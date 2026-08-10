Correntes do Destino - Hotfix da migration v0.8.1

Corrige o erro:
ERROR: Sem permissão. (SQLSTATE P0001)

Causa:
A migration atualizava public.abilities enquanto o trigger
protect_ability_update_trigger esperava um usuário autenticado no site.
Durante `supabase db push` não existe auth.uid(), então a própria migration
era rejeitada pelo mecanismo de proteção da ficha.

Correção:
A migration desativa SOMENTE protect_ability_update_trigger durante essa
atualização de dados e o reativa imediatamente depois. Nenhuma proteção
do site é removida permanentemente.

Substitua o arquivo da migration e execute novamente:
npx supabase@latest db push

Não crie migration nova e não rode SQL manual no banco para este erro.
