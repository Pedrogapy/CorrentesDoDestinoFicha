CORRENTES DO DESTINO - EQUIPAMENTOS E FERRAMENTAS AMALDIÇOADAS v0.6

Este patch pressupõe que o v0.5 esteja instalado.

Arquivos alterados/adicionados:
- src/main.js
- src/lib/api.js
- src/lib/system.js
- src/lib/combat-ui.js
- src/lib/equipment-ui.js
- scripts/check-system.mjs
- supabase/migrations/202608090004_equipment_slots_attunement.sql
- PROJECT_NOTES.md

Regras implementadas:
- Mão principal/secundária são ocupação física, sem bônus de acerto.
- Slots corporais: Cabeça, Pescoço, Corpo, Braços/Pulsos, Cintura, Pés, Acessório 1 e Acessório 2.
- Acessórios podem ser vestíveis e, quando configurados, também podem funcionar segurados em uma mão.
- Sintonia limita itens amaldiçoados ativos: 3/4/5/6/7 nos grandes marcos de nível.
- Cada item amaldiçoado equipado consome 1 Sintonia, inclusive armas. Consumíveis e itens comuns não consomem.
- Arma Padrão: 1d8 com uma mão; 1d10 em um ataque com duas mãos se estiver na Mão principal e a secundária estiver livre.
- Pesada: 1d12 + Mod, 1 PA, 2 mãos.
- Muito pesada: 2d10 + Mod, 2 PA, 2 mãos.
- Leve: 1d6 + Mod, 1 PA, 1 mão.
- Botão para excluir equipamento com confirmação.
- Passivos possuem duração "Enquanto equipado" e não vêm marcados como condução de EA por padrão.
- Passivos de consumíveis não ficam ativos apenas por estarem no inventário.

Instalação:
1. Extraia este ZIP na raiz do projeto usando -Force.
2. Rode: npx supabase@latest db push
3. Rode os node --check e: node .\scripts\check-system.mjs
4. Rode: npm run build
5. Teste localmente com: npm run dev
6. Se estiver certo, commit/push.
