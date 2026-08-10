Correntes do Destino - Hotfix v0.7.2.1

Corrige o erro PGRST201 ao carregar participantes do combate depois da adicao de active_summon_character_id.
O PostgREST passou a encontrar duas relacoes entre combat_participants e characters.
A consulta agora seleciona explicitamente a FK character_id:
combat_participants_character_id_fkey

Nao ha migration SQL neste hotfix.
