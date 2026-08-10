CORRENTES DO DESTINO — COMBATE v0.8.1
Seleção inicial, pesquisa, entrada durante combate e visibilidade de alvos

O QUE ESTE PATCH RESOLVE

1. Jogadores voltam a receber alvos válidos corretamente.
   O problema anterior vinha de combat_participants ter RLS restrito à própria ficha: o player só recebia o próprio side_key e os demais alvos retornados pelo RPC acabavam tratados como neutros no navegador.

2. Antes de iniciar um combate, o Mestre agora escolhe as fichas que começam nele.
   O seletor é separado por Players, NPCs, Maldições, Inimigos e Invocações e possui pesquisa por nome.

3. O Mestre pode adicionar novas fichas durante um combate ativo.
   Isso serve para reforços, inimigos que aparecem depois, NPCs que entram na cena etc.

4. Cada participante do encontro possui dois controles independentes:
   - Visível aos players
   - Alvo válido para players

   Se Visível estiver desligado, a ficha não aparece na ordem de iniciativa do jogador nem em seletores de alvo.
   Se estiver Visível mas Alvo válido estiver desligado, ela aparece na iniciativa, porém não pode ser selecionada por jogadores.
   O Mestre continua podendo operar e selecionar todas as fichas.

5. A regra é validada no Supabase.
   Alterar o HTML ou chamar um RPC manualmente não permite que um player mire uma ficha que o Mestre não liberou.

6. Ataques comuns e armas permitem fogo amigo.
   Qualquer OUTRO participante visível e liberado pode ser alvo. A relação de lados continua existindo para habilidades que realmente exigem aliado ou inimigo.

7. Técnicas ofensivas comuns dos players foram ajustadas de "Inimigo" para "Qualquer outro participante".
   Isso inclui, entre outras, Sangue Perfurante, Sangue Explosivo, Ataque Temporal, Agi, Pancada e ataques do Antônio.
   Suportes e controles que possuem relação específica continuam respeitando-a.

8. A iniciativa do jogador ganhou uma lista segura.
   Ela mostra somente participantes que o Mestre revelou. Participantes ocultos não vazam pelo nome no histórico quando uma ação deles envolve o player; aparecem como "Entidade oculta" enquanto continuarem ocultos.

9. Realtime seguro.
   Outros combat_participants continuam protegidos por RLS. Um trigger apenas atualiza updated_at do encontro para avisar a UI de que ela deve refazer o RPC seguro. Assim, revelar/adicionar/rolar iniciativa atualiza os jogadores sem abrir os dados completos do participante.

INSTALAÇÃO

1. Faça backup/commit.
2. Extraia o ZIP por cima do projeto.
3. Rode:
   npx supabase@latest db push
4. Valide:
   node --check .\src\lib\combat-ui.js
   node --check .\src\lib\api.js
   node --check .\src\lib\system.js
   node .\scripts\check-system.mjs
   node .\scripts\check-player-mechanics.mjs
   node .\scripts\check-antonio.mjs
   node .\scripts\check-ability-engine.mjs
   node .\scripts\check-combat-visibility.mjs
5. Reaplique os players para sincronizar as relações ofensivas "other":
   node .\scripts\apply-players.mjs .\data\players
6. npm run build
7. npm run dev

TESTE RECOMENDADO

- Crie um combate novo.
- Selecione Jin, Aiko e Maldição da Rua Sem Nome antes de iniciar.
- Deixe os três Visíveis e Alvo válido.
- Na conta do Jin, a iniciativa deve listar os três e o golpe básico deve permitir selecionar Aiko OU a Maldição.
- Sangue Perfurante também deve permitir qualquer um dos dois.
- No Mestre, desligue Alvo válido da Maldição: ela continua na iniciativa, mas some dos seletores do Jin.
- Ligue de novo.
- Desligue Visível: ela some da iniciativa e dos seletores do Jin.
- Ligue Visível: ela reaparece sem recarregar manualmente a página.
- Adicione outro inimigo pelo botão "+ Adicionar personagens ao combate" no meio da luta.
