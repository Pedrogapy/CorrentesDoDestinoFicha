# Correntes do Destino — Players e mecânicas v0.7.1

Este pacote corrige e sincroniza **Aiko Takahashi, Kotone Shiomi e Jin Okkotsu** sobre as contas/personagens que já existem no banco.

## O que mudou no motor

- recursos especiais de combate, incluindo Coágulos;
- habilidades reativas utilizáveis fora do próprio turno;
- Sobrecargas/modos estruturados;
- alvo `Próprio` automático, sem seletor inútil;
- ficha filha de Manifestação com habilidades travadas até a invocação;
- efeitos temporários estruturados;
- Armamento de Sangue criando arma temporária real no inventário;
- Uniforme Okkotsu com efeitos reais;
- Técnica do Corpo Amaldiçoado criada e controlada exclusivamente pelo Mestre;
- Técnica do Corpo e habilidades corporais ficam invisíveis até a liberação do Mestre;
- habilidades corporais são extras de backstory e não consomem slots/VP normais.

## Aiko

- Escudo Temporal, Regeneração Temporal, Ataque Temporal e Interrupção Temporal são habilidades separadas.
- Escudo Temporal é reação e pode proteger outro personagem fora do turno da Aiko.
- Escudo Temporal possui Sobrecarga para um segundo impacto.
- Regeneração Temporal possui Sobrecarga Intensiva.
- Interrupção Temporal possui execução contra inimigo e execução reativa em aliado.

## Kotone

- Orfeu é uma **ficha filha de Manifestação**.
- Orfeu não ganha turno independente: ele representa a Persona ativa de Kotone.
- Agi, Dia, Pancada e Tarukaja pertencem à ficha filha e ficam travados até Orfeu ser manifestado.
- `Invocar Orfeu` usa alvo Próprio e libera esse conjunto durante o combate.

## Jin

- entra no combate com **3/3 Coágulos**;
- recarregar 1 Coágulo custa 1 PA + 1d4 PS;
- Sangue Perfurante, Sangue Explosivo e Armamento de Sangue descontam 1 Coágulo automaticamente;
- Fluxo das Escamas Vermelhas é alvo Próprio, sem seletor de alvo;
- Armamento de Sangue cria arma temporária real e permite escolher Leve/Padrão/Pesada/Muito Pesada;
- armas maiores custam mais PS para serem moldadas;
- Uniforme Okkotsu é equipado no Corpo e tem Munição de Sangue + Reposição Vital;
- Circuito Hemático é preparado no painel do Mestre como **Técnica do Corpo oculta**, sem liberar nada automaticamente.

## Técnica do Corpo Amaldiçoado

No painel do Mestre de qualquer personagem existe uma área exclusiva para:

1. criar uma Técnica do Corpo;
2. escrever descrição pública futura e notas privadas;
3. criar habilidades corporais;
4. manter tudo oculto;
5. liberar o pacote ao jogador quando a história justificar;
6. retirar o acesso novamente se necessário.

Enquanto oculta, a conta do jogador não consegue ler nem usar a Técnica do Corpo. Quando liberada, ela aparece na aba Habilidades e suas habilidades passam a funcionar no combate.

## Ordem de instalação

1. aplique as migrations v0.7.0 e v0.7.1 com `npx supabase@latest db push`;
2. rode `node .\scripts\check-system.mjs`;
3. rode `node .\scripts\check-player-mechanics.mjs`;
4. rode `node .\scripts\apply-players.mjs .\data\players --dry-run`;
5. se a prévia estiver correta, rode `node .\scripts\apply-players.mjs .\data\players`;
6. rode `npm run build` e `npm run dev`.

O importador não troca conta, senha, profile ou `owner_id`.
