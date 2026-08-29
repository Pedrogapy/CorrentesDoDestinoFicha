-- Correntes do Destino — Staff V2 / Mandato Real
-- Requer o motor v0.8.3 (dados físicos) já aplicado.
--
-- Acrescenta quatro comportamentos genéricos sem acoplar o motor a nomes de NPC:
-- 1) spatial_infinity: ataques que precisam atravessar o espaço não alcançam o alvo;
-- 2) blocks_cursed_abilities: bloqueia Técnica/Manifestação/Transformação/Domínio;
-- 3) blocks_movement: impede reposicionamento no tabuleiro enquanto o efeito durar;
-- 4) royal_refusal: cancela o próximo ataque já pendente contra o alvo.
--
-- Os campos são guardados em combat_effect_states.data e podem ser reutilizados no futuro.

do $$
begin
  if to_regprocedure('public.create_combat_attack(uuid,uuid,uuid,text,text,uuid,text,text,integer,integer,boolean,boolean,integer,integer,integer,text,text,text,integer)') is null then
    raise exception 'create_combat_attack atual não encontrado. Confirme que o motor v0.8.x está aplicado.';
  end if;
  if to_regprocedure('public.use_ability_in_combat(uuid,uuid,uuid,uuid,text,text,jsonb)') is null then
    raise exception 'use_ability_in_combat atual não encontrado.';
  end if;
  if to_regprocedure('public.resolve_combat_hit(uuid,boolean)') is null then
    raise exception 'resolve_combat_hit atual não encontrado.';
  end if;
  if to_regprocedure('public.move_combat_token(uuid,uuid,integer,integer)') is null then
    raise exception 'move_combat_token atual não encontrado. Confirme que o Tabuleiro Tático está aplicado.';
  end if;
end $$;

-- ============================================================
-- 1. MUGEN / DEFESA ESPACIAL
-- ============================================================

do $$
begin
  if to_regprocedure('public.create_combat_attack_staff_v2_core(uuid,uuid,uuid,text,text,uuid,text,text,integer,integer,boolean,boolean,integer,integer,integer,text,text,text,integer)') is null then
    alter function public.create_combat_attack(
      uuid,uuid,uuid,text,text,uuid,text,text,integer,integer,boolean,boolean,integer,integer,integer,text,text,text,integer
    ) rename to create_combat_attack_staff_v2_core;
  end if;
end $$;

revoke execute on function public.create_combat_attack_staff_v2_core(
  uuid,uuid,uuid,text,text,uuid,text,text,integer,integer,boolean,boolean,integer,integer,integer,text,text,text,integer
) from public,anon,authenticated;

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
language plpgsql
security definer
set search_path=public
as $$
declare
  guarded boolean := false;
  bypass_guard boolean := false;
begin
  if p_target_character_id is not null
     and p_attacker_character_id is distinct from p_target_character_id then

    select exists(
      select 1
      from public.combat_effect_states s
      where s.encounter_id=p_encounter_id
        and s.target_character_id=p_target_character_id
        and coalesce((s.data->>'spatial_infinity')::boolean,false)
        and (s.remaining_turns is null or s.remaining_turns>0)
        and (s.uses_remaining is null or s.uses_remaining>0)
    ) into guarded;

    if guarded and p_source_id is not null
       and p_source_type in ('ability','ability_reaction','summon_ability','summon_ability_reaction') then
      bypass_guard := coalesce((
        select coalesce((a.config->>'bypass_spatial_infinity')::boolean,false)
        from public.abilities a
        where a.id=p_source_id
      ),false);
    end if;

    if guarded and not bypass_guard then
      raise exception 'Mugen — Infinito: o ataque não consegue atravessar a distância até o alvo.';
    end if;
  end if;

  return public.create_combat_attack_staff_v2_core(
    p_encounter_id,p_attacker_character_id,p_target_character_id,p_label,
    p_source_type,p_source_id,p_attack_attribute_key,p_attack_skill_key,
    p_pa_cost,p_ea_cost,p_uses_cursed_energy,p_forced_critical,p_critical_threshold,
    p_damage_dice_count,p_damage_die,p_damage_flat_attribute_key,p_condition_key,
    p_roll_mode,p_roll_count
  );
end;
$$;

revoke execute on function public.create_combat_attack(
  uuid,uuid,uuid,text,text,uuid,text,text,integer,integer,boolean,boolean,integer,integer,integer,text,text,text,integer
) from public,anon;
grant execute on function public.create_combat_attack(
  uuid,uuid,uuid,text,text,uuid,text,text,integer,integer,boolean,boolean,integer,integer,integer,text,text,text,integer
) to authenticated;

-- ============================================================
-- 2. SILÊNCIO DE TÉCNICA / BLOQUEIO DE CAPACIDADES AMALDIÇOADAS
-- ============================================================

do $$
begin
  if to_regprocedure('public.use_ability_in_combat_staff_v2_core(uuid,uuid,uuid,uuid,text,text,jsonb)') is null then
    alter function public.use_ability_in_combat(uuid,uuid,uuid,uuid,text,text,jsonb)
      rename to use_ability_in_combat_staff_v2_core;
  end if;
end $$;

revoke execute on function public.use_ability_in_combat_staff_v2_core(
  uuid,uuid,uuid,uuid,text,text,jsonb
) from public,anon,authenticated;

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
language plpgsql
security definer
set search_path=public
as $$
declare
  ab public.abilities%rowtype;
  cursed_locked boolean := false;
begin
  select * into ab from public.abilities where id=p_ability_id;

  select exists(
    select 1
    from public.combat_effect_states s
    where s.encounter_id=p_encounter_id
      and s.target_character_id=p_actor_character_id
      and coalesce((s.data->>'blocks_cursed_abilities')::boolean,false)
      and (s.remaining_turns is null or s.remaining_turns>0)
      and (s.uses_remaining is null or s.uses_remaining>0)
  ) into cursed_locked;

  if cursed_locked
     and ab.id is not null
     and ab.category in ('technique','manifestation','transformation','domain')
     and not coalesce((ab.config->>'ignores_cursed_silence')::boolean,false) then
    raise exception 'Mandato: Cale-se — esta capacidade amaldiçoada não pode ser manifestada enquanto o silêncio estiver ativo.';
  end if;

  return public.use_ability_in_combat_staff_v2_core(
    p_encounter_id,p_actor_character_id,p_ability_id,p_target_character_id,
    p_mode_key,p_overload_key,p_options
  );
end;
$$;

revoke execute on function public.use_ability_in_combat(
  uuid,uuid,uuid,uuid,text,text,jsonb
) from public,anon;
grant execute on function public.use_ability_in_combat(
  uuid,uuid,uuid,uuid,text,text,jsonb
) to authenticated;

-- ============================================================
-- 3. BLOQUEIO REAL DE MOVIMENTO NO TABULEIRO
-- ============================================================

do $$
begin
  if to_regprocedure('public.move_combat_token_staff_v2_core(uuid,uuid,integer,integer)') is null then
    alter function public.move_combat_token(uuid,uuid,integer,integer)
      rename to move_combat_token_staff_v2_core;
  end if;
end $$;

revoke execute on function public.move_combat_token_staff_v2_core(
  uuid,uuid,integer,integer
) from public,anon,authenticated;

create or replace function public.move_combat_token(
  p_encounter_id uuid,
  p_participant_id uuid,
  p_x int default null,
  p_y int default null
)
returns public.combat_participants
language plpgsql
security definer
set search_path=public
as $$
declare
  p public.combat_participants%rowtype;
begin
  select * into p
  from public.combat_participants
  where id=p_participant_id and encounter_id=p_encounter_id;

  if p.id is not null
     and p_x is not null and p_y is not null
     and exists(
       select 1
       from public.combat_effect_states s
       where s.encounter_id=p_encounter_id
         and s.target_character_id=p.character_id
         and coalesce((s.data->>'blocks_movement')::boolean,false)
         and (s.remaining_turns is null or s.remaining_turns>0)
         and (s.uses_remaining is null or s.uses_remaining>0)
     ) then
    raise exception 'Este personagem está impedido de se mover por um efeito ativo.';
  end if;

  return public.move_combat_token_staff_v2_core(
    p_encounter_id,p_participant_id,p_x,p_y
  );
end;
$$;

revoke execute on function public.move_combat_token(
  uuid,uuid,integer,integer
) from public,anon;
grant execute on function public.move_combat_token(
  uuid,uuid,integer,integer
) to authenticated;

-- ============================================================
-- 4. MANDATO: EU RECUSO — CANCELA ATAQUE JÁ PENDENTE
-- ============================================================

do $$
begin
  if to_regprocedure('public.resolve_combat_hit_staff_v2_core(uuid,boolean)') is null then
    alter function public.resolve_combat_hit(uuid,boolean)
      rename to resolve_combat_hit_staff_v2_core;
  end if;
end $$;

revoke execute on function public.resolve_combat_hit_staff_v2_core(
  uuid,boolean
) from public,anon,authenticated;

create or replace function public.resolve_combat_hit(
  p_action_id uuid,
  p_half boolean default false
)
returns public.combat_actions
language plpgsql
security definer
set search_path=public
as $$
declare
  a public.combat_actions%rowtype;
  result public.combat_actions%rowtype;
  refusal public.combat_effect_states%rowtype;
begin
  select * into a
  from public.combat_actions
  where id=p_action_id
  for update;

  if a.id is null then
    raise exception 'Ação não encontrada.';
  end if;

  if not (public.is_master() or public.owns_character(a.target_character_id)) then
    raise exception 'Somente o alvo ou o Mestre pode resolver o golpe.';
  end if;

  if a.status='pending_defense' then
    select s.* into refusal
    from public.combat_effect_states s
    where s.encounter_id=a.encounter_id
      and s.target_character_id=a.target_character_id
      and coalesce((s.data->>'royal_refusal')::boolean,false)
      and (s.remaining_turns is null or s.remaining_turns>0)
      and (s.uses_remaining is null or s.uses_remaining>0)
    order by s.created_at
    limit 1
    for update;

    if refusal.id is not null then
      if refusal.uses_remaining is null or refusal.uses_remaining<=1 then
        delete from public.combat_effect_states where id=refusal.id;
      else
        update public.combat_effect_states
        set uses_remaining=uses_remaining-1
        where id=refusal.id;
      end if;

      update public.combat_actions
      set status='cancelled',
          damage_rolls='[]'::jsonb,
          damage_flat=0,
          damage_total=0,
          summary='Mandato: Eu Recuso — Daiki negou a alteração e o ataque deixou de produzir efeito.',
          physical_damage_pending=false,
          physical_damage_queue='[]'::jsonb,
          updated_at=now()
      where id=p_action_id
      returning * into result;

      return result;
    end if;
  end if;

  return public.resolve_combat_hit_staff_v2_core(p_action_id,p_half);
end;
$$;

revoke execute on function public.resolve_combat_hit(uuid,boolean) from public,anon;
grant execute on function public.resolve_combat_hit(uuid,boolean) to authenticated;

-- Snapshots antigos podem não representar corretamente os wrappers/novos efeitos.
-- Limpamos apenas o histórico temporário de Desfazer, nunca personagens ou combate atual.
delete from public.combat_undo_snapshots;

comment on function public.use_ability_in_combat(uuid,uuid,uuid,uuid,text,text,jsonb)
is 'Motor v0.8.x + Staff V2: aplica bloqueio de capacidades amaldiçoadas por combat_effect_states.';

comment on function public.create_combat_attack(uuid,uuid,uuid,text,text,uuid,text,text,integer,integer,boolean,boolean,integer,integer,integer,text,text,text,integer)
is 'Motor v0.8.x + Staff V2: respeita defesa espacial spatial_infinity e bypass_spatial_infinity.';

comment on function public.resolve_combat_hit(uuid,boolean)
is 'Motor v0.8.3 + Staff V2: Mandato Eu Recuso pode cancelar o próximo ataque pendente.';
