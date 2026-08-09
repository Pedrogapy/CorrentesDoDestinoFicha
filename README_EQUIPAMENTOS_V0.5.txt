CORRENTES DO DESTINO - EQUIPAMENTOS E FERRAMENTAS AMALDIÇOADAS v0.5

Este patch pressupõe que o motor de combate v0.4 e o hotfix v0.4.1 já estejam instalados.

Arquivos alterados/adicionados:
- src/main.js
- src/styles.css
- src/lib/api.js
- src/lib/system.js
- src/lib/combat-ui.js
- src/lib/equipment-ui.js
- scripts/check-system.mjs
- supabase/migrations/202608090003_equipment_system.sql
- PROJECT_NOTES.md

Regras implementadas:
- Categorias: Arma, Amuleto/Acessório, Roupa/Armadura, Consumível, Outro.
- Perfis de arma: Leve 1d6/1 PA; Padrão 1d8/1 PA; Pesada 1d10/1 PA/2 mãos; Muito pesada 1d12/2 PA/2 mãos.
- Ataque físico básico da arma não consome VP.
- VP sobrenatural por grau: G4=2, G3=4, G2=6, G1=9, Especial=12 base.
- Grau não dá bônus automático de acerto.
- Arma amaldiçoada só pode gerar Kokusen se o usuário conduzir EA no golpe.
- Slots: mão principal, mão secundária, corpo, acessório 1, acessório 2.
- Ferramentas amaldiçoadas criadas por jogadores ficam pendentes até aprovação do Mestre.
- Efeitos: Passivo, Ativo, Reação, Ataque especial.
- Efeitos podem ter PA, EA, dano, condição, cargas e VP.
- Equipamentos aprovados/equipados aparecem no combate.
- Consumíveis aprovados podem usar efeitos diretamente do inventário.

Instalação:
1. Extraia este ZIP na raiz do projeto usando -Force.
2. Rode: npx supabase@latest db push
3. Rode: node --check nos JS e npm run build
4. Teste localmente com npm run dev
5. Se tudo estiver certo, git add/commit/push.
