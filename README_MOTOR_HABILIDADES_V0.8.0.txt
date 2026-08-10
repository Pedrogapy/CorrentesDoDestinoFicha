CORRENTES DO DESTINO — MOTOR DE HABILIDADES ESTRUTURADAS v0.8.0
=================================================================

OBJETIVO
--------
Esta atualização deixa de tratar habilidades complexas como apenas "texto + botão".
O painel de combate passa a entender alvos, relações, reações, testes resistidos,
cura, Sobrecargas, segundo alvo, efeitos temporários, custos especiais e outros
parâmetros de forma estruturada, mantendo Desfazer última ação como proteção.

IMPORTANTE ANTES DE INSTALAR
----------------------------
Encerre qualquer combate de teste antes de aplicar/reimportar as fichas dos players.
O importador substitui as habilidades normais pelos registros corrigidos e elas
recebem novos IDs. Não apague contas de Authentication.

CORREÇÃO PRINCIPAL — A LINHA QUE SEPARA
---------------------------------------
Na v0.7.4 a habilidade já possuía no JSON a Sobrecarga de segundo alvo, mas o
controle dinâmico não era ligado depois que a tela de combate era renderizada.
Por isso o seletor "Execução" mudava para Sobrecarga, mas nenhum campo de segundo
alvo surgia.

Agora:
- Normal: um alvo.
- Sobrecarga: +3 EA e surge obrigatoriamente "Segundo alvo".
- O segundo alvo não pode ser o primeiro.
- Só aparecem inimigos válidos.
- O segundo alvo faz sua própria rolagem de ataque.
- No dano do segundo alvo, somente a soma dos DADOS recebe x0,5.
- Modificador e bônus fixos permanecem inteiros.
- Tudo é validado no servidor, não somente no HTML.

LADOS DO COMBATE
----------------
Cada participante agora possui um lado no encontro:
- Aliado
- Inimigo
- Neutro

O Mestre pode alterar o lado na ficha do participante durante o combate.
Isso é independente de a ficha ser Player, NPC, Maldição ou Inimigo.

Habilidades podem declarar:
- Inimigo
- Aliado
- Aliado ou próprio
- Somente próprio
- Qualquer participante

A interface filtra os alvos e o banco valida novamente a relação escolhida.

CONSTRUTOR DE HABILIDADES
-------------------------
O criador de habilidades foi ampliado. Descrição e Mecânica continuam sendo a
referência humana, mas agora existem campos estruturados para automação:

- executável ou não no painel de combate;
- reação fora do turno;
- relação de alvo;
- ataque: atributo + perícia;
- atributo e bônus fixo no dano;
- crítico e condução de EA;
- teste resistido;
- cura;
- dano próprio;
- consumo de recurso especial;
- 1x por rodada;
- 1x por combate por alvo;
- efeitos temporários;
- bônus de CA;
- bônus no próximo ataque;
- dano adicional;
- redução de dano;
- modificador de perícia;
- penalidade de PA;
- bloqueio de ações/reações;
- imunidade temporária;
- dano no início do turno / queimadura;
- efeito na ativação ou somente depois de acertar;
- resistência adicional ao efeito depois do acerto;
- Sobrecarga com PA/EA/dados/usos adicionais;
- Sobrecarga que exige segundo alvo;
- multiplicador separado dos dados e do modificador no segundo alvo.

Habilidades canônicas mais complexas podem continuar vindo de JSON/importação,
mas usam o MESMO motor e não um sistema paralelo.

AIKO TAKAHASHI
--------------
Escudo Temporal
- Reação real, inclusive fora do turno da Aiko.
- Alvo: Aiko ou aliado.
- 1 PA + 3 EA.
- Reduz o primeiro impacto físico/projétil em 1d6 + Mod. Controle Amaldiçoado.
- Sobrecarga +2 EA: duas reduções antes de expirar.

Regeneração Temporal
- 1 PA + 4 EA.
- Aiko ou aliado em toque.
- 1d6 + Mod. Controle Amaldiçoado de cura.
- Sobrecarga +3 EA: 2d6 + Mod.

Ataque Temporal
- Habilidade separada.
- 1 PA + 2 EA.
- Inimigo.
- Controle Amaldiçoado + Pontaria.
- 1d6 + Mod. Controle Amaldiçoado.

Interrupção Temporal
- Modo inimigo: teste resistido; falha causa suspensão e -1 PA no próximo turno.
- Resistência bem-sucedida ainda deixa desaceleração narrativa pela metade.
- Modo aliado: reação que suspende Aiko/aliado até o próprio turno e impede dano,
  cura, condições e alterações externas enquanto suspenso.

Costura do Acaso
- Reação de equipamento.
- 1x por rodada.
- Rerrola o 1 natural próprio mais recente elegível e mantém o segundo resultado.

KOTONE SHIOMI
-------------
Orfeu
- Continua como Ficha Filha de Manifestação.
- Não recebe turno independente.
- Agi, Dia, Pancada e Tarukaja ficam travados até Orfeu ser manifestado.

Agi / Pancada
- Miram somente inimigos.

Dia / Tarukaja
- Miram Kotone ou aliados.

Tarukaja
- Por 2 turnos, o primeiro ataque que ACERTAR em cada turno do alvo recebe +1d4.
- Não acumula consigo mesmo; reaplicar renova.

Guarda de Alcance I
- Reação, uso compartilhado 1x por combate.
- Escolhe +1 em Reflexos, Lutar ou Contra-Ataque no uso correspondente.

Teoria de Manifestação I
- Marcada explicitamente como capacidade fora da automação de combate.

Véu da Fortuna
- Reação 1x por combate.
- Quando um ataque superar a CA de Kotone, força nova rolagem de acerto.
- O segundo resultado é mantido.

JIN OKKOTSU
-----------
Coágulos
- Recurso real 3/3 no começo do combate.
- Criar 1: 1 PA + 1d4 PS.
- Sangue Perfurante, Sangue Explosivo e Armamento de Sangue consomem 1.

Sangue Perfurante
- 1 PA + 4 EA + 1 Coágulo.
- 1d6 + 2 + Mod. Controle Amaldiçoado.

Sangue Explosivo
- 1 PA + 7 EA + 1 Coágulo.
- 1d8 + Mod. Controle Amaldiçoado.

Armamento de Sangue
- Alvo próprio; nunca abre seletor de inimigo.
- Cria equipamento temporário real no inventário durante o combate.
- Leve: 1 PS.
- Padrão: 1d4 PS.
- Pesada: 1d6 PS.
- Muito Pesada: 1d8 PS.
- Duração: 1d4+2 turnos do criador.
- Acerto usa o melhor teste entre Canalização e Lutar.
- Dano usa o melhor modificador entre Controle Amaldiçoado, Destreza e Força.

Fluxo das Escamas Vermelhas
- Alvo próprio, sem seletor.
- 1 PA + 6 EA + 1d4 PS, 1x por combate.
- +1 CA, +2 em ataques físicos, +2 em Reflexos/Defender/Fortitude.
- 1x por rodada reduz dano físico em 1d6.

Circuito Hemático
- Continua Técnica do Corpo oculta e controlada somente pelo Mestre.

ANTÔNIO FAGULHAS
----------------
Pincel Mágico e Postura de Luta permanecem estilos mutuamente exclusivos.
Informações que o player não conhece NÃO estão no JSON público.

A Linha Que Separa
- Segundo alvo real corrigido nesta versão.

Explosão Artística
- Área com múltiplos inimigos escolhidos.
- Bomba preparada; somente uma ativa.
- Detonação manual no fim da rodada.
- Reflexos contra CD para metade.

Eu Pintei Eles Queimando
- Dano inicial e queimadura por 2 turnos.
- Reaplicar em alvo já queimando somente renova, sem repetir dano inicial.

As Setas Indicam a Direção
- Reação 1x por rodada.
- Só pode corrigir o ataque recente de Antônio ou de um aliado.
- +2 no acerto.
- Não corrige 1 natural.

Postura de Luta
- Mantém Golpe de Explosão, Chute de Ruptura, Sequência Escaldante,
  Ponto de Ignição e Punho da Fornalha.

Tecido de Desvio
- Rerrola o dano do ataque recém sofrido, 1x por combate, mantendo o segundo.

DESFAZER
--------
A atualização usa as mesmas mutações do motor de combate e continua protegida por
snapshots. A migration remove snapshots ANTIGOS incompatíveis com as duas colunas
novas de fator de dano. A partir da instalação, novos snapshots voltam a ser
capturados normalmente e incluem os campos novos via to_jsonb.

INSTALAÇÃO
----------
1) Encerre combate de teste ativo.
2) Faça backup Git.
3) Extraia o patch na raiz.
4) Rode: npx supabase@latest db push
5) Rode todos os check scripts.
6) Rode npm run build.
7) Reimporte TODOS os players em data/players.
8) Teste localmente antes do git push.

Se db push falhar, NÃO rode correções aleatórias. Copie o erro completo.
