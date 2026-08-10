# Correntes do Destino — Sincronização das fichas dos players

Este pacote preenche **Aiko Takahashi, Jin Okkotsu e Kotone Shiomi** nas contas/personagens que já existem no banco.

## O script NÃO faz

- não cria conta;
- não troca senha;
- não troca `owner_id`;
- não promove/rebaixa perfil;
- não apaga personagem;
- não usa `service_role`.

Ele autentica como a conta normal do Mestre e deixa RLS/triggers validarem os dados.

## Antes de aplicar

Não deixe um combate ativo usando habilidades desses players enquanto estiver sincronizando. O script substitui a lista de habilidades de cada player pelas habilidades declaradas nos JSONs para converter o kit antigo de forma limpa.

## Prévia sem alterar nada

```powershell
node .\scripts\apply-players.mjs .\data\players --dry-run
```

A prévia valida:
- 20 pontos de Atributo no nível 5;
- limite 5 por atributo;
- 14 pontos de Perícia;
- limite 3 por perícia;
- 5 pontos de Crescimento;
- slots e VP das habilidades.

## Aplicar as três fichas

```powershell
node .\scripts\apply-players.mjs .\data\players
```

Digite `SIM`, depois entre com a mesma conta de Mestre usada no site.

## Aplicar apenas uma ficha

```powershell
node .\scripts\apply-players.mjs .\data\players\aiko.json
node .\scripts\apply-players.mjs .\data\players\jin.json
node .\scripts\apply-players.mjs .\data\players\kotone.json
```

## Conversões importantes

### Aiko
- NÃO recebe Dez Sombras.
- Técnica atual: temporal.
- Escudo Temporal, Regeneração Temporal e o pacote Ataque/Interrupção Temporal foram organizados nos 3 slots de Técnica do nível 5.
- Costura do Acaso entra como roupa amaldiçoada Grau 4, Corpo, Sintonia 1.

### Kotone
- Persona continua sendo a Técnica base.
- Orfeu entra como **Manifestação**, mas **não recebe ficha filha** porque as Personas dela não possuem PS/PA/turno próprio.
- Pancada é a ação básica da própria Manifestação Orfeu.
- Agi, Dia e Tarukaja ocupam os 3 slots de Técnica.
- Guarda de Alcance I e Teoria de Manifestação I entram como Habilidades Gerais.
- Lança comum equipada na mão principal.
- Véu da Fortuna entra como roupa amaldiçoada Grau 4, Corpo, Sintonia 1.

### Jin
- Manipulação de Sangue usa 3 Coágulos máximos.
- Sangue Perfurante, Sangue Explosivo e Armamento de Sangue ocupam os 3 slots de Técnica.
- Fluxo das Escamas Vermelhas entra corretamente como Transformação.
- Circuito Hemático permanece registrado como desenvolvimento corporal, mas não foi dado como habilidade ativa porque a ativação completa ainda era uma trilha de treinamento, não uma aquisição confirmada.
- O contador de Coágulos ainda é manual: isso é uma lacuna real do motor atual e deve virar um recurso customizado depois.

## Automação parcial do combate

Ataques simples configurados nos JSONs são executados pelo motor atual.

Alguns efeitos antigos são mais complexos que o motor v0.6.2 e aparecem com a regra completa na ficha, mas exigem resolução manual por enquanto, por exemplo:
- cura;
- redução de dano de habilidade reativa;
- buffs temporários;
- congelamento temporal;
- criação de arma temporária;
- contador de Coágulos;
- bônus da Transformação.

Isso foi deixado explícito em cada texto para não fingir que o site automatiza algo que ainda não automatiza.
