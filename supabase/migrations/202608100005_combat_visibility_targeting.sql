-- Correntes do Destino - Seleção, visibilidade e alvos de combate v0.8.1
--
-- Objetivos:
-- 1) o Mestre escolhe os participantes ANTES de iniciar o combate;
-- 2) participantes podem entrar durante o combate sem recriar o encontro;
-- 3) cada participante possui visibilidade e permissão de alvo específicas do encontro;
-- 4) jogadores enxergam na iniciativa apenas fichas liberadas pelo Mestre;
-- 5) jogadores só podem selecionar como alvo fichas liberadas pelo Mestre;
-- 6) o servidor valida as mesmas regras da UI para impedir bypass pelo navegador.
--
-- Essas colunas pertencem a combat_participants: não alteram a ficha original.

-- ============================================================
-- VISIBILIDADE POR PARTICIPANTE
-- ============================================================

alter table public.combat_participants
  add column if not exists visible_to_players boolean not null default true,
  add column if not exists targetable_by_players boolean not null default true;

-- Encontros que já estavam em andamento antes da migration continuam visíveis,
-- preservando o comportamento anterior até o Mestre decidir ocultar alguém.
update public.combat_participants
set visible_to_players=coalesce(visible_to_players,true),
    targetable_by_players=coalesce(targetable_by_players,true);

-- ============================================================
-- ALVOS / ROSTER SEGURO PARA JOGADORES
-- ============================================================

-- O retorno mudou para incluir lado, iniciativa e flags; por isso é necessário
-- recriar a função em vez de usar CREATE OR REPLACE com outro RETURNS TABLE.
drop function if exists public.get_combat_targets(uuid);

create function public.get_combat_targets(p_encounter_id uuid)
returns table(
  participant_id uuid,
  character_id uuid,
  display_name text,
  entity_type text,
  ca int,
  defeated boolean,
  side_key text,
  initiative int,
  targetable_by_players boolean,
  visible_to_players boolean
)
language sql stable security definer set search_path=public
as $$
  select
    cp.id,
    c.id,
    trim(concat_ws(' ',c.first_name,c.last_name)),
    c.entity_type,
    public.combat_ca(c.id),
    cp.defeated,
    cp.side_key,
    cp.initiative,
    case
      when public.is_master() then true
      when public.owns_character(c.id) then true
      else cp.visible_to_players and cp.targetable_by_players
    end,
    case
      when public.is_master() then cp.visible_to_players
      when public.owns_character(c.id) then true
      else cp.visible_to_players
    end
  from public.combat_participants cp
  join public.characters c on c.id=cp.character_id
  where cp.encounter_id=p_encounter_id
    and (
      public.is_master()
      or (
        exists(
          select 1 from public.combat_participants mine
          where mine.encounter_id=p_encounter_id
            and public.owns_character(mine.character_id)
        )
        and (public.owns_character(c.id) or cp.visible_to_players)
      )
    )
  order by cp.initiative desc, c.first_name, c.last_name;
$$;

grant execute on function public.get_combat_targets(uuid) to authenticated;

-- ============================================================
-- RELAÇÃO DE ALVO + PERMISSÃO DE ALVO DO MESTRE
-- ============================================================

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
  actor_row public.combat_participants%rowtype;
  target_row public.combat_participants%rowtype;
  rel text:=coalesce(nullif(p_relation,''),'any');
  own_target boolean;
begin
  if p_actor_character_id is null or p_target_character_id is null then return false; end if;

  select * into actor_row
  from public.combat_participants
  where encounter_id=p_encounter_id and character_id=p_actor_character_id;

  select * into target_row
  from public.combat_participants
  where encounter_id=p_encounter_id and character_id=p_target_character_id;

  if actor_row.id is null or target_row.id is null then return false; end if;

  own_target:=p_actor_character_id=p_target_character_id;

  -- O próprio personagem sempre pode ser alvo de efeitos próprios. Para qualquer
  -- OUTRA ficha, jogadores dependem da liberação do Mestre. O Mestre ignora essa
  -- trava para continuar podendo operar entidades secretas pelo painel dele.
  if not public.is_master() and not own_target then
    if not target_row.visible_to_players or not target_row.targetable_by_players then
      return false;
    end if;
  end if;

  if rel='self' then return own_target; end if;
  if rel='other' then return not own_target; end if;
  if rel='any' then return true; end if;

  if rel='ally_or_self' then
    return own_target
      or (actor_row.side_key<>'neutral' and target_row.side_key=actor_row.side_key);
  elsif rel='ally' then
    return not own_target
      and actor_row.side_key<>'neutral' and target_row.side_key=actor_row.side_key;
  elsif rel='enemy' then
    return not own_target
      and actor_row.side_key<>'neutral'
      and target_row.side_key<>'neutral'
      and actor_row.side_key<>target_row.side_key;
  end if;

  return true;
end;
$$;

-- assert_combat_target_relation já delega para a função acima. Recriamos apenas
-- para deixar a mensagem coerente quando o problema for visibilidade/alvo.
create or replace function public.assert_combat_target_relation(
  p_encounter_id uuid,p_actor_character_id uuid,p_target_character_id uuid,p_relation text
)
returns void
language plpgsql stable security definer set search_path=public
as $$
begin
  if not public.combat_target_relation_allowed(p_encounter_id,p_actor_character_id,p_target_character_id,p_relation) then
    raise exception 'Este alvo não está disponível para esta ação. Verifique relação, visibilidade e permissão de alvo do participante.';
  end if;
end;
$$;

revoke execute on function public.combat_target_relation_allowed(uuid,uuid,uuid,text) from public,anon;
revoke execute on function public.assert_combat_target_relation(uuid,uuid,uuid,text) from public,anon,authenticated;

-- Ataques de personagens de jogador passam a usar "other" por padrão quando a
-- intenção mecânica é apenas atingir outra entidade. Isso permite fogo amigo ou
-- escolhas narrativas sem transformar "lado" em uma barreira ontológica. Efeitos
-- explicitamente de suporte/controle continuam com ally/enemy conforme cadastrados.
--
-- IMPORTANTE: `protect_ability_update_trigger` foi escrito para atualizações feitas
-- por usuários autenticados no site. Uma migration executada via Supabase CLI não
-- possui `auth.uid()`, portanto o trigger a trataria como um jogador sem permissão.
-- Desativamos SOMENTE esse trigger durante esta migração de dados e o reativamos
-- imediatamente depois. Os demais triggers/regras permanecem intactos.
alter table public.abilities disable trigger protect_ability_update_trigger;

update public.abilities a
set config=jsonb_set(a.config,'{target_relation}','"other"'::jsonb,true), updated_at=now()
from public.characters c
where c.id=a.character_id
  and (
    c.entity_type='player'
    or exists(select 1 from public.characters parent where parent.id=c.parent_character_id and parent.entity_type='player')
  )
  and a.config->>'target_relation'='enemy'
  and (
    coalesce((a.config->>'requires_attack')::boolean,false)
    or coalesce(a.config->>'special_action','')='place_delayed_bomb'
  );

alter table public.abilities enable trigger protect_ability_update_trigger;

-- ============================================================
-- ATAQUES BÁSICOS / ARMAS TAMBÉM RESPEITAM ALVO LIBERADO
-- ============================================================

alter function public.create_combat_attack(
  uuid,uuid,uuid,text,text,uuid,text,text,int,int,boolean,boolean,int,int,int,text,text,text,int
) rename to create_combat_attack_v080_core;

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
begin
  if not public.is_master() then
    if not public.owns_character(p_attacker_character_id) then
      raise exception 'Você não pode realizar ataques por esta ficha.';
    end if;
    perform public.assert_combat_target_relation(
      p_encounter_id,
      p_attacker_character_id,
      p_target_character_id,
      case when p_attacker_character_id=p_target_character_id then 'self' else 'other' end
    );
  end if;

  return public.create_combat_attack_v080_core(
    p_encounter_id,p_attacker_character_id,p_target_character_id,p_label,p_source_type,p_source_id,
    p_attack_attribute_key,p_attack_skill_key,p_pa_cost,p_ea_cost,p_uses_cursed_energy,p_forced_critical,
    p_critical_threshold,p_damage_dice_count,p_damage_die,p_damage_flat_attribute_key,p_condition_key,
    p_roll_mode,p_roll_count
  );
end;
$$;

grant execute on function public.create_combat_attack(uuid,uuid,uuid,text,text,uuid,text,text,int,int,boolean,boolean,int,int,int,text,text,text,int) to authenticated;
revoke execute on function public.create_combat_attack_v080_core(uuid,uuid,uuid,text,text,uuid,text,text,int,int,boolean,boolean,int,int,int,text,text,text,int) from public,anon,authenticated;

-- ============================================================
-- INICIAR COMBATE COM PARTICIPANTES EM UMA ÚNICA TRANSAÇÃO
-- ============================================================

create or replace function public.create_combat_encounter_with_participants(
  p_name text,
  p_participants jsonb default '[]'::jsonb
)
returns uuid
language plpgsql security definer set search_path=public
as $$
declare
  encounter_id uuid;
  item jsonb;
  cid uuid;
  skey text;
  vis boolean;
  tgt boolean;
begin
  if not public.is_master() then raise exception 'Somente o Mestre pode iniciar um combate.'; end if;
  if nullif(trim(coalesce(p_name,'')),'') is null then raise exception 'Informe um nome para o combate.'; end if;
  if jsonb_typeof(coalesce(p_participants,'[]'::jsonb))<>'array' or jsonb_array_length(coalesce(p_participants,'[]'::jsonb))=0 then
    raise exception 'Selecione pelo menos uma ficha para iniciar o combate.';
  end if;
  if exists(select 1 from public.combat_encounters where status='active') then
    raise exception 'Já existe um combate ativo. Encerre-o antes de iniciar outro.';
  end if;

  insert into public.combat_encounters(name,status)
  values(trim(p_name),'active')
  returning id into encounter_id;

  for item in select value from jsonb_array_elements(p_participants)
  loop
    begin cid:=(item->>'character_id')::uuid;
    exception when invalid_text_representation then raise exception 'Uma das fichas selecionadas possui ID inválido.'; end;
    if not exists(select 1 from public.characters where id=cid) then
      raise exception 'Uma das fichas selecionadas não existe mais.';
    end if;

    skey:=coalesce(nullif(item->>'side_key',''),'neutral');
    if skey not in ('ally','enemy','neutral') then raise exception 'Lado de combate inválido: %',skey; end if;
    vis:=coalesce((item->>'visible_to_players')::boolean,true);
    tgt:=coalesce((item->>'targetable_by_players')::boolean,true);

    insert into public.combat_participants(
      encounter_id,character_id,side_key,visible_to_players,targetable_by_players
    ) values(encounter_id,cid,skey,vis,tgt)
    on conflict (encounter_id,character_id) do nothing;
  end loop;

  return encounter_id;
end;
$$;

grant execute on function public.create_combat_encounter_with_participants(text,jsonb) to authenticated;


-- ============================================================
-- SINAL DE REALTIME SEM EXPOR A LINHA COMPLETA DO PARTICIPANTE
-- ============================================================

-- Jogadores não recebem SELECT direto das linhas de outros participantes, então
-- o Realtime de combat_participants também não deve ser usado para revelar dados.
-- Em vez disso, qualquer mudança de participante apenas "toca" o encontro. Como
-- combat_encounters é legível por todos, a UI recebe o evento e refaz o RPC seguro.
alter table public.combat_encounters
  add column if not exists updated_at timestamptz not null default now();

create or replace function public.touch_combat_encounter_from_participant()
returns trigger
language plpgsql security definer set search_path=public
as $$
declare
  eid uuid;
begin
  eid:=case when tg_op='DELETE' then old.encounter_id else new.encounter_id end;
  update public.combat_encounters set updated_at=now() where id=eid;
  return case when tg_op='DELETE' then old else new end;
end;
$$;

drop trigger if exists touch_combat_encounter_participant_trigger on public.combat_participants;
create trigger touch_combat_encounter_participant_trigger
after insert or update or delete on public.combat_participants
for each row execute procedure public.touch_combat_encounter_from_participant();

revoke execute on function public.touch_combat_encounter_from_participant() from public,anon,authenticated;

-- ============================================================
-- NÃO VAZAR NOME DE PARTICIPANTE OCULTO EM AÇÕES QUE ENVOLVAM O PLAYER
-- ============================================================

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
  select
    a.id,a.encounter_id,a.attacker_character_id,a.target_character_id,
    case
      when public.is_master() or public.owns_character(a.attacker_character_id) or coalesce(ap.visible_to_players,true)
        then trim(concat_ws(' ',ac.first_name,ac.last_name))
      else 'Entidade oculta'
    end,
    case
      when public.is_master() or public.owns_character(a.target_character_id) or coalesce(tp.visible_to_players,true)
        then trim(concat_ws(' ',tc.first_name,tc.last_name))
      else 'Entidade oculta'
    end,
    a.source_type,a.source_id,a.label,
    case when not public.is_master() and p.role='master' and not public.owns_character(a.attacker_character_id) then '[]'::jsonb else a.attack_rolls end,
    case when not public.is_master() and p.role='master' and not public.owns_character(a.attacker_character_id) then null else a.attack_natural end,
    case when not public.is_master() and p.role='master' and not public.owns_character(a.attacker_character_id) then 0 else a.attack_bonus end,
    case when not public.is_master() and p.role='master' and not public.owns_character(a.attacker_character_id) then null else a.attack_total end,
    a.target_ca,
    (not public.is_master() and p.role='master' and not public.owns_character(a.attacker_character_id)) as attack_hidden,
    (not public.is_master() and dp.role='master' and not public.owns_character(a.target_character_id)) as defense_hidden,
    a.is_critical,a.kokusen_eligible,a.kokusen_denied,a.is_kokusen,
    case when not public.is_master() and p.role='master' and not public.owns_character(a.attacker_character_id) then '[]'::jsonb else a.damage_rolls end,
    a.damage_flat,a.damage_total,a.damage_reduction,a.defense_type,
    case when not public.is_master() and dp.role='master' and not public.owns_character(a.target_character_id) then '[]'::jsonb else a.defense_rolls end,
    case when not public.is_master() and dp.role='master' and not public.owns_character(a.target_character_id) then null else a.defense_natural end,
    case when not public.is_master() and dp.role='master' and not public.owns_character(a.target_character_id) then 0 else a.defense_bonus end,
    case when not public.is_master() and dp.role='master' and not public.owns_character(a.target_character_id) then null else a.defense_total end,
    a.defense_success,a.counterattack_available,a.condition_key,a.status,a.summary,a.created_at
  from public.combat_actions a
  join public.characters ac on ac.id=a.attacker_character_id
  join public.characters tc on tc.id=a.target_character_id
  left join public.combat_participants ap on ap.encounter_id=a.encounter_id and ap.character_id=a.attacker_character_id
  left join public.combat_participants tp on tp.encounter_id=a.encounter_id and tp.character_id=a.target_character_id
  left join public.profiles p on p.id=a.created_by
  left join public.profiles dp on dp.id=a.defense_created_by
  where a.encounter_id=p_encounter_id
    and (public.is_master() or public.owns_character(a.attacker_character_id) or public.owns_character(a.target_character_id))
  order by a.created_at desc
  limit 100;
$$;

grant execute on function public.get_visible_combat_actions(uuid) to authenticated;

-- Snapshots anteriores não possuem as duas novas colunas NOT NULL. Limpar apenas
-- o histórico de Undo evita que um snapshot antigo seja restaurado como registro
-- incompleto. O combate atual NÃO é apagado.
delete from public.combat_undo_snapshots;
