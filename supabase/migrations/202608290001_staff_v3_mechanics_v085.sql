-- Correntes do Destino — Staff V3
-- Requer dados físicos v0.8.3 e Staff V2.
--
-- Acrescenta dois comportamentos genéricos a combat_effect_states.data:
-- * source_resource_gain_on_hit_key/source_resource_gain_on_hit:
--   um alvo protegido gera recurso para quem originou a proteção ao sofrer um golpe;
-- * damage_reflect_percent: reflete uma porcentagem do dano final ao atacante.
--
-- A função pública continua envolvendo o núcleo do Staff V2. Assim, a fila de
-- dados físicos, Mugen, Mandato Real, reduções e todos os cálculos anteriores
-- são resolvidos antes destes gatilhos.

do $$
begin
  if to_regprocedure('public.resolve_combat_hit(uuid,boolean)') is null then
    raise exception 'resolve_combat_hit atual não encontrado.';
  end if;
  if to_regprocedure('public.change_combat_resource(uuid,text,integer)') is null then
    raise exception 'Motor de recursos especiais não encontrado.';
  end if;
  if to_regprocedure('public.resolve_combat_hit_staff_v3_core(uuid,boolean)') is null then
    alter function public.resolve_combat_hit(uuid,boolean)
      rename to resolve_combat_hit_staff_v3_core;
  end if;
end $$;

revoke execute on function public.resolve_combat_hit_staff_v3_core(uuid,boolean)
from public,anon,authenticated;

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
  before_action public.combat_actions%rowtype;
  result public.combat_actions%rowtype;
  effect_rec public.combat_effect_states%rowtype;
  source_participant public.combat_participants%rowtype;
  attacker_participant public.combat_participants%rowtype;
  resource_key text;
  resource_gain int;
  reflected int;
  reflected_total int := 0;
begin
  select * into before_action
  from public.combat_actions
  where id=p_action_id;

  result := public.resolve_combat_hit_staff_v3_core(p_action_id,p_half);

  -- Somente um golpe que acabou de ser resolvido pode disparar os gatilhos.
  -- Chamadas repetidas, ataques defendidos/cancelados e ações sem alvo não geram nada.
  if before_action.id is null
     or before_action.status <> 'pending_defense'
     or result.status <> 'resolved'
     or result.target_character_id is null then
    return result;
  end if;

  -- Proteções podem conceder recurso ao personagem que criou o efeito.
  for effect_rec in
    select s.*
    from public.combat_effect_states s
    where s.encounter_id=result.encounter_id
      and s.target_character_id=result.target_character_id
      and nullif(s.data->>'source_resource_gain_on_hit_key','') is not null
      and coalesce((s.data->>'source_resource_gain_on_hit')::int,0)>0
      and (s.remaining_turns is null or s.remaining_turns>0)
      and (s.uses_remaining is null or s.uses_remaining>0)
    order by s.created_at
  loop
    select * into source_participant
    from public.combat_participants cp
    where cp.encounter_id=result.encounter_id
      and cp.character_id=effect_rec.source_character_id
    for update;

    if source_participant.id is not null then
      resource_key := effect_rec.data->>'source_resource_gain_on_hit_key';
      resource_gain := greatest(0,coalesce((effect_rec.data->>'source_resource_gain_on_hit')::int,0));
      if effect_rec.source_character_id=effect_rec.target_character_id then
        resource_gain := resource_gain + greatest(0,coalesce((effect_rec.data->>'source_resource_gain_on_hit_self_bonus')::int,0));
      end if;
      if resource_gain>0 then
        perform public.change_combat_resource(source_participant.id,resource_key,resource_gain);
      end if;
    end if;
  end loop;

  -- Reflexão usa o dano final já reduzido e não cria outra combat_action, evitando
  -- recursão, crítico, Kokusen ou novos gatilhos de acerto.
  if coalesce(result.damage_total,0)>0
     and result.attacker_character_id is not null
     and result.attacker_character_id is distinct from result.target_character_id then
    select * into attacker_participant
    from public.combat_participants cp
    where cp.encounter_id=result.encounter_id
      and cp.character_id=result.attacker_character_id
    for update;

    if attacker_participant.id is not null then
      for effect_rec in
        select s.*
        from public.combat_effect_states s
        where s.encounter_id=result.encounter_id
          and s.target_character_id=result.target_character_id
          and coalesce((s.data->>'damage_reflect_percent')::numeric,0)>0
          and (s.remaining_turns is null or s.remaining_turns>0)
          and (s.uses_remaining is null or s.uses_remaining>0)
        order by s.created_at
      loop
        reflected := greatest(0,floor(result.damage_total * least(100,(effect_rec.data->>'damage_reflect_percent')::numeric) / 100.0)::int);
        reflected_total := reflected_total + reflected;
        if effect_rec.uses_remaining is not null then
          update public.combat_effect_states
          set uses_remaining=greatest(0,uses_remaining-1)
          where id=effect_rec.id;
          if effect_rec.uses_remaining<=1 and coalesce((effect_rec.data->>'remove_when_empty')::boolean,true) then
            delete from public.combat_effect_states where id=effect_rec.id;
          end if;
        end if;
      end loop;

      if reflected_total>0 then
        update public.combat_participants
        set current_ps=greatest(0,current_ps-reflected_total),
            defeated=(greatest(0,current_ps-reflected_total)=0)
        where id=attacker_participant.id;

        update public.combat_actions
        set summary=concat_ws(' ',nullif(summary,''),'Selo de Retaliação refletiu '||reflected_total||' de dano ao atacante.'),
            updated_at=now()
        where id=result.id
        returning * into result;
      end if;
    end if;
  end if;

  return result;
end;
$$;

revoke execute on function public.resolve_combat_hit(uuid,boolean) from public,anon;
grant execute on function public.resolve_combat_hit(uuid,boolean) to authenticated;

-- Snapshots anteriores não documentam a nova semântica dos gatilhos.
delete from public.combat_undo_snapshots;

comment on function public.resolve_combat_hit(uuid,boolean)
is 'Motor v0.8.3 + Staff V2/V3: preserva dados físicos e aplica ganho de recurso da fonte e reflexão após o dano final.';
