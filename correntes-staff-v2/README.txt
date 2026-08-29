CORRENTES DO DESTINO — STAFF V2 / MANDATO REAL

CORREÇÃO PRINCIPAL
- Daiki Arashiro agora é Nível 80.
- Atributos, perícias e Crescimento foram recalculados para caber nos limites reais do Nível 80.
- O Mandato Real agora possui mecânicas executáveis no motor de combate.
- Capacidades de Sakura, Sayuri e Akiya que antes estavam apenas registradas narrativamente agora possuem mecânicas quando o motor consegue representá-las corretamente.

MECÂNICAS NOVAS DO MOTOR
1. spatial_infinity
   - ataques não atravessam o Mugen/Infinito;
   - uma habilidade pode declarar bypass_spatial_infinity=true quando não depende de atravessar a distância.

2. blocks_cursed_abilities
   - bloqueia Técnica, Manifestação, Transformação e Domínio;
   - Habilidades Gerais e ataques básicos continuam permitidos.
   - usado por Mandato: Cale-se.

3. blocks_movement
   - impede mover a peça no Tabuleiro Tático.
   - usado por Ajoelhe-se, Pare e Vazio Imensurável.

4. royal_refusal
   - Mandato: Eu Recuso cancela um ataque já pendente;
   - o mesmo efeito também impede novas alterações externas durante sua curta duração.

MANDATO REAL
- Presença do Rei: teste resistido, penaliza ataque e CA.
- Ajoelhe-se: teste resistido, impede movimento/reação e penaliza ataque/CA.
- Quebre: ataque de Presença + Controle de Técnica, 6d10 + Presença; ignora defesa puramente espacial.
- Cale-se: teste resistido, bloqueia capacidades amaldiçoadas por 2 turnos.
- Pare: teste resistido, bloqueia ação, reação e movimento por 1 turno.
- Eu Recuso: reação 1x/combate que cancela o próximo ataque pendente e rejeita novas alterações externas enquanto durar.

OUTRAS CAPACIDADES AGORA MECÂNICAS
Sakura:
- Seis Olhos
- Mugen — Infinito
- Geodésica Curva
- Lente Espacial
- Vazio Imensurável

Sayuri:
- Passo de Baixa Pressão
- Olho da Tempestade

Akiya:
- Fluxo Constante de Reforço
- Comando: Ruptura
- Comando: Desdobrar

COMO USAR

Abra o PowerShell e volte para a raiz do projeto:

cd "C:\Users\warle\Downloads\correntes-do-destino-ficha-v0.1\correntes-do-destino-ficha"

Extraia este ZIP dentro dessa pasta. Depois rode:

powershell -ExecutionPolicy Bypass -File ".\correntes-staff-v2\APLICAR_STAFF_V2.ps1"

O instalador:
- exige o sistema v0.8.3;
- copia 202608280003_staff_mechanics_v084.sql para supabase/migrations;
- roda node --check;
- roda npx supabase@latest db push;
- autentica sua conta normal de Mestre;
- faz backup dos NPCs existentes antes de alterá-los;
- atualiza NPCs existentes pelo nome em vez de duplicá-los;
- não faz git push automaticamente.

DEPOIS, PARA VERSIONAR A MIGRATION:
git add "supabase/migrations/202608280003_staff_mechanics_v084.sql"
git commit -m "feat: mecanicas do staff e mandato real"
git push

OBSERVAÇÃO
A pasta do projeto que você vinha usando era:
C:\Users\warle\Downloads\correntes-do-destino-ficha-v0.1\correntes-do-destino-ficha
