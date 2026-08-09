CORRENTES DO DESTINO - COMBATE v0.6.1

Este patch deve ser aplicado SOBRE a versão v0.6 de equipamentos.

Adiciona:
- botão "Desfazer última ação" no painel do Mestre;
- restauração integral de recursos e consequências da última ação;
- múltiplos undo sequenciais, um clique por ação;
- restauração de PS, EA, PA, condições, iniciativa, derrota, Fluxo Negro,
  contra-ataques, ações, rolagens e cargas de equipamentos;
- "Desfazer encerramento" caso o combate seja encerrado por engano;
- snapshots secretos no banco, inacessíveis a jogadores.

Migration nova:
supabase/migrations/202608090005_combat_undo.sql

Não substitui nem apaga combates existentes.
