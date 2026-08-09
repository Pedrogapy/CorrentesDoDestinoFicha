-- Correntes do Destino - controle de turnos v0.6.2
--
-- Objetivo:
-- - somente o Mestre inicia um turno;
-- - somente a entidade cujo turno foi iniciado pode executar ações de turno;
-- - o próprio jogador ou o Mestre pode encerrar o turno ativo;
-- - reações/defesas/contra-ataques continuam possíveis fora do turno próprio;
-- - iniciar e encerrar turno entram no histórico de Desfazer da v0.6.1.

alter table public.combat_encounters
  add column if not exists active_participant_id uuid references public.combat_participants(id) on delete set null;

alter table public.combat_encounters
  add column if not exists turn_started_at timestamptz;

create index if not exists combat_encounters_active_participant_idx
on public.combat_encounters(active_participant_id);


-- Garante que o participante marcado como ativo pertence ao próprio encontro.
create or replace function public.validate_active_combat_participant()
returns trigger
language plpgsql
set search_path=public
as $$
begin
  if new.active_participant_id is not null and not exists (
    select 1 from public.combat_participants cp
    where cp.id=new.active_participant_id and cp.encounter_id=new.id
  ) then
    raise exception 'O turno ativo precisa pertencer a este combate.';
  end if;
  return new;
end;
$$;

drop trigger if exists validate_active_combat_participant_trigger on public.combat_encounters;
create trigger validate_active_combat_participant_trigger
before insert or update of active_participant_id on public.combat_encounters
for each row execute function public.validate_active_combat_participant();

-- Confirma apenas que a ficha pertence a este combate ativo. Usado por reações,
-- que precisam continuar funcionando mesmo quando não é o turno do defensor.
create or replace function public.assert_combat_participant(p_encounter_id uuid,p_character_id uuid)
returns void
language plpgsql
security definer
set search_path=public
as $$
declare
  e public.combat_encounters%rowtype;
begin
  select * into e from public.combat_encounters where id=p_encounter_id;
  if e.id is null then raise exception 'Combate não encontrado.'; end if;
  if e.status<>'active' then raise exception 'Este combate já foi encerrado.'; end if;
  if not exists(select 1 from public.combat_participants cp where cp.encounter_id=p_encounter_id and cp.character_id=p_character_id) then
    raise exception 'Este personagem não participa do combate.';
  end if;
end;
$$;

revoke execute on function public.assert_combat_participant(uuid,uuid) from public, anon, authenticated;

-- Regra central. Nem mesmo o Mestre ignora este bloqueio ao executar uma ação
-- normal de uma entidade; ele primeiro precisa iniciar formalmente o turno dela.
create or replace function public.assert_active_combat_turn(p_encounter_id uuid,p_character_id uuid)
returns void
language plpgsql
security definer
set search_path=public
as $$
declare
  e public.combat_encounters%rowtype;
  active_character uuid;
begin
  perform public.assert_combat_participant(p_encounter_id,p_character_id);
  select * into e from public.combat_encounters where id=p_encounter_id;
  if e.active_participant_id is null then
    raise exception 'Aguarde o Mestre iniciar seu turno.';
  end if;
  select cp.character_id into active_character
  from public.combat_participants cp
  where cp.id=e.active_participant_id and cp.encounter_id=p_encounter_id;
  if active_character is distinct from p_character_id then
    raise exception 'Não é o turno deste personagem.';
  end if;
end;
$$;

revoke execute on function public.assert_active_combat_turn(uuid,uuid) from public, anon, authenticated;

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
  if p_encounter_id is not null then
    perform public.assert_active_combat_turn(p_encounter_id,p_character_id);
  end if;
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
  -- Contra-ataques e reações são, por definição, ações fora do turno próprio.
  if coalesce(p_source_type,'basic') not in ('counterattack','reaction','equipment_reaction') then
    perform public.assert_active_combat_turn(p_encounter_id,p_attacker_character_id);
  else
    perform public.assert_combat_participant(p_encounter_id,p_attacker_character_id);
  end if;
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

-- A assinatura ganhou p_is_reaction. Removemos a versão anterior para evitar
-- ambiguidade no RPC do Supabase/PostgREST.
drop function if exists public.use_combat_effect(uuid,uuid,uuid,text,uuid,int,int,int,int,text,text);

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
  p_condition_key text,
  p_is_reaction boolean default false
)
returns jsonb
language plpgsql security definer set search_path=public
as $$
declare
  cp public.combat_participants%rowtype; tp public.combat_participants%rowtype; d jsonb; flat int; total int; paid_ea int; discount boolean:=false;
begin
  if not (public.is_master() or public.owns_character(p_character_id)) then raise exception 'Sem permissão para usar esta ficha.'; end if;
  if coalesce(p_is_reaction,false) then
    perform public.assert_combat_participant(p_encounter_id,p_character_id);
  else
    perform public.assert_active_combat_turn(p_encounter_id,p_character_id);
  end if;
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
declare
  p public.combat_participants%rowtype;
  e public.combat_encounters%rowtype;
begin
  if not public.is_master() then
    raise exception 'Somente o Mestre pode iniciar turnos.';
  end if;

  select * into p from public.combat_participants where id=p_participant_id for update;
  if p.id is null then raise exception 'Participante não encontrado.'; end if;
  if p.defeated then raise exception 'Um participante derrotado não pode iniciar turno.'; end if;

  select * into e from public.combat_encounters where id=p.encounter_id for update;
  if e.id is null or e.status<>'active' then raise exception 'Combate não está ativo.'; end if;
  if e.active_participant_id is not null then
    raise exception 'Já existe um turno ativo. Encerre o turno atual antes de iniciar outro.';
  end if;
  if exists(select 1 from public.combat_actions a where a.encounter_id=e.id and a.status='pending_defense') then
    raise exception 'Resolva a reação pendente antes de iniciar outro turno.';
  end if;

  update public.combat_participants
  set current_pa=public.combat_max_pa(character_id),
      counterattack_count=0,
      black_flash_discount_used=false
  where id=p.id
  returning * into p;

  update public.combat_encounters
  set active_participant_id=p.id,
      turn_started_at=now(),
      current_turn=current_turn+1
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
  if exists(select 1 from public.combat_actions a where a.encounter_id=e.id and a.status='pending_defense') then
    raise exception 'Resolva a reação pendente antes de encerrar o turno.';
  end if;

  -- Encerrar o turno não consome recurso. Só processa efeitos normais de fim
  -- de turno e devolve o controle ao Mestre para escolher a próxima entidade.
  update public.combat_participants
  set black_flash_turns=greatest(0,black_flash_turns-1)
  where id=p.id
  returning * into p;

  update public.combat_encounters
  set active_participant_id=null,
      turn_started_at=null
  where id=e.id;

  return p;
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
  restored_active_participant uuid;
  restored_turn_started_at timestamptz;
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
  restored_active_participant := nullif(encounter_json->>'active_participant_id','')::uuid;
  restored_turn_started_at := nullif(encounter_json->>'turn_started_at','')::timestamptz;

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
    active_participant_id=null,
    turn_started_at=null,
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

  -- O FK do turno ativo aponta para combat_participants. Por isso o participante
  -- é restaurado primeiro e só depois reativamos o turno capturado no snapshot.
  update public.combat_encounters
  set active_participant_id=restored_active_participant,
      turn_started_at=restored_turn_started_at
  where id=p_encounter_id;

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


create or replace function public.remove_combat_condition(p_participant_id uuid,p_condition_key text)
returns public.combat_participants
language plpgsql security definer set search_path=public
as $$
declare p public.combat_participants%rowtype;
begin
  select * into p from public.combat_participants where id=p_participant_id for update;
  if p.id is null then raise exception 'Participante não encontrado.'; end if;
  if not (public.is_master() or public.owns_character(p.character_id)) then raise exception 'Sem permissão.'; end if;
  if not public.is_master() then
    perform public.assert_active_combat_turn(p.encounter_id,p.character_id);
  end if;
  update public.combat_participants set conditions=coalesce(conditions,'[]'::jsonb) - p_condition_key where id=p.id returning * into p;
  return p;
end;
$$;
grant execute on function public.roll_general_test(uuid,text,text,text,text,int,text,uuid) to authenticated;
grant execute on function public.create_combat_attack(uuid,uuid,uuid,text,text,uuid,text,text,int,int,boolean,boolean,int,int,int,text,text,text,int) to authenticated;
grant execute on function public.use_combat_effect(uuid,uuid,uuid,text,uuid,int,int,int,int,text,text,boolean) to authenticated;
grant execute on function public.start_combat_turn(uuid) to authenticated;
grant execute on function public.end_combat_turn(uuid) to authenticated;
grant execute on function public.remove_combat_condition(uuid,text) to authenticated;
grant execute on function public.undo_last_combat_action(uuid) to authenticated;
