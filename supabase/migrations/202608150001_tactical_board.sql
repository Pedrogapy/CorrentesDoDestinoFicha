-- Correntes do Destino - tabuleiro tático de combate v0.8.2
--
-- Objetivo:
-- 1) dar ao Mestre um plano quadriculado persistente por encontro;
-- 2) permitir posicionar/repositionar qualquer participante do combate;
-- 3) permitir marcar quadrados intransponíveis e paredes/passagens bloqueadas;
-- 4) mostrar aos jogadores somente as peças que já são visíveis para eles;
-- 5) manter posição das peças dentro do snapshot existente de Desfazer.
--
-- IMPORTANTE:
-- O tabuleiro é uma camada de POSICIONAMENTO. Ele não converte automaticamente
-- quadrados em metros, não gasta PA e não altera alcance narrativo das técnicas.
-- Assim ele não quebra as regras já usadas pela campanha. As paredes são gravadas
-- de forma estruturada para poderem ser usadas por um motor de movimento futuro.

-- ============================================================
-- ESTADO DO TABULEIRO
-- ============================================================

alter table public.combat_encounters
  add column if not exists board_cols int not null default 14,
  add column if not exists board_rows int not null default 10,
  add column if not exists board_blocked_cells jsonb not null default '[]'::jsonb,
  add column if not exists board_walls jsonb not null default '[]'::jsonb;

-- A posição pertence ao participante NO encontro, não à ficha permanente.
alter table public.combat_participants
  add column if not exists board_x int,
  add column if not exists board_y int;

-- Checks adicionados com blocos condicionais para a migration continuar idempotente
-- durante desenvolvimento local.
do $$
begin
  if not exists(select 1 from pg_constraint where conname='combat_encounters_board_cols_check') then
    alter table public.combat_encounters
      add constraint combat_encounters_board_cols_check check (board_cols between 4 and 30);
  end if;
  if not exists(select 1 from pg_constraint where conname='combat_encounters_board_rows_check') then
    alter table public.combat_encounters
      add constraint combat_encounters_board_rows_check check (board_rows between 4 and 30);
  end if;
  if not exists(select 1 from pg_constraint where conname='combat_participants_board_x_check') then
    alter table public.combat_participants
      add constraint combat_participants_board_x_check check (board_x is null or board_x>=0);
  end if;
  if not exists(select 1 from pg_constraint where conname='combat_participants_board_y_check') then
    alter table public.combat_participants
      add constraint combat_participants_board_y_check check (board_y is null or board_y>=0);
  end if;
end $$;

-- Jogador não pode reposicionar a própria peça alterando o request manualmente.
-- Todo posicionamento do mapa é autoridade do Mestre.
create or replace function public.protect_combat_board_position()
returns trigger
language plpgsql
security definer set search_path=public
as $$
begin
  if not public.is_master()
     and (new.board_x is distinct from old.board_x or new.board_y is distinct from old.board_y) then
    raise exception 'Somente o Mestre pode reposicionar peças no tabuleiro.';
  end if;
  return new;
end;
$$;

drop trigger if exists protect_combat_board_position_trigger on public.combat_participants;
create trigger protect_combat_board_position_trigger
before update of board_x,board_y on public.combat_participants
for each row execute procedure public.protect_combat_board_position();

-- ============================================================
-- MOVIMENTAÇÃO AUTORITATIVA DO MESTRE
-- ============================================================

create or replace function public.move_combat_token(
  p_encounter_id uuid,
  p_participant_id uuid,
  p_x int default null,
  p_y int default null
)
returns public.combat_participants
language plpgsql
security definer set search_path=public
as $$
declare
  e public.combat_encounters%rowtype;
  p public.combat_participants%rowtype;
  cell_key text;
begin
  if not public.is_master() then
    raise exception 'Somente o Mestre pode mover peças no tabuleiro.';
  end if;

  select * into e from public.combat_encounters where id=p_encounter_id for update;
  if e.id is null then raise exception 'Combate não encontrado.'; end if;

  select * into p
  from public.combat_participants
  where id=p_participant_id and encounter_id=p_encounter_id
  for update;
  if p.id is null then raise exception 'Participante não pertence a este combate.'; end if;

  -- null/null retira a peça do plano sem remover o participante da luta.
  if p_x is null and p_y is null then
    update public.combat_participants
    set board_x=null, board_y=null
    where id=p.id
    returning * into p;
    return p;
  end if;

  if p_x is null or p_y is null then
    raise exception 'Informe X e Y juntos, ou deixe ambos vazios para retirar a peça do plano.';
  end if;

  if p_x<0 or p_y<0 or p_x>=e.board_cols or p_y>=e.board_rows then
    raise exception 'Posição fora dos limites do tabuleiro.';
  end if;

  cell_key:=p_x::text || ':' || p_y::text;
  if exists(
    select 1
    from jsonb_array_elements_text(coalesce(e.board_blocked_cells,'[]'::jsonb)) x(value)
    where x.value=cell_key
  ) then
    raise exception 'Este quadrado está marcado como intransponível.';
  end if;

  update public.combat_participants
  set board_x=p_x, board_y=p_y
  where id=p.id
  returning * into p;

  return p;
end;
$$;

-- Terrain não entra no histórico de ações. O Mestre pode marcar/desmarcar a
-- qualquer instante sem consumir recursos e sem poluir o botão Desfazer.
create or replace function public.set_combat_board_state(
  p_encounter_id uuid,
  p_blocked_cells jsonb default null,
  p_walls jsonb default null
)
returns public.combat_encounters
language plpgsql
security definer set search_path=public
as $$
declare
  e public.combat_encounters%rowtype;
  new_blocked jsonb;
begin
  if not public.is_master() then
    raise exception 'Somente o Mestre pode editar o terreno do tabuleiro.';
  end if;

  select * into e from public.combat_encounters where id=p_encounter_id for update;
  if e.id is null then raise exception 'Combate não encontrado.'; end if;

  new_blocked:=coalesce(p_blocked_cells,e.board_blocked_cells,'[]'::jsonb);
  if jsonb_typeof(new_blocked)<>'array' then raise exception 'Quadrados bloqueados precisam ser uma lista.'; end if;
  if p_walls is not null and jsonb_typeof(p_walls)<>'array' then raise exception 'Paredes precisam ser uma lista.'; end if;

  -- Não deixa transformar em parede sólida um quadrado que já contém uma peça.
  if exists(
    select 1
    from public.combat_participants cp
    where cp.encounter_id=p_encounter_id
      and cp.board_x is not null and cp.board_y is not null
      and exists(
        select 1 from jsonb_array_elements_text(new_blocked) b(value)
        where b.value=cp.board_x::text || ':' || cp.board_y::text
      )
  ) then
    raise exception 'Mova a peça antes de bloquear o quadrado ocupado.';
  end if;

  update public.combat_encounters
  set board_blocked_cells=new_blocked,
      board_walls=coalesce(p_walls,e.board_walls,'[]'::jsonb)
  where id=p_encounter_id
  returning * into e;

  return e;
end;
$$;

revoke execute on function public.move_combat_token(uuid,uuid,int,int) from public,anon;
revoke execute on function public.set_combat_board_state(uuid,jsonb,jsonb) from public,anon;
grant execute on function public.move_combat_token(uuid,uuid,int,int) to authenticated;
grant execute on function public.set_combat_board_state(uuid,jsonb,jsonb) to authenticated;

-- ============================================================
-- ROSTER PÚBLICO: POSIÇÃO SOMENTE DE QUEM JÁ É VISÍVEL
-- ============================================================

-- O RETURNS TABLE mudou para incluir board_x/board_y.
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
  visible_to_players boolean,
  board_x int,
  board_y int
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
    end,
    cp.board_x,
    cp.board_y
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
-- DESFAZER E COMPATIBILIDADE
-- ============================================================
-- combat_undo captura participantes com to_jsonb(cp) e restaura com
-- jsonb_populate_recordset(null::combat_participants,...). Portanto board_x e
-- board_y passam a ser capturados/restaurados automaticamente sem reescrever o
-- motor de Undo. O terreno (encounter.board_*) é edição de cena e fica fora do
-- histórico propositalmente.

-- Snapshots anteriores à existência de board_x/board_y podem ser restaurados com
-- null nesses campos, o que é seguro. Limpamos snapshots antigos porque alterações
-- de schema acumuladas entre versões não devem ser usadas como rollback de versão.
delete from public.combat_undo_snapshots;
