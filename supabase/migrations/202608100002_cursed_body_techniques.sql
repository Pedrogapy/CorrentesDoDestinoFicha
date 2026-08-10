-- Correntes do Destino - Técnicas de Corpo Amaldiçoado v0.7.1
--
-- Uma Técnica do Corpo é uma concessão narrativa do Mestre.
-- Ela não usa os slots/VP normais da build do jogador e permanece completamente
-- invisível até o Mestre liberar o acesso.

create table if not exists public.character_cursed_body_techniques (
  id uuid primary key default gen_random_uuid(),
  character_id uuid not null unique references public.characters(id) on delete cascade,
  name text not null,
  description text not null default '',
  master_notes text not null default '',
  is_released boolean not null default false,
  released_at timestamptz,
  released_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.abilities
  add column if not exists cursed_body_technique_id uuid references public.character_cursed_body_techniques(id) on delete cascade;

create index if not exists abilities_cursed_body_technique_idx
on public.abilities(cursed_body_technique_id)
where cursed_body_technique_id is not null;

alter table public.character_cursed_body_techniques enable row level security;

drop policy if exists cursed_body_select on public.character_cursed_body_techniques;
create policy cursed_body_select on public.character_cursed_body_techniques
for select to authenticated
using (
  public.is_master()
  or (is_released and public.owns_character(character_id))
);

drop policy if exists cursed_body_master_insert on public.character_cursed_body_techniques;
create policy cursed_body_master_insert on public.character_cursed_body_techniques
for insert to authenticated
with check (public.is_master());

drop policy if exists cursed_body_master_update on public.character_cursed_body_techniques;
create policy cursed_body_master_update on public.character_cursed_body_techniques
for update to authenticated
using (public.is_master())
with check (public.is_master());

drop policy if exists cursed_body_master_delete on public.character_cursed_body_techniques;
create policy cursed_body_master_delete on public.character_cursed_body_techniques
for delete to authenticated
using (public.is_master());

grant select,insert,update,delete on public.character_cursed_body_techniques to authenticated;

-- Habilidades de Corpo Amaldiçoado também ficam invisíveis até o pacote ser liberado.
-- Jogadores nunca podem criar, editar ou apagar uma habilidade concedida pelo corpo.
drop policy if exists "abilities_select" on public.abilities;
create policy "abilities_select" on public.abilities for select to authenticated
using (
  public.is_master()
  or (
    public.owns_character(character_id)
    and (
      cursed_body_technique_id is null
      or (
        status='approved'
        and exists(
          select 1
          from public.character_cursed_body_techniques cb
          where cb.id=abilities.cursed_body_technique_id
            and cb.character_id=abilities.character_id
            and cb.is_released
        )
      )
    )
  )
);

drop policy if exists "abilities_insert" on public.abilities;
create policy "abilities_insert" on public.abilities for insert to authenticated
with check (
  public.is_master()
  or (public.owns_character(character_id) and cursed_body_technique_id is null)
);

drop policy if exists "abilities_update" on public.abilities;
create policy "abilities_update" on public.abilities for update to authenticated
using (
  public.is_master()
  or (public.owns_character(character_id) and cursed_body_technique_id is null)
)
with check (
  public.is_master()
  or (public.owns_character(character_id) and cursed_body_technique_id is null)
);

drop policy if exists "abilities_delete" on public.abilities;
create policy "abilities_delete" on public.abilities for delete to authenticated
using (
  public.is_master()
  or (public.owns_character(character_id) and cursed_body_technique_id is null)
);

-- Corpo Amaldiçoado é extra narrativo: não disputa slots nem VP da build normal.
create or replace function public.enforce_approved_ability_budget()
returns trigger
language plpgsql
security definer set search_path=public
as $$
declare
  lvl int;
  used_slots int;
  used_vp int;
  vp_value int;
begin
  if new.cursed_body_technique_id is not null then return new; end if;
  if new.status <> 'approved' or new.limit_override then return new; end if;
  select level into lvl from public.characters where id=new.character_id;
  vp_value := coalesce(new.vp_approved,new.vp_estimated,1);
  if vp_value > public.ability_single_vp_limit(lvl,new.category) then
    raise exception 'Habilidade excede o VP máximo individual desta categoria no nível atual.';
  end if;
  select count(*), coalesce(sum(coalesce(vp_approved,vp_estimated)),0)
    into used_slots, used_vp
  from public.abilities
  where character_id=new.character_id
    and category=new.category
    and status='approved'
    and id<>new.id
    and not limit_override
    and cursed_body_technique_id is null;

  if used_slots + 1 > public.ability_slot_limit(lvl,new.category) then
    raise exception 'Quantidade de slots aprovada excederia o limite do personagem.';
  end if;
  if used_vp + vp_value > public.ability_vp_limit(lvl,new.category) then
    raise exception 'VP total aprovado excederia a capacidade da categoria.';
  end if;
  return new;
end;
$$;

-- Defesa adicional mesmo contra tentativas diretas fora da UI.
create or replace function public.protect_ability_insert()
returns trigger
language plpgsql
security definer set search_path=public
as $$
begin
  if new.cursed_body_technique_id is not null and not public.is_master() then
    raise exception 'Apenas o Mestre pode conceder habilidades de Corpo Amaldiçoado.';
  end if;
  if not public.is_master() then
    new.status := 'pending';
    new.vp_approved := null;
    new.limit_override := false;
    new.master_response := '';
  end if;
  return new;
end;
$$;

create or replace function public.protect_ability_update()
returns trigger
language plpgsql
security definer set search_path=public
as $$
begin
  if public.is_master() then return new; end if;
  if old.cursed_body_technique_id is not null or new.cursed_body_technique_id is not null then
    raise exception 'Habilidades concedidas pelo Corpo Amaldiçoado só podem ser alteradas pelo Mestre.';
  end if;
  if not public.owns_character(old.character_id) then raise exception 'Sem permissão.'; end if;
  new.vp_approved := old.vp_approved;
  new.limit_override := old.limit_override;
  new.master_response := old.master_response;
  if new.name is distinct from old.name
     or new.description is distinct from old.description
     or new.mechanics is distinct from old.mechanics
     or new.config is distinct from old.config
     or new.vp_estimated is distinct from old.vp_estimated then
    new.status := 'pending';
  else
    new.status := old.status;
  end if;
  return new;
end;
$$;

-- Liberar/retirar a Técnica do Corpo libera/retira todas as habilidades atuais do pacote.
-- Novas habilidades criadas enquanto a técnica já estiver liberada podem nascer approved.
create or replace function public.sync_cursed_body_release()
returns trigger
language plpgsql
security definer set search_path=public
as $$
begin
  new.updated_at := now();
  if new.is_released is distinct from old.is_released then
    if new.is_released then
      new.released_at := now();
      new.released_by := auth.uid();
    else
      new.released_at := null;
      new.released_by := null;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists sync_cursed_body_release_before on public.character_cursed_body_techniques;
create trigger sync_cursed_body_release_before
before update on public.character_cursed_body_techniques
for each row execute function public.sync_cursed_body_release();

create or replace function public.sync_cursed_body_abilities_release()
returns trigger
language plpgsql
security definer set search_path=public
as $$
begin
  if new.is_released is distinct from old.is_released then
    update public.abilities
    set status=case when new.is_released then 'approved' else 'disabled' end,
        master_response=case
          when new.is_released then 'Concedida pelo Mestre através da Técnica do Corpo.'
          else 'Acesso retirado pelo Mestre.'
        end,
        updated_at=now()
    where cursed_body_technique_id=new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists sync_cursed_body_release_after on public.character_cursed_body_techniques;
create trigger sync_cursed_body_release_after
after update of is_released on public.character_cursed_body_techniques
for each row execute function public.sync_cursed_body_abilities_release();

-- Auditoria para o Mestre poder rastrear quando a Técnica do Corpo foi alterada/liberada.
drop trigger if exists audit_character_cursed_body_techniques on public.character_cursed_body_techniques;
create trigger audit_character_cursed_body_techniques
after insert or update or delete on public.character_cursed_body_techniques
for each row execute procedure public.audit_row_change();

-- Limpeza defensiva: habilidade de corpo nunca pode ficar aprovada se a técnica estiver oculta.
create or replace function public.protect_cursed_body_ability_status()
returns trigger
language plpgsql
security definer set search_path=public
as $$
declare
  released boolean;
  body_character uuid;
begin
  if new.cursed_body_technique_id is null then return new; end if;
  select cb.is_released,cb.character_id into released,body_character
  from public.character_cursed_body_techniques cb
  where cb.id=new.cursed_body_technique_id;
  if body_character is null then raise exception 'Técnica de Corpo Amaldiçoado não encontrada.'; end if;
  if body_character is distinct from new.character_id then
    raise exception 'A habilidade corporal precisa pertencer ao mesmo personagem da Técnica do Corpo.';
  end if;
  if not coalesce(released,false) then
    new.status := 'disabled';
  end if;
  return new;
end;
$$;

drop trigger if exists protect_cursed_body_ability_status_trigger on public.abilities;
create trigger protect_cursed_body_ability_status_trigger
before insert or update of cursed_body_technique_id,status,character_id on public.abilities
for each row execute function public.protect_cursed_body_ability_status();
