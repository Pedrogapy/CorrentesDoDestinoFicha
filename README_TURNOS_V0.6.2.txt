CORRENTES DO DESTINO - CONTROLE DE TURNOS v0.6.2

Este patch deve ser aplicado POR CIMA da v0.6.1.

NOVO FLUXO
1. O Mestre adiciona os participantes e rola/permite rolar iniciativa.
2. Ninguém pode iniciar ataques/habilidades de turno ainda.
3. O Mestre clica em "Iniciar turno" no participante desejado.
4. O jogador recebe em tempo real: "Sua vez, NOME!" e suas ações são liberadas.
5. Reações dos outros participantes continuam funcionando fora do próprio turno.
6. O jogador ou o Mestre clica em "Encerrar turno" quando terminar.
7. O Mestre escolhe e inicia o próximo turno.

DESFAZER
- Iniciar turno é desfazível.
- Encerrar turno é desfazível.
- Encerrar turno não gasta PA/EA.
- Se "Encerrar turno" for desfeito, a entidade volta a estar em turno com o estado anterior restaurado.

REGRAS DE SEGURANÇA
- Só o Mestre inicia turnos, inclusive no banco/RPC.
- Ações normais fora do turno são recusadas pelo banco, não apenas escondidas pela interface.
- Defesa e contra-ataque continuam permitidos fora do turno.
- Não é possível avançar de turno com uma defesa pendente.

MIGRATION
202608090006_turn_control.sql

VERSÃO
Sistema 0.6.2
