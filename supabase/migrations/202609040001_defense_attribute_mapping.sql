-- Correntes do Destino — mapeamento defensivo 2026-09-04
--
-- Relações canônicas após a CA:
--   Força                    -> Defesa
--   Destreza                 -> Reflexos
--   Resistência              -> Fortitude
--   Conhecimento Amaldiçoado -> Reforço
--
-- A chave técnica `cursed_control` é preservada para não quebrar fichas,
-- habilidades, equipamentos e migrations existentes. Apenas o nome público
-- passa a ser Conhecimento Amaldiçoado.

update public.system_attributes
set name = 'Conhecimento Amaldiçoado',
    description = 'Conhecimento e domínio prático dos princípios da Energia Amaldiçoada, incluindo sua condução, aplicação e manipulação. Não representa o tamanho da reserva.',
    updated_at = now()
where key = 'cursed_control';

update public.system_skills
set name = 'Defesa',
    attribute_key = 'strength',
    description = 'Capacidade de bloquear, aparar ou interceptar fisicamente ataques utilizando força, postura, corpo, arma ou meio apropriado.',
    sort_order = 105,
    updated_at = now()
where key = 'defend';

-- CA canônica. Mantemos as chaves técnicas antigas para compatibilidade dos dados.
create or replace function public.combat_ca(p_character_id uuid)
returns int
language sql stable security definer set search_path=public
as $$
  select greatest(
    10 + public.combat_test_bonus(p_character_id,'strength','defend'),
    10 + public.combat_test_bonus(p_character_id,'dexterity','reflexes'),
    10 + public.combat_test_bonus(p_character_id,'resistance','fortitude'),
    10 + public.combat_test_bonus(p_character_id,'cursed_control','reinforcement')
  );
$$;

-- Compatibilidade com implementações históricas de resolve_combat_defense.
-- Algumas versões antigas chamam combat_test_bonus('resistance','defend').
-- Esse par antigo agora é interpretado como Força + Defesa, sem afetar
-- combinações alternativas explícitas que usem outra perícia.
create or replace function public.combat_test_bonus(
  p_character_id uuid,
  p_attribute_key text,
  p_skill_key text
)
returns int
language sql stable security definer set search_path=public
as $$
  select coalesce(
      public.combat_attribute_modifier(
        p_character_id,
        case
          when p_skill_key='defend' and p_attribute_key='resistance' then 'strength'
          else p_attribute_key
        end
      ),
      0
    )
    + coalesce(public.combat_skill_bonus(p_character_id,p_skill_key),0);
$$;

comment on function public.combat_ca(uuid) is
'CA = maior entre Força+Defesa, Destreza+Reflexos, Resistência+Fortitude e Conhecimento Amaldiçoado+Reforço.';
