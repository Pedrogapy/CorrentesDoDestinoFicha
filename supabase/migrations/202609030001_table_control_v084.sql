-- Correntes do Destino — Controle de Mesa v0.8.4
-- 2026-09-03
--
-- Objetivos:
-- * Mestre decide, durante o encontro, quais participantes podem reagir;
-- * o Mestre pode corrigir a conclusão automática de CA sem editar a ficha;
-- * dados físicos/digitais também cobrem reduções, resistências pós-acerto,
--   dano de início de turno e rerrolagens que antes eram silenciosamente digitais;
-- * detalhes de combat_effect_states continuam exclusivos do Mestre;
-- * nenhuma migration histórica é alterada.

alter table public.combat_participants
  add column if not exists reactions_enabled boolean not null default true;

alter table public.combat_actions
  add column if not exists physical_resolution_queue jsonb not null default '[]'::jsonb;

-- A coluna não contém segredo e precisa participar dos sinais/leituras de combate.
grant select(reactions_enabled) on public.combat_participants to authenticated;

-- ============================================================
-- CONTROLE DE REAÇÕES PELO MESTRE
-- ============================================================
create or replace function public.set_combat_reactions_enabled(
  p_encounter_id uuid,
  p_participant_id uuid,
  p_enabled boolean
)
returns jsonb
language plpgsql security definer set search_path=public
as $$
declare
  p public.combat_participants%rowtype;
  snapshot uuid;
begin
  if not public.is_master() then raise exception 'Somente o Mestre pode abrir ou fechar reações.'; end if;
  select * into p from public.combat_participants
  where id=p_participant_id and encounter_id=p_encounter_id for update;
  if p.id is null then raise exception 'Participante não encontrado neste combate.'; end if;
  snapshot:=public.begin_combat_undo(p_encounter_id,
    case when p_enabled then 'Liberar reações' else 'Bloquear reações' end);
  update public.combat_participants
  set reactions_enabled=coalesce(p_enabled,false)
  where id=p.id returning * into p;
  perform public.commit_combat_undo(snapshot);
  return to_jsonb(p);
end;
$$;
revoke execute on function public.set_combat_reactions_enabled(uuid,uuid,boolean) from public,anon;
grant execute on function public.set_combat_reactions_enabled(uuid,uuid,boolean) to authenticated;

-- Defesa normal: aceitar o golpe nunca é bloqueado; qualquer reação defensiva
-- depende da janela que o Mestre deixou aberta para o alvo.
do $$
begin
  if to_regprocedure('public.resolve_combat_defense_table_control_core(uuid,text,text,integer)') is null then
    alter function public.resolve_combat_defense(uuid,text,text,integer)
      rename to resolve_combat_defense_table_control_core;
  end if;
end $$;
revoke execute on function public.resolve_combat_defense_table_control_core(uuid,text,text,integer)
from public,anon,authenticated;

create or replace function public.resolve_combat_defense(
  p_action_id uuid,
  p_defense_type text,
  p_mode text default 'normal',
  p_count int default 1
)
returns jsonb
language plpgsql security definer set search_path=public
as $$
declare
  a public.combat_actions%rowtype;
  p public.combat_participants%rowtype;
  result jsonb;
begin
  select * into a from public.combat_actions where id=p_action_id;
  if a.id is null then raise exception 'Ação não encontrada.'; end if;
  select * into p from public.combat_participants
  where encounter_id=a.encounter_id and character_id=a.target_character_id;
  if coalesce(p_defense_type,'')<>'accept' and coalesce(p.reactions_enabled,true)=false then
    raise exception 'O Mestre fechou a janela de reação deste personagem.';
  end if;

  -- O core imediatamente anterior é o wrapper de privacidade da migration
  -- 202609020002 e retorna JSONB sanitizado para o cliente. Não converta esse
  -- retorno para combat_actions: PostgreSQL interpreta o JSON como literal de
  -- registro e gera "malformed record literal".
  result:=public.resolve_combat_defense_table_control_core(
    p_action_id,p_defense_type,p_mode,p_count
  );

  -- Se a defesa encerrou o golpe antes do dano, dados preparados para redução
  -- não devem ficar presos na ação.
  update public.combat_actions
  set physical_resolution_queue='[]'::jsonb
  where id=p_action_id;

  return result;
end;
$$;
revoke execute on function public.resolve_combat_defense(uuid,text,text,integer) from public,anon;
grant execute on function public.resolve_combat_defense(uuid,text,text,integer) to authenticated;

-- Contra-ataque é reação e segue o mesmo controle.
do $$
begin
  if to_regprocedure('public.create_basic_counterattack_table_control_core(uuid,boolean)') is null then
    alter function public.create_basic_counterattack(uuid,boolean)
      rename to create_basic_counterattack_table_control_core;
  end if;
end $$;
revoke execute on function public.create_basic_counterattack_table_control_core(uuid,boolean)
from public,anon,authenticated;

create or replace function public.create_basic_counterattack(
  p_action_id uuid,
  p_use_cursed_energy boolean default false
)
returns uuid
language plpgsql security definer set search_path=public
as $$
declare
  a public.combat_actions%rowtype;
  p public.combat_participants%rowtype;
begin
  select * into a from public.combat_actions where id=p_action_id;
  if a.id is null then raise exception 'Ação não encontrada.'; end if;
  select * into p from public.combat_participants
  where encounter_id=a.encounter_id and character_id=a.target_character_id;
  if coalesce(p.reactions_enabled,true)=false then
    raise exception 'O Mestre fechou a janela de reação deste personagem.';
  end if;
  return public.create_basic_counterattack_table_control_core(p_action_id,p_use_cursed_energy);
end;
$$;
revoke execute on function public.create_basic_counterattack(uuid,boolean) from public,anon;
grant execute on function public.create_basic_counterattack(uuid,boolean) to authenticated;

-- Habilidades marcadas como reação também respeitam a janela do personagem.
do $$
begin
  if to_regprocedure('public.use_ability_in_combat_table_control_core(uuid,uuid,uuid,uuid,text,text,jsonb)') is null then
    alter function public.use_ability_in_combat(uuid,uuid,uuid,uuid,text,text,jsonb)
      rename to use_ability_in_combat_table_control_core;
  end if;
end $$;
revoke execute on function public.use_ability_in_combat_table_control_core(uuid,uuid,uuid,uuid,text,text,jsonb)
from public,anon,authenticated;

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
  p public.combat_participants%rowtype;
  reaction boolean:=false;
begin
  select * into ab from public.abilities where id=p_ability_id;
  if ab.id is not null then
    cfg:=public.resolve_config_mode(ab.config,p_mode_key,p_overload_key);
    reaction:=coalesce((cfg->>'is_reaction')::boolean,false)
      or coalesce(cfg->>'activation_timing','')='reaction';
  end if;
  if reaction then
    select * into p from public.combat_participants
    where encounter_id=p_encounter_id and character_id=p_actor_character_id;
    if coalesce(p.reactions_enabled,true)=false then
      raise exception 'O Mestre fechou a janela de reação deste personagem.';
    end if;
  end if;
  return public.use_ability_in_combat_table_control_core(
    p_encounter_id,p_actor_character_id,p_ability_id,p_target_character_id,
    p_mode_key,p_overload_key,p_options
  );
end;
$$;
revoke execute on function public.use_ability_in_combat(uuid,uuid,uuid,uuid,text,text,jsonb) from public,anon;
grant execute on function public.use_ability_in_combat(uuid,uuid,uuid,uuid,text,text,jsonb) to authenticated;

-- Efeitos de equipamento marcados como reação seguem a mesma regra.
do $$
begin
  if to_regprocedure('public.use_equipment_effect_in_combat_table_control_core(uuid,uuid,uuid,text,uuid,text)') is null then
    alter function public.use_equipment_effect_in_combat(uuid,uuid,uuid,text,uuid,text)
      rename to use_equipment_effect_in_combat_table_control_core;
  end if;
end $$;
revoke execute on function public.use_equipment_effect_in_combat_table_control_core(uuid,uuid,uuid,text,uuid,text)
from public,anon,authenticated;

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
  p public.combat_participants%rowtype;
  reaction boolean:=false;
begin
  select * into item from public.equipment where id=p_item_id;
  select value into effect
  from jsonb_array_elements(coalesce(item.effects,'[]'::jsonb))
  where value->>'id'=p_effect_id limit 1;
  if effect is not null then
    cfg:=public.resolve_config_mode(coalesce(effect->'config','{}'::jsonb),p_mode_key,null);
    reaction:=coalesce(effect->>'type','')='reaction'
      or coalesce((cfg->>'is_reaction')::boolean,false)
      or coalesce(cfg->>'activation_timing','')='reaction';
  end if;
  if reaction then
    select * into p from public.combat_participants
    where encounter_id=p_encounter_id and character_id=p_actor_character_id;
    if coalesce(p.reactions_enabled,true)=false then
      raise exception 'O Mestre fechou a janela de reação deste personagem.';
    end if;
  end if;
  return public.use_equipment_effect_in_combat_table_control_core(
    p_encounter_id,p_actor_character_id,p_item_id,p_effect_id,p_target_character_id,p_mode_key
  );
end;
$$;
revoke execute on function public.use_equipment_effect_in_combat(uuid,uuid,uuid,text,uuid,text) from public,anon;
grant execute on function public.use_equipment_effect_in_combat(uuid,uuid,uuid,text,uuid,text) to authenticated;

-- ============================================================
-- PLANO DE DADOS: RESOLUÇÃO DO ALVO
-- ============================================================
create or replace function public.get_combat_resolution_roll_prompt(p_action_id uuid)
returns jsonb
language plpgsql stable security definer set search_path=public
as $$
declare
  a public.combat_actions%rowtype;
  s public.combat_effect_states%rowtype;
  steps jsonb:='[]'::jsonb;
  label_text text;
begin
  select * into a from public.combat_actions where id=p_action_id;
  if a.id is null then raise exception 'Ação não encontrada.'; end if;
  if not (public.is_master() or public.owns_character(a.target_character_id)) then raise exception 'Sem permissão.'; end if;

  for s in
    select x.* from public.combat_effect_states x
    where x.encounter_id=a.encounter_id
      and x.target_character_id=a.target_character_id
      and coalesce((x.data->>'damage_reduction_dice_count')::int,0)>0
      and coalesce((x.data->>'damage_reduction_die')::int,0)>1
      and (x.uses_remaining is null or x.uses_remaining>0)
      and (
        coalesce(x.data->>'applies_to','any')='any'
        or (x.data->>'applies_to' in ('physical','physical_projectile')
          and (a.source_type in ('basic','equipment','counterattack') or a.attack_attribute_key in ('strength','dexterity')))
      )
    order by x.created_at
  loop
    label_text:=case when public.is_master() then coalesce(nullif(s.name,''),'Redução de dano') else 'Redução de dano' end;
    steps:=steps||jsonb_build_array(jsonb_build_object(
      'kind','dice','label',label_text,
      'count',coalesce((s.data->>'damage_reduction_dice_count')::int,0),
      'sides',coalesce((s.data->>'damage_reduction_die')::int,0)
    ));
  end loop;

  if jsonb_typeof(a.on_hit_effect)='object'
     and coalesce(a.on_hit_effect->>'type','')='contest_effect' then
    steps:=steps||jsonb_build_array(jsonb_build_object(
      'kind','d20','label','Resistência ao efeito','mode','normal','count',1
    ));
  end if;
  return jsonb_build_object('steps',steps);
end;
$$;
revoke execute on function public.get_combat_resolution_roll_prompt(uuid) from public,anon;
grant execute on function public.get_combat_resolution_roll_prompt(uuid) to authenticated;

create or replace function public.set_combat_resolution_dice(p_action_id uuid,p_queue jsonb)
returns void
language plpgsql security definer set search_path=public
as $$
declare a public.combat_actions%rowtype;
begin
  if p_queue is null or jsonb_typeof(p_queue)<>'array' then raise exception 'Fila de resolução inválida.'; end if;
  select * into a from public.combat_actions where id=p_action_id for update;
  if a.id is null then raise exception 'Ação não encontrada.'; end if;
  if not (public.is_master() or public.owns_character(a.target_character_id)) then raise exception 'Sem permissão.'; end if;
  update public.combat_actions set physical_resolution_queue=p_queue,updated_at=now() where id=a.id;
end;
$$;

create or replace function public.clear_combat_resolution_dice(p_action_id uuid)
returns void
language plpgsql security definer set search_path=public
as $$
declare a public.combat_actions%rowtype;
begin
  select * into a from public.combat_actions where id=p_action_id for update;
  if a.id is null then return; end if;
  if not (public.is_master() or public.owns_character(a.target_character_id)) then raise exception 'Sem permissão.'; end if;
  update public.combat_actions set physical_resolution_queue='[]'::jsonb,updated_at=now() where id=a.id;
end;
$$;
revoke execute on function public.set_combat_resolution_dice(uuid,jsonb) from public,anon;
revoke execute on function public.clear_combat_resolution_dice(uuid) from public,anon;
grant execute on function public.set_combat_resolution_dice(uuid,jsonb) to authenticated;
grant execute on function public.clear_combat_resolution_dice(uuid) to authenticated;

-- O wrapper atual (Staff V3 -> Staff V2 -> dados físicos v0.8.3 -> motor) continua
-- intacto. Apenas acrescentamos, no momento exato da resolução, os dados que
-- pertencem ao alvo depois dos dados de dano do atacante.
do $$
begin
  if to_regprocedure('public.resolve_combat_hit_table_control_core(uuid,boolean)') is null then
    alter function public.resolve_combat_hit(uuid,boolean)
      rename to resolve_combat_hit_table_control_core;
  end if;
end $$;
revoke execute on function public.resolve_combat_hit_table_control_core(uuid,boolean)
from public,anon,authenticated;

create or replace function public.resolve_combat_hit(p_action_id uuid,p_half boolean default false)
returns public.combat_actions
language plpgsql security definer set search_path=public
as $$
declare
  a public.combat_actions%rowtype;
  result public.combat_actions%rowtype;
  prefix jsonb:='[]'::jsonb;
  i int;
  n int;
  sides int;
  bonus public.combat_effect_states%rowtype;
  v int;
begin
  select * into a from public.combat_actions where id=p_action_id for update;
  if a.id is null then raise exception 'Ação não encontrada.'; end if;

  if jsonb_typeof(a.physical_resolution_queue)='array'
     and jsonb_array_length(a.physical_resolution_queue)>0 then
    -- Se o atacante escolheu dados físicos, a fila de dano já existe.
    prefix:=coalesce(a.physical_damage_queue,'[]'::jsonb);

    -- Se o dano do atacante ficou digital, pré-rolamos somente os dados de dano
    -- que aparecem ANTES das rolagens do alvo e os colocamos na mesma fila.
    if jsonb_array_length(prefix)=0 then
      n:=greatest(0,coalesce(a.damage_dice_count,0))*case when coalesce(a.is_critical,false) then 2 else 1 end;
      sides:=greatest(0,coalesce(a.damage_die,0));
      if n>0 and sides>1 then
        for i in 1..n loop
          v:=floor(random()*sides)::int+1;
          prefix:=prefix||jsonb_build_array(jsonb_build_object('kind','die','sides',sides,'value',v));
        end loop;
      end if;

      select s.* into bonus from public.combat_effect_states s
      where s.encounter_id=a.encounter_id and s.target_character_id=a.attacker_character_id
        and coalesce((s.data->>'bonus_damage_dice_count')::int,0)>0
        and coalesce((s.data->>'bonus_damage_die')::int,0)>1
        and (s.uses_remaining is null or s.uses_remaining>0)
      order by s.created_at limit 1;
      if bonus.id is not null then
        n:=greatest(0,coalesce((bonus.data->>'bonus_damage_dice_count')::int,0));
        sides:=greatest(0,coalesce((bonus.data->>'bonus_damage_die')::int,0));
        if n>0 and sides>1 then
          for i in 1..n loop
            v:=floor(random()*sides)::int+1;
            prefix:=prefix||jsonb_build_array(jsonb_build_object('kind','die','sides',sides,'value',v));
          end loop;
        end if;
      end if;
    end if;

    update public.combat_actions
    set physical_damage_queue=prefix||a.physical_resolution_queue
    where id=a.id;
  end if;

  result:=public.resolve_combat_hit_table_control_core(p_action_id,p_half);
  update public.combat_actions set physical_resolution_queue='[]'::jsonb where id=p_action_id;
  return result;
exception when others then
  -- Não apaga a escolha do alvo em caso de erro; ela pode ser reutilizada após
  -- o Mestre corrigir a situação que impediu a resolução.
  raise;
end;
$$;
revoke execute on function public.resolve_combat_hit(uuid,boolean) from public,anon,authenticated;
-- O cliente continua resolvendo golpes pela defesa/aceite; o RPC direto permanece
-- reservado para wrappers security definer e para o override do Mestre abaixo.

-- ============================================================
-- OUTRAS ROLAGENS QUE ANTES ERAM AUTOMÁTICAS
-- ============================================================
create or replace function public.get_start_turn_roll_prompt(p_participant_id uuid)
returns jsonb
language plpgsql stable security definer set search_path=public
as $$
declare
  p public.combat_participants%rowtype;
  s public.combat_effect_states%rowtype;
  groups jsonb:='[]'::jsonb;
  label_text text;
begin
  select * into p from public.combat_participants where id=p_participant_id;
  if p.id is null then raise exception 'Participante não encontrado.'; end if;
  if not (public.is_master() or public.owns_character(p.character_id)) then raise exception 'Sem permissão.'; end if;
  for s in select x.* from public.combat_effect_states x
    where x.encounter_id=p.encounter_id and x.target_character_id=p.character_id
      and coalesce((x.data->>'start_turn_damage_dice_count')::int,0)>0
      and coalesce((x.data->>'start_turn_damage_die')::int,0)>1
    order by x.created_at
  loop
    label_text:=case when public.is_master() then coalesce(nullif(s.name,''),'Efeito de início de turno') else 'Efeito de início de turno' end;
    groups:=groups||jsonb_build_array(jsonb_build_object(
      'label',label_text,
      'count',(s.data->>'start_turn_damage_dice_count')::int,
      'sides',(s.data->>'start_turn_damage_die')::int
    ));
  end loop;
  return jsonb_build_object('groups',groups);
end;
$$;
revoke execute on function public.get_start_turn_roll_prompt(uuid) from public,anon;
grant execute on function public.get_start_turn_roll_prompt(uuid) to authenticated;

create or replace function public.get_table_control_reroll_prompt(
  p_encounter_id uuid,
  p_actor_character_id uuid,
  p_special_action text
)
returns jsonb
language plpgsql stable security definer set search_path=public
as $$
declare
  a public.combat_actions%rowtype;
  groups jsonb:='[]'::jsonb;
  count_dice int;
begin
  if not (public.is_master() or public.owns_character(p_actor_character_id)) then raise exception 'Sem permissão.'; end if;
  if p_special_action='reroll_recent_damage' then
    select * into a from public.combat_actions
    where encounter_id=p_encounter_id and target_character_id=p_actor_character_id
      and status='resolved' and damage_total>0 and not damage_reroll_used
    order by created_at desc limit 1;
    if a.id is not null and coalesce(a.damage_dice_count,0)>0 and coalesce(a.damage_die,0)>1 then
      count_dice:=a.damage_dice_count*case when a.is_critical then 2 else 1 end;
      groups:=jsonb_build_array(jsonb_build_object('label','Rerrolagem de dano','count',count_dice,'sides',a.damage_die));
    end if;
  end if;
  return jsonb_build_object('groups',groups);
end;
$$;
revoke execute on function public.get_table_control_reroll_prompt(uuid,uuid,text) from public,anon;
grant execute on function public.get_table_control_reroll_prompt(uuid,uuid,text) to authenticated;

-- ============================================================
-- OVERRIDE DO MESTRE: O SISTEMA CALCULA, O MESTRE DECIDE
-- ============================================================
create or replace function public.master_override_combat_action(
  p_action_id uuid,
  p_decision text,
  p_public_text text default null
)
returns jsonb
language plpgsql security definer set search_path=public
as $$
declare
  a public.combat_actions%rowtype;
  result public.combat_actions%rowtype;
  snapshot uuid;
  public_text text;
  decision text:=lower(coalesce(p_decision,''));
begin
  if not public.is_master() then raise exception 'Somente o Mestre pode sobrescrever a resolução automática.'; end if;
  select * into a from public.combat_actions where id=p_action_id for update;
  if a.id is null then raise exception 'Ação não encontrada.'; end if;
  snapshot:=public.begin_combat_undo(a.encounter_id,'Decisão manual do Mestre');

  if decision in ('force_hit','ignore_ca') then
    if a.status not in ('miss','pending_defense') then raise exception 'Somente ataques ainda não resolvidos podem ser convertidos em acerto.'; end if;
    public_text:=coalesce(nullif(p_public_text,''),'O ataque acertou.');
    update public.combat_actions set status='pending_defense',
      master_action=coalesce(master_action,'{}'::jsonb)||jsonb_build_object('override','force_hit','public_text',public_text,'reveal_details',false),
      summary='O Mestre confirmou o acerto independentemente da comparação automática com a CA.',updated_at=now()
    where id=a.id returning * into result;

  elsif decision='force_miss' then
    if a.status not in ('miss','pending_defense') then raise exception 'Somente ataques ainda não resolvidos podem ser convertidos em erro.'; end if;
    public_text:=coalesce(nullif(p_public_text,''),'O ataque não acertou.');
    update public.combat_actions set status='miss',physical_resolution_queue='[]'::jsonb,physical_damage_queue='[]'::jsonb,physical_damage_pending=false,
      master_action=coalesce(master_action,'{}'::jsonb)||jsonb_build_object('override','force_miss','public_text',public_text,'reveal_details',false),
      summary='O Mestre confirmou que o ataque não acertou.',updated_at=now()
    where id=a.id returning * into result;

  elsif decision='cancel' then
    if a.status not in ('miss','pending_defense') then raise exception 'Esta ação já foi resolvida e deve ser desfeita pelo Undo antes de cancelar.'; end if;
    public_text:=coalesce(nullif(p_public_text,''),'A ação foi interrompida.');
    update public.combat_actions set status='cancelled',physical_resolution_queue='[]'::jsonb,physical_damage_queue='[]'::jsonb,physical_damage_pending=false,
      master_action=coalesce(master_action,'{}'::jsonb)||jsonb_build_object('override','cancel','public_text',public_text,'reveal_details',false),
      summary='A ação foi cancelada por decisão do Mestre.',updated_at=now()
    where id=a.id returning * into result;

  elsif decision in ('accept_hit','half_hit') then
    if a.status<>'pending_defense' then raise exception 'O ataque precisa estar aguardando resolução.'; end if;
    result:=public.resolve_combat_hit(a.id,decision='half_hit');
    public_text:=coalesce(nullif(p_public_text,''),'O golpe foi resolvido.');
    update public.combat_actions
    set master_action=coalesce(master_action,'{}'::jsonb)||jsonb_build_object('override',decision,'public_text',public_text,'reveal_details',false),
        updated_at=now()
    where id=a.id returning * into result;
  else
    raise exception 'Decisão manual inválida: %.',p_decision;
  end if;

  perform public.commit_combat_undo(snapshot);
  if public.is_master() then return to_jsonb(result); end if;
  return jsonb_build_object('id',result.id,'status',result.status);
exception when others then
  if snapshot is not null then perform public.discard_combat_undo(snapshot); end if;
  raise;
end;
$$;
revoke execute on function public.master_override_combat_action(uuid,text,text) from public,anon;
grant execute on function public.master_override_combat_action(uuid,text,text) to authenticated;

-- ============================================================
-- PRIVACIDADE: DETALHES DOS EFEITOS SOMENTE PARA O MESTRE
-- ============================================================
create or replace function public.get_visible_combat_effects(p_encounter_id uuid)
returns setof jsonb language sql stable security definer set search_path=public as $$
  select case when public.is_master() then to_jsonb(s) else jsonb_build_object(
    'id',s.id,
    'encounter_id',s.encounter_id,
    'target_character_id',s.target_character_id,
    'name','Efeito ativo',
    'description','',
    'remaining_turns',null,
    'uses_remaining',null,
    -- Exceção funcional: o dono de uma bomba precisa poder detoná-la, mas não
    -- recebe a estrutura interna de combat_effect_states.
    'can_detonate',s.effect_key='art_bomb' and public.owns_character(s.source_character_id),
    'bomb_roll',case when s.effect_key='art_bomb' and public.owns_character(s.source_character_id) then jsonb_build_object(
      'count',coalesce((s.data->>'damage_dice_count')::int,0),
      'sides',coalesce((s.data->>'damage_die')::int,0),
      'target_count',greatest(1,jsonb_array_length(coalesce(s.data->'target_ids','[]'::jsonb)))
    ) end
  ) end
  from public.combat_effect_states s
  where s.encounter_id=p_encounter_id and (public.is_master() or (
    public.owns_character(s.target_character_id) and coalesce((s.data->>'public_visible')::boolean,true)
    or (s.effect_key='art_bomb' and public.owns_character(s.source_character_id))
  ))
  order by s.created_at,s.id;
$$;
revoke execute on function public.get_visible_combat_effects(uuid) from public,anon;
grant execute on function public.get_visible_combat_effects(uuid) to authenticated;

-- Compatibilidade do Undo: snapshots criados antes desta migration não possuem
-- as duas colunas novas. Em vez de apagar o histórico, completamos somente os
-- campos ausentes dentro do JSON salvo. Assim, Ctrl+Z anterior continua válido.
update public.combat_undo_snapshots s
set state = jsonb_set(
  jsonb_set(
    s.state,
    '{participants}',
    coalesce((
      select jsonb_agg(
        case when item ? 'reactions_enabled'
          then item
          else item || jsonb_build_object('reactions_enabled',true)
        end
        order by ord
      )
      from jsonb_array_elements(coalesce(s.state->'participants','[]'::jsonb))
           with ordinality as p(item,ord)
    ),'[]'::jsonb),
    true
  ),
  '{actions}',
  coalesce((
    select jsonb_agg(
      case when item ? 'physical_resolution_queue'
        then item
        else item || jsonb_build_object('physical_resolution_queue','[]'::jsonb)
      end
      order by ord
    )
    from jsonb_array_elements(coalesce(s.state->'actions','[]'::jsonb))
         with ordinality as a(item,ord)
  ),'[]'::jsonb),
  true
);

comment on column public.combat_participants.reactions_enabled
is 'Controle de Mesa v0.8.4: janela de reação decidida pelo Mestre durante o encontro.';
comment on function public.master_override_combat_action(uuid,text,text)
is 'Controle de Mesa v0.8.4: permite ao Mestre confirmar acerto/erro/cancelamento ou resolver um golpe sem depender da decisão automática de CA.';
