# Importador de NPCs - Correntes do Destino

Ferramenta de desenvolvimento para aplicar NPCs diretamente no Supabase usando a **conta normal do Mestre**, sem `service_role`.

## Nanami incluído

`data/npcs/nanami.json` é uma adaptação demonstrativa de Kento Nanami para o sistema Correntes do Destino.

- NPC, Grau 1, Nível 20.
- Técnica da Proporção (7:3).
- Proporção 7:3 como habilidade de combate.
- Colapso como extensão de técnica em área.
- Voto Hora Extra.
- Lâmina embotada envolta em tecido como arma Padrão equipada na mão principal.

O nível 20 é uma decisão de balanceamento desta campanha, não uma classificação oficial de Jujutsu Kaisen.

## Aplicar

Na raiz do projeto:

```powershell
node .\scripts\apply-npc.mjs .\data\npcs\nanami.json
```

O script:

1. mostra uma prévia;
2. exige `SIM`;
3. pede o nome usado para entrar como Mestre;
4. pede a senha sem exibi-la;
5. confirma no banco que a conta possui `role = master`;
6. cria ou atualiza o NPC;
7. sincroniza apenas as habilidades/votos/equipamentos declarados no JSON;
8. equipa a arma usando a RPC normal de equipamentos.

Nenhuma chave `service_role` é usada ou salva.

## Remover o NPC de teste

```powershell
node .\scripts\apply-npc.mjs .\data\npcs\nanami.json --remove
```

Digite `REMOVER` quando solicitado. A exclusão do personagem remove suas dependências pela estrutura de `on delete cascade` do banco.

## Reexecutar

O importador procura o NPC por `entity_type + first_name + last_name`. Se encontrar exatamente um, atualiza a ficha em vez de duplicá-la. Para habilidades, votos e equipamentos do arquivo, substitui apenas entradas com os mesmos nomes.

Isso permite editar `data/npcs/nanami.json` e executar o comando novamente para experimentar balanceamento.
