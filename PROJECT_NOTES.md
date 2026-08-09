# Notas de continuidade do projeto

Este arquivo existe para reduzir perda de intenção caso o desenvolvimento continue em outro chat.

## Regras centrais atuais

- Sistema reconstruído do zero, reaproveitando conceitos já existentes da campanha.
- d20 como dado principal.
- Nível máximo: 100. O nível 100 é reservado a entidades do extremo do cenário; personagens importantes conhecidos não precisam chegar perto disso.
- PCs atuais entram no novo sistema no nível 5.
- Grau Jujutsu é classificação burocrática/narrativa, não calculada pelo nível.
- Sem classes.
- Respec de pontos distribuíveis é permitido fora de sessão e bloqueado durante sessão ativa.
- Modificações permanentes concedidas pelo mestre ficam separadas da distribuição normal.

## Atributos

1. Força
2. Destreza
3. Resistência
4. Inteligência
5. Percepção
6. Vontade
7. Presença
8. Controle Amaldiçoado

Fórmula de teste: `1d20 + floor(Atributo/2) + Perícia`.

## Defesa

CA é o maior valor entre:

- `10 + Mod. Destreza + Reflexos`
- `10 + Mod. Resistência + Defender`
- `10 + Mod. Resistência + Fortitude`
- `10 + Mod. Controle Amaldiçoado + Reforço`

Se o ataque superar a CA, o alvo pode gastar PA em uma reação válida. Contra-ataque exige gasto adicional e acumula dados de desvantagem a cada nova tentativa antes do próximo turno.

## Crítico e Kokusen

- 20 natural é crítico.
- Apenas 20 natural pode tornar o golpe elegível a Kokusen.
- Crítico forçado, faixa de crítico ampliada ou técnica que force crítico NÃO gera Kokusen por si só.
- Kokusen não é aprendido.
- Uma defesa crítica adequada pode negar o Kokusen.

## Progressão atual

- XP único.
- XP para próximo nível: `100 + 25 * nível atual`.
- Atributos disponíveis: `15 + nível`.
- Perícias disponíveis: `9 + nível`.
- Crescimento: `nível` pontos divididos entre Vigor e Reserva.
- PA: 3 (1–24), 4 (25–49), 5 (50–74), 6 (75–99), 7 (100).
- PS: `18 + 2*nivel + 2*Resistência + 2*Vigor + bônus permanente`.
- EA: `18 + 2*nivel + 2*Controle Amaldiçoado + 2*Reserva + bônus permanente`.

## Tempo livre

Ao encerrar sessão, o mestre concede XP e dias livres individualmente. O jogador deposita dias em atividades por ticket. Ele NÃO vê quanto falta para uma recompensa oculta. O mestre possui trilhas de progresso invisíveis ao jogador. Dias não comprometidos são expirados quando a próxima sessão começa.

## Votos vinculativos

Estados:

- pending
- active
- player_disabled
- master_locked
- available_reactivation
- rejected

Jogador pode desativar um voto ativo ao perceber que o quebrou. Se o mestre bloquear, o jogador não consegue reativá-lo até liberação do mestre. A proteção existe no banco, não só no botão da interface.

## Segredos

Nunca colocar informações que somente o mestre pode conhecer em `characters`, HTML escondido, atributos `data-*` ou JSON enviado ao cliente. Usar tabelas master-only com RLS.

## Domínios e sistemas ainda secretos

Expansões de domínio são desenvolvimento narrativo/técnico e não são dadas automaticamente por nível. Não expor ao jogador recursos/conceitos que ele ainda não conhece apenas para mostrar que "existe algo bloqueado".

## Fase de testes

Depois do site funcionar, criar **Souta Minazuki** pelo próprio painel do mestre como primeiro teste completo do criador de NPCs. Não inserir a ficha dele manualmente no banco só para contornar problemas: qualquer incômodo encontrado deve ser corrigido no criador/sistema.
