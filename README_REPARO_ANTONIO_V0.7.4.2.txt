Correntes do Destino — Reparo da conta de Antônio Fagulhas v0.7.4.2

Este reparo foi feito para o caso em que:
- a conta Auth canônica de Antônio foi recriada;
- a ficha antiga de Antônio ainda ficou ligada a um owner_id anterior;
- a primeira versão do script recusou sobrescrever essa relação.

O script novo é idempotente:
1. tenta entrar na conta Antônio Fagulhas / Fagulhas;
2. se ela já existe, reutiliza o Auth em vez de criar outra conta;
3. autentica o Mestre;
4. encontra a ficha antiga por nome normalizado (Antonio/Antônio);
5. se ela estiver ligada a outro owner_id, mostra os dois IDs e exige REASSOCIAR;
6. reassocia somente owner_id, preservando character.id, XP, histórico e relações;
7. sincroniza novamente atributos, perícias, habilidades e equipamentos do JSON instalado.

Não usa service_role e não exige migration.
