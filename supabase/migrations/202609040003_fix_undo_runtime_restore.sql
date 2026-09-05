-- Correntes do Destino — preservação completa do runtime no Undo
--
-- O Undo restaura combat_participants reinserindo os snapshots. O trigger
-- initialize_combat_runtime também roda em INSERT e estava sobrescrevendo
-- campos já presentes no snapshot (resources, turn_epoch, modo de combate etc.).
-- Esta migration adiciona um sinal transacional usado somente durante a
-- restauração para que o trigger preserve exatamente o estado capturado.

create or replace function public.initialize_combat_runtime()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare
  defs jsonb;
  etype text;
  item jsonb;
  res jsonb := '{}'::jsonb;
  k text;
  maxv int;
  startv int;
begin
  -- Durante Undo, todos os campos de NEW já vieram do snapshot e não devem
  -- ser reinicializados pelos defaults de entrada em combate.
  if coalesce(current_setting('cdd.restore_combat_snapshot', true),'off')='on' then
    return new;
  end if;

  select coalesce(c.special_resources,'[]'::jsonb), c.entity_type
  into defs, etype
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
  new.active_combat_mode := null;
  new.combat_mode_changed_epoch := -1;
  new.combat_mode_bonus_used := false;
  new.combat_bridge_used := false;
  new.combat_bridge_type := null;
  new.side_key := case
    when etype in ('player','npc','summon') then 'ally'
    when etype in ('curse','enemy') then 'enemy'
    else 'neutral' end;
  return new;
end;
$$;

-- Mantém o motor de Undo já consolidado pelas migrations anteriores intacto;
-- apenas o envolve com o sinal transacional de restauração.
do $$
begin
  if to_regprocedure('public.undo_last_combat_action_runtime_core(uuid)') is null then
    alter function public.undo_last_combat_action(uuid)
      rename to undo_last_combat_action_runtime_core;
  end if;
end $$;

revoke execute on function public.undo_last_combat_action_runtime_core(uuid)
from public,anon,authenticated;

create or replace function public.undo_last_combat_action(p_encounter_id uuid)
returns text
language plpgsql
security definer
set search_path=public
as $$
declare
  restored_label text;
begin
  perform set_config('cdd.restore_combat_snapshot','on',true);
  restored_label := public.undo_last_combat_action_runtime_core(p_encounter_id);
  perform set_config('cdd.restore_combat_snapshot','off',true);
  return restored_label;
end;
$$;

revoke execute on function public.undo_last_combat_action(uuid) from public,anon;
grant execute on function public.undo_last_combat_action(uuid) to authenticated;

comment on function public.undo_last_combat_action(uuid) is
'Desfaz a última ação preservando integralmente os campos de runtime capturados no snapshot.';
