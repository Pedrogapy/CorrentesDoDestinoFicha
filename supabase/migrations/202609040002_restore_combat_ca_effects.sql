-- Correntes do Destino — restaura bônus temporários na CA após o novo mapeamento defensivo
--
-- Mantém as relações canônicas:
--   Força                    -> Defesa
--   Destreza                 -> Reflexos
--   Resistência              -> Fortitude
--   Conhecimento Amaldiçoado -> Reforço
--
-- E preserva o comportamento anterior em que efeitos temporários estruturados
-- podem alterar a CA por meio de combat_effect_states.data.ca_bonus.

create or replace function public.combat_ca(p_character_id uuid)
returns int
language sql stable security definer set search_path=public
as $$
  select greatest(
    10 + public.combat_test_bonus(p_character_id,'strength','defend'),
    10 + public.combat_test_bonus(p_character_id,'dexterity','reflexes'),
    10 + public.combat_test_bonus(p_character_id,'resistance','fortitude'),
    10 + public.combat_test_bonus(p_character_id,'cursed_control','reinforcement')
  ) + coalesce((
    select sum(coalesce((s.data->>'ca_bonus')::int,0))
    from public.combat_effect_states s
    join public.combat_encounters e
      on e.id=s.encounter_id
     and e.status='active'
    where s.target_character_id=p_character_id
  ),0);
$$;

comment on function public.combat_ca(uuid) is
'CA = maior entre Força+Defesa, Destreza+Reflexos, Resistência+Fortitude e Conhecimento Amaldiçoado+Reforço, somada aos bônus temporários de CA de efeitos estruturados ativos.';
