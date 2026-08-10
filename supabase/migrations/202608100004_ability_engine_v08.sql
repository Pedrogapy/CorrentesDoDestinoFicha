-- Correntes do Destino - Motor de Habilidades Estruturadas v0.8.0
--
-- Objetivos desta migration:
-- 1) tornar alvo aliado/inimigo uma regra real do servidor;
-- 2) separar multiplicador dos DADOS e do MODIFICADOR de dano;
-- 3) suportar bônus condicionais, rerrolagens e efeitos pós-acerto;
-- 4) manter todos os recursos no mesmo motor de combate/Desfazer já existente.
--
-- Este arquivo não contém segredos narrativos de jogador.

-- ============================================================
-- LADOS DO COMBATE / RELAÇÃO DE ALVO
-- ============================================================

alter table public.combat_participants
  add column if not exists side_key text not null default 'neutral';

alter table public.combat_participants drop constraint if exists combat_participants_side_key_check;
alter table public.combat_participants add constraint combat_participants_side_key_check
check (side_key in ('ally','enemy','neutral'));

-- Fichas já presentes em um combate recebem um lado inicial coerente.
update public.combat_participants cp
set side_key=case
  when c.entity_type in ('player','npc','summon') then 'ally'
  when c.entity_type in ('curse','enemy') then 'enemy'
  else 'neutral' end
from public.characters c
where c.id=cp.character_id
  and (cp.side_key is null or cp.side_key='neutral');

-- O trigger que inicializa recursos também inicializa o lado do participante.
create or replace function public.initialize_combat_runtime()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare
  defs jsonb;
  etype text;
  item jsonb;
  res jsonb := '{}'::jsonb;
  k text;
  maxv int;
  startv int;
begin
  select coalesce(c.special_resources,'[]'::jsonb), c.entity_type
  into defs, etype
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
  new.side_key := case
    when etype in ('player','npc','summon') then 'ally'
    when etype in ('curse','enemy') then 'enemy'
    else 'neutral' end;
  return new;
end;
$$;

create or replace function public.combat_target_relation_allowed(
  p_encounter_id uuid,
  p_actor_character_id uuid,
  p_target_character_id uuid,
  p_relation text default 'any'
)
returns boolean
language plpgsql stable security definer set search_path=public
as $$
declare
  actor_side text;
  target_side text;
  rel text:=coalesce(nullif(p_relation,''),'any');
begin
  if p_actor_character_id is null or p_target_character_id is null then return false; end if;
  if rel='self' then return p_actor_character_id=p_target_character_id; end if;
  if rel='any' then
    return exists(select 1 from public.combat_participants where encounter_id=p_encounter_id and character_id=p_target_character_id);
  end if;

  select side_key into actor_side from public.combat_participants
  where encounter_id=p_encounter_id and character_id=p_actor_character_id;
  select side_key into target_side from public.combat_participants
  where encounter_id=p_encounter_id and character_id=p_target_character_id;
  if actor_side is null or target_side is null then return false; end if;

  if rel='ally_or_self' then
    return p_actor_character_id=p_target_character_id
      or (actor_side<>'neutral' and target_side=actor_side);
  elsif rel='ally' then
    return p_actor_character_id<>p_target_character_id
      and actor_side<>'neutral' and target_side=actor_side;
  elsif rel='enemy' then
    return p_actor_character_id<>p_target_character_id
      and actor_side<>'neutral' and target_side<>'neutral' and actor_side<>target_side;
  end if;
  return true;
end;
$$;

create or replace function public.assert_combat_target_relation(
  p_encounter_id uuid,p_actor_character_id uuid,p_target_character_id uuid,p_relation text
)
returns void
language plpgsql stable security definer set search_path=public
as $$
begin
  if not public.combat_target_relation_allowed(p_encounter_id,p_actor_character_id,p_target_character_id,p_relation) then
    raise exception 'O alvo escolhido não corresponde à relação permitida por esta habilidade (%).',coalesce(p_relation,'any');
  end if;
end;
$$;

revoke execute on function public.combat_target_relation_allowed(uuid,uuid,uuid,text) from public,anon;
revoke execute on function public.assert_combat_target_relation(uuid,uuid,uuid,text) from public,anon,authenticated;

-- ============================================================
-- DANO FRACIONADO CORRETAMENTE
-- ============================================================

alter table public.combat_actions
  add column if not exists damage_dice_factor numeric not null default 1,
  add column if not exists damage_flat_factor numeric not null default 1;

alter table public.combat_actions drop constraint if exists combat_actions_damage_dice_factor_check;
alter table public.combat_actions add constraint combat_actions_damage_dice_factor_check
check (damage_dice_factor >= 0 and damage_dice_factor <= 4);

alter table public.combat_actions drop constraint if exists combat_actions_damage_flat_factor_check;
alter table public.combat_actions add constraint combat_actions_damage_flat_factor_check
check (damage_flat_factor >= 0 and damage_flat_factor <= 4);

-- ============================================================
-- ATAQUE: best-of e bônus condicionais
-- ============================================================

alter function public.create_combat_attack(
  uuid,uuid,uuid,text,text,uuid,text,text,int,int,boolean,boolean,int,int,int,text,text,text,int
) rename to create_combat_attack_v074_core;

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
  a public.combat_actions%rowtype;
  item public.equipment%rowtype;
  icfg jsonb;
  ab public.abilities%rowtype;
  resolved_attr text:=p_attack_attribute_key;
  resolved_skill text:=p_attack_skill_key;
  resolved_damage_attr text:=p_damage_flat_attribute_key;
  candidate text;
  candidate_attr text;
  score int;
  best_score int:=-99999;
  modv int;
  best_mod int:=-99999;
  effect_rec record;
  conditional_bonus int:=0;
  applies boolean;
  new_total int;
  new_status text;
  log_id uuid;
begin
  -- Suspensão temporal e efeitos equivalentes impedem alterações externas.
  if p_target_character_id<>p_attacker_character_id and exists(
    select 1 from public.combat_effect_states s
    where s.encounter_id=p_encounter_id and s.target_character_id=p_target_character_id
      and coalesce((s.data->>'immune_to_external_changes')::boolean,false)
  ) then
    raise exception 'O alvo está temporariamente fora do alcance de alterações externas.';
  end if;

  -- Equipamentos podem declarar alternativas de teste/atributo. O motor escolhe
  -- a combinação mecanicamente melhor sem obrigar a UI a duplicar ataques.
  if p_source_id is not null and p_source_type in ('equipment','equipment_reaction') then
    select * into item from public.equipment where id=p_source_id;
    if item.id is not null then
      icfg:=coalesce(item.attack_config,'{}'::jsonb);
      if jsonb_typeof(icfg->'attack_skill_best_of')='array' then
        for candidate in select value from jsonb_array_elements_text(icfg->'attack_skill_best_of')
        loop
          if candidate='channeling' then candidate_attr:='cursed_control';
          elsif candidate=p_attack_skill_key then candidate_attr:=p_attack_attribute_key;
          else
            select attribute_key into candidate_attr from public.system_skills where key=candidate;
            candidate_attr:=coalesce(candidate_attr,p_attack_attribute_key);
          end if;
          score:=public.combat_test_bonus(p_attacker_character_id,candidate_attr,candidate);
          if score>best_score then
            best_score:=score; resolved_attr:=candidate_attr; resolved_skill:=candidate;
          end if;
        end loop;
      end if;
      if jsonb_typeof(icfg->'damage_attribute_best_of')='array' then
        for candidate in select value from jsonb_array_elements_text(icfg->'damage_attribute_best_of')
        loop
          modv:=public.combat_attribute_modifier(p_attacker_character_id,candidate);
          if modv>best_mod then best_mod:=modv;resolved_damage_attr:=candidate;end if;
        end loop;
      end if;
    end if;
  end if;

  action_id:=public.create_combat_attack_v074_core(
    p_encounter_id,p_attacker_character_id,p_target_character_id,p_label,p_source_type,p_source_id,
    resolved_attr,resolved_skill,p_pa_cost,p_ea_cost,p_uses_cursed_energy,p_forced_critical,
    p_critical_threshold,p_damage_dice_count,p_damage_die,resolved_damage_attr,p_condition_key,p_roll_mode,p_roll_count
  );

  if p_source_id is not null and p_source_type in ('ability','ability_reaction','summon_ability','summon_ability_reaction') then
    select * into ab from public.abilities where id=p_source_id;
  end if;

  -- Bônus condicionais ficam "armados" como efeitos e só são consumidos por
  -- um ataque que realmente corresponde aos filtros do efeito.
  for effect_rec in
    select s.* from public.combat_effect_states s
    where s.encounter_id=p_encounter_id
      and s.target_character_id=p_attacker_character_id
      and s.data ? 'conditional_attack_bonus'
      and (s.uses_remaining is null or s.uses_remaining>0)
    order by s.created_at
  loop
    applies:=true;
    if nullif(effect_rec.data->>'allowed_attack_skill','') is not null
       and effect_rec.data->>'allowed_attack_skill'<>resolved_skill then applies:=false; end if;
    if nullif(effect_rec.data->>'allowed_attack_attribute','') is not null
       and effect_rec.data->>'allowed_attack_attribute'<>resolved_attr then applies:=false; end if;
    if jsonb_typeof(effect_rec.data->'allowed_source_types')='array'
       and not (effect_rec.data->'allowed_source_types' ? p_source_type) then applies:=false; end if;
    if jsonb_typeof(effect_rec.data->'exclude_source_types')='array'
       and (effect_rec.data->'exclude_source_types' ? p_source_type) then applies:=false; end if;
    if nullif(effect_rec.data->>'allowed_ability_tag','') is not null
       and (ab.id is null or not (coalesce(ab.config->'tags','[]'::jsonb) ? (effect_rec.data->>'allowed_ability_tag'))) then applies:=false; end if;

    if applies then
      conditional_bonus:=conditional_bonus+coalesce((effect_rec.data->>'conditional_attack_bonus')::int,0);
      if effect_rec.uses_remaining is not null then
        if effect_rec.uses_remaining<=1 and coalesce((effect_rec.data->>'remove_when_empty')::boolean,true) then
          delete from public.combat_effect_states where id=effect_rec.id;
        else
          update public.combat_effect_states set uses_remaining=greatest(0,uses_remaining-1) where id=effect_rec.id;
        end if;
      elsif coalesce((effect_rec.data->>'remove_when_empty')::boolean,false) then
        delete from public.combat_effect_states where id=effect_rec.id;
      end if;
    end if;
  end loop;

  if conditional_bonus<>0 then
    select * into a from public.combat_actions where id=action_id for update;
    new_total:=coalesce(a.attack_total,0)+conditional_bonus;
    new_status:=case when a.attack_natural=1 then 'miss' when a.attack_natural=20 or new_total>a.target_ca then 'pending_defense' else 'miss' end;
    update public.combat_actions
    set attack_bonus=coalesce(attack_bonus,0)+conditional_bonus,
        attack_total=new_total,status=new_status,
        summary=case when new_status='miss'
          then 'Bônus condicional aplicado, mas o ataque não superou a defesa passiva.'
          else 'Bônus condicional aplicado. O ataque superou a defesa passiva.' end,
        updated_at=now()
    where id=action_id;

    select id into log_id from public.roll_logs
    where encounter_id=p_encounter_id and character_id=p_attacker_character_id
      and roll_type='attack' and label=coalesce(nullif(p_label,''),'Ataque')
    order by created_at desc limit 1;
    if log_id is not null then
      update public.roll_logs set bonus=bonus+conditional_bonus,total=total+conditional_bonus where id=log_id;
    end if;
  end if;

  return action_id;
end;
$$;

-- ============================================================
-- HABILIDADES: alvo, Sobrecarga e resultados resistidos
-- ============================================================

alter function public.use_ability_in_combat(uuid,uuid,uuid,uuid,text,text,jsonb)
rename to use_ability_in_combat_v074_core;

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
  special text;
  relation text;
  target_id uuid;
  secondary_id uuid;
  target_text text;
  target_ids jsonb;
  result jsonb;
  secondary_action_id uuid;
  created_item_id uuid;
  resisted jsonb;
  ekey text;
  ename text;
  edata jsonb;
  eturns int;
  euses int;
  recent_action public.combat_actions%rowtype;
  recent_action_id uuid;
begin
  select * into ab from public.abilities where id=p_ability_id;
  if ab.id is null or ab.status<>'approved' then raise exception 'Habilidade não encontrada ou não aprovada.'; end if;
  cfg:=public.resolve_config_mode(ab.config,p_mode_key,p_overload_key);
  if coalesce((cfg->>'combat_usable')::boolean,true)=false then raise exception 'Esta capacidade não é executável pelo painel de combate.'; end if;
  special:=coalesce(cfg->>'special_action','');
  relation:=coalesce(nullif(cfg->>'target_relation',''),case when coalesce((cfg->>'requires_attack')::boolean,false) or jsonb_typeof(cfg->'contest')='object' then 'enemy' else 'any' end);

  if coalesce(cfg->>'target_mode','')='self' or coalesce(cfg->>'targets','')='self' or coalesce(cfg->>'range','')='self' or relation='self' then
    target_id:=p_actor_character_id;
  else
    target_id:=p_target_character_id;
  end if;

  -- Algumas ações especiais usam uma lista de alvos ou uma ação recente, não o
  -- alvo primário passado pelo formulário.
  if special not in ('set_combat_mode','boost_recent_attack','place_delayed_bomb') then
    if target_id is null then raise exception 'Escolha um alvo.'; end if;
    perform public.assert_combat_target_relation(p_encounter_id,p_actor_character_id,target_id,relation);
    if target_id<>p_actor_character_id and exists(
      select 1 from public.combat_effect_states s where s.encounter_id=p_encounter_id
        and s.target_character_id=target_id and coalesce((s.data->>'immune_to_external_changes')::boolean,false)
    ) then raise exception 'O alvo está temporariamente fora do alcance de alterações externas.'; end if;
  end if;

  if special='place_delayed_bomb' or coalesce(cfg->>'target_mode','')='multiple' then
    target_ids:=coalesce(p_options->'target_ids','[]'::jsonb);
    if jsonb_typeof(target_ids)='array' then
      for target_text in select value from jsonb_array_elements_text(target_ids)
      loop
        perform public.assert_combat_target_relation(p_encounter_id,p_actor_character_id,target_text::uuid,relation);
        if exists(select 1 from public.combat_effect_states s where s.encounter_id=p_encounter_id
          and s.target_character_id=target_text::uuid and coalesce((s.data->>'immune_to_external_changes')::boolean,false)) then
          raise exception 'Um dos alvos selecionados está temporariamente fora do alcance de alterações externas.';
        end if;
      end loop;
    end if;
  end if;

  if coalesce((cfg->>'requires_secondary_target')::boolean,false) then
    begin secondary_id:=nullif(p_options->>'secondary_target_id','')::uuid;
    exception when invalid_text_representation then secondary_id:=null; end;
    if secondary_id is null or secondary_id=target_id then raise exception 'Escolha um segundo alvo diferente para esta Sobrecarga.'; end if;
    perform public.assert_combat_target_relation(
      p_encounter_id,p_actor_character_id,secondary_id,
      coalesce(nullif(cfg->>'secondary_target_relation',''),relation)
    );
  end if;

  -- Reações que alteram uma rolagem recente podem restringir quem realizou a
  -- ação original. Isso mantém suporte/guia voltado a aliados sem confiar só
  -- no filtro visual do navegador.
  if special='boost_recent_attack' then
    begin recent_action_id:=nullif(p_options->>'action_id','')::uuid;
    exception when invalid_text_representation then recent_action_id:=null; end;
    if recent_action_id is null then raise exception 'Escolha a rolagem recente que receberá o efeito.'; end if;
    select * into recent_action from public.combat_actions
      where id=recent_action_id and encounter_id=p_encounter_id;
    if recent_action.id is null then raise exception 'A rolagem recente escolhida não pertence a este combate.'; end if;
    perform public.assert_combat_target_relation(
      p_encounter_id,p_actor_character_id,recent_action.attacker_character_id,
      coalesce(nullif(cfg->>'recent_action_actor_relation',''),'any')
    );
  end if;

  result:=public.use_ability_in_combat_v074_core(
    p_encounter_id,p_actor_character_id,p_ability_id,p_target_character_id,p_mode_key,p_overload_key,p_options
  );

  -- O core 0.7.4 já cria a segunda ação. Aqui corrigimos a matemática para
  -- permitir que "metade dos dados" seja diferente de "metade do dano inteiro".
  if result ? 'secondary_action_id' then
    secondary_action_id:=(result->>'secondary_action_id')::uuid;
    update public.combat_actions
    set damage_factor=greatest(0,least(4,coalesce((cfg->>'secondary_target_damage_factor')::numeric,1))),
        damage_dice_factor=greatest(0,least(4,coalesce((cfg->>'secondary_target_die_factor')::numeric,1))),
        damage_flat_factor=greatest(0,least(4,coalesce((cfg->>'secondary_target_flat_factor')::numeric,1))),
        damage_flat_bonus=coalesce(damage_flat_bonus,0)+coalesce((cfg->>'damage_flat_bonus')::int,0)
    where id=secondary_action_id;
  end if;

  -- Armamento de Sangue e futuras construções temporárias podem declarar um
  -- "melhor entre" para perícia de acerto e atributo no dano.
  if result->>'kind'='weapon_created' and result ? 'equipment_id' then
    created_item_id:=(result->>'equipment_id')::uuid;
    update public.equipment
    set attack_config=coalesce(attack_config,'{}'::jsonb)
      || case when jsonb_typeof(cfg->'weapon_attack_skill_best_of')='array'
              then jsonb_build_object('attack_skill_best_of',cfg->'weapon_attack_skill_best_of') else '{}'::jsonb end
      || case when jsonb_typeof(cfg->'weapon_damage_attribute_best_of')='array'
              then jsonb_build_object('damage_attribute_best_of',cfg->'weapon_damage_attribute_best_of') else '{}'::jsonb end
    where id=created_item_id;
  end if;

  -- Uma habilidade resistida pode especificar um efeito menor mesmo quando a
  -- resistência é bem-sucedida (ex.: desaceleração parcial da Aiko).
  if result->>'kind'='contest' and coalesce((result->>'success')::boolean,false)=false
     and jsonb_typeof(cfg->'contest_resisted_effect')='object' then
    resisted:=cfg->'contest_resisted_effect';
    ekey:=coalesce(nullif(resisted->>'key',''),ab.name||'_resisted');
    ename:=coalesce(nullif(resisted->>'name',''),ab.name||' — efeito resistido');
    edata:=coalesce(resisted->'data','{}'::jsonb);
    eturns:=nullif(coalesce((resisted->>'remaining_turns')::int,0),0);
    euses:=nullif(coalesce((resisted->>'uses')::int,0),0);
    delete from public.combat_effect_states
      where encounter_id=p_encounter_id and target_character_id=target_id and effect_key=ekey;
    insert into public.combat_effect_states(
      encounter_id,source_character_id,target_character_id,source_type,source_id,effect_key,name,data,remaining_turns,uses_remaining
    ) values(p_encounter_id,p_actor_character_id,target_id,'ability',ab.id,ekey,ename,edata,eturns,euses);
    result:=result||jsonb_build_object('resisted_effect_applied',true,'resisted_effect_name',ename);
  end if;

  return result;
end;
$$;

-- ============================================================
-- DEFESA: consumo de bônus condicionais de Reflexos
-- ============================================================

alter function public.resolve_combat_defense(uuid,text,text,int)
rename to resolve_combat_defense_v074_core;

create or replace function public.resolve_combat_defense(
  p_action_id uuid,p_defense_type text,p_mode text default 'normal',p_count int default 1
)
returns public.combat_actions
language plpgsql security definer set search_path=public
as $$
declare
  before_action public.combat_actions%rowtype;
  result public.combat_actions%rowtype;
  eff record;
begin
  select * into before_action from public.combat_actions where id=p_action_id;
  result:=public.resolve_combat_defense_v074_core(p_action_id,p_defense_type,p_mode,p_count);

  if p_defense_type='dodge' and before_action.target_character_id is not null then
    select s.* into eff from public.combat_effect_states s
    where s.encounter_id=before_action.encounter_id
      and s.target_character_id=before_action.target_character_id
      and s.effect_key='guard_range_reflex'
      and (s.uses_remaining is null or s.uses_remaining>0)
    order by s.created_at limit 1 for update;
    if eff.id is not null then
      if eff.uses_remaining is null or eff.uses_remaining<=1 then delete from public.combat_effect_states where id=eff.id;
      else update public.combat_effect_states set uses_remaining=uses_remaining-1 where id=eff.id; end if;
    end if;
  end if;
  return result;
end;
$$;

-- ============================================================
-- RESOLUÇÃO DE DANO v0.8
-- ============================================================

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
    -- v0.8: dados e modificadores podem ser fracionados separadamente.
    -- Isso é necessário para efeitos como A Linha Que Separa, em que apenas
    -- o resultado dos dados do segundo alvo é reduzido, sem cortar o modificador.
    total:=greatest(0,
      floor(rolled*coalesce(a.damage_dice_factor,1))::int
      + floor((flat+coalesce(a.damage_flat_bonus,0))*coalesce(a.damage_flat_factor,1))::int
    );
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


-- ============================================================
-- EQUIPAMENTOS: rerrolagens como ações reais do motor
-- ============================================================

alter function public.use_equipment_effect_in_combat(uuid,uuid,uuid,text,uuid,text)
rename to use_equipment_effect_in_combat_v074_core;

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
  relation text;
  target_id uuid;
  special text;
  result jsonb;
  a public.combat_actions%rowtype;
  tp public.combat_participants%rowtype;
  reroll jsonb;
  nat int;
  total int;
  crit boolean;
  kok boolean;
  new_status text;
  log_rec public.roll_logs%rowtype;
  old_rolled int:=0;
  new_rolled int:=0;
  x text;
  old_pre int;
  old_stage int;
  fixed_reduction int;
  new_pre int;
  new_stage int;
  new_final int;
  delta int;
begin
  select * into item from public.equipment where id=p_item_id;
  if item.id is null or item.character_id<>p_actor_character_id then raise exception 'Equipamento não encontrado.'; end if;
  select value into effect from jsonb_array_elements(coalesce(item.effects,'[]'::jsonb)) where value->>'id'=p_effect_id limit 1;
  if effect is null then raise exception 'Efeito do equipamento não encontrado.'; end if;
  cfg:=public.resolve_config_mode(effect->'config',p_mode_key,null);
  special:=coalesce(cfg->>'special_action','');
  relation:=coalesce(nullif(cfg->>'target_relation',''),case when coalesce((cfg->>'requires_attack')::boolean,false) then 'enemy' else 'any' end);
  if coalesce(cfg->>'target_mode','')='self' or coalesce(cfg->>'targets','')='self' or coalesce(cfg->>'range','')='self' or relation='self' then
    target_id:=p_actor_character_id;
  else target_id:=p_target_character_id; end if;
  if target_id is null then raise exception 'Escolha um alvo.'; end if;
  perform public.assert_combat_target_relation(p_encounter_id,p_actor_character_id,target_id,relation);
  if target_id<>p_actor_character_id and exists(
    select 1 from public.combat_effect_states s where s.encounter_id=p_encounter_id and s.target_character_id=target_id
      and coalesce((s.data->>'immune_to_external_changes')::boolean,false)
  ) then raise exception 'O alvo está temporariamente fora do alcance de alterações externas.'; end if;

  -- Usa o core estruturado 0.7.1 para custo, uso, carga, cura e efeitos. O wrapper
  -- 0.7.4 é mantido apenas como histórico interno; a rerrolagem é refeita abaixo
  -- para respeitar os fatores separados de dado/modificador.
  result:=public.use_equipment_effect_in_combat_v071_core(
    p_encounter_id,p_actor_character_id,p_item_id,p_effect_id,p_target_character_id,p_mode_key
  );

  if special='reroll_recent_damage' then
    select * into a from public.combat_actions
    where encounter_id=p_encounter_id and target_character_id=p_actor_character_id
      and status='resolved' and damage_total>0 and not damage_reroll_used
    order by created_at desc limit 1 for update;
    if a.id is null then raise exception 'Não existe dano recente válido para rerrolar.'; end if;

    for x in select value from jsonb_array_elements_text(coalesce(a.damage_rolls,'[]'::jsonb)) loop old_rolled:=old_rolled+coalesce(x::int,0); end loop;
    reroll:=public.roll_pg_damage(a.damage_dice_count,a.damage_die,a.is_critical);
    new_rolled:=coalesce((reroll->>'total')::int,0);

    old_pre:=greatest(0,floor(old_rolled*coalesce(a.damage_dice_factor,1))::int + floor(coalesce(a.damage_flat,0)*coalesce(a.damage_flat_factor,1))::int);
    old_pre:=greatest(0,floor(old_pre*coalesce(a.damage_factor,1))::int);
    old_stage:=case when a.damage_reduction='half' then floor(old_pre/2.0)::int else old_pre end;
    fixed_reduction:=greatest(0,old_stage-a.damage_total);

    new_pre:=greatest(0,floor(new_rolled*coalesce(a.damage_dice_factor,1))::int + floor(coalesce(a.damage_flat,0)*coalesce(a.damage_flat_factor,1))::int);
    new_pre:=greatest(0,floor(new_pre*coalesce(a.damage_factor,1))::int);
    new_stage:=case when a.damage_reduction='half' then floor(new_pre/2.0)::int else new_pre end;
    new_final:=greatest(0,new_stage-fixed_reduction);
    delta:=a.damage_total-new_final;

    select * into tp from public.combat_participants where encounter_id=p_encounter_id and character_id=p_actor_character_id for update;
    update public.combat_participants
    set current_ps=greatest(0,least(public.combat_max_ps(p_actor_character_id),current_ps+delta)),
        defeated=(greatest(0,least(public.combat_max_ps(p_actor_character_id),current_ps+delta))=0)
    where id=tp.id;
    update public.combat_actions
    set damage_reroll_used=true,damage_reroll_original_total=a.damage_total,
        damage_rolls=reroll->'rolls',damage_total=new_final,
        summary=trim(coalesce(summary,'')||' O dano foi rerrolado; o segundo resultado foi mantido.'),updated_at=now()
    where id=a.id;
    return result||jsonb_build_object('rerolled_action_id',a.id,'old_damage',a.damage_total,'new_damage',new_final,'new_rolls',reroll->'rolls');
  end if;

  if special='reroll_recent_attack_against_self' then
    select * into a from public.combat_actions
    where encounter_id=p_encounter_id and target_character_id=p_actor_character_id and status='pending_defense'
    order by created_at desc limit 1 for update;
    if a.id is null then raise exception 'Não existe ataque recente contra você aguardando resolução.'; end if;

    reroll:=public.roll_pg_d20(coalesce(a.roll_mode,'normal'),greatest(1,coalesce(a.roll_count,1)));
    nat:=(reroll->>'natural')::int;
    total:=nat+coalesce(a.attack_bonus,0);
    crit:=(nat<>1) and (coalesce(a.forced_critical,false) or nat>=greatest(2,least(20,coalesce(a.critical_threshold,20))));
    kok:=(nat=20 and coalesce(a.uses_cursed_energy,false));
    new_status:=case when nat=1 then 'miss' when nat=20 or total>a.target_ca then 'pending_defense' else 'miss' end;
    update public.combat_actions set
      attack_rolls=reroll->'rolls',attack_natural=nat,attack_total=total,is_critical=crit,kokusen_eligible=kok,
      status=new_status,summary=case when new_status='miss' then 'A rolagem de acerto foi refeita e o ataque não superou a CA.' else 'A rolagem de acerto foi refeita; o novo resultado ainda supera a CA.' end,
      updated_at=now()
    where id=a.id;
    select * into log_rec from public.roll_logs
    where encounter_id=p_encounter_id and character_id=a.attacker_character_id and roll_type='attack' and label=a.label
    order by created_at desc limit 1 for update;
    if log_rec.id is not null then
      update public.roll_logs set rolls=reroll->'rolls',natural_roll=nat,total=total,is_critical=crit,kokusen_eligible=kok where id=log_rec.id;
    end if;
    return result||jsonb_build_object('rerolled_action_id',a.id,'new_natural',nat,'new_total',total,'new_status',new_status);
  end if;

  if special='reroll_recent_natural_one' then
    -- Costura do Acaso só pode corrigir a rolagem PRÓPRIA mais recente. Isso
    -- impede guardar um 1 natural antigo e acioná-lo vários eventos depois.
    select * into log_rec from public.roll_logs
    where encounter_id=p_encounter_id and character_id=p_actor_character_id
      and roll_type in ('attack','test','ability')
    order by created_at desc limit 1 for update;
    if log_rec.id is null or log_rec.natural_roll is distinct from 1 then
      raise exception 'A rolagem própria mais recente não é um 1 natural elegível.';
    end if;

    if log_rec.roll_type='attack' then
      -- O log e a combat_action precisam representar o mesmo ataque ainda não
      -- resolvido. Um dano/defesa já resolvido não pode ser reconstruído por
      -- rerrolagem retroativa.
      select * into a from public.combat_actions
      where encounter_id=p_encounter_id
        and attacker_character_id=p_actor_character_id
        and label=log_rec.label
        and attack_natural=1
        and status='miss'
      order by created_at desc limit 1 for update;
      if a.id is null then
        raise exception 'O 1 natural mais recente já não pode ser rerrolado.';
      end if;

      reroll:=public.roll_pg_d20(coalesce(a.roll_mode,'normal'),greatest(1,coalesce(a.roll_count,1)));
      nat:=(reroll->>'natural')::int;
      total:=nat+coalesce(a.attack_bonus,0);
      crit:=(nat<>1) and (coalesce(a.forced_critical,false) or nat>=greatest(2,least(20,coalesce(a.critical_threshold,20))));
      kok:=(nat=20 and coalesce(a.uses_cursed_energy,false));
      new_status:=case when nat=1 then 'miss' when nat=20 or total>a.target_ca then 'pending_defense' else 'miss' end;
      update public.combat_actions set
        attack_rolls=reroll->'rolls',attack_natural=nat,attack_total=total,is_critical=crit,kokusen_eligible=kok,status=new_status,
        summary='Costura do Acaso: o 1 natural foi rerrolado e o segundo resultado deve ser mantido.',updated_at=now()
      where id=a.id;
      update public.roll_logs set
        rolls=reroll->'rolls',natural_roll=nat,total=total,is_critical=crit,kokusen_eligible=kok
      where id=log_rec.id;
      return result||jsonb_build_object('rerolled_action_id',a.id,'new_natural',nat,'new_total',total,'new_status',new_status);
    end if;

    -- Testes gerais não possuem estado de dano/defesa. Como já confirmamos que
    -- este é exatamente o último teste próprio e que o natural foi 1, basta
    -- substituir a rolagem no histórico. O segundo resultado é obrigatório.
    reroll:=public.roll_pg_d20('normal',1);
    nat:=(reroll->>'natural')::int;
    total:=nat+coalesce(log_rec.bonus,0);
    update public.roll_logs set
      rolls=reroll->'rolls',natural_roll=nat,total=total,is_critical=(nat=20),kokusen_eligible=false
    where id=log_rec.id;
    return result||jsonb_build_object('rerolled_roll_id',log_rec.id,'new_natural',nat,'new_total',total);
  end if;

  return result;
end;
$$;

-- Snapshots anteriores não conhecem side_key/fatores novos. Limpa somente o
-- histórico antigo de Desfazer; o combate atual e seus participantes permanecem.
delete from public.combat_undo_snapshots;

grant execute on function public.create_combat_attack(uuid,uuid,uuid,text,text,uuid,text,text,int,int,boolean,boolean,int,int,int,text,text,text,int) to authenticated;
grant execute on function public.use_ability_in_combat(uuid,uuid,uuid,uuid,text,text,jsonb) to authenticated;
grant execute on function public.resolve_combat_defense(uuid,text,text,int) to authenticated;
grant execute on function public.resolve_combat_hit(uuid,boolean) to authenticated;
grant execute on function public.use_equipment_effect_in_combat(uuid,uuid,uuid,text,uuid,text) to authenticated;

revoke execute on function public.create_combat_attack_v074_core(uuid,uuid,uuid,text,text,uuid,text,text,int,int,boolean,boolean,int,int,int,text,text,text,int) from public,anon,authenticated;
revoke execute on function public.use_ability_in_combat_v074_core(uuid,uuid,uuid,uuid,text,text,jsonb) from public,anon,authenticated;
revoke execute on function public.resolve_combat_defense_v074_core(uuid,text,text,int) from public,anon,authenticated;
revoke execute on function public.use_equipment_effect_in_combat_v074_core(uuid,uuid,uuid,text,uuid,text) from public,anon,authenticated;
