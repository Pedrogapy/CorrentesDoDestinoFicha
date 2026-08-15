-- Correntes do Destino
-- Hotfix: corrige ambiguidade de encounter_id ao criar combate.
--
-- O nome da variavel PL/pgSQL era igual ao nome da coluna
-- combat_participants.encounter_id. Isso fazia:
-- ON CONFLICT (encounter_id, character_id)
-- falhar com "column reference encounter_id is ambiguous".

create or replace function public.create_combat_encounter_with_participants(
  p_name text,
  p_participants jsonb default '[]'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path=public
as $$
declare
  v_encounter_id uuid;
  item jsonb;
  cid uuid;
  skey text;
  vis boolean;
  tgt boolean;
begin
  if not public.is_master() then
    raise exception 'Somente o Mestre pode iniciar um combate.';
  end if;

  if nullif(trim(coalesce(p_name,'')),'') is null then
    raise exception 'Informe um nome para o combate.';
  end if;

  if jsonb_typeof(coalesce(p_participants,'[]'::jsonb)) <> 'array'
     or jsonb_array_length(coalesce(p_participants,'[]'::jsonb)) = 0 then
    raise exception 'Selecione pelo menos uma ficha para iniciar o combate.';
  end if;

  if exists(
    select 1
    from public.combat_encounters ce
    where ce.status='active'
  ) then
    raise exception 'Já existe um combate ativo. Encerre-o antes de iniciar outro.';
  end if;

  insert into public.combat_encounters(name,status)
  values(trim(p_name),'active')
  returning id into v_encounter_id;

  for item in
    select value
    from jsonb_array_elements(p_participants)
  loop
    begin
      cid := (item->>'character_id')::uuid;
    exception
      when invalid_text_representation then
        raise exception 'Uma das fichas selecionadas possui ID inválido.';
    end;

    if not exists(
      select 1
      from public.characters c
      where c.id=cid
    ) then
      raise exception 'Uma das fichas selecionadas não existe mais.';
    end if;

    skey := coalesce(nullif(item->>'side_key',''),'neutral');

    if skey not in ('ally','enemy','neutral') then
      raise exception 'Lado de combate inválido: %', skey;
    end if;

    vis := coalesce((item->>'visible_to_players')::boolean,true);
    tgt := coalesce((item->>'targetable_by_players')::boolean,true);

    insert into public.combat_participants(
      encounter_id,
      character_id,
      side_key,
      visible_to_players,
      targetable_by_players
    )
    values(
      v_encounter_id,
      cid,
      skey,
      vis,
      tgt
    )
    on conflict (encounter_id,character_id) do nothing;
  end loop;

  return v_encounter_id;
end;
$$;

revoke execute on function public.create_combat_encounter_with_participants(text,jsonb)
from public,anon;

grant execute on function public.create_combat_encounter_with_participants(text,jsonb)
to authenticated;
