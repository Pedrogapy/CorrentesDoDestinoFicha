# Auditoria Correntes do Destino — v0.8.8

Data: 10/10/2026. Base inicial inspecionada: `fb226a5` (main, v0.8.7). Integrados também os cinco commits posteriores de main, até `0668c96`. As correções de testes antigos e de `source-map-js` chegaram igualmente à main durante esta auditoria; foram reconciliadas, preservando as atualizações de Actions e o override de segurança.

A base já continha navegação agrupada, identidade visual por personagem e exportação PDF. Esta revisão verificou essas implementações, corrigiu problemas remanescentes e adicionou testes de comportamento. Não equivale a uma certificação de ausência de bugs.

## Resultado e escopo

- Auditoria de regras em `system.js`, chamadas em `api.js`, combate estruturado/improvisado, dados físicos, fichas, navegação, estilos, migrations e scripts de verificação.
- Correções incrementais, sem substituir modelos de dados, chaves das regras ou o motor de combate. Arquivos de migrations anteriores preservados.
- 17/17 scripts de verificação passam; inicialmente passavam 10/14.
- Build completo, inclusive com configuração fictícia do Supabase para impedir que código da aplicação seja eliminado como não utilizado, passa.
- Revisão visual em navegador Chromium com dados fictícios: ficha, combate e mestre; larguras 390 e 1440 px. Nenhuma rolagem horizontal indevida nem erro JavaScript nos cenários verificados.
- PDF de demonstração: 2 páginas. Teste de estresse: 7 páginas. Acentos, referências internas do arquivo e limites de página verificados; primeiras páginas renderizadas e inspecionadas visualmente.
- Sem uso de conta real de jogador, alteração de campanha, leitura de credenciais ou publicação automática em produção.

## Problemas corrigidos

| Prioridade | Problema observado | Correção e evidência |
|---|---|---|
| Alta | Helpers `security definer` de atributos, perícias e recursos podiam ser chamados diretamente por papéis públicos, contornando as projeções usadas pela interface. | Revogado EXECUTE direto de 11 helpers internos. RPCs autorizados continuam usando-os internamente. Testes SQL verificam privilégios e recusa de leitura direta. |
| Alta | Backup confiava em um comentário dizendo que o repositório deveria ser privado. | Verificação da propriedade `private` pela API antes de enviar qualquer snapshot ao GitHub; falha de verificação bloqueia envio. Teste com destino público e erro de API. |
| Alta | Backup não incluía ações, efeitos, uso de habilidades, Undo, técnicas corporais e dados reservados de habilidades. | Inventário ampliado para 26 tabelas; chaves de ordenação verificadas contra o esquema real das migrations. Filas efêmeras de dados físicos não são backup persistente. |
| Alta | Backup fazia uma única consulta por tabela, sujeita ao limite de linhas do serviço. | Leitura paginada até página vazia; teste recupera 1.205 registros mesmo quando o servidor retorna páginas menores que o solicitado. |
| Média | Contra-ataques eram truncados em 10d20 tanto no coletor físico quanto no PostgreSQL. | Removido o teto mecânico, mantendo 1d20 normal e maior/menor com vantagem/desvantagem. Testes de 12 dados físicos e 20 digitais; o 12º dado modifica o resultado esperado. |
| Média | Banco aceitava atributos ausentes, mas a interface rejeitava essa mesma ficha. | Novas fichas têm os oito atributos mínimos no padrão; validação rejeita objetos incompletos. Não reescreve fichas antigas. |
| Média | Catálogo SQL e documentação ainda usavam nomes diferentes dos exibidos no site. | `Controle Amaldiçoado` e `Defender` alinhados; chaves técnicas preservadas. Corrigida a nota que atribuía Defender à Resistência: o motor atual usa Força. |
| Média | Botões de atributos/perícias redesenhavam a ficha e apagavam textos ainda não salvos. | Modelo atualizado antes de redesenhar e durante a digitação. Teste altera nome/história, redistribui atributo e navega para outra aba e volta. |
| Média | Imagem escolhida se perdia quando o formulário era redesenhado. | Arquivo pendente associado ao modelo por WeakMap e nome da seleção mostrado após redesenho. |
| Média | Sem combate ativo, a tela deixava de escutar o início de um encontro ou sua reabertura. | Assinatura também escuta mudanças de encontros quando está aguardando. Teste de evento na sala vazia. |
| Média | Cada atualização recriava o canal Realtime, e timers antigos podiam disparar depois da saída. | Controlador reutiliza canal por contexto, agrupa eventos, serializa atualizações e cancela timers ao sair. Aguarda modais e campos em edição. Testes de reutilização, espera e cancelamento. |
| Média | Defesas pendentes podiam ficar dentro do histórico recolhido. | Reação pendente aparece em bloco destacado; controles correspondentes não são duplicados no histórico. Teste DOM verifica visibilidade estrutural e unicidade. |
| Média | Mapa grande precedia os controles principais; no celular exigia muita rolagem. | Mapa recolhível com resumo acessível, preservando tabuleiro e ferramentas. |
| Média | “Agora” sobrepunha a navegação inferior no celular. | Posicionamento acima da barra, considerando área segura. Verificação geométrica em navegador a 390 px. |
| Média | Painel “Agora” podia abrir automaticamente fora de uma defesa pendente. | Abertura automática exige ID de ação pendente; reações próprias seguem disponíveis no painel. |
| Média | Painel fechado ainda continha controles focáveis; diálogos não mantinham o foco do teclado. | `inert` no painel fechado, retorno de foco, ciclo de Tab nos diálogos, foco visível e `aria-current` na navegação. Preferência de movimento reduzido respeitada. |
| Média | PDF usava largura média de caractere e não quebrava títulos longos. | Métricas Helvetica por caractere, quebra de títulos e palavras longas, normalização de acentos e paginação. Teste de estresse renderizado sem extravasamento. |
| Média | Exportação pouco visível, estados de votos em inglês e URL do download revogada imediatamente. | Atalho no topo da ficha, estados traduzidos e revogação adiada. Exportação continua local, usando somente os registros acessíveis pela conta e o rascunho atual da ficha. |
| Média | Falha ao confirmar Undo depois de uma ação bem-sucedida descartava o snapshot e parecia uma falha da própria ação. | Snapshot preservado e mensagem explícita para não repetir a ação. Teste simula erro no commit. Não torna o protocolo inteiro transacional. |
| Média | Ajuste manual de recursos aceitava valores negativos/fracionários e podia deixar PS e derrota divergentes. | API da interface valida inteiros não negativos e sincroniza derrota ao alterar PS. Testes de rejeição, PS zero e recuperação. Exceções do mestre acima do máximo não foram removidas. |
| Média | Três testes exigiam v0.8.3 enquanto o aplicativo estava em v0.8.7; outro exigia cores diferentes para dois IDs que colidiam em uma paleta de oito cores. | Validação de versão semântica/coerência com pacote e teste de distribuição da paleta, sem exigir unicidade impossível. |
| Média | Dependência transitiva `source-map-js` vulnerável. | Atualizada para versão corrigida. Auditoria npm: zero vulnerabilidades conhecidas após atualização. |
| Média | Dependências `latest` e deploy com `npm install` tornavam a instalação variável. | Versões exatas, lockfile atualizado e `npm ci`. Workflow de PR testa e faz build sem publicar site. |
| Baixa | Estado de navegação de mestre podia permanecer inválido para jogador. | Aba validada contra destinos permitidos ao carregar o perfil. |
| Baixa | Pouco contraste em alguns rótulos e risco de nomes extensos romperem cartões. | Contraste de rótulos, quebra de texto e limites flexíveis ajustados. Inspeção visual local. |

## Compatibilidade e regras

- Preservados: PA/EA/PS, crítico versus Kokusen, perfis de armas, manifestação, estilos, recursos especiais, dados físicos/digitais, combate improvisado/estruturado, tabuleiro, RLS e projeções públicas.
- Fórmulas de PS, EA, PA e CA comparadas entre JavaScript e PostgreSQL nos níveis 1, 6, 7, 24, 25, 49, 50, 74, 75, 91, 99 e 100.
- Estimador de VP e a expressão “algumas rodadas” mantidos. Não foram inventados números de duração ou novos descontos de VP.
- Contra-ataques sem teto seguem a regra explícita recuperada da conversa anterior.
- O PDF completo do Livro do Jogador v0.8.6 não veio anexado nem está no repositório. A conferência usou regras do projeto, código vigente e o contexto recuperado da conversa. Não foi feita comparação página a página do livro.
- Individualidade visual continua derivada do ID da ficha, em detalhes de cor, monograma e destaques. Cores podem se repetir; não há mensagens declarando personagens “especiais”.

## Validações executadas

1. Instalação inicial com `npm ci --ignore-scripts` e auditoria de dependências.
2. `npm test`: 14 verificações iniciais, 4 falhas de testes identificadas; suíte final com 17 verificações aprovadas.
3. Novos testes DOM executam código real com rede substituída: rascunho, navegação, PDF disponível, 12d20 físicos, reação pendente, assinatura Realtime, erro de confirmação de Undo e ajustes de recursos.
4. PostgreSQL em memória (PGlite): aplicação de todas as migrations, paridade de fórmulas, permissões, RLS, nomes e tabelas de backup. Auth/Storage/publicação do Supabase são simulados pelo harness; não é teste do serviço hospedado.
5. Testes existentes de efeitos, visibilidade, habilidades, jogadores, staff, improvisação, tabuleiro, Controle de Mesa e Undo mantidos na suíte.
6. Build Vite sem configuração e com configuração fictícia do Supabase, sem chaves reais.
7. Browser local com dados fictícios: ficha desktop/mobile, navegação “Mais”, combate mobile, visão geral do mestre e combate do mestre; sem erro JavaScript, sem extravasamento horizontal, sem sobreposição da navegação pelo botão “Agora”.
8. PDF: estrutura xref e comprimentos de streams, português, assinatura determinística, extração e renderização. Nenhuma caixa de texto fora de página nos exemplos normal e de estresse.
9. `git diff --check` e inspeção das diferenças.

## Riscos e pendências explícitos

- **Produção:** a migration nova e a função `session-backup` precisam ser implantadas. Esta revisão não aplicou SQL no banco real nem publicou a função. Antes de implantação, é necessário testar em staging com duas sessões autenticadas e políticas/configuração reais do projeto.
- **Realtime hospedado:** comportamento do controlador foi testado, mas entrega de eventos, concessões por coluna, publicação e reconexão do Supabase real não foram validadas. Mantidos os sinais existentes pelo encontro.
- **Undo concorrente:** muitas ações ainda usam três requisições (snapshot, mutação e confirmação). Queda de rede ou ações simultâneas de clientes distintos podem produzir ambiguidades. A correção evita descartar snapshot após falha de confirmação, mas atomicidade completa exige uma revisão transacional por RPC. Falhas de rede durante a mutação também podem ter resultado desconhecido.
- **Backup consistente no tempo:** a paginação resolve truncamento; consultas de múltiplas tabelas ainda não constituem uma transação única. Para restauração estritamente consistente durante atividade intensa, usar snapshot transacional do banco.
- **Regras/livro:** falta o arquivo integral do livro atual para conciliação documental completa. A divergência histórica de Defender foi resolvida em favor do código/migration vigente, preservando a mecânica atual.
- **PDF:** exporta os máximos derivados da ficha, e não uma fotografia de recursos temporários da batalha. Não inclui retrato nem árvore de fichas-filhas em um único documento; cada ficha aberta pode ser exportada. Fontes padrão cobrem português/WinAnsi, mas caracteres fora desse conjunto (por exemplo, japonês e emojis) ainda são substituídos por `?`.
- **Legado:** fichas incompletas antigas não são reescritas automaticamente. Precisam receber os oito atributos válidos ao serem corrigidas; isso evita inventar distribuições ou alterar personagens em lote.
- **Segredos narrativos em arquivos:** o repositório é público e contém seeds e backups históricos de staff. RLS não protege arquivos Git. Os dois backups inspecionados tinham zero registros na lista `secrets`, mas contêm dados de fichas e habilidades. Adicionado ignore para novos backups; isso não remove arquivos já rastreados nem seu histórico. Não foi reescrita história Git ou apagado conteúdo da campanha.
- **Autenticação existente:** login derivado de nome/sobrenome foi preservado. Alterar esse esquema exige migração de contas e fluxo de recuperação; não foi feito nesta revisão.
- **Cobertura visual:** cenários locais representativos, sem certificação WCAG integral, teste com leitor de tela, todos os navegadores ou todos os personagens reais.

## Arquivos alterados

Frontend: `src/main.js`, `src/styles.css`, `src/lib/system.js`, `api.js`, `combat-ui.js`, `manual-dice.js`, `combat-live-panel.js`, `character-pdf.js`; novos `combat-realtime.js`, `dialog-focus.js`, `pdf-font-metrics.js`.

Banco/backup: `supabase/migrations/20261010031606_audit_consistency.sql`, `supabase/functions/session-backup/index.ts`, novo `snapshot.js`.

Testes: `scripts/check-all.mjs`, `check-ability-engine.mjs`, `check-character-pdf.mjs`, `check-combat-visibility.mjs`, `check-improvised-combat.mjs`, `check-tactical-board.mjs`, `check-ux-audit.mjs`; novos `check-audit-ui.mjs`, `check-audit-db.mjs`, `check-backup.mjs`, `scripts/lib/load-ui.mjs`.

Entrega/configuração: `package.json`, `package-lock.json`, `.gitignore`, `.github/workflows/deploy-pages.yml`, novo `.github/workflows/check.yml`, `README.md`, `PROJECT_NOTES.md`, este relatório.

## Aplicação da mudança

Revisar o PR, testar a migration em staging, verificar login mestre/jogador em paralelo, fazer backup privado e implantar a migration e a função atualizada antes da publicação do frontend. O workflow de PR não publica. O workflow existente publica Pages quando houver merge em `main`.

Referências técnicas consultadas: [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security) e [aviso de segurança da dependência](https://github.com/advisories/GHSA-68fv-2mgg-jv7q). A evidência principal deste relatório são o código e os testes locais descritos acima.
