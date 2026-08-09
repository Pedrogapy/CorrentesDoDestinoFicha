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

## Equipamentos e Ferramentas Amaldiçoadas - v0.6

Regras canônicas implementadas no site:

- Categorias: Arma, Amuleto/Acessório, Roupa/Armadura, Consumível e Outro.
- Ataque físico básico de uma arma não consome VP.
- Perfis: Leve 1d6/1 PA/1 mão; Padrão 1d8/1 PA e pode usar duas mãos no ataque para 1d10 se a mão secundária estiver livre; Pesada 1d12/1 PA/2 mãos; Muito pesada 2d10/2 PA/2 mãos.
- Mão principal e Mão secundária são slots físicos, sem bônus ou penalidade de acerto.
- Armas Pesadas/Muito Pesadas são equipadas na Mão principal e ocupam as duas mãos.
- Slots corporais: Cabeça, Pescoço, Corpo, Braços/Pulsos, Cintura, Pés, Acessório 1 e Acessório 2.
- Amuletos/acessórios podem funcionar vestidos; quando o item permite ser segurado, também podem ocupar Mão principal ou Mão secundária.
- Cada item amaldiçoado aprovado e equipado consome 1 Sintonia, inclusive armas. Consumíveis e itens comuns não consomem.
- Capacidade de Sintonia: 3 (Nv 1-24), 4 (25-49), 5 (50-74), 6 (75-99), 7 (100).
- VP de efeitos sobrenaturais: Grau 4=2, Grau 3=4, Grau 2=6, Grau 1=9, Grau Especial=12 base.
- O Grau não concede bônus automático para acertar.
- Item amaldiçoado criado por jogador fica pendente e precisa ser aprovado pelo Mestre.
- Apenas itens aprovados e equipados liberam ataques/passivos. Consumíveis aprovados podem usar efeitos ativos diretamente do inventário.
- Uma arma amaldiçoada não torna o ataque elegível a Kokusen automaticamente. O usuário pode conduzir +1 EA no ataque básico da arma para torná-lo elegível em 20 natural.
- Efeitos do item podem ser Passivo, Ativo, Reação ou Ataque especial, com VP, PA, EA, dano, condição e cargas.
- Passivos usam a duração própria "Enquanto equipado".
- Equipamentos podem ser excluídos pelo dono da ficha ou pelo Mestre, com confirmação na interface.
- O Mestre pode criar exceções narrativas de VP com override explícito.

## Desfazer ações de combate - v0.6.1

- O painel do Mestre possui **Desfazer última ação**.
- Antes de cada mutação relevante do combate é criado um snapshot; ele só vira desfazível se a ação terminar com sucesso.
- O Mestre pode desfazer várias vezes em sequência, sempre uma ação por vez (até 50 snapshots por combate).
- A restauração recupera: PS, EA, PA, condições, iniciativa, estado derrotado, contador de contra-ataques, Fluxo Negro, desconto de Fluxo Negro, ações, reações, rolagens e cargas de equipamentos consumidas.
- Ataque e defesa são passos separados: desfazer a defesa volta o ataque para `pending_defense`; desfazer novamente remove o ataque e devolve os custos dele.
- Encerrar combate também é desfazível. Se o Mestre encerrar sem querer, o painel sem combate ativo oferece **Desfazer encerramento** para reabrir o encontro no estado anterior.
- Apenas o Mestre pode restaurar snapshots. Jogadores podem gerar snapshots ao realizar suas próprias ações, mas não conseguem ler o conteúdo nem usar o undo.
- O undo não altera mudanças de inventário feitas fora do fluxo de combate (equipar/desequipar/excluir); ele restaura apenas cargas consumidas por ações de combate.
- Não existe "Refazer" nesta versão.
