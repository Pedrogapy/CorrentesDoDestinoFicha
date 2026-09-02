-- Projeções de leitura no servidor. RLS continua sendo a fronteira de acesso.

-- Arrays legados podem guardar uma chave autoral de condição. Somente o Mestre
-- recebe a chave; players recebem um estado genérico sem revelar sua origem.
create or replace function public.visible_combat_participant(p public.combat_participants)
returns public.combat_participants language plpgsql stable security definer set search_path=public as $$
begin
  if not public.is_master() then
    select coalesce(jsonb_agg(distinct case when c.public_catalog then entry.value else 'active_effect' end),'[]')
    into p.conditions from jsonb_array_elements_text(p.conditions) entry
    left join public.system_conditions c on c.key=entry.value;
  end if;
  return p;
end;
$$;
revoke execute on function public.visible_combat_participant(public.combat_participants) from public,anon,authenticated;

revoke select on public.combat_participants from authenticated;
do $$
declare columns text;
begin
  select string_agg(quote_ident(attname),',') into columns from pg_attribute
  where attrelid='public.combat_participants'::regclass and attnum>0 and not attisdropped and attname<>'conditions';
  execute 'grant select('||columns||') on public.combat_participants to authenticated';
end;
$$;
create or replace function public.get_combat_participants(p_encounter_id uuid)
returns setof jsonb language sql stable security definer set search_path=public as $$
  select to_jsonb(public.visible_combat_participant(p))||jsonb_build_object('characters',to_jsonb(c))
  from public.combat_participants p join public.characters c on c.id=p.character_id
  where p.encounter_id=p_encounter_id and (public.is_master() or public.owns_character(p.character_id))
  order by p.initiative desc,p.id;
$$;
revoke execute on function public.get_combat_participants(uuid) from public,anon;
grant execute on function public.get_combat_participants(uuid) to authenticated;

-- Os retornos de mutações aplicam a mesma projeção; o estado armazenado não muda.
do $$
declare signature text; definition text;
begin
  foreach signature in array array['public.start_combat_turn(uuid)','public.end_combat_turn(uuid)','public.remove_combat_condition(uuid,text)'] loop
    select pg_get_functiondef(signature::regprocedure) into definition;
    definition:=replace(definition,'return p;','return public.visible_combat_participant(p);');
    execute definition;
  end loop;
end;
$$;

-- Notas continuam no formato usado pelos importadores, mas sem privilégio SELECT para players.
revoke select on public.character_cursed_body_techniques from authenticated;
grant select(id,character_id,name,description,is_released,released_at,created_at,updated_at)
  on public.character_cursed_body_techniques to authenticated;

create or replace function public.get_visible_cursed_body(p_character_id uuid)
returns jsonb language sql stable security definer set search_path=public as $$
  select case when public.is_master() then to_jsonb(cb) else
    jsonb_build_object('id',cb.id,'character_id',cb.character_id,'name',cb.name,'description',cb.description,'is_released',cb.is_released)
  end from public.character_cursed_body_techniques cb
  where cb.character_id=p_character_id and (public.is_master() or (cb.is_released and public.owns_character(cb.character_id)));
$$;
revoke execute on function public.get_visible_cursed_body(uuid) from public,anon;
grant execute on function public.get_visible_cursed_body(uuid) to authenticated;

-- Auditoria pode conter versões antigas de habilidades ainda ocultas e notas internas.
drop policy if exists audit_select on public.audit_logs;
create policy audit_select on public.audit_logs for select to authenticated using(public.is_master());
create or replace function public.get_visible_audit_logs(p_character_id uuid default null)
returns setof jsonb language sql stable security definer set search_path=public as $$
  select case when public.is_master() then to_jsonb(l) else jsonb_build_object(
    'id',l.id,'character_id',l.character_id,'table_name',l.table_name,'action',l.action,
    'summary','Registro atualizado.','created_at',l.created_at
  ) end from public.audit_logs l
  where (p_character_id is null or l.character_id=p_character_id)
    and (public.is_master() or (public.owns_character(l.character_id)
      and l.table_name in ('characters','equipment','vows','training_tickets')))
  order by l.created_at desc,l.id desc limit 100;
$$;
revoke execute on function public.get_visible_audit_logs(uuid) from public,anon;
grant execute on function public.get_visible_audit_logs(uuid) to authenticated;

-- Metadados reservados não pertencem ao config que o dono usa na ficha.
create table if not exists public.ability_master_data (
  ability_id uuid primary key references public.abilities(id) on delete cascade deferrable initially deferred,
  original_config jsonb not null
);
alter table public.ability_master_data enable row level security;
create policy ability_master_data_only on public.ability_master_data for all to authenticated
using(public.is_master()) with check(public.is_master());
grant select,insert,update,delete on public.ability_master_data to authenticated;

create or replace function public.player_config(p_config jsonb)
returns jsonb language plpgsql immutable set search_path=public as $$
declare result jsonb; k text; v jsonb;
begin
  if jsonb_typeof(p_config)='object' then
    result:='{}';
    for k,v in select * from jsonb_each(p_config) loop
      if k !~* '(secret|^master_|^internal_|^private_)' then result:=result||jsonb_build_object(k,public.player_config(v)); end if;
    end loop;
    return result;
  elsif jsonb_typeof(p_config)='array' then
    select coalesce(jsonb_agg(public.player_config(value)),'[]') into result from jsonb_array_elements(p_config);
    return result;
  end if;
  return p_config;
end;
$$;
insert into public.ability_master_data(ability_id,original_config)
select id,config from public.abilities where config is distinct from public.player_config(config)
on conflict(ability_id) do nothing;
alter table public.abilities disable trigger protect_ability_update_trigger;
update public.abilities set config=public.player_config(config) where config is distinct from public.player_config(config);
alter table public.abilities enable trigger protect_ability_update_trigger;

-- Impede reintroduzir campos privados por importações futuras sem preservar sua cópia.
create or replace function public.separate_ability_master_data()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.config is distinct from public.player_config(new.config) then
    insert into public.ability_master_data(ability_id,original_config) values(new.id,new.config)
    on conflict(ability_id) do update set original_config=excluded.original_config;
    new.config:=public.player_config(new.config);
  end if;
  return new;
end;
$$;
create trigger separate_ability_master_data before insert or update of config on public.abilities
for each row execute function public.separate_ability_master_data();

-- Rota de leitura já empregada pela sala: conserva o contrato de defesa e elimina origens secretas.
alter function public.get_visible_combat_actions(uuid) rename to get_visible_combat_actions_privacy_core;
revoke execute on function public.get_visible_combat_actions_privacy_core(uuid) from public,anon,authenticated;

create or replace function public.get_visible_combat_actions(p_encounter_id uuid)
returns table(
  id uuid, encounter_id uuid, attacker_character_id uuid, target_character_id uuid,
  attacker_name text, target_name text, source_type text, source_id uuid, label text,
  attack_rolls jsonb, attack_natural int, attack_bonus int, attack_total int, target_ca int,
  attack_hidden boolean, defense_hidden boolean, is_critical boolean, kokusen_eligible boolean, kokusen_denied boolean,
  is_kokusen boolean, damage_rolls jsonb, damage_flat int, damage_total int, damage_reduction text,
  defense_type text, defense_rolls jsonb, defense_natural int, defense_bonus int, defense_total int,
  defense_success boolean, counterattack_available boolean, condition_key text, status text,
  summary text, created_at timestamptz
)
language sql stable security definer set search_path=public as $$
  select v.id,v.encounter_id,
    case when public.is_master() or public.owns_character(v.attacker_character_id) or ap.visible_to_players then v.attacker_character_id end,
    case when public.is_master() or public.owns_character(v.target_character_id) or tp.visible_to_players then v.target_character_id end,
    v.attacker_name,v.target_name,
    case when public.is_master() or public.owns_character(v.attacker_character_id) then v.source_type else 'custom' end,
    case when public.is_master() or public.owns_character(v.attacker_character_id) then v.source_id end,
    case when public.is_master() or public.owns_character(v.attacker_character_id) then v.label else 'Ação' end,
    v.attack_rolls,v.attack_natural,v.attack_bonus,v.attack_total,
    case when public.is_master() or public.owns_character(v.target_character_id) then v.target_ca end,
    v.attack_hidden,v.defense_hidden,
    case when public.is_master() or a.master_action is null or coalesce((a.master_action->>'reveal_details')::boolean,false) then v.is_critical else false end,
    v.kokusen_eligible,v.kokusen_denied,v.is_kokusen,
    v.damage_rolls,
    case when public.is_master() or public.owns_character(v.attacker_character_id) then v.damage_flat else 0 end,
    case when public.is_master() or a.master_action is null or coalesce((a.master_action->>'reveal_details')::boolean,false) then v.damage_total else 0 end,
    v.damage_reduction,v.defense_type,v.defense_rolls,v.defense_natural,v.defense_bonus,v.defense_total,
    v.defense_success,v.counterattack_available,
    case when public.is_master() or exists(select 1 from public.system_conditions c where c.key=v.condition_key and c.public_catalog) then v.condition_key end,
    v.status,
    case when public.is_master() then v.summary
      when a.master_action is not null then concat_ws(' ',nullif(a.master_action->>'public_text',''),
        case when coalesce((a.master_action->>'reveal_details')::boolean,false) then nullif(a.master_action->>'damage_type','') end)
      else case v.status
        when 'pending_defense' then 'Aguardando reação.' when 'miss' then 'O ataque não acertou.'
        when 'defended' then 'O ataque foi defendido.' when 'cancelled' then 'A ação foi interrompida.' else 'Ação resolvida.' end
      end,
    v.created_at
  from public.get_visible_combat_actions_privacy_core(p_encounter_id) v
  join public.combat_actions a on a.id=v.id
  left join public.combat_participants ap on ap.encounter_id=v.encounter_id and ap.character_id=v.attacker_character_id
  left join public.combat_participants tp on tp.encounter_id=v.encounter_id and tp.character_id=v.target_character_id
  where auth.uid() is not null;
$$;
revoke execute on function public.get_visible_combat_actions(uuid) from public,anon;
grant execute on function public.get_visible_combat_actions(uuid) to authenticated;

create or replace function public.get_boostable_combat_actions(p_encounter_id uuid)
returns table(id uuid,attacker_character_id uuid,target_character_id uuid,attacker_name text,target_name text,
  label text,status text,attack_natural int,attack_total int,target_ca int,created_at timestamptz)
language sql stable security definer set search_path=public as $$
  select a.id,a.attacker_character_id,
    case when public.is_master() or public.owns_character(a.target_character_id) or tp.visible_to_players then a.target_character_id end,
    trim(concat_ws(' ',ac.first_name,ac.last_name)),
    case when public.is_master() or public.owns_character(a.target_character_id) or tp.visible_to_players then trim(concat_ws(' ',tc.first_name,tc.last_name)) else 'Entidade oculta' end,
    case when public.is_master() or public.owns_character(a.attacker_character_id) then a.label else 'Ataque' end,
    a.status,a.attack_natural,a.attack_total,
    case when public.is_master() or public.owns_character(a.target_character_id) then a.target_ca end,a.created_at
  from public.combat_actions a join public.characters ac on ac.id=a.attacker_character_id join public.characters tc on tc.id=a.target_character_id
  left join public.combat_participants tp on tp.encounter_id=a.encounter_id and tp.character_id=a.target_character_id
  where a.encounter_id=p_encounter_id and a.status in ('miss','pending_defense') and a.attack_natural is not null
    and (public.is_master() or (ac.entity_type='player' and exists(select 1 from public.combat_participants me where me.encounter_id=p_encounter_id and public.owns_character(me.character_id))))
  order by a.created_at desc limit 12;
$$;
revoke execute on function public.get_boostable_combat_actions(uuid) from public,anon;

-- Núcleos retornam combat_actions completos. Clientes só precisam do ID/resultados públicos.
-- RPCs internos permanecem disponíveis a outros security definer, mas não diretamente ao cliente.
revoke execute on function public.resolve_combat_hit(uuid,boolean) from public,anon,authenticated;

alter function public.resolve_combat_defense(uuid,text,text,int) rename to resolve_combat_defense_privacy_core;
revoke execute on function public.resolve_combat_defense_privacy_core(uuid,text,text,int) from public,anon,authenticated;
create or replace function public.resolve_combat_defense(p_action_id uuid,p_defense_type text,p_mode text default 'normal',p_count int default 1)
returns jsonb language plpgsql security definer set search_path=public as $$
declare result public.combat_actions%rowtype; visible jsonb;
begin
  result:=public.resolve_combat_defense_privacy_core(p_action_id,p_defense_type,p_mode,p_count);
  if public.is_master() then return to_jsonb(result); end if;
  select to_jsonb(v) into visible from public.get_visible_combat_actions(result.encounter_id) v where v.id=result.id;
  return visible;
end;
$$;
revoke execute on function public.resolve_combat_defense(uuid,text,text,int) from public,anon;
grant execute on function public.resolve_combat_defense(uuid,text,text,int) to authenticated;

-- Testes resistidos e danos contínuos não publicam o nome interno do efeito causador.
create or replace function public.public_effect_roll_label()
returns trigger language plpgsql set search_path=public as $$
begin
  if new.visibility='public' and new.roll_type in ('effect','defense') then
    new.label:=case when new.roll_type='effect' then 'Efeito em andamento' else 'Teste de resistência' end;
  end if;
  return new;
end;
$$;
create trigger public_effect_roll_label before insert or update on public.roll_logs
for each row execute function public.public_effect_roll_label();
update public.roll_logs set label=case when roll_type='effect' then 'Efeito em andamento' else 'Teste de resistência' end
where visibility='public' and roll_type in ('effect','defense');

-- As mesmas projeções valem para logs restaurados por Undo (trigger acima).
-- Mensagens de validação não devem identificar uma técnica ainda secreta.
do $$
declare definition text;
begin
  select pg_get_functiondef('public.create_combat_attack(uuid,uuid,uuid,text,text,uuid,text,text,int,int,boolean,boolean,int,int,int,text,text,text,int)'::regprocedure) into definition;
  definition:=replace(definition,'Mugen — Infinito: o ataque não consegue atravessar a distância até o alvo.','O ataque não consegue alcançar o alvo.');
  execute definition;
  select pg_get_functiondef('public.use_ability_in_combat(uuid,uuid,uuid,uuid,text,text,jsonb)'::regprocedure) into definition;
  definition:=replace(definition,'Mandato: Cale-se — esta capacidade amaldiçoada não pode ser manifestada enquanto o silêncio estiver ativo.','Esta capacidade está temporariamente suprimida.');
  execute definition;
  select pg_get_functiondef('public.get_physical_attack_prompt(uuid)'::regprocedure) into definition;
  definition:=replace(definition,'coalesce(nullif(bonus.name,''''),''Dano adicional'')','''Dano adicional''');
  execute definition;
end;
$$;
