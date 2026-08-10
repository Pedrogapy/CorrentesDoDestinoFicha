-- Correntes do Destino - mecânicas específicas de players v0.7.0
--
-- Objetivos:
-- * recursos especiais por personagem (ex.: Coágulos do Jin);
-- * Manifestação ativa com ficha filha e habilidades bloqueadas até a invocação;
-- * habilidades de reação utilizáveis fora do turno próprio;
-- * alvo "Próprio" automático sem seletor desnecessário;
-- * Sobrecargas/modos estruturados de habilidades;
-- * efeitos temporários de combate (escudos, estase, transformação, bônus);
-- * Armamento de Sangue cria arma temporária de verdade no inventário;
-- * todos estes estados entram no Desfazer do combate.

alter table public.characters
  add column if not exists special_resources jsonb not null default '[]'::jsonb;

alter table public.combat_participants
  add column if not exists resources jsonb not null default '{}'::jsonb,
  add column if not exists active_summon_character_id uuid references public.characters(id) on delete set null,
  add column if not exists turn_epoch int not null default 0;

alter table public.equipment
  add column if not exists temporary_encounter_id uuid references public.combat_encounters(id) on delete cascade,
  add column if not exists temporary_turns_remaining int,
  add column if not exists created_by_ability_id uuid references public.abilities(id) on delete set null;

create index if not exists equipment_temporary_encounter_idx
on public.equipment(temporary_encounter_id)
where temporary_encounter_id is not null;

-- Novos tipos de origem para habilidades reativas e habilidades vindas de fichas filhas.
alter table public.combat_actions drop constraint if exists combat_actions_source_type_check;
alter table public.combat_actions add constraint combat_actions_source_type_check
check (source_type in (
  'basic','ability','ability_reaction','summon_ability','summon_ability_reaction',
  'equipment','equipment_reaction','counterattack','reaction','custom'
));

create table if not exists public.combat_effect_states (
  id uuid primary key default gen_random_uuid(),
  encounter_id uuid not null references public.combat_encounters(id) on delete cascade,
  source_character_id uuid not null references public.characters(id) on delete cascade,
  target_character_id uuid not null references public.characters(id) on delete cascade,
  source_type text not null default 'ability',
  source_id uuid,
  effect_key text not null,
  name text not null,
  data jsonb not null default '{}'::jsonb,
  remaining_turns int,
  uses_remaining int,
  created_at timestamptz not null default now()
);

create index if not exists combat_effect_states_encounter_target_idx
on public.combat_effect_states(encounter_id,target_character_id);

create table if not exists public.combat_usage (
  id uuid primary key default gen_random_uuid(),
  encounter_id uuid not null references public.combat_encounters(id) on delete cascade,
  user_character_id uuid not null references public.characters(id) on delete cascade,
  source_type text not null,
  source_id uuid not null,
  mode_key text not null default '',
  target_character_id uuid references public.characters(id) on delete cascade,
  turn_epoch int not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists combat_usage_lookup_idx
on public.combat_usage(encounter_id,user_character_id,source_type,source_id,mode_key);

alter table public.combat_effect_states enable row level security;
alter table public.combat_usage enable row level security;

drop policy if exists combat_effect_states_read on public.combat_effect_states;
create policy combat_effect_states_read on public.combat_effect_states
for select to authenticated
using (
  public.is_master()
  or public.owns_character(source_character_id)
  or public.owns_character(target_character_id)
);

-- Uso é controle interno. Jogadores não precisam ler a tabela bruta.
drop policy if exists combat_usage_master_read on public.combat_usage;
create policy combat_usage_master_read on public.combat_usage
for select to authenticated using (public.is_master());

grant select on public.combat_effect_states to authenticated;
grant select on public.combat_usage to authenticated;

-- ============================================================
-- RECURSOS ESPECIAIS
-- ============================================================

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
  return new;
end;
$$;

drop trigger if exists initialize_combat_runtime_trigger on public.combat_participants;
create trigger initialize_combat_runtime_trigger
before insert on public.combat_participants
for each row execute function public.initialize_combat_runtime();

create or replace function public.combat_resource_current(p_participant_id uuid,p_key text)
returns int
language sql stable security definer set search_path=public
as $$
  select coalesce((cp.resources->p_key->>'current')::int,0)
  from public.combat_participants cp where cp.id=p_participant_id;
$$;

create or replace function public.combat_resource_max(p_participant_id uuid,p_key text)
returns int
language sql stable security definer set search_path=public
as $$
  select coalesce((cp.resources->p_key->>'max')::int,0)
  from public.combat_participants cp where cp.id=p_participant_id;
$$;

revoke execute on function public.combat_resource_current(uuid,text) from public,anon,authenticated;
revoke execute on function public.combat_resource_max(uuid,text) from public,anon,authenticated;

create or replace function public.change_combat_resource(p_participant_id uuid,p_key text,p_delta int)
returns int
language plpgsql security definer set search_path=public
as $$
declare
  cp public.combat_participants%rowtype;
  cur int;
  mx int;
  nxt int;
begin
  select * into cp from public.combat_participants where id=p_participant_id for update;
  if cp.id is null then raise exception 'Participante não encontrado.'; end if;
  if not (cp.resources ? p_key) then raise exception 'Recurso especial não existe: %',p_key; end if;
  cur := coalesce((cp.resources->p_key->>'current')::int,0);
  mx := coalesce((cp.resources->p_key->>'max')::int,0);
  nxt := greatest(0,least(mx,cur+coalesce(p_delta,0)));
  if p_delta<0 and cur < abs(p_delta) then
    raise exception 'Recurso especial insuficiente: %.',coalesce(cp.resources->p_key->>'name',p_key);
  end if;
  update public.combat_participants
  set resources=jsonb_set(resources,array[p_key,'current'],to_jsonb(nxt),false)
  where id=cp.id;
  return nxt;
end;
$$;

revoke execute on function public.change_combat_resource(uuid,text,int) from public,anon,authenticated;

-- ============================================================
-- EFEITOS / USOS
-- ============================================================

create or replace function public.record_combat_usage(
  p_encounter_id uuid,
  p_user_character_id uuid,
  p_source_type text,
  p_source_id uuid,
  p_mode_key text,
  p_target_character_id uuid,
  p_once_per_combat boolean,
  p_once_per_target boolean,
  p_once_per_cycle boolean,
  p_usage_scope text default 'mode'
)
returns void
language plpgsql security definer set search_path=public
as $$
declare
  epoch int := 0;
  key_mode text;
begin
  select coalesce(cp.turn_epoch,0) into epoch
  from public.combat_participants cp
  where cp.encounter_id=p_encounter_id and cp.character_id=p_user_character_id;

  key_mode := case when coalesce(p_usage_scope,'mode')='source' then '' else coalesce(p_mode_key,'') end;

  -- Sem limite de uso não há razão para poluir a tabela de controle.
  if not coalesce(p_once_per_combat,false)
     and not coalesce(p_once_per_target,false)
     and not coalesce(p_once_per_cycle,false) then
    return;
  end if;

  if coalesce(p_once_per_combat,false) and exists(
    select 1 from public.combat_usage u
    where u.encounter_id=p_encounter_id
      and u.user_character_id=p_user_character_id
      and u.source_type=p_source_type
      and u.source_id=p_source_id
      and u.mode_key=key_mode
  ) then
    raise exception 'Este efeito já foi usado neste combate.';
  end if;

  if coalesce(p_once_per_target,false) and p_target_character_id is not null and exists(
    select 1 from public.combat_usage u
    where u.encounter_id=p_encounter_id
      and u.user_character_id=p_user_character_id
      and u.source_type=p_source_type
      and u.source_id=p_source_id
      and u.mode_key=key_mode
      and u.target_character_id=p_target_character_id
  ) then
    raise exception 'Este efeito já foi usado neste alvo durante o combate.';
  end if;

  if coalesce(p_once_per_cycle,false) and exists(
    select 1 from public.combat_usage u
    where u.encounter_id=p_encounter_id
      and u.user_character_id=p_user_character_id
      and u.source_type=p_source_type
      and u.source_id=p_source_id
      and u.mode_key=key_mode
      and u.turn_epoch=epoch
  ) then
    raise exception 'Este efeito já foi usado desde o último início de turno deste personagem.';
  end if;

  insert into public.combat_usage(
    encounter_id,user_character_id,source_type,source_id,mode_key,target_character_id,turn_epoch
  ) values (
    p_encounter_id,p_user_character_id,p_source_type,p_source_id,key_mode,p_target_character_id,epoch
  );
end;
$$;

revoke execute on function public.record_combat_usage(uuid,uuid,text,uuid,text,uuid,boolean,boolean,boolean,text) from public,anon,authenticated;

create or replace function public.spend_ability_cost(
  p_encounter_id uuid,
  p_character_id uuid,
  p_pa_cost int,
  p_ea_cost int,
  p_is_reaction boolean
)
returns int
language plpgsql security definer set search_path=public
as $$
declare
  cp public.combat_participants%rowtype;
  paid_ea int := greatest(0,coalesce(p_ea_cost,0));
  discount boolean := false;
begin
  if coalesce(p_is_reaction,false) then
    perform public.assert_combat_participant(p_encounter_id,p_character_id);
  else
    perform public.assert_active_combat_turn(p_encounter_id,p_character_id);
  end if;

  select * into cp
  from public.combat_participants
  where encounter_id=p_encounter_id and character_id=p_character_id
  for update;
  if cp.id is null then raise exception 'Participante não encontrado.'; end if;
  if cp.defeated then raise exception 'O personagem está derrotado.'; end if;

  if coalesce(p_is_reaction,false) and exists(
    select 1 from public.combat_effect_states s
    where s.encounter_id=p_encounter_id and s.target_character_id=p_character_id
      and coalesce((s.data->>'blocks_reactions')::boolean,false)
  ) then
    raise exception 'Este personagem está impedido de reagir por um efeito ativo.';
  end if;
  if not coalesce(p_is_reaction,false) and exists(
    select 1 from public.combat_effect_states s
    where s.encounter_id=p_encounter_id and s.target_character_id=p_character_id
      and coalesce((s.data->>'blocks_actions')::boolean,false)
  ) then
    raise exception 'Este personagem está impedido de agir por um efeito ativo.';
  end if;

  if cp.black_flash_turns>0 and paid_ea>0 and not cp.black_flash_discount_used then
    paid_ea:=greatest(1,paid_ea-1);
    discount:=true;
  end if;

  if coalesce(cp.current_pa,public.combat_max_pa(p_character_id))<greatest(0,coalesce(p_pa_cost,0)) then
    raise exception 'PA insuficiente.';
  end if;
  if coalesce(cp.current_ea,public.combat_max_ea(p_character_id))<paid_ea then
    raise exception 'EA insuficiente.';
  end if;

  update public.combat_participants
  set current_pa=coalesce(current_pa,public.combat_max_pa(p_character_id))-greatest(0,coalesce(p_pa_cost,0)),
      current_ea=coalesce(current_ea,public.combat_max_ea(p_character_id))-paid_ea,
      black_flash_discount_used=case when discount then true else black_flash_discount_used end
  where id=cp.id;

  return paid_ea;
end;
$$;

revoke execute on function public.spend_ability_cost(uuid,uuid,int,int,boolean) from public,anon,authenticated;

-- CA considera bônus temporários estruturados, como Fluxo das Escamas Vermelhas.
create or replace function public.combat_ca(p_character_id uuid)
returns int
language sql stable security definer set search_path=public
as $$
  select greatest(
    10 + public.combat_test_bonus(p_character_id,'dexterity','reflexes'),
    10 + public.combat_test_bonus(p_character_id,'resistance','defend'),
    10 + public.combat_test_bonus(p_character_id,'resistance','fortitude'),
    10 + public.combat_test_bonus(p_character_id,'cursed_control','reinforcement')
  ) + coalesce((
    select sum(coalesce((s.data->>'ca_bonus')::int,0))
    from public.combat_effect_states s
    join public.combat_encounters e on e.id=s.encounter_id and e.status='active'
    where s.target_character_id=p_character_id
  ),0);
$$;

-- ============================================================
-- ATAQUE COM BÔNUS TEMPORÁRIOS / REAÇÕES DE HABILIDADE
-- ============================================================

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
  temp_bonus int := 0;
  bonus_effect record;
begin
  if not (public.is_master() or public.owns_character(p_attacker_character_id)) then raise exception 'Sem permissão para usar esta ficha.'; end if;

  if coalesce(p_source_type,'basic') not in ('counterattack','reaction','equipment_reaction','ability_reaction','summon_ability_reaction') then
    perform public.assert_active_combat_turn(p_encounter_id,p_attacker_character_id);
  else
    perform public.assert_combat_participant(p_encounter_id,p_attacker_character_id);
  end if;

  select * into ap from public.combat_participants where encounter_id=p_encounter_id and character_id=p_attacker_character_id for update;
  select * into tp from public.combat_participants where encounter_id=p_encounter_id and character_id=p_target_character_id for update;
  if ap.id is null or tp.id is null then raise exception 'Atacante e alvo precisam participar do combate.'; end if;
  if ap.defeated then raise exception 'O atacante está derrotado.'; end if;

  if exists(
    select 1 from public.combat_effect_states s
    where s.encounter_id=p_encounter_id and s.target_character_id=p_attacker_character_id
      and coalesce((s.data->>'blocks_actions')::boolean,false)
  ) then
    raise exception 'Este personagem está impedido de agir por um efeito ativo.';
  end if;

  if ap.black_flash_turns>0 and p_source_type in ('ability','summon_ability') and paid_ea>0 and not ap.black_flash_discount_used then
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

  -- Bônus temporário em ataques físicos (ex.: Fluxo das Escamas Vermelhas).
  select coalesce(sum(coalesce((s.data->>'physical_attack_bonus')::int,0)),0)
  into temp_bonus
  from public.combat_effect_states s
  where s.encounter_id=p_encounter_id
    and s.target_character_id=p_attacker_character_id
    and (p_attack_attribute_key in ('strength','dexterity') or p_attack_skill_key in ('fight','impact','grapple','athletics'));
  b:=b+coalesce(temp_bonus,0);

  -- Bônus de precisão do Uniforme Okkotsu: consome no próximo ataque de sangue.
  if p_source_type in ('ability','ability_reaction') and p_source_id is not null and exists(
    select 1 from public.abilities ab
    where ab.id=p_source_id and coalesce(ab.config->'tags','[]'::jsonb) ? 'blood_technique'
  ) then
    select s.* into bonus_effect
    from public.combat_effect_states s
    where s.encounter_id=p_encounter_id
      and s.target_character_id=p_attacker_character_id
      and s.effect_key='uniform_blood_precision'
    order by s.created_at
    limit 1
    for update;
    if bonus_effect.id is not null then
      b:=b+coalesce((bonus_effect.data->>'attack_bonus')::int,1);
      delete from public.combat_effect_states where id=bonus_effect.id;
    end if;
  end if;

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

  if st='pending_defense' then update public.combat_participants set current_ps=current_ps where id=tp.id; end if;
  return action_id;
end;
$$;

-- ============================================================
-- DANO + REDUÇÕES / ESTASE
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

  -- Bônus temporário de dano no primeiro golpe que conectar (ex.: Tarukaja).
  -- Entra antes de Fortitude/metade para que a defesa reduza o golpe inteiro.
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

  if bonus_damage_effect.id is not null then
    bonus_damage_roll:=public.roll_pg_damage(
      coalesce((bonus_damage_effect.data->>'bonus_damage_dice_count')::int,0),
      coalesce((bonus_damage_effect.data->>'bonus_damage_die')::int,0),
      false
    );
    bonus_damage_total:=greatest(0,coalesce((bonus_damage_roll->>'total')::int,0));
    total:=total+bonus_damage_total;
    if bonus_damage_effect.uses_remaining is not null then
      update public.combat_effect_states
      set uses_remaining=greatest(0,uses_remaining-1)
      where id=bonus_damage_effect.id;
      if bonus_damage_effect.uses_remaining<=1 and coalesce((bonus_damage_effect.data->>'remove_when_empty')::boolean,true) then
        delete from public.combat_effect_states where id=bonus_damage_effect.id;
      end if;
    end if;
  end if;

  final_total:=case when p_half then floor(total/2.0)::int else total end;

  select exists(
    select 1 from public.combat_effect_states s
    where s.encounter_id=a.encounter_id
      and s.target_character_id=a.target_character_id
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
            and (
              a.source_type in ('basic','equipment','counterattack')
              or a.attack_attribute_key in ('strength','dexterity')
            )
          )
        )
      order by s.created_at
    loop
      red_roll:=public.roll_pg_damage(
        coalesce((effect_rec.data->>'damage_reduction_dice_count')::int,0),
        coalesce((effect_rec.data->>'damage_reduction_die')::int,0),
        false
      );
      red_amount:=coalesce((red_roll->>'total')::int,0)+coalesce((effect_rec.data->>'damage_reduction_flat')::int,0);
      total_reduction:=total_reduction+greatest(0,red_amount);
      if effect_rec.uses_remaining is not null then
        update public.combat_effect_states
        set uses_remaining=greatest(0,uses_remaining-1)
        where id=effect_rec.id;
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
    update public.combat_participants set black_flash_turns=2, black_flash_discount_used=false where id=ap.id;
  end if;

  update public.combat_actions set
    damage_rolls=d->'rolls',damage_flat=flat,damage_total=final_total,
    damage_reduction=case when p_half then 'half' else 'none' end,
    is_kokusen=actual_kokusen,status='resolved',
    summary=case
      when immune then 'O golpe conectou, mas o alvo estava suspenso no tempo e não sofreu alteração.'
      when total_reduction>0 and bonus_damage_total>0 then 'O golpe recebeu +'||bonus_damage_total||' de dano de um efeito ativo e o alvo reduziu '||total_reduction||' de dano.'
      when total_reduction>0 then 'O golpe conectou. Efeitos ativos reduziram '||total_reduction||' de dano.'
      when actual_kokusen and bonus_damage_total>0 then 'Kokusen! O golpe recebeu +'||bonus_damage_total||' de dano de um efeito ativo e o atacante entrou em Fluxo Negro.'
      when actual_kokusen then 'Kokusen! O golpe conectou e o atacante entrou em Fluxo Negro.'
      when p_half and bonus_damage_total>0 then 'O golpe recebeu +'||bonus_damage_total||' de dano de um efeito ativo; o alvo resistiu e reduziu o total pela metade.'
      when p_half then 'O alvo resistiu e reduziu o dano pela metade.'
      when bonus_damage_total>0 then 'O golpe conectou com +'||bonus_damage_total||' de dano de um efeito ativo.'
      else 'O golpe conectou.' end,
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

  if exists(
    select 1 from public.combat_effect_states s
    where s.encounter_id=a.encounter_id and s.target_character_id=a.target_character_id
      and coalesce((s.data->>'blocks_reactions')::boolean,false)
  ) and p_defense_type<>'accept' then
    raise exception 'O alvo está impedido de reagir por um efeito ativo.';
  end if;

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

-- ============================================================
-- HABILIDADE E EFEITO DE EQUIPAMENTO: MOTOR ESTRUTURADO
-- ============================================================

create or replace function public.resolve_config_mode(p_config jsonb,p_mode_key text,p_overload_key text)
returns jsonb
language plpgsql stable
as $$
declare
  cfg jsonb := coalesce(p_config,'{}'::jsonb);
  mode_rec jsonb;
  over_rec jsonb;
begin
  if p_mode_key is not null and p_mode_key<>'' then
    select value into mode_rec
    from jsonb_array_elements(coalesce(cfg->'modes','[]'::jsonb))
    where value->>'key'=p_mode_key
    limit 1;
    if mode_rec is null then raise exception 'Modo de habilidade inválido.'; end if;
    cfg := cfg || (mode_rec - 'key' - 'label');
  end if;
  if p_overload_key is not null and p_overload_key<>'' then
    select value into over_rec
    from jsonb_array_elements(coalesce(cfg->'overloads','[]'::jsonb))
    where value->>'key'=p_overload_key
    limit 1;
    if over_rec is null then raise exception 'Sobrecarga inválida.'; end if;
    cfg := cfg
      || coalesce(over_rec->'overrides','{}'::jsonb)
      || jsonb_build_object(
        'pa_cost',coalesce((cfg->>'pa_cost')::int,0)+coalesce((over_rec->>'extra_pa')::int,0),
        'ea_cost',coalesce((cfg->>'ea_cost')::int,0)+coalesce((over_rec->>'extra_ea')::int,0)
      );
  end if;
  return cfg;
end;
$$;

revoke execute on function public.resolve_config_mode(jsonb,text,text) from public,anon,authenticated;

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
  owner_char public.characters%rowtype;
  child_char public.characters%rowtype;
  actor_part public.combat_participants%rowtype;
  cfg jsonb;
  mode_label text;
  target_id uuid;
  is_reaction boolean;
  source_kind text;
  resource_cfg jsonb;
  resource_key text;
  resource_amount int;
  paid_ea int;
  action_id uuid;
  special text;
  eff jsonb;
  effect_data jsonb;
  v_effect_key text;
  effect_name text;
  effect_uses int;
  effect_turns int;
  self_damage jsonb;
  self_damage_total int := 0;
  heal_roll jsonb;
  heal_flat int := 0;
  heal_total int := 0;
  contest_cfg jsonb;
  atk_roll jsonb;
  def_roll jsonb;
  atk_nat int;
  def_nat int;
  atk_bonus int;
  def_bonus int;
  atk_total int;
  def_total int;
  contest_success boolean;
  profile text;
  blood_cost_roll jsonb;
  blood_cost int;
  duration_roll int;
  temp_item public.equipment%rowtype;
  attack_attr text;
  weapon_die int;
  weapon_count int;
  weapon_pa int;
  status_rec record;
  base_ea int;
  usage_scope text;
  mode_usage_key text;
begin
  select * into ab from public.abilities where id=p_ability_id;
  if ab.id is null or ab.status<>'approved' then raise exception 'Habilidade não encontrada ou não aprovada.'; end if;
  select * into owner_char from public.characters where id=ab.character_id;
  if owner_char.id is null then raise exception 'Ficha da habilidade não encontrada.'; end if;

  select * into actor_part
  from public.combat_participants
  where encounter_id=p_encounter_id and character_id=p_actor_character_id
  for update;
  if actor_part.id is null then raise exception 'O personagem não participa do combate.'; end if;

  if ab.character_id<>p_actor_character_id then
    select * into child_char from public.characters where id=ab.character_id;
    if child_char.parent_character_id is distinct from p_actor_character_id then
      raise exception 'Esta habilidade não pertence ao personagem nem a uma ficha filha dele.';
    end if;
    if actor_part.active_summon_character_id is distinct from ab.character_id then
      raise exception 'As habilidades desta invocação estão travadas até ela ser manifestada.';
    end if;
  end if;

  if not (public.is_master() or public.owns_character(p_actor_character_id)) then raise exception 'Sem permissão para usar esta ficha.'; end if;

  cfg := public.resolve_config_mode(ab.config,p_mode_key,p_overload_key);
  mode_label := coalesce(nullif(cfg->>'label',''),nullif(p_mode_key,''),ab.name);
  is_reaction := coalesce((cfg->>'is_reaction')::boolean,false) or coalesce(cfg->>'activation_timing','')='reaction';
  source_kind := case
    when ab.character_id<>p_actor_character_id and is_reaction then 'summon_ability_reaction'
    when ab.character_id<>p_actor_character_id then 'summon_ability'
    when is_reaction then 'ability_reaction'
    else 'ability' end;

  if coalesce(cfg->>'target_mode','')='self' or coalesce(cfg->>'targets','')='self' or coalesce(cfg->>'range','')='self' then
    target_id:=p_actor_character_id;
  else
    target_id:=p_target_character_id;
  end if;
  if target_id is null then raise exception 'Escolha um alvo.'; end if;
  perform public.assert_combat_participant(p_encounter_id,target_id);

  usage_scope:=coalesce(cfg->>'usage_scope','mode');
  mode_usage_key:=coalesce(p_mode_key,'');
  perform public.record_combat_usage(
    p_encounter_id,p_actor_character_id,'ability',ab.id,mode_usage_key,target_id,
    coalesce((cfg->>'once_per_combat')::boolean,false),
    coalesce((cfg->>'once_per_combat_per_target')::boolean,false),
    coalesce((cfg->>'once_per_round')::boolean,false),
    usage_scope
  );

  resource_cfg:=cfg->'resource_cost';
  if resource_cfg is not null and jsonb_typeof(resource_cfg)='object' then
    resource_key:=resource_cfg->>'key';
    resource_amount:=greatest(0,coalesce((resource_cfg->>'amount')::int,0));
    if resource_amount>0 then
      perform public.change_combat_resource(actor_part.id,resource_key,-resource_amount);
    end if;
  end if;

  base_ea:=greatest(0,coalesce((cfg->>'ea_cost')::int,0));
  -- Uniforme Okkotsu: economia no próximo uso de técnica de sangue.
  if coalesce(cfg->'tags','[]'::jsonb) ? 'blood_technique' then
    select s.* into status_rec
    from public.combat_effect_states s
    where s.encounter_id=p_encounter_id
      and s.target_character_id=p_actor_character_id
      and s.effect_key='uniform_blood_discount'
    order by s.created_at
    limit 1
    for update;
    if status_rec.id is not null then
      base_ea:=greatest(0,base_ea-coalesce((status_rec.data->>'ea_discount')::int,1));
      delete from public.combat_effect_states where id=status_rec.id;
    end if;
  end if;

  special:=coalesce(cfg->>'special_action','');

  if coalesce((cfg->>'requires_attack')::boolean,false) then
    action_id:=public.create_combat_attack(
      p_encounter_id,p_actor_character_id,target_id,
      case when p_mode_key is null or p_mode_key='' then ab.name else ab.name||' — '||coalesce(cfg->>'label',p_mode_key) end,
      source_kind,ab.id,
      coalesce(cfg->>'attack_attribute_key','cursed_control'),
      coalesce(cfg->>'attack_skill_key','technique_control'),
      greatest(0,coalesce((cfg->>'pa_cost')::int,1)),
      base_ea,
      coalesce((cfg->>'uses_cursed_energy')::boolean,base_ea>0),
      coalesce((cfg->>'forced_critical')::boolean,false),
      greatest(2,least(20,coalesce((cfg->>'critical_threshold')::int,20))),
      greatest(0,coalesce((cfg->>'damage_dice_count')::int,0)),
      greatest(0,coalesce((cfg->>'damage_die')::int,0)),
      nullif(cfg->>'damage_flat_attribute_key',''),
      nullif(cfg->>'condition_key',''),
      coalesce(p_options->>'roll_mode','normal'),
      greatest(1,coalesce((p_options->>'roll_count')::int,1))
    );
    return jsonb_build_object('kind','attack','action_id',action_id);
  end if;

  paid_ea:=public.spend_ability_cost(
    p_encounter_id,p_actor_character_id,
    greatest(0,coalesce((cfg->>'pa_cost')::int,0)),
    base_ea,
    is_reaction
  );

  if special='activate_summon' then
    if nullif(cfg->>'summon_character_id','') is null then raise exception 'Invocação sem ficha filha vinculada.'; end if;
    select * into child_char from public.characters where id=(cfg->>'summon_character_id')::uuid;
    if child_char.id is null or child_char.parent_character_id is distinct from p_actor_character_id then
      raise exception 'Ficha filha inválida para esta invocação.';
    end if;
    update public.combat_participants
    set active_summon_character_id=child_char.id
    where id=actor_part.id;
    return jsonb_build_object('kind','summon','summon_character_id',child_char.id,'name',child_char.first_name);
  end if;

  if special='create_weapon' then
    profile:=coalesce(nullif(p_options->>'weapon_profile',''),'standard');
    if profile not in ('light','standard','heavy','very_heavy') then raise exception 'Perfil de arma inválido.'; end if;
    attack_attr:=coalesce(nullif(p_options->>'weapon_attribute',''),'strength');
    if attack_attr not in ('strength','dexterity') then attack_attr:='strength'; end if;

    if profile='light' then blood_cost:=1; weapon_die:=6; weapon_count:=1; weapon_pa:=1;
    elsif profile='standard' then blood_cost_roll:=public.roll_pg_damage(1,4,false); blood_cost:=(blood_cost_roll->>'total')::int; weapon_die:=8; weapon_count:=1; weapon_pa:=1;
    elsif profile='heavy' then blood_cost_roll:=public.roll_pg_damage(1,6,false); blood_cost:=(blood_cost_roll->>'total')::int; weapon_die:=12; weapon_count:=1; weapon_pa:=1;
    else blood_cost_roll:=public.roll_pg_damage(1,8,false); blood_cost:=(blood_cost_roll->>'total')::int; weapon_die:=10; weapon_count:=2; weapon_pa:=2;
    end if;

    if coalesce(actor_part.current_ps,public.combat_max_ps(p_actor_character_id))<=blood_cost then
      raise exception 'PS insuficiente para moldar uma arma deste tamanho.';
    end if;
    update public.combat_participants
    set current_ps=current_ps-blood_cost
    where id=actor_part.id;

    duration_roll:=public.roll_pg_die(4)+2;

    insert into public.equipment(
      character_id,name,equipment_type,grade,description,mechanics,image_url,active,
      category,subtype,is_cursed,status,master_response,equipped,equip_slot,hands,weapon_profile,weapon_range,effects,vp_limit_override,
      attack_config,wear_slot,can_hold,temporary_encounter_id,temporary_turns_remaining,created_by_ability_id
    ) values (
      p_actor_character_id,
      'Armamento de Sangue — '||case profile when 'light' then 'Leve' when 'standard' then 'Padrão' when 'heavy' then 'Pesado' else 'Muito Pesado' end,
      'Arma','Sem Grau',
      'Arma temporária moldada diretamente do sangue de Jin durante o combate.',
      'Construção da técnica Manipulação de Sangue. Não consome Sintonia. Desaparece quando sua duração termina ou quando o combate é encerrado.',
      '',true,
      'weapon','Arma de sangue',false,'approved','',false,null,
      case when profile in ('heavy','very_heavy') then 2 else 1 end,
      profile,'melee','[]'::jsonb,false,
      jsonb_build_object(
        'enabled',true,'attack_attribute_key',attack_attr,'attack_skill_key','fight',
        'damage_flat_attribute_key',attack_attr,'pa_cost',weapon_pa,'ea_cost',0,
        'damage_dice_count',weapon_count,'damage_die',weapon_die,'uses_cursed_energy',false,
        'forced_critical',false,'critical_threshold',20,'allow_cursed_reinforcement',true,'range','melee'
      ),
      'none',false,p_encounter_id,duration_roll,ab.id
    ) returning * into temp_item;

    -- Tenta equipar automaticamente. Se a mão estiver ocupada, a arma continua no inventário.
    begin
      perform public.equip_equipment(temp_item.id,'main_hand');
    exception when others then
      null;
    end;

    return jsonb_build_object(
      'kind','weapon_created','equipment_id',temp_item.id,'profile',profile,
      'ps_paid',blood_cost,'turns',duration_roll
    );
  end if;

  if special='resource_gain' then
    resource_key:=cfg->>'resource_key';
    resource_amount:=greatest(1,coalesce((cfg->>'resource_gain')::int,1));
    if coalesce((cfg->>'self_damage_dice_count')::int,0)>0 and coalesce((cfg->>'self_damage_die')::int,0)>0 then
      self_damage:=public.roll_pg_damage((cfg->>'self_damage_dice_count')::int,(cfg->>'self_damage_die')::int,false);
      self_damage_total:=coalesce((self_damage->>'total')::int,0);
      if coalesce(actor_part.current_ps,public.combat_max_ps(p_actor_character_id))<=self_damage_total then
        raise exception 'PS insuficiente para gerar este recurso.';
      end if;
      update public.combat_participants set current_ps=current_ps-self_damage_total where id=actor_part.id;
    end if;
    perform public.change_combat_resource(actor_part.id,resource_key,resource_amount);
    return jsonb_build_object('kind','resource_gain','resource_key',resource_key,'gain',resource_amount,'self_damage',self_damage_total);
  end if;

  -- Dano próprio estruturado (transformações etc.).
  if coalesce((cfg->>'self_damage_dice_count')::int,0)>0 and coalesce((cfg->>'self_damage_die')::int,0)>0 then
    self_damage:=public.roll_pg_damage((cfg->>'self_damage_dice_count')::int,(cfg->>'self_damage_die')::int,false);
    self_damage_total:=coalesce((self_damage->>'total')::int,0);
    if coalesce(actor_part.current_ps,public.combat_max_ps(p_actor_character_id))<=self_damage_total then
      raise exception 'PS insuficiente para sustentar esta habilidade.';
    end if;
    update public.combat_participants set current_ps=current_ps-self_damage_total where id=actor_part.id;
  end if;

  -- Teste resistido estruturado.
  contest_cfg:=cfg->'contest';
  if contest_cfg is not null and jsonb_typeof(contest_cfg)='object' then
    atk_bonus:=public.combat_test_bonus(
      p_actor_character_id,
      coalesce(contest_cfg->>'attacker_attribute','cursed_control'),
      coalesce(contest_cfg->>'attacker_skill','technique_control')
    );
    def_bonus:=public.combat_test_bonus(
      target_id,
      coalesce(contest_cfg->>'defender_attribute','resistance'),
      coalesce(contest_cfg->>'defender_skill','steadiness')
    );
    atk_roll:=public.roll_pg_d20('normal',1);
    def_roll:=public.roll_pg_d20('normal',1);
    atk_nat:=(atk_roll->>'natural')::int;
    def_nat:=(def_roll->>'natural')::int;
    atk_total:=atk_nat+atk_bonus;
    def_total:=def_nat+def_bonus;
    contest_success:=atk_nat<>1 and (def_nat=1 or atk_total>def_total);

    insert into public.roll_logs(encounter_id,character_id,label,roll_type,expression,rolls,natural_roll,bonus,total,is_critical,kokusen_eligible,visibility)
    values(p_encounter_id,p_actor_character_id,ab.name||' — ataque','ability','1d20',atk_roll->'rolls',atk_nat,atk_bonus,atk_total,atk_nat=20,false,case when public.is_master() then 'master' else 'public' end);
    insert into public.roll_logs(encounter_id,character_id,label,roll_type,expression,rolls,natural_roll,bonus,total,is_critical,kokusen_eligible,visibility)
    values(p_encounter_id,target_id,ab.name||' — resistência','defense','1d20',def_roll->'rolls',def_nat,def_bonus,def_total,def_nat=20,false,case when public.is_master() then 'master' else 'public' end);

    if not contest_success then
      return jsonb_build_object('kind','contest','success',false,'attack_total',atk_total,'defense_total',def_total,'self_damage',self_damage_total);
    end if;
  end if;

  -- Cura estruturada.
  if coalesce((cfg->>'healing_dice_count')::int,0)>0 and coalesce((cfg->>'healing_die')::int,0)>0 then
    heal_roll:=public.roll_pg_damage((cfg->>'healing_dice_count')::int,(cfg->>'healing_die')::int,false);
    heal_flat:=case when nullif(cfg->>'healing_flat_attribute_key','') is null then 0 else public.combat_attribute_modifier(p_actor_character_id,cfg->>'healing_flat_attribute_key') end;
    heal_total:=greatest(0,coalesce((heal_roll->>'total')::int,0)+heal_flat);
    update public.combat_participants
    set current_ps=least(public.combat_max_ps(target_id),coalesce(current_ps,public.combat_max_ps(target_id))+heal_total),
        defeated=false
    where encounter_id=p_encounter_id and character_id=target_id;
  end if;

  -- Efeito temporário estruturado.
  eff:=cfg->'combat_effect';
  if eff is not null and jsonb_typeof(eff)='object' then
    v_effect_key:=coalesce(nullif(eff->>'key',''),ab.name);
    effect_name:=coalesce(nullif(eff->>'name',''),ab.name);
    effect_data:=coalesce(eff->'data','{}'::jsonb);

    if nullif(eff->>'damage_reduction_flat_attribute_key','') is not null then
      effect_data:=effect_data||jsonb_build_object(
        'damage_reduction_flat',public.combat_attribute_modifier(p_actor_character_id,eff->>'damage_reduction_flat_attribute_key')
      );
    end if;

    effect_uses:=coalesce((eff->>'uses')::int,0);
    if coalesce((cfg->>'effect_charges')::int,0)>0 then effect_uses:=(cfg->>'effect_charges')::int; end if;
    if effect_uses<=0 then effect_uses:=null; end if;

    effect_turns:=null;
    if coalesce((eff->>'remaining_turns')::int,0)>0 then effect_turns:=(eff->>'remaining_turns')::int; end if;
    if coalesce((eff->>'duration_from_self_damage')::boolean,false) then effect_turns:=greatest(1,self_damage_total); end if;

    -- Efeito único por chave/alvo: reaplicar substitui/refresca.
    delete from public.combat_effect_states
    where encounter_id=p_encounter_id and target_character_id=target_id and combat_effect_states.effect_key=v_effect_key;

    insert into public.combat_effect_states(
      encounter_id,source_character_id,target_character_id,source_type,source_id,effect_key,name,data,remaining_turns,uses_remaining
    ) values (
      p_encounter_id,p_actor_character_id,target_id,'ability',ab.id,v_effect_key,effect_name,effect_data,effect_turns,effect_uses
    );
  end if;

  return jsonb_build_object(
    'kind',case when contest_cfg is not null then 'contest' when heal_total>0 then 'healing' else 'effect' end,
    'success',coalesce(contest_success,true),
    'healing',heal_total,
    'self_damage',self_damage_total,
    'ea_paid',paid_ea,
    'attack_total',atk_total,
    'defense_total',def_total
  );
end;
$$;

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
  effect_uuid uuid;
  cfg jsonb;
  target_id uuid;
  is_reaction boolean;
  paid int:=0;
  heal_roll jsonb;
  heal_flat int:=0;
  heal_total int:=0;
  eff jsonb;
  v_effect_key text;
  effect_name text;
  effect_data jsonb;
  ccur int;
  ccost int;
  action_id uuid;
begin
  select * into item from public.equipment where id=p_item_id;
  if item.id is null or item.character_id<>p_actor_character_id then raise exception 'Equipamento não encontrado.'; end if;
  if item.status<>'approved' or (not item.equipped and item.category<>'consumable') then
    raise exception 'O equipamento precisa estar aprovado e equipado. Consumíveis aprovados podem ser usados diretamente do inventário.';
  end if;
  if not (public.is_master() or public.owns_character(p_actor_character_id)) then raise exception 'Sem permissão.'; end if;

  select value into effect
  from jsonb_array_elements(coalesce(item.effects,'[]'::jsonb))
  where value->>'id'=p_effect_id
  limit 1;
  if effect is null then raise exception 'Efeito do equipamento não encontrado.'; end if;
  begin
    effect_uuid := nullif(effect->>'id','')::uuid;
  exception when invalid_text_representation then
    raise exception 'O efeito do equipamento precisa possuir um ID UUID válido.';
  end;

  cfg:=public.resolve_config_mode(effect->'config',p_mode_key,null);
  is_reaction:=coalesce(effect->>'type','')='reaction'
               or coalesce((cfg->>'is_reaction')::boolean,false)
               or coalesce(cfg->>'activation_timing','')='reaction';

  if coalesce(cfg->>'target_mode','')='self'
     or coalesce(cfg->>'targets','')='self'
     or coalesce(cfg->>'range','')='self' then
    target_id:=p_actor_character_id;
  else
    target_id:=p_target_character_id;
  end if;
  if target_id is null then raise exception 'Escolha um alvo.'; end if;
  perform public.assert_combat_participant(p_encounter_id,target_id);

  perform public.record_combat_usage(
    p_encounter_id,p_actor_character_id,'equipment_effect',effect_uuid,coalesce(p_mode_key,''),target_id,
    coalesce((cfg->>'once_per_combat')::boolean,false),
    coalesce((cfg->>'once_per_combat_per_target')::boolean,false),
    coalesce((cfg->>'once_per_round')::boolean,false),
    coalesce(cfg->>'usage_scope','mode')
  );

  ccost:=greatest(0,coalesce((cfg->>'charges_cost')::int,0));
  if ccost>0 and item.charges_max is not null then
    ccur:=coalesce(item.charges_current,0);
    if ccur<ccost then raise exception 'Cargas insuficientes.'; end if;
  end if;

  -- Efeitos de equipamento que atacam passam pelo mesmo motor de ataque.
  if coalesce((cfg->>'requires_attack')::boolean,false) then
    action_id:=public.create_combat_attack(
      p_encounter_id,p_actor_character_id,target_id,
      item.name||': '||coalesce(effect->>'name','Efeito'),
      case when is_reaction then 'equipment_reaction' else 'equipment' end,
      item.id,
      coalesce(cfg->>'attack_attribute_key','strength'),
      coalesce(cfg->>'attack_skill_key','fight'),
      greatest(0,coalesce((cfg->>'pa_cost')::int,1)),
      greatest(0,coalesce((cfg->>'ea_cost')::int,0)),
      coalesce((cfg->>'uses_cursed_energy')::boolean,false),
      false,20,
      greatest(0,coalesce((cfg->>'damage_dice_count')::int,0)),
      greatest(0,coalesce((cfg->>'damage_die')::int,0)),
      nullif(cfg->>'damage_flat_attribute_key',''),
      nullif(cfg->>'condition_key',''),
      'normal',1
    );
    if ccost>0 and item.charges_max is not null then
      update public.equipment set charges_current=greatest(0,coalesce(charges_current,0)-ccost) where id=item.id;
    end if;
    return jsonb_build_object('kind','attack','action_id',action_id);
  end if;

  paid:=public.spend_ability_cost(
    p_encounter_id,p_actor_character_id,
    greatest(0,coalesce((cfg->>'pa_cost')::int,0)),
    greatest(0,coalesce((cfg->>'ea_cost')::int,0)),
    is_reaction
  );

  if ccost>0 and item.charges_max is not null then
    update public.equipment set charges_current=greatest(0,coalesce(charges_current,0)-ccost) where id=item.id;
  end if;

  if coalesce((cfg->>'healing_dice_count')::int,0)>0 and coalesce((cfg->>'healing_die')::int,0)>0 then
    heal_roll:=public.roll_pg_damage((cfg->>'healing_dice_count')::int,(cfg->>'healing_die')::int,false);
    heal_flat:=case when nullif(cfg->>'healing_flat_attribute_key','') is null then 0 else public.combat_attribute_modifier(p_actor_character_id,cfg->>'healing_flat_attribute_key') end;
    heal_total:=greatest(0,coalesce((heal_roll->>'total')::int,0)+heal_flat);
    update public.combat_participants
    set current_ps=least(public.combat_max_ps(target_id),coalesce(current_ps,public.combat_max_ps(target_id))+heal_total),defeated=false
    where encounter_id=p_encounter_id and character_id=target_id;
  end if;

  eff:=cfg->'combat_effect';
  if eff is not null and jsonb_typeof(eff)='object' then
    v_effect_key:=coalesce(nullif(eff->>'key',''),effect->>'name');
    effect_name:=coalesce(nullif(eff->>'name',''),effect->>'name');
    effect_data:=coalesce(eff->'data','{}'::jsonb);
    delete from public.combat_effect_states s
      where s.encounter_id=p_encounter_id and s.target_character_id=target_id and s.effect_key=v_effect_key;
    insert into public.combat_effect_states(
      encounter_id,source_character_id,target_character_id,source_type,source_id,effect_key,name,data,remaining_turns,uses_remaining
    ) values(
      p_encounter_id,p_actor_character_id,target_id,'equipment',item.id,v_effect_key,effect_name,effect_data,
      nullif(coalesce((eff->>'remaining_turns')::int,0),0),nullif(coalesce((eff->>'uses')::int,0),0)
    );
  end if;

  return jsonb_build_object('kind',case when heal_total>0 then 'healing' else 'effect' end,'healing',heal_total,'ea_paid',paid);
end;
$$;

create or replace function public.dismiss_combat_summon(p_encounter_id uuid,p_actor_character_id uuid)
returns void
language plpgsql security definer set search_path=public
as $$
begin
  if not (public.is_master() or public.owns_character(p_actor_character_id)) then raise exception 'Sem permissão.'; end if;
  perform public.assert_active_combat_turn(p_encounter_id,p_actor_character_id);
  update public.combat_participants
  set active_summon_character_id=null
  where encounter_id=p_encounter_id and character_id=p_actor_character_id;
end;
$$;

create or replace function public.use_combat_resource_action(
  p_encounter_id uuid,
  p_actor_character_id uuid,
  p_resource_key text
)
returns jsonb
language plpgsql security definer set search_path=public
as $$
declare
  c public.characters%rowtype;
  cp public.combat_participants%rowtype;
  def jsonb;
  recharge jsonb;
  paid int;
  dmg jsonb;
  dmg_total int:=0;
  gain int;
  cur int;
  mx int;
begin
  if not (public.is_master() or public.owns_character(p_actor_character_id)) then raise exception 'Sem permissão.'; end if;
  perform public.assert_active_combat_turn(p_encounter_id,p_actor_character_id);
  select * into c from public.characters where id=p_actor_character_id;
  select value into def from jsonb_array_elements(coalesce(c.special_resources,'[]'::jsonb)) where value->>'key'=p_resource_key limit 1;
  if def is null then raise exception 'Recurso especial não encontrado.'; end if;
  recharge:=def->'recharge';
  if recharge is null then raise exception 'Este recurso não possui ação de recarga.'; end if;
  select * into cp from public.combat_participants where encounter_id=p_encounter_id and character_id=p_actor_character_id for update;
  cur:=public.combat_resource_current(cp.id,p_resource_key); mx:=public.combat_resource_max(cp.id,p_resource_key);
  if cur>=mx then raise exception 'O recurso já está no máximo.'; end if;

  paid:=public.spend_ability_cost(p_encounter_id,p_actor_character_id,coalesce((recharge->>'pa_cost')::int,1),coalesce((recharge->>'ea_cost')::int,0),false);
  if coalesce((recharge->>'self_damage_dice_count')::int,0)>0 and coalesce((recharge->>'self_damage_die')::int,0)>0 then
    dmg:=public.roll_pg_damage((recharge->>'self_damage_dice_count')::int,(recharge->>'self_damage_die')::int,false);
    dmg_total:=coalesce((dmg->>'total')::int,0);
    if coalesce(cp.current_ps,public.combat_max_ps(p_actor_character_id))<=dmg_total then raise exception 'PS insuficiente para recarregar este recurso.'; end if;
    update public.combat_participants set current_ps=current_ps-dmg_total where id=cp.id;
  end if;
  gain:=greatest(1,coalesce((recharge->>'gain')::int,1));
  perform public.change_combat_resource(cp.id,p_resource_key,gain);
  return jsonb_build_object('resource_key',p_resource_key,'gain',gain,'self_damage',dmg_total,'ea_paid',paid);
end;
$$;

-- ============================================================
-- TURNOS: reset de uso, PA penalizado, efeitos temporários, armas de sangue
-- ============================================================

create or replace function public.start_combat_turn(p_participant_id uuid)
returns public.combat_participants
language plpgsql security definer set search_path=public
as $$
declare
  p public.combat_participants%rowtype;
  e public.combat_encounters%rowtype;
  penalty int:=0;
begin
  if not public.is_master() then raise exception 'Somente o Mestre pode iniciar turnos.'; end if;
  select * into p from public.combat_participants where id=p_participant_id for update;
  if p.id is null then raise exception 'Participante não encontrado.'; end if;
  if p.defeated then raise exception 'Um participante derrotado não pode iniciar turno.'; end if;
  select * into e from public.combat_encounters where id=p.encounter_id for update;
  if e.id is null or e.status<>'active' then raise exception 'Combate não está ativo.'; end if;
  if e.active_participant_id is not null then raise exception 'Já existe um turno ativo. Encerre o turno atual antes de iniciar outro.'; end if;
  if exists(select 1 from public.combat_actions a where a.encounter_id=e.id and a.status='pending_defense') then raise exception 'Resolva a reação pendente antes de iniciar outro turno.'; end if;

  select coalesce(sum(coalesce((s.data->>'pa_penalty_next_turn')::int,0)),0)
  into penalty
  from public.combat_effect_states s
  where s.encounter_id=e.id and s.target_character_id=p.character_id;

  -- Efeitos que duram "até o próprio turno" terminam antes da entidade agir.
  delete from public.combat_effect_states s
  where s.encounter_id=e.id and s.target_character_id=p.character_id
    and coalesce((s.data->>'remove_on_target_turn_start')::boolean,false);

  -- Escudos de reação da fonte expiram quando o próximo turno da fonte começa.
  delete from public.combat_effect_states s
  where s.encounter_id=e.id and s.source_character_id=p.character_id
    and coalesce((s.data->>'expires_on_source_turn_start')::boolean,false);

  update public.combat_effect_states
  set uses_remaining=coalesce((data->>'reset_uses')::int,uses_remaining)
  where encounter_id=e.id and target_character_id=p.character_id and data ? 'reset_uses';

  update public.combat_participants
  set current_pa=greatest(0,public.combat_max_pa(character_id)-penalty),
      counterattack_count=0,
      black_flash_discount_used=false,
      turn_epoch=turn_epoch+1
  where id=p.id
  returning * into p;

  update public.combat_encounters
  set active_participant_id=p.id,turn_started_at=now(),current_turn=current_turn+1
  where id=e.id;

  return p;
end;
$$;

create or replace function public.end_combat_turn(p_participant_id uuid)
returns public.combat_participants
language plpgsql security definer set search_path=public
as $$
declare
  p public.combat_participants%rowtype;
  e public.combat_encounters%rowtype;
begin
  select * into p from public.combat_participants where id=p_participant_id for update;
  if p.id is null then raise exception 'Participante não encontrado.'; end if;
  if not (public.is_master() or public.owns_character(p.character_id)) then raise exception 'Sem permissão para encerrar este turno.'; end if;
  select * into e from public.combat_encounters where id=p.encounter_id for update;
  if e.id is null or e.status<>'active' then raise exception 'Combate não está ativo.'; end if;
  if e.active_participant_id is distinct from p.id then raise exception 'Este personagem não está com o turno ativo.'; end if;
  if exists(select 1 from public.combat_actions a where a.encounter_id=e.id and a.status='pending_defense') then raise exception 'Resolva a reação pendente antes de encerrar o turno.'; end if;

  update public.combat_participants set black_flash_turns=greatest(0,black_flash_turns-1) where id=p.id returning * into p;

  -- Duração de transformações e outros efeitos medidos pelos turnos do alvo.
  delete from public.combat_effect_states
  where encounter_id=e.id and target_character_id=p.character_id
    and remaining_turns is not null and remaining_turns<=1
    and coalesce(data->>'decrement_on','target_end')='target_end';
  update public.combat_effect_states
  set remaining_turns=remaining_turns-1
  where encounter_id=e.id and target_character_id=p.character_id
    and remaining_turns is not null and remaining_turns>1
    and coalesce(data->>'decrement_on','target_end')='target_end';

  -- Equipamentos temporários do Armamento de Sangue contam turnos do próprio criador.
  delete from public.equipment
  where character_id=p.character_id and temporary_encounter_id=e.id and temporary_turns_remaining is not null and temporary_turns_remaining<=1;
  update public.equipment
  set temporary_turns_remaining=temporary_turns_remaining-1
  where character_id=p.character_id and temporary_encounter_id=e.id and temporary_turns_remaining is not null and temporary_turns_remaining>1;

  update public.combat_encounters set active_participant_id=null,turn_started_at=null where id=e.id;
  return p;
end;
$$;

-- ============================================================
-- DESFAZER: inclui efeitos, usos e equipamentos temporários.
-- ============================================================

create or replace function public.capture_combat_state(p_encounter_id uuid)
returns jsonb
language plpgsql security definer set search_path=public
as $$
declare
  encounter_state jsonb;
  participant_state jsonb;
  action_state jsonb;
  roll_state jsonb;
  equipment_charge_state jsonb;
  temp_equipment_state jsonb;
  effect_state jsonb;
  usage_state jsonb;
begin
  select to_jsonb(e) into encounter_state from public.combat_encounters e where e.id=p_encounter_id;
  if encounter_state is null then raise exception 'Combate não encontrado.'; end if;
  select coalesce(jsonb_agg(to_jsonb(cp) order by cp.created_at,cp.id),'[]'::jsonb) into participant_state from public.combat_participants cp where cp.encounter_id=p_encounter_id;
  select coalesce(jsonb_agg(to_jsonb(a) order by a.created_at,a.id),'[]'::jsonb) into action_state from public.combat_actions a where a.encounter_id=p_encounter_id;
  select coalesce(jsonb_agg(to_jsonb(r) order by r.created_at,r.id),'[]'::jsonb) into roll_state from public.roll_logs r where r.encounter_id=p_encounter_id;
  select coalesce(jsonb_agg(jsonb_build_object('id',eq.id,'charges_current',eq.charges_current) order by eq.id),'[]'::jsonb)
    into equipment_charge_state
  from public.equipment eq where eq.character_id in (select cp.character_id from public.combat_participants cp where cp.encounter_id=p_encounter_id);
  select coalesce(jsonb_agg(to_jsonb(eq) order by eq.created_at,eq.id),'[]'::jsonb) into temp_equipment_state
  from public.equipment eq where eq.temporary_encounter_id=p_encounter_id;
  select coalesce(jsonb_agg(to_jsonb(s) order by s.created_at,s.id),'[]'::jsonb) into effect_state
  from public.combat_effect_states s where s.encounter_id=p_encounter_id;
  select coalesce(jsonb_agg(to_jsonb(u) order by u.created_at,u.id),'[]'::jsonb) into usage_state
  from public.combat_usage u where u.encounter_id=p_encounter_id;
  return jsonb_build_object(
    'encounter',encounter_state,'participants',participant_state,'actions',action_state,'rolls',roll_state,
    'equipment_charges',equipment_charge_state,'temporary_equipment',temp_equipment_state,
    'effects',effect_state,'usage',usage_state
  );
end;
$$;

revoke execute on function public.capture_combat_state(uuid) from public,anon,authenticated;

create or replace function public.undo_last_combat_action(p_encounter_id uuid)
returns text
language plpgsql security definer set search_path=public
as $$
declare
  s public.combat_undo_snapshots%rowtype;
  encounter_json jsonb;
  restored_status text;
  restored_campaign uuid;
  eq record;
  restored_active_participant uuid;
  restored_turn_started_at timestamptz;
begin
  if not public.is_master() then raise exception 'Somente o Mestre pode desfazer ações de combate.'; end if;
  select * into s from public.combat_undo_snapshots
  where encounter_id=p_encounter_id and status='committed'
  order by committed_at desc nulls last,created_at desc limit 1 for update;
  if s.id is null then raise exception 'Não há ação de combate para desfazer.'; end if;

  encounter_json:=s.state->'encounter';
  restored_status:=coalesce(encounter_json->>'status','active');
  restored_campaign:=(encounter_json->>'campaign_id')::uuid;
  restored_active_participant:=nullif(encounter_json->>'active_participant_id','')::uuid;
  restored_turn_started_at:=nullif(encounter_json->>'turn_started_at','')::timestamptz;
  if restored_status='active' and exists(select 1 from public.combat_encounters e where e.id<>p_encounter_id and e.campaign_id=restored_campaign and e.status='active') then
    raise exception 'Não é possível reabrir este combate enquanto outro combate estiver ativo.';
  end if;

  update public.combat_encounters
  set name=coalesce(encounter_json->>'name',name),status=restored_status,
      round=greatest(1,coalesce((encounter_json->>'round')::int,1)),current_turn=coalesce((encounter_json->>'current_turn')::int,0),
      active_participant_id=null,turn_started_at=null,
      ended_at=case when encounter_json->>'ended_at' is null then null else (encounter_json->>'ended_at')::timestamptz end
  where id=p_encounter_id;

  delete from public.combat_participants where encounter_id=p_encounter_id;
  insert into public.combat_participants select * from jsonb_populate_recordset(null::public.combat_participants,coalesce(s.state->'participants','[]'::jsonb));
  update public.combat_encounters set active_participant_id=restored_active_participant,turn_started_at=restored_turn_started_at where id=p_encounter_id;

  delete from public.combat_actions where encounter_id=p_encounter_id;
  insert into public.combat_actions select * from jsonb_populate_recordset(null::public.combat_actions,coalesce(s.state->'actions','[]'::jsonb));
  delete from public.roll_logs where encounter_id=p_encounter_id;
  insert into public.roll_logs select * from jsonb_populate_recordset(null::public.roll_logs,coalesce(s.state->'rolls','[]'::jsonb));

  delete from public.combat_effect_states where encounter_id=p_encounter_id;
  insert into public.combat_effect_states select * from jsonb_populate_recordset(null::public.combat_effect_states,coalesce(s.state->'effects','[]'::jsonb));
  delete from public.combat_usage where encounter_id=p_encounter_id;
  insert into public.combat_usage select * from jsonb_populate_recordset(null::public.combat_usage,coalesce(s.state->'usage','[]'::jsonb));

  -- Equipamentos temporários precisam ser restaurados por inteiro, pois podem nascer/desaparecer durante um turno.
  delete from public.equipment where temporary_encounter_id=p_encounter_id;
  perform set_config('app.equipment_slot_rpc','1',true);
  insert into public.equipment select * from jsonb_populate_recordset(null::public.equipment,coalesce(s.state->'temporary_equipment','[]'::jsonb));

  for eq in select * from jsonb_to_recordset(coalesce(s.state->'equipment_charges','[]'::jsonb)) as x(id uuid,charges_current int)
  loop
    update public.equipment set charges_current=eq.charges_current where id=eq.id;
  end loop;

  delete from public.combat_undo_snapshots where id=s.id;
  return s.label;
end;
$$;

-- Ao encerrar combate, construções temporárias desaparecem.
create or replace function public.cleanup_temporary_combat_equipment()
returns trigger
language plpgsql security definer set search_path=public
as $$
begin
  if old.status='active' and new.status='ended' then
    delete from public.equipment where temporary_encounter_id=new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists cleanup_temporary_combat_equipment_trigger on public.combat_encounters;
create trigger cleanup_temporary_combat_equipment_trigger
after update of status on public.combat_encounters
for each row execute function public.cleanup_temporary_combat_equipment();

grant execute on function public.use_ability_in_combat(uuid,uuid,uuid,uuid,text,text,jsonb) to authenticated;
grant execute on function public.use_equipment_effect_in_combat(uuid,uuid,uuid,text,uuid,text) to authenticated;
grant execute on function public.dismiss_combat_summon(uuid,uuid) to authenticated;
grant execute on function public.use_combat_resource_action(uuid,uuid,text) to authenticated;
grant execute on function public.create_combat_attack(uuid,uuid,uuid,text,text,uuid,text,text,int,int,boolean,boolean,int,int,int,text,text,text,int) to authenticated;
grant execute on function public.resolve_combat_defense(uuid,text,text,int) to authenticated;
grant execute on function public.start_combat_turn(uuid) to authenticated;
grant execute on function public.end_combat_turn(uuid) to authenticated;
grant execute on function public.undo_last_combat_action(uuid) to authenticated;
