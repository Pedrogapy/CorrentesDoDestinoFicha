# Correntes do Destino — Ficha Digital

Projeto inicial do sistema próprio de TTRPG e da ficha digital da campanha **Correntes do Destino**.

## Stack

- Front-end: Vite + JavaScript puro
- Hospedagem: GitHub Pages
- Banco, autenticação, storage e realtime: Supabase
- Backup automático de sessão: Supabase Edge Function -> repositório privado no GitHub

## Recursos já presentes

- Login por nome de personagem + senha visível baseada no sobrenome
- Uma ficha principal por conta de jogador
- Níveis 1–100
- Atributos e perícias universais com compêndio dentro do site
- PS, EA, CA e PA calculados automaticamente
- CA calculada pela melhor defesa passiva entre **Força + Defesa**, **Destreza + Reflexos**, **Resistência + Fortitude** e **Conhecimento Amaldiçoado + Reforço**
- Redistribuição de atributos/perícias/crescimento fora de sessão
- XP único e botão de subir de nível
- Separação de Vigor e Reserva
- Técnica Amaldiçoada principal
- Criador de habilidades com estimativa de VP e aprovação do mestre
- Slots e limites de VP por categoria
- Habilidades gerais separadas da técnica
- Fichas-filhas para manifestações/invocações
- Votos vinculativos com bloqueio pelo mestre
- Dias livres, tickets de treino e progresso oculto exclusivo do mestre
- Notas/solicitações ao mestre para mudanças narrativas permanentes
- Equipamentos
- Compêndio de condições editável pelo mestre
- Segredos do personagem em tabela protegida por RLS
- NPCs, maldições e inimigos usando a mesma base da ficha
- Painel do mestre
- Sala de combate com recursos, rolagens e atualização realtime
- Rolagens de NPC/mestre ocultas dos jogadores no banco
- Histórico/auditoria
- Upload de imagem ou URL
- Exportação JSON por personagem
- Backup JSON completo em repositório GitHub privado ao iniciar/encerrar sessão
- Layout responsivo pensado também para celular

## Segurança importante

A chave pública/publishable do Supabase pode ser usada pelo front-end, desde que as tabelas estejam protegidas por RLS. **Nunca** coloque `service_role`, `secret key` ou token de escrita do GitHub no código, `.env` do Vite ou repositório público.

Os segredos do mestre ficam em `character_master_secrets` e `master_progress_tracks`, tabelas sem política de leitura para jogadores.

## Observações de design

- Grau Jujutsu é burocrático e separado do nível.
- A chave interna `cursed_control` é mantida por compatibilidade, mas o nome apresentado no sistema é **Conhecimento Amaldiçoado**.
- Kokusen não é habilidade aprendível. Apenas um 20 natural elegível pode gerar Kokusen.
- Crítico forçado continua sendo crítico, mas não vira Kokusen.
- A estrutura do banco já possui `campaigns.system_key` para facilitar outro sistema no futuro, mas a interface atual apresenta somente Correntes do Destino.
- O estimador de VP é propositalmente isolado em `src/lib/system.js`. Ele deve ser recalibrado depois de criar NPCs pelo próprio painel e testar o fluxo real.
- Conceitos narrativamente desconhecidos pelos jogadores não devem ser adicionados à interface pública só porque o banco é capaz de suportá-los futuramente.

## Teste rápido das fórmulas

```powershell
npm run test:system
```

Ele verifica builds neutras válidas nos níveis 1, 5, 25, 50, 75 e 100.

Leia também `COMANDOS_POWERSHELL.md` e `PROJECT_NOTES.md`.
