-- Correntes do Destino - Estilos de Combate / Antonio Fagulhas v0.7.4
--
-- Esta migration implementa um sistema GENERICO de modos de combate mutuamente
-- exclusivos. O primeiro uso é Antonio (Pincel Mágico x Postura de Luta), mas a
-- mecânica não depende do nome/personagem e pode ser reaproveitada futuramente.
--
-- IMPORTANTE: este arquivo contém apenas mecânicas que o jogador pode conhecer.
-- Nenhuma explicação narrativa secreta sobre a origem dos poderes é armazenada aqui.

alter table public.combat_participants
  add column if not exists active_combat_mode text,
  add column if not exists combat_mode_changed_epoch int not null default -1,
  add column if not exists combat_mode_bonus_used boolean not null default false,
  add column if not exists combat_bridge_used boolean not null default false,
  add column if not exists combat_bridge_type text;

alter table public.combat_actions
  add column if not exists damage_flat_bonus int not null default 0,
  add column if not exists damage_factor numeric not null default 1,
  add column if not exists on_hit_effect jsonb,
  add column if not exists attacker_turn_epoch int not null default 0,
  add column if not exists damage_reroll_used boolean not null default false,
  add column if not exists damage_reroll_original_total int;

alter table public.combat_actions drop constraint if exists combat_actions_damage_factor_check;
alter table public.combat_actions add constraint combat_actions_damage_factor_check
check (damage_factor > 0 and damage_factor <= 4);

-- Novos participantes sempre começam sem postura/modo escolhido.
create or replace function public.initialize_combat_runtime()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare
  defs jsonb;
  item jsonb;
  res jsonb := '{}'::jsonb;
  k text;
  maxv int;
  startv int;
begin
  select coalesce(c.special_resources,'[]'::jsonb)
  into defs
  from public.characters c
  where c.id=new.character_id;

  for item in select value from jsonb_array_elements(defs)
  loop
    k := nullif(item->>'key','');
    if k is null then continue; end if;
    maxv := greatest(0,coalesce((item->>'max')::int,0));
    startv := greatest(0,least(maxv,coalesce((item->>'start_combat')::int,maxv)));
    res := res || jsonb_build_object(
      k,
      jsonb_build_object(
        'name',coalesce(nullif(item->>'name',''),k),
        'current',startv,
        'max',maxv
      )
    );
  end loop;

  new.resources := res;
  new.active_summon_character_id := null;
  new.turn_epoch := 0;
  new.active_combat_mode := null;
  new.combat_mode_changed_epoch := -1;
  new.combat_mode_bonus_used := false;
  new.combat_bridge_used := false;
  new.combat_bridge_type := null;
  return new;
end;
$$;

-- Efeitos temporários podem modificar uma perícia de maneira estruturada.
-- Ex.: Punho da Fornalha aplica -1 em Fortitude até o fim do próximo turno.
create or replace function public.combat_test_bonus(p_character_id uuid, p_attribute_key text, p_skill_key text)
returns int
language sql stable security definer set search_path=public
as $$
  select coalesce(public.combat_attribute_modifier(p_character_id,p_attribute_key),0)
       + coalesce(public.combat_skill_bonus(p_character_id,p_skill_key),0)
       + coalesce((
          select sum(coalesce((s.data->'skill_modifiers'->>p_skill_key)::int,0))
          from public.combat_effect_states s
          join public.combat_encounters e on e.id=s.encounter_id and e.status='active'
          where s.target_character_id=p_character_id
            and jsonb_typeof(s.data->'skill_modifiers')='object'
       ),0);
$$;

-- ---------------------------------------------------------------------------
-- ATAQUES: preserva o motor anterior e adiciona bônus/penalidades de estilo.
-- ---------------------------------------------------------------------------

alter function public.create_combat_attack(
  uuid,uuid,uuid,text,text,uuid,text,text,int,int,boolean,boolean,int,int,int,text,text,text,int
) rename to create_combat_attack_v071_core;

create or replace function public.create_combat_attack(
  p_encounter_id uuid,
  p_attacker_character_id uuid,
  p_target_character_id uuid,
  p_label text,
  p_source_type text default 'basic',
  p_source_id uuid default null,
  p_attack_attribute_key text default 'strength',
  p_attack_skill_key text default 'fight',
  p_pa_cost int default 1,
  p_ea_cost int default 0,
  p_uses_cursed_energy boolean default false,
  p_forced_critical boolean default false,
  p_critical_threshold int default 20,
  p_damage_dice_count int default 1,
  p_damage_die int default 6,
  p_damage_flat_attribute_key text default 'strength',
  p_condition_key text default null,
  p_roll_mode text default 'normal',
  p_roll_count int default 1
)
returns uuid
language plpgsql security definer set search_path=public
as $$
declare
  action_id uuid;
  cp public.combat_participants%rowtype;
  a public.combat_actions%rowtype;
  ab public.abilities%rowtype;
  effect_rec record;
  effect_bonus int := 0;
  bridge_bonus int := 0;
  mode_damage_bonus int := 0;
  is_own_turn boolean := false;
  new_total int;
  new_status text;
  log_id uuid;
begin
  action_id := public.create_combat_attack_v071_core(
    p_encounter_id,p_attacker_character_id,p_target_character_id,p_label,p_source_type,p_source_id,
    p_attack_attribute_key,p_attack_skill_key,p_pa_cost,p_ea_cost,p_uses_cursed_energy,p_forced_critical,
    p_critical_threshold,p_damage_dice_count,p_damage_die,p_damage_flat_attribute_key,p_condition_key,p_roll_mode,p_roll_count
  );

  select * into cp
  from public.combat_participants
  where encounter_id=p_encounter_id and character_id=p_attacker_character_id
  for update;

  select exists(
    select 1 from public.combat_encounters e
    where e.id=p_encounter_id and e.active_participant_id=cp.id
  ) into is_own_turn;

  if p_source_id is not null and p_source_type in ('ability','ability_reaction') then
    select * into ab from public.abilities where id=p_source_id;
  end if;

  -- Postura de Luta: primeiro ataque corpo a corpo do próprio turno recebe +1 dano.
  if is_own_turn
     and cp.active_combat_mode='flame_monk'
     and not cp.combat_mode_bonus_used
     and p_attack_skill_key='fight'
     and p_source_type not in ('counterattack','reaction','ability_reaction','equipment_reaction','summon_ability_reaction') then
    mode_damage_bonus := 1;
    update public.combat_participants set combat_mode_bonus_used=true where id=cp.id;
  end if;

  -- Ritmo Híbrido, uso único do combate: ao migrar do Pincel para a Postura
  -- após acertar à distância no turno anterior, o próximo corpo a corpo recebe +1 acerto.
  if cp.combat_bridge_type='flame_accuracy' and p_attack_skill_key='fight' then
    bridge_bonus := 1;
    update public.combat_participants
      set combat_bridge_type=null,combat_bridge_used=true
    where id=cp.id;
  elsif cp.combat_bridge_type='brush_damage'
        and ab.id is not null
        and coalesce(ab.config->'tags','[]'::jsonb) ? 'painting_technique' then
    mode_damage_bonus := mode_damage_bonus + 1;
    update public.combat_participants
      set combat_bridge_type=null,combat_bridge_used=true
    where id=cp.id;
  end if;

  -- Penalidades/bônus temporários de acerto, consumidos no próximo ataque.
  for effect_rec in
    select s.* from public.combat_effect_states s
    where s.encounter_id=p_encounter_id
      and s.target_character_id=p_attacker_character_id
      and s.data ? 'attack_bonus'
      and (s.uses_remaining is null or s.uses_remaining>0)
    order by s.created_at
  loop
    effect_bonus := effect_bonus + coalesce((effect_rec.data->>'attack_bonus')::int,0);
    if effect_rec.uses_remaining is not null then
      update public.combat_effect_states
      set uses_remaining=greatest(0,uses_remaining-1)
      where id=effect_rec.id;
      if effect_rec.uses_remaining<=1 and coalesce((effect_rec.data->>'remove_when_empty')::boolean,true) then
        delete from public.combat_effect_states where id=effect_rec.id;
      end if;
    end if;
  end loop;

  select * into a from public.combat_actions where id=action_id for update;
  new_total := coalesce(a.attack_total,0)+bridge_bonus+effect_bonus;
  new_status := case
    when a.attack_natural=1 then 'miss'
    when a.attack_natural=20 or new_total>a.target_ca then 'pending_defense'
    else 'miss' end;

  update public.combat_actions
  set attacker_turn_epoch=coalesce(cp.turn_epoch,0),
      damage_flat_bonus=coalesce(damage_flat_bonus,0)+mode_damage_bonus,
      attack_bonus=coalesce(attack_bonus,0)+bridge_bonus+effect_bonus,
      attack_total=case when attack_total is null then null else new_total end,
      status=new_status,
      summary=case
        when new_status='miss' then 'O ataque não superou a defesa passiva.'
        else 'O ataque superou a defesa passiva. O alvo pode reagir.' end,
      updated_at=now()
  where id=action_id;

  -- Mantém o histórico de rolagem coerente com bônus aplicados depois da rolagem base.
  if bridge_bonus+effect_bonus<>0 then
    select id into log_id
    from public.roll_logs
    where encounter_id=p_encounter_id
      and character_id=p_attacker_character_id
      and roll_type='attack'
      and label=coalesce(nullif(p_label,''),'Ataque')
    order by created_at desc limit 1;
    if log_id is not null then
      update public.roll_logs
      set bonus=bonus+bridge_bonus+effect_bonus,total=total+bridge_bonus+effect_bonus
      where id=log_id;
    end if;
  end if;

  return action_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- HABILIDADES: modos, Pincel/Postura, Sobrecargas e efeitos pós-acerto.
-- ---------------------------------------------------------------------------

alter function public.use_ability_in_combat(uuid,uuid,uuid,uuid,text,text,jsonb)
rename to use_ability_in_combat_v071_core;

create or replace function public.use_ability_in_combat(
  p_encounter_id uuid,
  p_actor_character_id uuid,
  p_ability_id uuid,
  p_target_character_id uuid default null,
  p_mode_key text default null,
  p_overload_key text default null,
  p_options jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql security definer set search_path=public
as $$
declare
  ab public.abilities%rowtype;
  cfg jsonb;
  cp public.combat_participants%rowtype;
  old_mode text;
  requested_mode text;
  required_mode text;
  special text;
  result jsonb;
  action_id uuid;
  second_action_id uuid;
  second_target uuid;
  best_attr text;
  best_mod int := -999;
  candidate text;
  candidate_mod int;
  extra_bonus int := 0;
  target_ids jsonb;
  target_text text;
  target_uuid uuid;
  latest_action public.combat_actions%rowtype;
  refund int := 0;
  has_prior_hit boolean := false;
  brush_bonus_consumed boolean := false;
begin
  select * into ab from public.abilities where id=p_ability_id;
  if ab.id is null or ab.status<>'approved' then raise exception 'Habilidade não encontrada ou não aprovada.'; end if;
  if not (public.is_master() or public.owns_character(p_actor_character_id)) then raise exception 'Sem permissão para usar esta ficha.'; end if;

  cfg:=public.resolve_config_mode(ab.config,p_mode_key,p_overload_key);
  special:=coalesce(cfg->>'special_action','');
  required_mode:=nullif(cfg->>'requires_combat_mode','');

  select * into cp
  from public.combat_participants
  where encounter_id=p_encounter_id and character_id=p_actor_character_id
  for update;
  if cp.id is null then raise exception 'O personagem não participa do combate.'; end if;

  -- Selecionar/alternar modo é uma ação de interface sem custo, permitida apenas
  -- no próprio turno e antes de qualquer outra ação daquele turno.
  if special='set_combat_mode' then
    perform public.assert_active_combat_turn(p_encounter_id,p_actor_character_id);
    requested_mode:=nullif(cfg->>'combat_mode_key','');
    if requested_mode is null then raise exception 'Modo de combate não configurado.'; end if;
    if cp.active_combat_mode=requested_mode then
      return jsonb_build_object('kind','combat_mode','mode',requested_mode,'changed',false);
    end if;
    if cp.combat_mode_changed_epoch=cp.turn_epoch then
      raise exception 'Você já escolheu ou trocou seu estilo neste turno.';
    end if;
    if exists(
      select 1 from public.combat_actions a
      where a.encounter_id=p_encounter_id
        and a.attacker_character_id=p_actor_character_id
        and a.attacker_turn_epoch=cp.turn_epoch
    ) or exists(
      select 1 from public.combat_usage u
      where u.encounter_id=p_encounter_id
        and u.user_character_id=p_actor_character_id
        and u.turn_epoch=cp.turn_epoch
    ) then
      raise exception 'O estilo deve ser escolhido no início do turno, antes de realizar outras ações.';
    end if;

    old_mode:=cp.active_combat_mode;

    -- Ritmo Híbrido: somente uma transição premiada por combate.
    if old_mode is not null and old_mode<>requested_mode and not cp.combat_bridge_used then
      if old_mode='flame_monk' and requested_mode='magic_brush' then
        select exists(
          select 1 from public.combat_actions a
          where a.encounter_id=p_encounter_id
            and a.attacker_character_id=p_actor_character_id
            and a.attacker_turn_epoch=cp.turn_epoch-1
            and a.attack_skill_key='fight'
            and a.status='resolved'
        ) into has_prior_hit;
        if has_prior_hit then cp.combat_bridge_type:='brush_damage'; end if;
      elsif old_mode='magic_brush' and requested_mode='flame_monk' then
        select exists(
          select 1
          from public.combat_actions a
          join public.abilities x on x.id=a.source_id
          where a.encounter_id=p_encounter_id
            and a.attacker_character_id=p_actor_character_id
            and a.attacker_turn_epoch=cp.turn_epoch-1
            and a.status='resolved'
            and coalesce(x.config->'tags','[]'::jsonb) ? 'painting_technique'
        ) into has_prior_hit;
        if has_prior_hit then cp.combat_bridge_type:='flame_accuracy'; end if;
      end if;
    end if;

    update public.combat_participants
    set active_combat_mode=requested_mode,
        combat_mode_changed_epoch=turn_epoch,
        combat_mode_bonus_used=false,
        combat_bridge_type=cp.combat_bridge_type
    where id=cp.id;

    return jsonb_build_object(
      'kind','combat_mode','mode',requested_mode,'previous_mode',old_mode,
      'bridge',cp.combat_bridge_type,'changed',true
    );
  end if;

  if required_mode is not null and cp.active_combat_mode is distinct from required_mode then
    raise exception 'Esta habilidade exige o estilo correto antes de ser usada.';
  end if;

  result:=public.use_ability_in_combat_v071_core(
    p_encounter_id,p_actor_character_id,p_ability_id,p_target_character_id,p_mode_key,p_overload_key,p_options
  );

  -- Pincel Mágico: a primeira técnica de pintura usada desde o início do próprio
  -- turno custa 1 EA a menos, até o mínimo efetivo de 1 EA.
  if cp.active_combat_mode='magic_brush'
     and coalesce(ab.config->'tags','[]'::jsonb) ? 'painting_technique'
     and not cp.combat_mode_bonus_used
     and greatest(0,coalesce((cfg->>'ea_cost')::int,0))>1 then
    refund:=1;
    update public.combat_participants
    set current_ea=least(public.combat_max_ea(p_actor_character_id),coalesce(current_ea,0)+refund),
        combat_mode_bonus_used=true
    where id=cp.id;
    result:=result||jsonb_build_object('combat_mode_ea_refund',refund);
  end if;

  if result->>'kind'='attack' then
    action_id:=(result->>'action_id')::uuid;

    -- Algumas habilidades antigas usam o maior modificador entre dois atributos.
    if jsonb_typeof(cfg->'damage_flat_best_of')='array' then
      best_attr:=null;
      for candidate in select value from jsonb_array_elements_text(cfg->'damage_flat_best_of')
      loop
        candidate_mod:=public.combat_attribute_modifier(p_actor_character_id,candidate);
        if best_attr is null or candidate_mod>best_mod then
          best_attr:=candidate; best_mod:=candidate_mod;
        end if;
      end loop;
      if best_attr is not null then
        update public.combat_actions set damage_flat_attribute_key=best_attr where id=action_id;
      end if;
    end if;

    update public.combat_actions
    set damage_factor=greatest(0.01,least(4,coalesce((cfg->>'damage_factor')::numeric,1))),
        damage_flat_bonus=coalesce(damage_flat_bonus,0)+coalesce((cfg->>'damage_flat_bonus')::int,0),
        on_hit_effect=case when jsonb_typeof(cfg->'on_hit_effect')='object' then cfg->'on_hit_effect' else on_hit_effect end
    where id=action_id;

    -- Sequência Escaldante: +1 acerto se o mesmo alvo sofreu um corpo a corpo
    -- resolvido de Antonio no turno anterior dele.
    if coalesce((cfg->>'prior_turn_same_target_attack_bonus')::int,0)<>0 then
      select exists(
        select 1 from public.combat_actions a
        where a.encounter_id=p_encounter_id
          and a.attacker_character_id=p_actor_character_id
          and a.target_character_id=p_target_character_id
          and a.attacker_turn_epoch=cp.turn_epoch-1
          and a.attack_skill_key='fight'
          and a.status='resolved'
      ) into has_prior_hit;
      if has_prior_hit then
        extra_bonus:=coalesce((cfg->>'prior_turn_same_target_attack_bonus')::int,0);
        update public.combat_actions
        set attack_bonus=attack_bonus+extra_bonus,
            attack_total=attack_total+extra_bonus,
            status=case when attack_natural=1 then 'miss' when attack_natural=20 or attack_total+extra_bonus>target_ca then 'pending_defense' else 'miss' end,
            summary=case when attack_natural<>1 and (attack_natural=20 or attack_total+extra_bonus>target_ca)
              then 'Ritmo de Pressão: +1 no acerto. O alvo pode reagir.'
              else 'Ritmo de Pressão: +1 no acerto, mas o ataque não superou a defesa passiva.' end,
            updated_at=now()
        where id=action_id;
      end if;
    end if;

    -- A Linha Que Separa: Sobrecarga cria um segundo ataque contra outro alvo,
    -- com o custo extra já cobrado pelo motor e metade do dano final.
    if coalesce((cfg->>'requires_secondary_target')::boolean,false) then
      begin second_target:=nullif(p_options->>'secondary_target_id','')::uuid;
      exception when invalid_text_representation then second_target:=null; end;
      if second_target is null or second_target=p_target_character_id then
        raise exception 'Escolha um segundo alvo diferente para a Sobrecarga.';
      end if;
      perform public.assert_combat_participant(p_encounter_id,second_target);
      second_action_id:=public.create_combat_attack(
        p_encounter_id,p_actor_character_id,second_target,ab.name||' — segundo alvo',
        'ability',ab.id,
        coalesce(cfg->>'attack_attribute_key','cursed_control'),coalesce(cfg->>'attack_skill_key','channeling'),
        0,0,coalesce((cfg->>'uses_cursed_energy')::boolean,true),
        coalesce((cfg->>'forced_critical')::boolean,false),greatest(2,least(20,coalesce((cfg->>'critical_threshold')::int,20))),
        greatest(0,coalesce((cfg->>'damage_dice_count')::int,0)),greatest(0,coalesce((cfg->>'damage_die')::int,0)),
        nullif(cfg->>'damage_flat_attribute_key',''),nullif(cfg->>'condition_key',''),'normal',1
      );
      update public.combat_actions
      set damage_factor=greatest(0.01,least(1,coalesce((cfg->>'secondary_target_damage_factor')::numeric,0.5))),
          attacker_turn_epoch=cp.turn_epoch
      where id=second_action_id;
      result:=result||jsonb_build_object('secondary_action_id',second_action_id);
    end if;
  end if;

  if special='place_delayed_bomb' then
    if exists(
      select 1 from public.combat_effect_states s
      where s.encounter_id=p_encounter_id
        and s.source_character_id=p_actor_character_id
        and s.effect_key='art_bomb'
    ) then raise exception 'Só pode existir uma Explosão Artística preparada por vez.'; end if;

    target_ids:=coalesce(p_options->'target_ids','[]'::jsonb);
    if jsonb_typeof(target_ids)<>'array' or jsonb_array_length(target_ids)=0 then
      raise exception 'Escolha pelo menos um alvo dentro da área da bomba.';
    end if;
    for target_text in select value from jsonb_array_elements_text(target_ids)
    loop
      begin target_uuid:=target_text::uuid;
      exception when invalid_text_representation then raise exception 'Alvo inválido na área da bomba.'; end;
      if target_uuid=p_actor_character_id then raise exception 'Antonio não pode marcar a si mesmo como alvo da área.'; end if;
      perform public.assert_combat_participant(p_encounter_id,target_uuid);
    end loop;

    -- Ritmo Híbrido: se a transição Corpo a Corpo -> Pincel foi conquistada,
    -- a próxima técnica de pintura que realmente cause dano recebe +1. A bomba
    -- conta como essa próxima técnica no momento em que é preparada.
    if cp.combat_bridge_type='brush_damage' then
      brush_bonus_consumed:=true;
      update public.combat_participants
      set combat_bridge_type=null, combat_bridge_used=true
      where id=cp.id;
    end if;

    insert into public.combat_effect_states(
      encounter_id,source_character_id,target_character_id,source_type,source_id,effect_key,name,data
    ) values(
      p_encounter_id,p_actor_character_id,p_actor_character_id,'ability',ab.id,'art_bomb','Explosão Artística preparada',
      jsonb_build_object(
        'target_ids',target_ids,
        'damage_dice_count',coalesce((cfg->>'bomb_damage_dice_count')::int,1),
        'damage_die',coalesce((cfg->>'bomb_damage_die')::int,8),
        'flat_bonus',coalesce((cfg->>'bomb_flat_bonus')::int,2)+case when brush_bonus_consumed then 1 else 0 end,
        'flat_attribute_key',coalesce(cfg->>'bomb_flat_attribute_key','cursed_control'),
        'defender_attribute','dexterity','defender_skill','reflexes',
        'detonate_manually',true
      )
    );
    result:=result||jsonb_build_object('bomb_prepared',true,'targets',target_ids);
  end if;

  if special='boost_recent_attack' then
    begin action_id:=nullif(p_options->>'action_id','')::uuid;
    exception when invalid_text_representation then action_id:=null; end;
    if action_id is null then raise exception 'Escolha a rolagem que receberá as Setas.'; end if;

    select * into latest_action
    from public.combat_actions
    where encounter_id=p_encounter_id
    order by created_at desc
    limit 1
    for update;

    if latest_action.id is distinct from action_id then
      raise exception 'As Setas só podem alterar a rolagem de ataque mais recente.';
    end if;
    if latest_action.status not in ('miss','pending_defense') then raise exception 'Essa rolagem já foi resolvida.'; end if;
    if latest_action.attack_natural=1 then raise exception '1 natural não pode ser corrigido por este efeito.'; end if;

    extra_bonus:=greatest(0,coalesce((cfg->>'attack_bonus')::int,2));
    update public.combat_actions
    set attack_bonus=attack_bonus+extra_bonus,
        attack_total=attack_total+extra_bonus,
        status=case when attack_natural=20 or attack_total+extra_bonus>target_ca then 'pending_defense' else 'miss' end,
        summary=case when attack_natural=20 or attack_total+extra_bonus>target_ca
          then 'As Setas Indicam a Direção: +'||extra_bonus||' no acerto. O ataque agora supera a defesa passiva.'
          else 'As Setas Indicam a Direção: +'||extra_bonus||' no acerto, mas ainda não supera a defesa passiva.' end,
        updated_at=now()
    where id=action_id;
    result:=result||jsonb_build_object('boosted_action_id',action_id,'attack_bonus_added',extra_bonus);
  end if;

  return result;
end;
$$;

-- ---------------------------------------------------------------------------
-- DANO: bônus fixo, dano fracionado, queimadura e efeitos pós-acerto.
-- ---------------------------------------------------------------------------

create or replace function public.resolve_combat_hit(p_action_id uuid, p_half boolean default false)
returns public.combat_actions
language plpgsql security definer set search_path=public
as $$
declare
  a public.combat_actions%rowtype;
  tp public.combat_participants%rowtype;
  ap public.combat_participants%rowtype;
  d jsonb; rolled int; flat int; total int; final_total int; actual_kokusen boolean;
  effect_rec record;
  red_roll jsonb;
  red_amount int;
  total_reduction int := 0;
  immune boolean := false;
  bonus_damage_roll jsonb;
  bonus_damage_total int := 0;
  bonus_damage_effect record;
  hit_eff jsonb;
  existing_refresh boolean := false;
  contest_roll jsonb;
  contest_nat int;
  contest_bonus int;
  contest_total int;
  contest_dc int;
  contest_failed boolean;
  ekey text;
  ename text;
  edata jsonb;
  eturns int;
  euses int;
begin
  select * into a from public.combat_actions where id=p_action_id for update;
  if a.id is null then raise exception 'Ação não encontrada.'; end if;
  if not (public.is_master() or public.owns_character(a.target_character_id)) then raise exception 'Somente o alvo ou o Mestre pode resolver o golpe.'; end if;
  select * into tp from public.combat_participants where encounter_id=a.encounter_id and character_id=a.target_character_id for update;
  select * into ap from public.combat_participants where encounter_id=a.encounter_id and character_id=a.attacker_character_id for update;

  hit_eff:=a.on_hit_effect;
  if jsonb_typeof(hit_eff)='object'
     and coalesce((hit_eff->>'refresh_only_if_existing')::boolean,false) then
    select exists(
      select 1 from public.combat_effect_states s
      where s.encounter_id=a.encounter_id
        and s.target_character_id=a.target_character_id
        and s.effect_key=coalesce(nullif(hit_eff->>'key',''),'burning')
    ) into existing_refresh;
  end if;

  if existing_refresh then
    d:=jsonb_build_object('rolls','[]'::jsonb,'total',0);
    rolled:=0;
    flat:=0;
    total:=0;
  else
    d:=public.roll_pg_damage(a.damage_dice_count,a.damage_die,a.is_critical);
    rolled:=coalesce((d->>'total')::int,0);
    flat:=case when a.damage_flat_attribute_key is null or a.damage_flat_attribute_key='' then 0 else public.combat_attribute_modifier(a.attacker_character_id,a.damage_flat_attribute_key) end;
    total:=greatest(0,rolled+flat+coalesce(a.damage_flat_bonus,0));
    total:=greatest(0,floor(total*coalesce(a.damage_factor,1))::int);
  end if;

  select s.* into bonus_damage_effect
  from public.combat_effect_states s
  where s.encounter_id=a.encounter_id
    and s.target_character_id=a.attacker_character_id
    and coalesce((s.data->>'bonus_damage_dice_count')::int,0)>0
    and coalesce((s.data->>'bonus_damage_die')::int,0)>0
    and (s.uses_remaining is null or s.uses_remaining>0)
  order by s.created_at
  limit 1
  for update;

  if bonus_damage_effect.id is not null and not existing_refresh then
    bonus_damage_roll:=public.roll_pg_damage(
      coalesce((bonus_damage_effect.data->>'bonus_damage_dice_count')::int,0),
      coalesce((bonus_damage_effect.data->>'bonus_damage_die')::int,0),false
    );
    bonus_damage_total:=greatest(0,coalesce((bonus_damage_roll->>'total')::int,0));
    total:=total+bonus_damage_total;
    if bonus_damage_effect.uses_remaining is not null then
      update public.combat_effect_states set uses_remaining=greatest(0,uses_remaining-1) where id=bonus_damage_effect.id;
      if bonus_damage_effect.uses_remaining<=1 and coalesce((bonus_damage_effect.data->>'remove_when_empty')::boolean,true) then
        delete from public.combat_effect_states where id=bonus_damage_effect.id;
      end if;
    end if;
  end if;

  final_total:=case when p_half then floor(total/2.0)::int else total end;

  select exists(
    select 1 from public.combat_effect_states s
    where s.encounter_id=a.encounter_id and s.target_character_id=a.target_character_id
      and coalesce((s.data->>'immune_to_damage')::boolean,false)
  ) into immune;

  if immune then
    final_total:=0;
  else
    for effect_rec in
      select s.* from public.combat_effect_states s
      where s.encounter_id=a.encounter_id
        and s.target_character_id=a.target_character_id
        and coalesce((s.data->>'damage_reduction_dice_count')::int,0)>0
        and (s.uses_remaining is null or s.uses_remaining>0)
        and (
          coalesce(s.data->>'applies_to','any')='any'
          or (
            s.data->>'applies_to' in ('physical','physical_projectile')
            and (a.source_type in ('basic','equipment','counterattack') or a.attack_attribute_key in ('strength','dexterity'))
          )
        )
      order by s.created_at
    loop
      red_roll:=public.roll_pg_damage(
        coalesce((effect_rec.data->>'damage_reduction_dice_count')::int,0),
        coalesce((effect_rec.data->>'damage_reduction_die')::int,0),false
      );
      red_amount:=coalesce((red_roll->>'total')::int,0)+coalesce((effect_rec.data->>'damage_reduction_flat')::int,0);
      total_reduction:=total_reduction+greatest(0,red_amount);
      if effect_rec.uses_remaining is not null then
        update public.combat_effect_states set uses_remaining=greatest(0,uses_remaining-1) where id=effect_rec.id;
        if effect_rec.uses_remaining<=1 and coalesce((effect_rec.data->>'remove_when_empty')::boolean,true) then
          delete from public.combat_effect_states where id=effect_rec.id;
        end if;
      end if;
    end loop;
    final_total:=greatest(0,final_total-total_reduction);
  end if;

  actual_kokusen:=a.kokusen_eligible and not a.kokusen_denied;

  update public.combat_participants set
    current_ps=greatest(0,coalesce(current_ps,public.combat_max_ps(a.target_character_id))-final_total),
    defeated=(greatest(0,coalesce(current_ps,public.combat_max_ps(a.target_character_id))-final_total)=0),
    conditions=case
      when immune then conditions
      when a.condition_key is not null and a.condition_key<>'' and not (conditions ? a.condition_key)
      then conditions || jsonb_build_array(a.condition_key)
      else conditions end
  where id=tp.id;

  if actual_kokusen then
    update public.combat_participants set black_flash_turns=2,black_flash_discount_used=false where id=ap.id;
  end if;

  update public.combat_actions set
    damage_rolls=d->'rolls',damage_flat=flat+coalesce(a.damage_flat_bonus,0),damage_total=final_total,
    damage_reduction=case when p_half then 'half' else 'none' end,
    is_kokusen=actual_kokusen,status='resolved',
    summary=case
      when existing_refresh then 'O efeito foi renovado; como o alvo já estava sob o mesmo efeito, o dano inicial não foi reaplicado.'
      when immune then 'O golpe conectou, mas o alvo estava protegido contra dano por um efeito ativo.'
      when total_reduction>0 then 'O golpe conectou. Efeitos ativos reduziram '||total_reduction||' de dano.'
      when actual_kokusen then 'Kokusen! O golpe conectou e o atacante entrou em Fluxo Negro.'
      when p_half then 'O alvo resistiu e reduziu o dano pela metade.'
      else 'O golpe conectou.' end,
    updated_at=now()
  where id=a.id returning * into a;

  -- Efeito pós-acerto configurado pela habilidade.
  if not immune and jsonb_typeof(hit_eff)='object' then
    ekey:=coalesce(nullif(hit_eff->>'key',''),a.label);
    ename:=coalesce(nullif(hit_eff->>'name',''),a.label);
    edata:=coalesce(hit_eff->'data','{}'::jsonb);
    eturns:=nullif(coalesce((hit_eff->>'remaining_turns')::int,0),0);
    euses:=nullif(coalesce((hit_eff->>'uses')::int,0),0);

    if coalesce(hit_eff->>'type','')='contest_effect' then
      contest_bonus:=public.combat_test_bonus(
        a.target_character_id,
        coalesce(hit_eff->>'defender_attribute','resistance'),
        coalesce(hit_eff->>'defender_skill','steadiness')
      );
      contest_dc:=8+public.combat_test_bonus(
        a.attacker_character_id,
        coalesce(hit_eff->>'dc_attribute','strength'),
        coalesce(hit_eff->>'dc_skill','fight')
      );
      contest_roll:=public.roll_pg_d20('normal',1);
      contest_nat:=(contest_roll->>'natural')::int;
      contest_total:=contest_nat+contest_bonus;
      contest_failed:=contest_nat=1 or (contest_nat<>20 and contest_total<contest_dc);

      insert into public.roll_logs(encounter_id,character_id,label,roll_type,expression,rolls,natural_roll,bonus,total,is_critical,kokusen_eligible,visibility)
      values(a.encounter_id,a.target_character_id,ename||' — resistência','defense','1d20',contest_roll->'rolls',contest_nat,contest_bonus,contest_total,contest_nat=20,false,'public');

      if contest_failed then
        edata:=coalesce(hit_eff->'on_fail_data','{}'::jsonb);
        ename:=coalesce(nullif(hit_eff->>'on_fail_name',''),ename);
        ekey:=coalesce(nullif(hit_eff->>'on_fail_key',''),ekey);
        eturns:=nullif(coalesce((hit_eff->>'on_fail_remaining_turns')::int,0),0);
        euses:=nullif(coalesce((hit_eff->>'on_fail_uses')::int,0),0);
        delete from public.combat_effect_states s
        where s.encounter_id=a.encounter_id and s.target_character_id=a.target_character_id and s.effect_key=ekey;
        insert into public.combat_effect_states(encounter_id,source_character_id,target_character_id,source_type,source_id,effect_key,name,data,remaining_turns,uses_remaining)
        values(a.encounter_id,a.attacker_character_id,a.target_character_id,'ability',a.source_id,ekey,ename,edata,eturns,euses);
      end if;
    else
      if coalesce(hit_eff->>'type','')='burn' then
        edata:=edata||jsonb_build_object(
          'start_turn_damage_dice_count',coalesce((hit_eff->>'start_turn_damage_dice_count')::int,1),
          'start_turn_damage_die',coalesce((hit_eff->>'start_turn_damage_die')::int,4),
          'extinguish_pa_cost',coalesce((hit_eff->>'extinguish_pa_cost')::int,1),
          'decrement_on','target_start'
        );
      end if;
      delete from public.combat_effect_states s
      where s.encounter_id=a.encounter_id and s.target_character_id=a.target_character_id and s.effect_key=ekey;
      insert into public.combat_effect_states(encounter_id,source_character_id,target_character_id,source_type,source_id,effect_key,name,data,remaining_turns,uses_remaining)
      values(a.encounter_id,a.attacker_character_id,a.target_character_id,'ability',a.source_id,ekey,ename,edata,eturns,euses);
    end if;
  end if;

  return a;
end;
$$;

-- ---------------------------------------------------------------------------
-- TURNOS: reset do bônus de modo e dano no início do turno (queimaduras).
-- ---------------------------------------------------------------------------

alter function public.start_combat_turn(uuid) rename to start_combat_turn_v071_core;

create or replace function public.start_combat_turn(p_participant_id uuid)
returns public.combat_participants
language plpgsql security definer set search_path=public
as $$
declare
  p public.combat_participants%rowtype;
  burn_rec record;
  dmg jsonb;
  dmg_total int;
begin
  p:=public.start_combat_turn_v071_core(p_participant_id);

  update public.combat_participants
  set combat_mode_bonus_used=false
  where id=p.id
  returning * into p;

  for burn_rec in
    select s.* from public.combat_effect_states s
    where s.encounter_id=p.encounter_id
      and s.target_character_id=p.character_id
      and coalesce((s.data->>'start_turn_damage_dice_count')::int,0)>0
      and coalesce((s.data->>'start_turn_damage_die')::int,0)>0
    order by s.created_at
  loop
    dmg:=public.roll_pg_damage(
      coalesce((burn_rec.data->>'start_turn_damage_dice_count')::int,1),
      coalesce((burn_rec.data->>'start_turn_damage_die')::int,4),false
    );
    dmg_total:=greatest(0,coalesce((dmg->>'total')::int,0));
    update public.combat_participants
    set current_ps=greatest(0,current_ps-dmg_total),
        defeated=(greatest(0,current_ps-dmg_total)=0)
    where id=p.id returning * into p;

    insert into public.roll_logs(encounter_id,character_id,label,roll_type,expression,rolls,natural_roll,bonus,total,is_critical,kokusen_eligible,visibility)
    values(p.encounter_id,p.character_id,burn_rec.name,'effect',coalesce((burn_rec.data->>'start_turn_damage_dice_count')::int,1)||'d'||coalesce((burn_rec.data->>'start_turn_damage_die')::int,4),dmg->'rolls',null,0,dmg_total,false,false,'public');

    if burn_rec.remaining_turns is not null then
      if burn_rec.remaining_turns<=1 then
        delete from public.combat_effect_states where id=burn_rec.id;
      else
        update public.combat_effect_states set remaining_turns=remaining_turns-1 where id=burn_rec.id;
      end if;
    end if;
  end loop;

  return p;
end;
$$;

create or replace function public.extinguish_combat_effect(p_encounter_id uuid,p_effect_id uuid)
returns void
language plpgsql security definer set search_path=public
as $$
declare
  s public.combat_effect_states%rowtype;
  cp public.combat_participants%rowtype;
  pa_cost int;
begin
  select * into s from public.combat_effect_states where id=p_effect_id and encounter_id=p_encounter_id for update;
  if s.id is null then raise exception 'Efeito não encontrado.'; end if;
  if not (public.is_master() or public.owns_character(s.target_character_id)) then raise exception 'Sem permissão.'; end if;
  pa_cost:=coalesce((s.data->>'extinguish_pa_cost')::int,0);
  if pa_cost<=0 then raise exception 'Este efeito não pode ser removido por esta ação.'; end if;
  perform public.assert_active_combat_turn(p_encounter_id,s.target_character_id);
  perform public.spend_ability_cost(p_encounter_id,s.target_character_id,pa_cost,0,false);
  delete from public.combat_effect_states where id=s.id;
end;
$$;

-- Explosão Artística preparada: o Mestre/jogador detona manualmente ao fim da
-- rodada real da mesa, pois o motor não inventa uma rodada espacial própria.
create or replace function public.detonate_art_bomb(p_encounter_id uuid,p_actor_character_id uuid)
returns jsonb
language plpgsql security definer set search_path=public
as $$
declare
  s public.combat_effect_states%rowtype;
  ids jsonb;
  target_text text;
  target_id uuid;
  target_part public.combat_participants%rowtype;
  dmg jsonb;
  dmg_total int;
  flat int;
  base_total int;
  def_roll jsonb;
  def_nat int;
  def_bonus int;
  def_total int;
  dc int;
  final_damage int;
  results jsonb:='[]'::jsonb;
begin
  if not (public.is_master() or public.owns_character(p_actor_character_id)) then raise exception 'Sem permissão.'; end if;
  select * into s from public.combat_effect_states
  where encounter_id=p_encounter_id and source_character_id=p_actor_character_id and effect_key='art_bomb'
  order by created_at limit 1 for update;
  if s.id is null then raise exception 'Nenhuma Explosão Artística está preparada.'; end if;

  ids:=coalesce(s.data->'target_ids','[]'::jsonb);
  dmg:=public.roll_pg_damage(coalesce((s.data->>'damage_dice_count')::int,1),coalesce((s.data->>'damage_die')::int,8),false);
  flat:=coalesce((s.data->>'flat_bonus')::int,0)+public.combat_attribute_modifier(p_actor_character_id,coalesce(s.data->>'flat_attribute_key','cursed_control'));
  base_total:=greatest(0,coalesce((dmg->>'total')::int,0)+flat);
  dc:=8+public.combat_test_bonus(p_actor_character_id,'cursed_control','channeling');

  for target_text in select value from jsonb_array_elements_text(ids)
  loop
    target_id:=target_text::uuid;
    select * into target_part from public.combat_participants where encounter_id=p_encounter_id and character_id=target_id for update;
    if target_part.id is null then continue; end if;
    def_bonus:=public.combat_test_bonus(target_id,'dexterity','reflexes');
    def_roll:=public.roll_pg_d20('normal',1);
    def_nat:=(def_roll->>'natural')::int;
    def_total:=def_nat+def_bonus;
    final_damage:=case when def_nat=20 or (def_nat<>1 and def_total>=dc) then floor(base_total/2.0)::int else base_total end;

    update public.combat_participants
    set current_ps=greatest(0,current_ps-final_damage),defeated=(greatest(0,current_ps-final_damage)=0)
    where id=target_part.id;

    insert into public.combat_actions(
      encounter_id,attacker_character_id,target_character_id,source_type,source_id,label,
      attack_bonus,attack_total,target_ca,pa_cost,ea_cost,ea_cost_paid,uses_cursed_energy,
      damage_dice_count,damage_die,damage_rolls,damage_flat,damage_total,damage_reduction,status,summary,attacker_turn_epoch
    ) values(
      p_encounter_id,p_actor_character_id,target_id,'custom',s.source_id,'Explosão Artística',
      0,null,dc,0,0,0,true,
      coalesce((s.data->>'damage_dice_count')::int,1),coalesce((s.data->>'damage_die')::int,8),dmg->'rolls',flat,final_damage,
      case when final_damage<base_total then 'half' else 'none' end,'resolved',
      case when final_damage<base_total then 'Reflexos conseguiu reduzir a explosão pela metade.' else 'A bomba pintada explodiu ao fim da rodada.' end,
      coalesce((select turn_epoch from public.combat_participants where encounter_id=p_encounter_id and character_id=p_actor_character_id),0)
    );

    insert into public.roll_logs(encounter_id,character_id,label,roll_type,expression,rolls,natural_roll,bonus,total,is_critical,kokusen_eligible,visibility)
    values(p_encounter_id,target_id,'Explosão Artística — Reflexos','defense','1d20',def_roll->'rolls',def_nat,def_bonus,def_total,def_nat=20,false,'public');

    results:=results||jsonb_build_array(jsonb_build_object('target_id',target_id,'defense_total',def_total,'damage',final_damage));
  end loop;

  delete from public.combat_effect_states where id=s.id;
  return jsonb_build_object('damage_rolls',dmg->'rolls','base_damage',base_total,'dc',dc,'results',results);
end;
$$;

-- ---------------------------------------------------------------------------
-- Tecido de Desvio: rerrola somente os dados de dano do golpe mais recente.
-- ---------------------------------------------------------------------------

alter function public.use_equipment_effect_in_combat(uuid,uuid,uuid,text,uuid,text)
rename to use_equipment_effect_in_combat_v071_core;

create or replace function public.use_equipment_effect_in_combat(
  p_encounter_id uuid,
  p_actor_character_id uuid,
  p_item_id uuid,
  p_effect_id text,
  p_target_character_id uuid default null,
  p_mode_key text default null
)
returns jsonb
language plpgsql security definer set search_path=public
as $$
declare
  item public.equipment%rowtype;
  effect jsonb;
  cfg jsonb;
  result jsonb;
  a public.combat_actions%rowtype;
  tp public.combat_participants%rowtype;
  new_roll jsonb;
  new_rolled int;
  old_rolled int:=0;
  x text;
  old_pre_reduction int;
  old_stage int;
  fixed_reduction int;
  new_pre_reduction int;
  new_stage int;
  new_final int;
  delta int;
begin
  select * into item from public.equipment where id=p_item_id;
  if item.id is null or item.character_id<>p_actor_character_id then raise exception 'Equipamento não encontrado.'; end if;
  select value into effect
  from jsonb_array_elements(coalesce(item.effects,'[]'::jsonb))
  where value->>'id'=p_effect_id limit 1;
  if effect is null then raise exception 'Efeito do equipamento não encontrado.'; end if;
  cfg:=public.resolve_config_mode(effect->'config',p_mode_key,null);

  result:=public.use_equipment_effect_in_combat_v071_core(
    p_encounter_id,p_actor_character_id,p_item_id,p_effect_id,p_target_character_id,p_mode_key
  );

  if coalesce(cfg->>'special_action','')<>'reroll_recent_damage' then return result; end if;

  select * into a
  from public.combat_actions
  where encounter_id=p_encounter_id
    and target_character_id=p_actor_character_id
    and status='resolved'
    and damage_total>0
    and not damage_reroll_used
  order by created_at desc
  limit 1 for update;
  if a.id is null then raise exception 'Não existe dano recente válido para o Tecido de Desvio.'; end if;

  for x in select value from jsonb_array_elements_text(coalesce(a.damage_rolls,'[]'::jsonb))
  loop old_rolled:=old_rolled+coalesce(x::int,0); end loop;

  new_roll:=public.roll_pg_damage(a.damage_dice_count,a.damage_die,a.is_critical);
  new_rolled:=coalesce((new_roll->>'total')::int,0);

  old_pre_reduction:=greatest(0,floor((old_rolled+coalesce(a.damage_flat,0))*coalesce(a.damage_factor,1))::int);
  old_stage:=case when a.damage_reduction='half' then floor(old_pre_reduction/2.0)::int else old_pre_reduction end;
  fixed_reduction:=greatest(0,old_stage-a.damage_total);

  new_pre_reduction:=greatest(0,floor((new_rolled+coalesce(a.damage_flat,0))*coalesce(a.damage_factor,1))::int);
  new_stage:=case when a.damage_reduction='half' then floor(new_pre_reduction/2.0)::int else new_pre_reduction end;
  new_final:=greatest(0,new_stage-fixed_reduction);
  delta:=a.damage_total-new_final;

  select * into tp from public.combat_participants where encounter_id=p_encounter_id and character_id=p_actor_character_id for update;
  update public.combat_participants
  set current_ps=greatest(0,least(public.combat_max_ps(p_actor_character_id),current_ps+delta)),
      defeated=(greatest(0,least(public.combat_max_ps(p_actor_character_id),current_ps+delta))=0)
  where id=tp.id;

  update public.combat_actions
  set damage_reroll_used=true,damage_reroll_original_total=a.damage_total,
      damage_rolls=new_roll->'rolls',damage_total=new_final,
      summary=trim(coalesce(summary,'')||' Tecido de Desvio: os dados de dano foram rerrolados; o segundo resultado foi mantido.'),
      updated_at=now()
  where id=a.id;

  return result||jsonb_build_object('rerolled_action_id',a.id,'old_damage',a.damage_total,'new_damage',new_final,'new_rolls',new_roll->'rolls');
end;
$$;

-- Ações que podem receber As Setas. Jogadores recebem apenas ações de outros
-- jogadores/da própria ficha; o Mestre enxerga qualquer atacante.
create or replace function public.get_boostable_combat_actions(p_encounter_id uuid)
returns table(
  id uuid, attacker_character_id uuid, target_character_id uuid,
  attacker_name text, target_name text, label text, status text,
  attack_natural int, attack_total int, target_ca int, created_at timestamptz
)
language sql stable security definer set search_path=public
as $$
  select a.id,a.attacker_character_id,a.target_character_id,
         trim(concat_ws(' ',ac.first_name,ac.last_name)),trim(concat_ws(' ',tc.first_name,tc.last_name)),
         a.label,a.status,a.attack_natural,a.attack_total,a.target_ca,a.created_at
  from public.combat_actions a
  join public.characters ac on ac.id=a.attacker_character_id
  join public.characters tc on tc.id=a.target_character_id
  where a.encounter_id=p_encounter_id
    and a.status in ('miss','pending_defense')
    and a.attack_natural is not null
    and (public.is_master() or ac.entity_type='player')
  order by a.created_at desc
  limit 12;
$$;

-- Snapshots antigos não conhecem as novas colunas NOT NULL de modo/ação.
-- Limpa apenas o histórico de desfazer anterior à atualização; o combate atual permanece.
delete from public.combat_undo_snapshots;

grant execute on function public.create_combat_attack(uuid,uuid,uuid,text,text,uuid,text,text,int,int,boolean,boolean,int,int,int,text,text,text,int) to authenticated;
grant execute on function public.use_ability_in_combat(uuid,uuid,uuid,uuid,text,text,jsonb) to authenticated;
grant execute on function public.resolve_combat_hit(uuid,boolean) to authenticated;
grant execute on function public.start_combat_turn(uuid) to authenticated;
grant execute on function public.extinguish_combat_effect(uuid,uuid) to authenticated;
grant execute on function public.detonate_art_bomb(uuid,uuid) to authenticated;
grant execute on function public.use_equipment_effect_in_combat(uuid,uuid,uuid,text,uuid,text) to authenticated;
grant execute on function public.get_boostable_combat_actions(uuid) to authenticated;

-- As versões core continuam internas.
revoke execute on function public.create_combat_attack_v071_core(uuid,uuid,uuid,text,text,uuid,text,text,int,int,boolean,boolean,int,int,int,text,text,text,int) from public,anon,authenticated;
revoke execute on function public.use_ability_in_combat_v071_core(uuid,uuid,uuid,uuid,text,text,jsonb) from public,anon,authenticated;
revoke execute on function public.use_equipment_effect_in_combat_v071_core(uuid,uuid,uuid,text,uuid,text) from public,anon,authenticated;
revoke execute on function public.start_combat_turn_v071_core(uuid) from public,anon,authenticated;
