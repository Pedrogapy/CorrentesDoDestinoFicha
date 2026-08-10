Correntes do Destino - v0.7.3
Categorias de fichas + Maldição da Rua Sem Nome

MUDANÇAS DE INTERFACE
- Painel Mestre > Fichas por categoria:
  Players, NPCs, Maldições, Inimigos e Invocações/Fichas Filhas.
- Cada categoria possui uma cor própria.
- O seletor "Adicionar fichas" no combate também é separado pelas mesmas categorias.
- Nenhuma regra de personagem foi alterada por essa organização visual.

MALDIÇÃO DE TESTE
Arquivo:
  data/curses/maldicao-rua-sem-nome.json

Importar:
  node .\scripts\apply-curse.mjs .\data\curses\maldicao-rua-sem-nome.json

Remover depois:
  node .\scripts\apply-curse.mjs .\data\curses\maldicao-rua-sem-nome.json --remove

A ficha é uma conversão da Maldição da Rua Sem Nome / Maldição das Placas já enfrentada na campanha.
Versão de treino atual:
- Tipo: Maldição
- Grau: Grau 2
- Nível: 8
- PS: 80
- EA: 56
- PA: 3
- CA: 14

Ações:
- Corte de Placa: ataque de dano.
- Rua Errada: ataque que aplica Atordoado.
- Chamada Pelo Nome: teste resistido e -1 PA no próximo turno.
- Reflexo Que Atrasa: teste resistido e -2 em ataques temporariamente.
- Porta Que Não Abre: reação de redução de dano.

Equipamento:
- Conjunto de Placas em Branco, 3 cargas.
- Lugar Sem Nome: reação sem PA/EA que consome 1 carga e reduz o próximo dano em 1d4+1.

A ficha foi ajustada para funcionar como tutorial contra os jogadores de nível 5 sem arrastar excessivamente o combate.
O conceito original de três placas foi preservado como três cargas mecânicas para que o site consiga controlar o recurso automaticamente.

NÃO HÁ MIGRATION NOVA.
