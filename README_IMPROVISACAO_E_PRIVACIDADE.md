# Improvisação de combate e privacidade

Implementação local de 2 de setembro de 2026. As migrations devem ser aplicadas em ordem antes de usar esta versão da interface. Nenhuma migration foi aplicada ao banco remoto durante o desenvolvimento.

## Uso pelo Mestre

- **Inimigo** é uma ficha permanente na categoria Inimigos, reutilizável entre encontros. Nasce sem lore, técnica, biografia ou habilidades específicas. Atributos podem ser editados na ficha; PS, EA, PA e visibilidade continuam ajustáveis durante o combate.
- **Improvisação do Mestre** fica no painel de combate e serve para o Inimigo e demais participantes.
- **Ataque Improvisado** usa o participante do turno atual, custa 1 PA, rola o ataque pelo motor existente e permite as defesas habituais. O Mestre informa o dano base a cada uso; bônus e reduções existentes continuam válidos. Não existe dano fixo cadastrado.
- **Aplicar Dano**, **Curar/Restaurar** PS e **Alterar EA** são ajustes diretos, disponíveis sem turno ativo. Valores são limitados pelos recursos máximos e por zero. Dano direto não é um acerto: não dispara reações ou bônus de ataque.
- **Efeito Improvisado** permite condição existente ou nome/descrição temporários. Duração conta encerramentos de turno do alvo. Bônus de ataque e redução de dano consomem usos automaticamente; o Mestre também pode consumir usos ou remover o efeito. Os modificadores são escolhidos separadamente: selecionar uma condição não impõe mecânicas adicionais.
- **Ação Narrativa** exige somente texto público; alvo é opcional.

O campo Texto público aparece como escrito. A opção de publicar detalhes começa desmarcada. Efeitos têm controle separado de visibilidade. A interface não acrescenta nomes de fontes, habilidades ou configurações internas ao texto público. Na resolução de ataques, o alvo continua recebendo as informações necessárias para reagir.

## Persistência e Undo

As novas operações reutilizam `combat_participants`, `combat_actions`, `combat_effect_states`, `roll_logs` e o sistema existente de snapshots. Snapshot, operação e confirmação são transacionais nas ferramentas improvisadas. Falhas de validação não deixam ações ou snapshots parciais. Ataque e defesa continuam sendo passos separados no Undo.

As novas colunas de ações aceitam nulo para compatibilidade com snapshots anteriores. Nenhum histórico é apagado pelas migrations novas. A restauração não reinicializa recursos especiais, modos ou contadores de turno. Foi corrigido também o filtro que ignorava redução fixa de dano sem dados.

Mudanças em participantes, ações e efeitos sinalizam atualização pelo encontro. A interface refaz as consultas seguras, sem assinar registros privados de participantes no Realtime do player.

## Catálogo e sigilo

O catálogo possui 45 estados genéricos estáveis. O arquivo `data/system/conditions.json` é a referência editorial; `node scripts/sync-condition-catalog.mjs --check` confere sua correspondência com as migrations. Os sete estados originais mantêm as chaves. Textos corrompidos conhecidos são reparados por substituições exatas, preservando trechos já corretos. Novos registros particulares e registros autorais legados ficam restritos ao Mestre. Ampliar o catálogo público exige uma migration, não uma edição cotidiana de habilidade.

Foram conferidos 57 efeitos estruturados em nove arquivos de PCs, NPCs e inimigos. Cobertura inclui bloqueios de ação/reação/movimento, interferência de energia, suspensão, queimadura, bônus, escudos, redução, reflexão e mudanças de recursos. O mapa de auditoria fica em um script local de teste e não integra o catálogo público.

Proteções no banco:

- Efeitos brutos são master-only. O player recebe nome/descrição perceptíveis, duração e ações disponíveis, sem `source_id`, origem, `effect_key` ou `data` interno.
- Arrays legados de condições são projetados sem chaves autorais. Retornos de turnos usam a mesma proteção.
- Notas de técnica corporal não podem ser consultadas pelo player, inclusive após liberar a técnica.
- `master_secret` e metadados reservados de configurações são preservados em `ability_master_data`, com RLS exclusivo do Mestre; a separação também ocorre em novas importações antes de `RETURNING`.
- Auditoria pública não retorna cópias brutas de registros. Ações e alvos para reações removem nomes/IDs de origens ocultas. Retorno de defesa também passa pela projeção pública.
- Núcleos internos de resolução e restauração não são executáveis diretamente pelo cliente.

## Verificação local

- `npm test`: todos os checks existentes, catálogo, cobertura, integração PostgreSQL e formulários.
- `npm run test:combat`: integração e eventos dos formulários.
- `npm run build`: compilação de produção.

O banco de teste usa PostgreSQL em memória via PGlite, executando todas as migrations. Somente as interfaces de autenticação, armazenamento e publicação do Supabase são simuladas. Os testes assumem o papel `authenticated` e alternam Mestre/jogador; não validam RLS como superusuário. Dados físicos, efeitos, Undo e sinais de atualização são executados no banco. Entrega real de eventos pelo serviço hospedado de Realtime não é simulada.

Os formulários são testados em DOM local com happy-dom. A tentativa de inspeção visual pelo navegador do aplicativo falhou na inicialização do ambiente de navegador; não houve validação visual em sessão autenticada remota.

## Resultado da execução

- `npm test`: **11/11 checks aprovados**, incluindo **20 grupos de integração**, formulário das seis ferramentas e cobertura de 57 efeitos estruturados.
- `npm run build`: **aprovado**, 56 módulos compilados.
- `git diff --check`: **aprovado**.
- Git: **8 arquivos modificados e 11 novos**, sem alterações no stage, sem commit e sem push.
- Diff dos arquivos já rastreados: **205 inserções e 45 remoções**. Os arquivos novos incluem o catálogo, o módulo de improvisação, duas migrations, a documentação e os testes.

Saída de `git status --short --untracked-files=all`:

```text
 M package-lock.json
 M package.json
 M src/lib/api.js
 M src/lib/combat-ui.js
 M src/lib/manual-dice.js
 M src/main.js
 M src/styles.css
 M supabase/migrations/202608090001_initial_schema.sql
?? README_IMPROVISACAO_E_PRIVACIDADE.md
?? data/system/conditions.json
?? scripts/check-all.mjs
?? scripts/check-effect-coverage.mjs
?? scripts/check-improvised-combat.mjs
?? scripts/check-improvised-ui.mjs
?? scripts/lib/test-db.mjs
?? scripts/sync-condition-catalog.mjs
?? src/lib/improvised-combat.js
?? supabase/migrations/202609020001_improvised_combat.sql
?? supabase/migrations/202609020002_player_payload_privacy.sql
```
