-- Correntes do Destino - motor de testes e combate v0.4
-- Mantém rolagens do Mestre ocultas no banco: jogadores nunca recebem os dados brutos
-- de ações criadas por uma conta master. Reações são resolvidas por RPC no servidor.

alter table public.equipment
  add column if not exists attack_config jsonb not null default '{}'::jsonb;

alter table public.combat_participants
  add column if not exists black_flash_turns int not null default 0,
  add column if not exists black_flash_discount_used boolean not null default false;

create table if not exists public.combat_actions (
  id uuid primary key default gen_random_uuid(),
  encounter_id uuid not null references public.combat_encounters(id) on delete cascade,
  attacker_character_id uuid not null references public.characters(id) on delete cascade,
  target_character_id uuid not null references public.characters(id) on delete cascade,
  source_type text not null default 'basic' check (source_type in ('basic','ability','equipment','counterattack','custom')),
  source_id uuid,
  label text not null default 'Ataque',
  created_by uuid not null default auth.uid(),

  attack_attribute_key text,
  attack_skill_key text,
  attack_rolls jsonb not null default '[]'::jsonb,
  attack_natural int,
  attack_bonus int not null default 0,
  attack_total int,
  target_ca int,
  roll_mode text not null default 'normal' check (roll_mode in ('normal','advantage','disadvantage')),
  roll_count int not null default 1,

  pa_cost int not null default 1,
  ea_cost int not null default 0,
  ea_cost_paid int not null default 0,
  uses_cursed_energy boolean not null default false,
  forced_critical boolean not null default false,
  critical_threshold int not null default 20 check (critical_threshold between 2 and 20),
  is_critical boolean not null default false,
  kokusen_eligible boolean not null default false,
  kokusen_denied boolean not null default false,
  is_kokusen boolean not null default false,

  damage_dice_count int not null default 0,
  damage_die int not null default 0,
  damage_flat_attribute_key text,
  damage_rolls jsonb not null default '[]'::jsonb,
  damage_flat int not null default 0,
  damage_total int not null default 0,
  damage_reduction text not null default 'none' check (damage_reduction in ('none','half')),
  condition_key text,

  defense_type text check (defense_type in ('dodge','defend','reinforce','fortitude','accept')),
  defense_created_by uuid,
  defense_rolls jsonb not null default '[]'::jsonb,
  defense_natural int,
  defense_bonus int,
  defense_total int,
  defense_success boolean,

  counterattack_available boolean not null default false,
  status text not null default 'pending_defense' check (status in ('pending_defense','miss','defended','resolved','cancelled')),
  summary text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists combat_actions_encounter_idx on public.combat_actions(encounter_id, created_at desc);
create index if not exists combat_actions_target_idx on public.combat_actions(target_character_id, status);

alter table public.combat_actions enable row level security;

-- A tabela bruta não é legível por jogadores. A UI usa get_visible_combat_actions(),
-- que remove resultados secretos de ataques feitos pelo Mestre.
drop policy if exists "combat_actions_master_read" on public.combat_actions;
create policy "combat_actions_master_read" on public.combat_actions for select to authenticated
using (public.is_master());

-- Escrita direta é desabilitada; toda resolução ocorre por RPC security definer.
grant select on public.combat_actions to authenticated;

create or replace function public.combat_attribute_modifier(p_character_id uuid, p_attribute_key text)
returns int
language sql stable security definer set search_path=public
as $$
  select floor(coalesce((c.attributes->>p_attribute_key)::numeric, 0) / 2.0)::int
  from public.characters c where c.id=p_character_id;
$$;

create or replace function public.combat_skill_bonus(p_character_id uuid, p_skill_key text)
returns int
language sql stable security definer set search_path=public
as $$
  select coalesce((c.skills->>p_skill_key)::int,0)
  from public.characters c where c.id=p_character_id;
$$;

create or replace function public.combat_test_bonus(p_character_id uuid, p_attribute_key text, p_skill_key text)
returns int
language sql stable security definer set search_path=public
as $$
  select coalesce(public.combat_attribute_modifier(p_character_id,p_attribute_key),0)
       + coalesce(public.combat_skill_bonus(p_character_id,p_skill_key),0);
$$;

create or replace function public.combat_ca(p_character_id uuid)
returns int
language sql stable security definer set search_path=public
as $$
  select greatest(
    10 + public.combat_test_bonus(p_character_id,'dexterity','reflexes'),
    10 + public.combat_test_bonus(p_character_id,'resistance','defend'),
    10 + public.combat_test_bonus(p_character_id,'resistance','fortitude'),
    10 + public.combat_test_bonus(p_character_id,'cursed_control','reinforcement')
  );
$$;

create or replace function public.combat_max_ps(p_character_id uuid)
returns int
language sql stable security definer set search_path=public
as $$
  select 18 + 2*c.level
    + 2*coalesce((c.attributes->>'resistance')::int,1)
    + 2*c.growth_vigor + c.permanent_ps_bonus
  from public.characters c where c.id=p_character_id;
$$;

create or replace function public.combat_max_ea(p_character_id uuid)
returns int
language sql stable security definer set search_path=public
as $$
  select 18 + 2*c.level
    + 2*coalesce((c.attributes->>'cursed_control')::int,1)
    + 2*c.growth_reserve + c.permanent_ea_bonus
  from public.characters c where c.id=p_character_id;
$$;

create or replace function public.combat_max_pa(p_character_id uuid)
returns int
language sql stable security definer set search_path=public
as $$
  select case
    when c.level=100 then 7
    when c.level>=75 then 6
    when c.level>=50 then 5
    when c.level>=25 then 4
    else 3 end
  from public.characters c where c.id=p_character_id;
$$;

create or replace function public.roll_pg_die(p_sides int)
returns int
language sql volatile
as $$ select floor(random()*greatest(1,p_sides))::int + 1; $$;

create or replace function public.roll_pg_d20(p_mode text default 'normal', p_count int default 1)
returns jsonb
language plpgsql volatile
as $$
declare
  rolls int[] := '{}';
  i int;
  n int;
  c int := greatest(1,least(10,coalesce(p_count,1)));
begin
  if p_mode='normal' then c:=1;
  elsif p_mode='advantage' and c<2 then c:=2;
  elsif p_mode='disadvantage' and c<2 then c:=2;
  end if;
  for i in 1..c loop rolls := array_append(rolls, public.roll_pg_die(20)); end loop;
  if p_mode='advantage' then select max(v) into n from unnest(rolls) v;
  elsif p_mode='disadvantage' then select min(v) into n from unnest(rolls) v;
  else n:=rolls[1]; end if;
  return jsonb_build_object('rolls',to_jsonb(rolls),'natural',n);
end;
$$;

create or replace function public.roll_pg_damage(p_count int, p_sides int, p_critical boolean default false)
returns jsonb
language plpgsql volatile
as $$
declare
  rolls int[] := '{}';
  i int;
  total int := 0;
  c int := greatest(0,least(40,coalesce(p_count,0))) * case when p_critical then 2 else 1 end;
begin
  if c=0 or p_sides<=0 then return jsonb_build_object('rolls','[]'::jsonb,'total',0); end if;
  for i in 1..c loop
    rolls := array_append(rolls, public.roll_pg_die(p_sides));
    total := total + rolls[array_length(rolls,1)];
  end loop;
  return jsonb_build_object('rolls',to_jsonb(rolls),'total',total);
end;
$$;

create or replace function public.get_combat_targets(p_encounter_id uuid)
returns table(participant_id uuid, character_id uuid, display_name text, entity_type text, ca int, defeated boolean)
language sql stable security definer set search_path=public
as $$
  select cp.id, c.id, trim(concat_ws(' ',c.first_name,c.last_name)), c.entity_type,
         public.combat_ca(c.id), cp.defeated
  from public.combat_participants cp
  join public.characters c on c.id=cp.character_id
  where cp.encounter_id=p_encounter_id
  order by cp.initiative desc, c.first_name;
$$;

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
language sql stable security definer set search_path=public
as $$
  select a.id,a.encounter_id,a.attacker_character_id,a.target_character_id,
         trim(concat_ws(' ',ac.first_name,ac.last_name)),trim(concat_ws(' ',tc.first_name,tc.last_name)),
         a.source_type,a.source_id,a.label,
         case when not public.is_master() and p.role='master' and not public.owns_character(a.attacker_character_id) then '[]'::jsonb else a.attack_rolls end,
         case when not public.is_master() and p.role='master' and not public.owns_character(a.attacker_character_id) then null else a.attack_natural end,
         case when not public.is_master() and p.role='master' and not public.owns_character(a.attacker_character_id) then 0 else a.attack_bonus end,
         case when not public.is_master() and p.role='master' and not public.owns_character(a.attacker_character_id) then null else a.attack_total end,
         a.target_ca,
         (not public.is_master() and p.role='master' and not public.owns_character(a.attacker_character_id)) as attack_hidden,
         (not public.is_master() and dp.role='master' and not public.owns_character(a.target_character_id)) as defense_hidden,
         a.is_critical,a.kokusen_eligible,a.kokusen_denied,a.is_kokusen,
         case when not public.is_master() and p.role='master' and not public.owns_character(a.attacker_character_id) then '[]'::jsonb else a.damage_rolls end,a.damage_flat,a.damage_total,a.damage_reduction,
         a.defense_type,
         case when not public.is_master() and dp.role='master' and not public.owns_character(a.target_character_id) then '[]'::jsonb else a.defense_rolls end,
         case when not public.is_master() and dp.role='master' and not public.owns_character(a.target_character_id) then null else a.defense_natural end,
         case when not public.is_master() and dp.role='master' and not public.owns_character(a.target_character_id) then 0 else a.defense_bonus end,
         case when not public.is_master() and dp.role='master' and not public.owns_character(a.target_character_id) then null else a.defense_total end,
         a.defense_success,
         a.counterattack_available,a.condition_key,a.status,a.summary,a.created_at
  from public.combat_actions a
  join public.characters ac on ac.id=a.attacker_character_id
  join public.characters tc on tc.id=a.target_character_id
  left join public.profiles p on p.id=a.created_by
  left join public.profiles dp on dp.id=a.defense_created_by
  where a.encounter_id=p_encounter_id
    and (public.is_master() or public.owns_character(a.attacker_character_id) or public.owns_character(a.target_character_id))
  order by a.created_at desc
  limit 100;
$$;

create or replace function public.roll_general_test(
  p_character_id uuid,
  p_label text,
  p_attribute_key text,
  p_skill_key text,
  p_mode text default 'normal',
  p_count int default 1,
  p_visibility text default 'public',
  p_encounter_id uuid default null
)
returns jsonb
language plpgsql security definer set search_path=public
as $$
declare
  r jsonb;
  nat int;
  b int;
  total int;
  vis text;
  flow_bonus int := 0;
begin
  if not (public.is_master() or public.owns_character(p_character_id)) then raise exception 'Sem permissão para rolar por esta ficha.'; end if;
  if p_visibility not in ('public','owner','master') then p_visibility:='public'; end if;
  if public.is_master() then vis:='master'; else vis:=p_visibility; end if;
  b:=public.combat_test_bonus(p_character_id,p_attribute_key,p_skill_key);
  select case when cp.black_flash_turns>0 and p_attribute_key='cursed_control' then 1 else 0 end into flow_bonus
  from public.combat_participants cp where cp.character_id=p_character_id and (p_encounter_id is null or cp.encounter_id=p_encounter_id) limit 1;
  b:=b+coalesce(flow_bonus,0);
  r:=public.roll_pg_d20(p_mode,p_count); nat:=(r->>'natural')::int; total:=nat+b;
  insert into public.roll_logs(encounter_id,character_id,label,roll_type,expression,rolls,natural_roll,bonus,total,is_critical,kokusen_eligible,visibility)
  values(p_encounter_id,p_character_id,p_label,'skill',case when p_mode='normal' then '1d20' else p_count||'d20 '||p_mode end,r->'rolls',nat,b,total,nat=20,false,vis);
  return jsonb_build_object('rolls',r->'rolls','natural',nat,'bonus',b,'total',total,'critical',nat=20,'failure',nat=1);
end;
$$;

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
  ap public.combat_participants%rowtype;
  tp public.combat_participants%rowtype;
  r jsonb; nat int; b int; total int; tca int; crit boolean; kok boolean; st text;
  paid_ea int := greatest(0,coalesce(p_ea_cost,0));
  discount boolean := false;
  action_id uuid;
  vis text;
begin
  if not (public.is_master() or public.owns_character(p_attacker_character_id)) then raise exception 'Sem permissão para usar esta ficha.'; end if;
  select * into ap from public.combat_participants where encounter_id=p_encounter_id and character_id=p_attacker_character_id for update;
  select * into tp from public.combat_participants where encounter_id=p_encounter_id and character_id=p_target_character_id for update;
  if ap.id is null or tp.id is null then raise exception 'Atacante e alvo precisam participar do combate.'; end if;
  if ap.defeated then raise exception 'O atacante está derrotado.'; end if;

  if ap.black_flash_turns>0 and p_source_type='ability' and paid_ea>0 and not ap.black_flash_discount_used then
    paid_ea:=greatest(1,paid_ea-1); discount:=true;
  end if;
  if coalesce(ap.current_pa,public.combat_max_pa(p_attacker_character_id)) < greatest(0,p_pa_cost) then raise exception 'PA insuficiente.'; end if;
  if coalesce(ap.current_ea,public.combat_max_ea(p_attacker_character_id)) < paid_ea then raise exception 'EA insuficiente.'; end if;

  update public.combat_participants set
    current_pa=coalesce(current_pa,public.combat_max_pa(p_attacker_character_id))-greatest(0,p_pa_cost),
    current_ea=coalesce(current_ea,public.combat_max_ea(p_attacker_character_id))-paid_ea,
    black_flash_discount_used=case when discount then true else black_flash_discount_used end
  where id=ap.id;

  b:=public.combat_test_bonus(p_attacker_character_id,p_attack_attribute_key,p_attack_skill_key);
  if ap.black_flash_turns>0 and p_attack_attribute_key='cursed_control' then b:=b+1; end if;
  r:=public.roll_pg_d20(p_roll_mode,p_roll_count); nat:=(r->>'natural')::int; total:=nat+b;
  tca:=public.combat_ca(p_target_character_id);
  crit:=(nat<>1) and (p_forced_critical or nat>=greatest(2,least(20,p_critical_threshold)));
  kok:=(nat=20 and p_uses_cursed_energy);
  st:=case when nat=1 then 'miss' when nat=20 or total>tca then 'pending_defense' else 'miss' end;

  insert into public.combat_actions(
    encounter_id,attacker_character_id,target_character_id,source_type,source_id,label,
    attack_attribute_key,attack_skill_key,attack_rolls,attack_natural,attack_bonus,attack_total,target_ca,roll_mode,roll_count,
    pa_cost,ea_cost,ea_cost_paid,uses_cursed_energy,forced_critical,critical_threshold,is_critical,kokusen_eligible,
    damage_dice_count,damage_die,damage_flat_attribute_key,condition_key,status,summary)
  values(
    p_encounter_id,p_attacker_character_id,p_target_character_id,p_source_type,p_source_id,coalesce(nullif(p_label,''),'Ataque'),
    p_attack_attribute_key,p_attack_skill_key,r->'rolls',nat,b,total,tca,p_roll_mode,greatest(1,p_roll_count),
    greatest(0,p_pa_cost),greatest(0,p_ea_cost),paid_ea,p_uses_cursed_energy,p_forced_critical,greatest(2,least(20,p_critical_threshold)),crit,kok,
    greatest(0,p_damage_dice_count),greatest(0,p_damage_die),p_damage_flat_attribute_key,p_condition_key,st,
    case when st='miss' then 'O ataque não superou a defesa passiva.' else 'O ataque superou a defesa passiva. O alvo pode reagir.' end)
  returning id into action_id;

  vis:=case when public.is_master() then 'master' else 'public' end;
  insert into public.roll_logs(encounter_id,character_id,label,roll_type,expression,rolls,natural_roll,bonus,total,is_critical,kokusen_eligible,visibility)
  values(p_encounter_id,p_attacker_character_id,coalesce(nullif(p_label,''),'Ataque'),'attack',case when p_roll_mode='normal' then '1d20' else greatest(1,p_roll_count)||'d20 '||p_roll_mode end,r->'rolls',nat,b,total,crit,kok,vis);

  -- Força um evento realtime visível ao alvo sem revelar a rolagem secreta do Mestre.
  if st='pending_defense' then update public.combat_participants set current_ps=current_ps where id=tp.id; end if;
  return action_id;
end;
$$;

create or replace function public.resolve_combat_hit(p_action_id uuid, p_half boolean default false)
returns public.combat_actions
language plpgsql security definer set search_path=public
as $$
declare
  a public.combat_actions%rowtype;
  tp public.combat_participants%rowtype;
  ap public.combat_participants%rowtype;
  d jsonb; rolled int; flat int; total int; final_total int; actual_kokusen boolean;
begin
  select * into a from public.combat_actions where id=p_action_id for update;
  if a.id is null then raise exception 'Ação não encontrada.'; end if;
  if not (public.is_master() or public.owns_character(a.target_character_id)) then raise exception 'Somente o alvo ou o Mestre pode resolver o golpe.'; end if;
  select * into tp from public.combat_participants where encounter_id=a.encounter_id and character_id=a.target_character_id for update;
  select * into ap from public.combat_participants where encounter_id=a.encounter_id and character_id=a.attacker_character_id for update;
  d:=public.roll_pg_damage(a.damage_dice_count,a.damage_die,a.is_critical);
  rolled:=coalesce((d->>'total')::int,0);
  flat:=case when a.damage_flat_attribute_key is null or a.damage_flat_attribute_key='' then 0 else public.combat_attribute_modifier(a.attacker_character_id,a.damage_flat_attribute_key) end;
  total:=greatest(0,rolled+flat);
  final_total:=case when p_half then floor(total/2.0)::int else total end;
  actual_kokusen:=a.kokusen_eligible and not a.kokusen_denied;

  update public.combat_participants set
    current_ps=greatest(0,coalesce(current_ps,public.combat_max_ps(a.target_character_id))-final_total),
    defeated=(greatest(0,coalesce(current_ps,public.combat_max_ps(a.target_character_id))-final_total)=0),
    conditions=case when a.condition_key is not null and a.condition_key<>'' and not (conditions ? a.condition_key)
      then conditions || jsonb_build_array(a.condition_key) else conditions end
  where id=tp.id;

  if actual_kokusen then
    update public.combat_participants set black_flash_turns=2, black_flash_discount_used=false where id=ap.id;
  end if;

  update public.combat_actions set
    damage_rolls=d->'rolls',damage_flat=flat,damage_total=final_total,
    damage_reduction=case when p_half then 'half' else 'none' end,
    is_kokusen=actual_kokusen,status='resolved',
    summary=case when actual_kokusen then 'Kokusen! O golpe conectou e o atacante entrou em Fluxo Negro.' when p_half then 'O alvo resistiu e reduziu o dano pela metade.' else 'O golpe conectou.' end,
    updated_at=now()
  where id=a.id returning * into a;
  return a;
end;
$$;

create or replace function public.resolve_combat_defense(
  p_action_id uuid,
  p_defense_type text,
  p_mode text default 'normal',
  p_count int default 1
)
returns public.combat_actions
language plpgsql security definer set search_path=public
as $$
declare
  a public.combat_actions%rowtype;
  tp public.combat_participants%rowtype;
  attr_key text; skill_key text; r jsonb; nat int; b int; total int; success boolean; deny_kokusen boolean := false; vis text;
begin
  select * into a from public.combat_actions where id=p_action_id for update;
  if a.id is null or a.status<>'pending_defense' then raise exception 'Esta ação não está aguardando defesa.'; end if;
  if not (public.is_master() or public.owns_character(a.target_character_id)) then raise exception 'Somente o alvo ou o Mestre pode reagir.'; end if;
  if p_defense_type='accept' then
    update public.combat_actions set defense_type='accept',defense_created_by=auth.uid(),defense_success=false,updated_at=now() where id=a.id;
    return public.resolve_combat_hit(a.id,false);
  end if;
  if p_defense_type not in ('dodge','defend','reinforce','fortitude') then raise exception 'Defesa inválida.'; end if;
  select * into tp from public.combat_participants where encounter_id=a.encounter_id and character_id=a.target_character_id for update;
  if coalesce(tp.current_pa,public.combat_max_pa(a.target_character_id))<1 then raise exception 'PA insuficiente para reagir.'; end if;
  update public.combat_participants set current_pa=coalesce(current_pa,public.combat_max_pa(a.target_character_id))-1 where id=tp.id;

  if p_defense_type='dodge' then attr_key:='dexterity';skill_key:='reflexes';
  elsif p_defense_type='defend' then attr_key:='resistance';skill_key:='defend';
  elsif p_defense_type='reinforce' then attr_key:='cursed_control';skill_key:='reinforcement';
  else attr_key:='resistance';skill_key:='fortitude'; end if;
  b:=public.combat_test_bonus(a.target_character_id,attr_key,skill_key);
  if tp.black_flash_turns>0 and attr_key='cursed_control' then b:=b+1; end if;
  r:=public.roll_pg_d20(p_mode,p_count);nat:=(r->>'natural')::int;total:=nat+b;
  success:=(nat<>1 and total>=a.attack_total);
  deny_kokusen:=(a.attack_natural=20 and nat=20 and p_defense_type in ('defend','reinforce'));

  update public.combat_actions set defense_type=p_defense_type,defense_created_by=auth.uid(),defense_rolls=r->'rolls',defense_natural=nat,
    defense_bonus=b,defense_total=total,defense_success=success,kokusen_denied=deny_kokusen,updated_at=now()
  where id=a.id returning * into a;

  vis:=case when public.is_master() then 'master' else 'public' end;
  insert into public.roll_logs(encounter_id,character_id,label,roll_type,expression,rolls,natural_roll,bonus,total,is_critical,kokusen_eligible,visibility)
  values(a.encounter_id,a.target_character_id,initcap(p_defense_type),'defense',case when p_mode='normal' then '1d20' else greatest(1,p_count)||'d20 '||p_mode end,r->'rolls',nat,b,total,nat=20,false,vis);

  if p_defense_type='fortitude' then
    return public.resolve_combat_hit(a.id,success);
  elsif success then
    update public.combat_actions set status='defended',counterattack_available=true,summary='Defesa ativa bem-sucedida.',updated_at=now() where id=a.id returning * into a;
    return a;
  else
    return public.resolve_combat_hit(a.id,false);
  end if;
end;
$$;

create or replace function public.create_basic_counterattack(p_action_id uuid, p_use_cursed_energy boolean default false)
returns uuid
language plpgsql security definer set search_path=public
as $$
declare
  a public.combat_actions%rowtype;
  tp public.combat_participants%rowtype;
  n int; result_id uuid;
begin
  select * into a from public.combat_actions where id=p_action_id for update;
  if a.id is null or a.status<>'defended' or not a.counterattack_available then raise exception 'Contra-ataque não está disponível.'; end if;
  if not (public.is_master() or public.owns_character(a.target_character_id)) then raise exception 'Sem permissão para contra-atacar.'; end if;
  select * into tp from public.combat_participants where encounter_id=a.encounter_id and character_id=a.target_character_id for update;
  n:=coalesce(tp.counterattack_count,0)+1;
  update public.combat_participants set counterattack_count=n where id=tp.id;
  update public.combat_actions set counterattack_available=false,updated_at=now() where id=a.id;
  result_id:=public.create_combat_attack(
    a.encounter_id,a.target_character_id,a.attacker_character_id,'Contra-ataque','counterattack',null,
    'strength','fight',1,case when p_use_cursed_energy then 1 else 0 end,p_use_cursed_energy,false,20,1,6,'strength',null,
    case when n=1 then 'normal' else 'disadvantage' end,n
  );
  return result_id;
end;
$$;

create or replace function public.use_combat_effect(
  p_encounter_id uuid,
  p_character_id uuid,
  p_target_character_id uuid,
  p_label text,
  p_source_id uuid,
  p_pa_cost int,
  p_ea_cost int,
  p_damage_dice_count int,
  p_damage_die int,
  p_damage_flat_attribute_key text,
  p_condition_key text
)
returns jsonb
language plpgsql security definer set search_path=public
as $$
declare
  cp public.combat_participants%rowtype; tp public.combat_participants%rowtype; d jsonb; flat int; total int; paid_ea int; discount boolean:=false;
begin
  if not (public.is_master() or public.owns_character(p_character_id)) then raise exception 'Sem permissão para usar esta ficha.'; end if;
  select * into cp from public.combat_participants where encounter_id=p_encounter_id and character_id=p_character_id for update;
  select * into tp from public.combat_participants where encounter_id=p_encounter_id and character_id=p_target_character_id for update;
  if cp.id is null or tp.id is null then raise exception 'Usuário e alvo precisam estar no combate.'; end if;
  paid_ea:=greatest(0,p_ea_cost);
  if cp.black_flash_turns>0 and paid_ea>0 and not cp.black_flash_discount_used then paid_ea:=greatest(1,paid_ea-1);discount:=true;end if;
  if coalesce(cp.current_pa,public.combat_max_pa(p_character_id))<greatest(0,p_pa_cost) then raise exception 'PA insuficiente.';end if;
  if coalesce(cp.current_ea,public.combat_max_ea(p_character_id))<paid_ea then raise exception 'EA insuficiente.';end if;
  update public.combat_participants set current_pa=coalesce(current_pa,public.combat_max_pa(p_character_id))-greatest(0,p_pa_cost),current_ea=coalesce(current_ea,public.combat_max_ea(p_character_id))-paid_ea,black_flash_discount_used=case when discount then true else black_flash_discount_used end where id=cp.id;
  d:=public.roll_pg_damage(p_damage_dice_count,p_damage_die,false);
  flat:=case when p_damage_flat_attribute_key is null or p_damage_flat_attribute_key='' then 0 else public.combat_attribute_modifier(p_character_id,p_damage_flat_attribute_key) end;
  total:=greatest(0,coalesce((d->>'total')::int,0)+flat);
  update public.combat_participants set current_ps=greatest(0,coalesce(current_ps,public.combat_max_ps(p_target_character_id))-total), defeated=(greatest(0,coalesce(current_ps,public.combat_max_ps(p_target_character_id))-total)=0), conditions=case when p_condition_key is not null and p_condition_key<>'' and not (conditions ? p_condition_key) then conditions||jsonb_build_array(p_condition_key) else conditions end where id=tp.id;
  insert into public.roll_logs(encounter_id,character_id,label,roll_type,expression,rolls,natural_roll,bonus,total,is_critical,kokusen_eligible,visibility)
  values(p_encounter_id,p_character_id,p_label,'ability',p_damage_dice_count||'d'||p_damage_die,d->'rolls',null,flat,total,false,false,case when public.is_master() then 'master' else 'public' end);
  return jsonb_build_object('damage_rolls',d->'rolls','flat',flat,'damage_total',total,'ea_paid',paid_ea);
end;
$$;

create or replace function public.start_combat_turn(p_participant_id uuid)
returns public.combat_participants
language plpgsql security definer set search_path=public
as $$
declare p public.combat_participants%rowtype;
begin
  select * into p from public.combat_participants where id=p_participant_id for update;
  if p.id is null then raise exception 'Participante não encontrado.'; end if;
  if not (public.is_master() or public.owns_character(p.character_id)) then raise exception 'Sem permissão.'; end if;
  update public.combat_participants set current_pa=public.combat_max_pa(character_id),counterattack_count=0,black_flash_discount_used=false where id=p.id returning * into p;
  return p;
end;
$$;

create or replace function public.end_combat_turn(p_participant_id uuid)
returns public.combat_participants
language plpgsql security definer set search_path=public
as $$
declare p public.combat_participants%rowtype;
begin
  select * into p from public.combat_participants where id=p_participant_id for update;
  if p.id is null then raise exception 'Participante não encontrado.'; end if;
  if not (public.is_master() or public.owns_character(p.character_id)) then raise exception 'Sem permissão.'; end if;
  update public.combat_participants set black_flash_turns=greatest(0,black_flash_turns-1) where id=p.id returning * into p;
  return p;
end;
$$;

create or replace function public.roll_combat_initiative(p_participant_id uuid)
returns int
language plpgsql security definer set search_path=public
as $$
declare p public.combat_participants%rowtype; r jsonb; nat int; b int; total int;
begin
  select * into p from public.combat_participants where id=p_participant_id for update;
  if p.id is null then raise exception 'Participante não encontrado.'; end if;
  if not (public.is_master() or public.owns_character(p.character_id)) then raise exception 'Sem permissão.'; end if;
  b:=public.combat_test_bonus(p.character_id,'dexterity','reflexes');r:=public.roll_pg_d20('normal',1);nat:=(r->>'natural')::int;total:=nat+b;
  update public.combat_participants set initiative=total where id=p.id;
  insert into public.roll_logs(encounter_id,character_id,label,roll_type,expression,rolls,natural_roll,bonus,total,is_critical,kokusen_eligible,visibility)
  values(p.encounter_id,p.character_id,'Iniciativa','initiative','1d20',r->'rolls',nat,b,total,nat=20,false,case when public.is_master() then 'master' else 'public' end);
  return total;
end;
$$;

create or replace function public.remove_combat_condition(p_participant_id uuid,p_condition_key text)
returns public.combat_participants
language plpgsql security definer set search_path=public
as $$
declare p public.combat_participants%rowtype;
begin
  select * into p from public.combat_participants where id=p_participant_id for update;
  if p.id is null then raise exception 'Participante não encontrado.'; end if;
  if not (public.is_master() or public.owns_character(p.character_id)) then raise exception 'Sem permissão.'; end if;
  update public.combat_participants set conditions=coalesce(conditions,'[]'::jsonb) - p_condition_key where id=p.id returning * into p;
  return p;
end;
$$;

grant execute on function public.get_combat_targets(uuid) to authenticated;
grant execute on function public.get_visible_combat_actions(uuid) to authenticated;
grant execute on function public.roll_general_test(uuid,text,text,text,text,int,text,uuid) to authenticated;
grant execute on function public.create_combat_attack(uuid,uuid,uuid,text,text,uuid,text,text,int,int,boolean,boolean,int,int,int,text,text,text,int) to authenticated;
grant execute on function public.resolve_combat_defense(uuid,text,text,int) to authenticated;
grant execute on function public.resolve_combat_hit(uuid,boolean) to authenticated;
grant execute on function public.create_basic_counterattack(uuid,boolean) to authenticated;
grant execute on function public.use_combat_effect(uuid,uuid,uuid,text,uuid,int,int,int,int,text,text) to authenticated;
grant execute on function public.start_combat_turn(uuid) to authenticated;
grant execute on function public.end_combat_turn(uuid) to authenticated;
grant execute on function public.roll_combat_initiative(uuid) to authenticated;
grant execute on function public.remove_combat_condition(uuid,text) to authenticated;

-- Atualiza a descrição de Lutar no compêndio para incluir armas corpo a corpo.
update public.system_skills
set description='Treinamento e eficiência em combate corpo a corpo, desarmado ou utilizando armas de combate próximo.'
where key='fight';
