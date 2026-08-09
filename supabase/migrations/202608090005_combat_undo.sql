-- Correntes do Destino - desfazer última ação de combate v0.6.1
--
-- Estratégia:
-- cada mutação relevante do combate cria um snapshot ANTES de acontecer.
-- O snapshot só é marcado como "committed" depois que a ação termina com sucesso.
-- O Mestre pode restaurar o snapshot mais recente, recuperando PS/EA/PA,
-- condições, iniciativa, Fluxo Negro, ações, rolagens e cargas consumidas.
--
-- A tabela não é exposta diretamente aos jogadores. Toda leitura/restauração
-- passa por RPCs security definer e a restauração é exclusiva do Mestre.

create table if not exists public.combat_undo_snapshots (
  id uuid primary key default gen_random_uuid(),
  encounter_id uuid not null references public.combat_encounters(id) on delete cascade,
  created_by uuid not null default auth.uid(),
  label text not null default 'Ação de combate',
  state jsonb not null,
  status text not null default 'pending' check (status in ('pending','committed')),
  created_at timestamptz not null default now(),
  committed_at timestamptz
);

create index if not exists combat_undo_snapshots_encounter_idx
on public.combat_undo_snapshots(encounter_id, committed_at desc nulls last, created_at desc);

alter table public.combat_undo_snapshots enable row level security;

-- Não há acesso direto do cliente ao conteúdo dos snapshots.
revoke all on table public.combat_undo_snapshots from anon, authenticated;

create or replace function public.capture_combat_state(p_encounter_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  encounter_state jsonb;
  participant_state jsonb;
  action_state jsonb;
  roll_state jsonb;
  equipment_state jsonb;
begin
  select to_jsonb(e) into encounter_state
  from public.combat_encounters e
  where e.id=p_encounter_id;

  if encounter_state is null then
    raise exception 'Combate não encontrado.';
  end if;

  select coalesce(jsonb_agg(to_jsonb(cp) order by cp.created_at, cp.id), '[]'::jsonb)
    into participant_state
  from public.combat_participants cp
  where cp.encounter_id=p_encounter_id;

  select coalesce(jsonb_agg(to_jsonb(a) order by a.created_at, a.id), '[]'::jsonb)
    into action_state
  from public.combat_actions a
  where a.encounter_id=p_encounter_id;

  select coalesce(jsonb_agg(to_jsonb(r) order by r.created_at, r.id), '[]'::jsonb)
    into roll_state
  from public.roll_logs r
  where r.encounter_id=p_encounter_id;

  -- Combate só altera cargas de equipamento. Equipar/desequipar continua sendo
  -- uma alteração de inventário e não é revertida por "Desfazer combate".
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', eq.id,
        'charges_current', eq.charges_current
      ) order by eq.id
    ),
    '[]'::jsonb
  ) into equipment_state
  from public.equipment eq
  where eq.character_id in (
    select cp.character_id
    from public.combat_participants cp
    where cp.encounter_id=p_encounter_id
  );

  return jsonb_build_object(
    'encounter', encounter_state,
    'participants', participant_state,
    'actions', action_state,
    'rolls', roll_state,
    'equipment_charges', equipment_state
  );
end;
$$;

-- Função interna: o conteúdo bruto inclui rolagens secretas do Mestre.
revoke execute on function public.capture_combat_state(uuid) from public, anon, authenticated;

create or replace function public.begin_combat_undo(p_encounter_id uuid, p_label text default 'Ação de combate')
returns uuid
language plpgsql
security definer
set search_path=public
as $$
declare
  snapshot_id uuid;
  allowed boolean := false;
begin
  allowed := public.is_master() or exists (
    select 1
    from public.combat_participants cp
    where cp.encounter_id=p_encounter_id
      and public.owns_character(cp.character_id)
  );

  if not allowed then
    raise exception 'Sem permissão para registrar esta ação de combate.';
  end if;

  -- Pendências antigas do mesmo usuário nunca contam como ações desfazíveis.
  delete from public.combat_undo_snapshots
  where encounter_id=p_encounter_id
    and created_by=auth.uid()
    and status='pending'
    and created_at < now() - interval '10 minutes';

  insert into public.combat_undo_snapshots(encounter_id,created_by,label,state,status)
  values(
    p_encounter_id,
    auth.uid(),
    coalesce(nullif(trim(p_label),''),'Ação de combate'),
    public.capture_combat_state(p_encounter_id),
    'pending'
  )
  returning id into snapshot_id;

  return snapshot_id;
end;
$$;

create or replace function public.commit_combat_undo(p_snapshot_id uuid)
returns void
language plpgsql
security definer
set search_path=public
as $$
declare
  sid uuid;
  eid uuid;
begin
  update public.combat_undo_snapshots
  set status='committed', committed_at=now()
  where id=p_snapshot_id
    and status='pending'
    and (created_by=auth.uid() or public.is_master())
  returning id, encounter_id into sid, eid;

  if sid is null then
    raise exception 'Snapshot de combate não encontrado ou sem permissão.';
  end if;

  -- Mantém histórico suficiente para vários Ctrl+Z sem crescimento indefinido.
  delete from public.combat_undo_snapshots s
  where s.id in (
    select x.id
    from public.combat_undo_snapshots x
    where x.encounter_id=eid and x.status='committed'
    order by x.committed_at desc, x.created_at desc
    offset 50
  );
end;
$$;

create or replace function public.discard_combat_undo(p_snapshot_id uuid)
returns void
language plpgsql
security definer
set search_path=public
as $$
begin
  delete from public.combat_undo_snapshots
  where id=p_snapshot_id
    and status='pending'
    and (created_by=auth.uid() or public.is_master());
end;
$$;

create or replace function public.get_latest_combat_undo(p_encounter_id uuid default null)
returns table(
  snapshot_id uuid,
  encounter_id uuid,
  encounter_name text,
  encounter_status text,
  label text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path=public
as $$
begin
  if not public.is_master() then
    raise exception 'Somente o Mestre pode consultar o histórico de desfazer.';
  end if;

  return query
  select s.id, s.encounter_id, e.name, e.status, s.label, coalesce(s.committed_at,s.created_at)
  from public.combat_undo_snapshots s
  join public.combat_encounters e on e.id=s.encounter_id
  where s.status='committed'
    and (p_encounter_id is null or s.encounter_id=p_encounter_id)
  order by coalesce(s.committed_at,s.created_at) desc, s.created_at desc
  limit 1;
end;
$$;

create or replace function public.undo_last_combat_action(p_encounter_id uuid)
returns text
language plpgsql
security definer
set search_path=public
as $$
declare
  s public.combat_undo_snapshots%rowtype;
  encounter_json jsonb;
  restored_status text;
  restored_campaign uuid;
  eq record;
begin
  if not public.is_master() then
    raise exception 'Somente o Mestre pode desfazer ações de combate.';
  end if;

  select * into s
  from public.combat_undo_snapshots
  where encounter_id=p_encounter_id and status='committed'
  order by committed_at desc nulls last, created_at desc
  limit 1
  for update;

  if s.id is null then
    raise exception 'Não há ação de combate para desfazer.';
  end if;

  encounter_json := s.state->'encounter';
  restored_status := coalesce(encounter_json->>'status','active');
  restored_campaign := (encounter_json->>'campaign_id')::uuid;

  if restored_status='active' and exists (
    select 1 from public.combat_encounters e
    where e.id<>p_encounter_id
      and e.campaign_id=restored_campaign
      and e.status='active'
  ) then
    raise exception 'Não é possível reabrir este combate enquanto outro combate estiver ativo.';
  end if;

  -- Estado do encontro.
  update public.combat_encounters
  set
    name=coalesce(encounter_json->>'name',name),
    status=restored_status,
    round=greatest(1,coalesce((encounter_json->>'round')::int,1)),
    current_turn=coalesce((encounter_json->>'current_turn')::int,0),
    ended_at=case
      when encounter_json->>'ended_at' is null then null
      else (encounter_json->>'ended_at')::timestamptz
    end
  where id=p_encounter_id;

  -- Participantes: recupera exatamente PS, EA, PA, condições, iniciativa,
  -- contador de contra-ataque, Fluxo Negro e estado derrotado.
  delete from public.combat_participants where encounter_id=p_encounter_id;
  insert into public.combat_participants
  select *
  from jsonb_populate_recordset(
    null::public.combat_participants,
    coalesce(s.state->'participants','[]'::jsonb)
  );

  -- Ações e rolagens voltam ao ponto imediatamente anterior ao clique desfeito.
  delete from public.combat_actions where encounter_id=p_encounter_id;
  insert into public.combat_actions
  select *
  from jsonb_populate_recordset(
    null::public.combat_actions,
    coalesce(s.state->'actions','[]'::jsonb)
  );

  delete from public.roll_logs where encounter_id=p_encounter_id;
  insert into public.roll_logs
  select *
  from jsonb_populate_recordset(
    null::public.roll_logs,
    coalesce(s.state->'rolls','[]'::jsonb)
  );

  -- Devolve cargas gastas por armas, amuletos, consumíveis e outros itens.
  for eq in
    select *
    from jsonb_to_recordset(coalesce(s.state->'equipment_charges','[]'::jsonb))
      as x(id uuid, charges_current int)
  loop
    update public.equipment
    set charges_current=eq.charges_current
    where id=eq.id;
  end loop;

  -- Remover o snapshot permite apertar Desfazer novamente para voltar mais uma ação.
  delete from public.combat_undo_snapshots where id=s.id;

  return s.label;
end;
$$;

grant execute on function public.begin_combat_undo(uuid,text) to authenticated;
grant execute on function public.commit_combat_undo(uuid) to authenticated;
grant execute on function public.discard_combat_undo(uuid) to authenticated;
grant execute on function public.get_latest_combat_undo(uuid) to authenticated;
grant execute on function public.undo_last_combat_action(uuid) to authenticated;
