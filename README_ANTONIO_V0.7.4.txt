CORRENTES DO DESTINO — ANTONIO FAGULHAS / ESTILOS DE COMBATE v0.7.4

O QUE MUDA
- Adiciona suporte genérico a estilos/modos de combate mutuamente exclusivos.
- Antonio pode Invocar Pincel Mágico ou Assumir Postura de Luta no início do próprio turno, antes de agir.
- Técnicas de pintura ficam bloqueadas fora do Pincel Mágico.
- Golpes do estilo marcial ficam bloqueados fora da Postura de Luta.
- Mantém a lógica pública de Feiticeiro Híbrido como um estilo de combate, sem criar classe nova no sistema.
- Implementa Ritmo Híbrido 1x/combate entre os dois estilos.
- Implementa Sobrecarga de A Linha Que Separa com segundo alvo e metade do dano.
- Implementa Explosão Artística com seleção de múltiplos alvos e detonação manual no fim da rodada.
- Implementa Em Chamas com dano no início do turno e botão Apagar.
- Implementa As Setas Indicam a Direção como reação de +2 na rolagem de ataque mais recente.
- Implementa efeitos dos golpes Chute de Ruptura, Sequência Escaldante, Ponto de Ignição e Punho da Fornalha.
- Implementa Tecido de Desvio como reação 1x/combate que rerrola os dados do dano recém sofrido e mantém o segundo resultado.
- Adiciona data/players/antonio.json para sincronizar a conta/player já existente.

FICHA CONVERTIDA — NÍVEL 5
Atributos: 20/20
Perícias: 14/14
Crescimento: 5/5
PS 40 / EA 42 / PA 3 / CA 13

IMPORTANTE
- Pincel Mágico é uma manifestação/foco da própria técnica e NÃO é um item permanente do inventário nem consome Sintonia.
- Tecido de Desvio é o equipamento amaldiçoado confirmado no pacote e fica equipado no Corpo, consumindo 1 Sintonia.
- O pacote público contém apenas informações que podem ser vistas pelo jogador.
- Execute a sincronização fora de um combate ativo, pois replace_abilities substitui os IDs das habilidades de Antonio.

INSTALAÇÃO
1. Extraia o ZIP na raiz do projeto com -Force.
2. Rode: npx supabase@latest db push
3. Rode os node --check indicados no chat.
4. Rode: node .\scripts\check-antonio.mjs
5. Prévia: node .\scripts\apply-players.mjs .\data\players\antonio.json --dry-run
6. Aplicar: node .\scripts\apply-players.mjs .\data\players\antonio.json
7. Rode: npm run build
8. Teste localmente com npm run dev antes de publicar.
