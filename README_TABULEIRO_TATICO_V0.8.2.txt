CORRENTES DO DESTINO — TABULEIRO TÁTICO v0.8.2
=================================================

O QUE FOI ADICIONADO
- Plano quadriculado 14x10 em todo combate ativo.
- Mestre arrasta qualquer participante do combate para qualquer quadrado transitável.
- Alternativa para mouse/mobile: clicar na peça e depois no quadrado.
- Peças podem ser retiradas do plano sem sair do combate.
- Quadrados podem ser marcados como intransponíveis.
- Cada quadrado pode ter parede/passagem bloqueada em Norte, Leste, Sul e Oeste.
- Marcar a parede por um dos lados grava a mesma aresta para o quadrado vizinho.
- Players veem o mesmo plano em modo somente leitura.
- Participantes ocultos pelo Mestre não aparecem no plano dos players.
- Participantes visíveis mas não-alvejáveis continuam aparecendo no plano, com indicação visual.
- Peças adicionadas durante o combate entram na bandeja e podem ser posicionadas imediatamente.
- Posição acompanha atualizações Realtime.

REGRAS DE SEGURANÇA / SISTEMA
- Somente o Mestre pode mover peças, mesmo se um player manipular requests manualmente.
- Somente o Mestre pode editar terreno.
- A posição é armazenada em combat_participants, por encontro.
- O terreno é armazenado em combat_encounters, por encontro.
- O grid NÃO converte quadrados em metros e NÃO cobra PA automaticamente.
- O sistema de alcance continua narrativo. Isso evita quebrar habilidades já existentes.
- Paredes são armazenadas de modo estruturado para um futuro motor de movimento/pathfinding.

DESFAZER
- Mover uma peça é uma ação desfazível. O snapshot existente já captura todas as colunas de combat_participants, então board_x/board_y voltam junto.
- Editar parede/quadrado NÃO substitui a última ação desfazível. O terreno pode ser desmarcado diretamente pelo Mestre.
- A migration limpa snapshots antigos para não misturar layouts de schema entre versões.

INSTALAÇÃO
1) Extraia o ZIP na raiz do projeto.
2) Rode:
   npx supabase@latest db push
3) Valide:
   node --check .\src\lib\api.js
   node --check .\src\lib\combat-ui.js
   node --check .\src\lib\system.js
   node .\scripts\check-tactical-board.mjs
   npm run build
   npm run dev

TESTE RECOMENDADO
- Inicie combate com Jin, Aiko e Maldição da Rua Sem Nome.
- Arraste os três para o mapa.
- Mude para Editar terreno.
- Bloqueie um quadrado e marque uma parede.
- Volte para Mover peças e tente jogar uma peça no quadrado bloqueado: deve recusar.
- Mova Jin para outro quadrado e use Desfazer última ação: Jin deve voltar à posição anterior.
- Oculte a Maldição dos players: a peça deve sumir do tabuleiro da conta de Jin/Aiko sem perder sua posição para o Mestre.
- Revele novamente: ela deve reaparecer no mesmo quadrado.
- Adicione Souta durante o combate: ele deve aparecer na bandeja ainda sem posição.
