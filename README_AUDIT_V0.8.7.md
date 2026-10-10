# Correntes do Destino — auditoria v0.8.7

Esta revisão trata o site como ferramenta de mesa, não apenas como formulário de banco.
O objetivo foi reduzir atrito cognitivo, alinhar livro e motor, evitar estados silenciosamente incorretos e fazer cada ficha carregar a identidade mecânica do personagem sem adicionar mensagens artificiais de “você é especial”.

## Erros e inconsistências corrigidos

- A versão exibida pelo frontend estava parada em 0.8.3 apesar das mecânicas posteriores. Atualizada para 0.8.7.
- O site chamava `cursed_control` de **Conhecimento Amaldiçoado**, enquanto o livro e as fórmulas atuais usam **Controle Amaldiçoado**. Padronizado.
- A perícia `defend` aparecia como **Defesa** em parte do código e **Defender** no livro. Padronizado como **Defender** sem alterar a chave técnica.
- `validateBuild` aceitava Crescimento negativo e valores fracionários em campos que são discretos. A validação agora rejeita nível, atributos, perícias e Crescimento inválidos de forma explícita.
- O estimador de VP podia cobrar duas vezes o mesmo benefício de confiabilidade (`no_attack_or_save` + ataque desativado) e podia somar faixa de crítico ampliada a crítico forçado, embora o segundo torne a primeira irrelevante. Corrigido.
- `upsertMasterProgress` não informava a chave única `(character_id,key)`, então “adicionar/atualizar” podia colidir em vez de atualizar. Corrigido com `onConflict` explícito.
- A tela de Testes do Mestre rolava para a entidade escolhida, mas não preservava a seleção e o histórico mostrava todas as entidades. Agora a seleção persiste e o histórico acompanha a ficha escolhida.
- Mudanças diretas em participante de combate (PS, EA, PA, lado, visibilidade e posição) podiam não atualizar imediatamente a tela dos jogadores porque o Realtime escutava apenas encontro e logs. `combat_participants` agora também dispara atualização.
- A interface dizia que uma ficha filha exigia Manifestação aprovada, porém o formulário permanecia habilitado. O backend já protegia a regra; a interface agora também a representa corretamente.
- Aprovação de habilidade era escrita diretamente da `main.js` no Supabase. Foi centralizada na camada `api.js`, com validação de estado.
- Upload de imagem agora valida tipo e tamanho antes de enviar ao Storage.
- O deploy do GitHub Pages fazia apenas build. Agora executa toda a suíte `npm test` antes de publicar.

## Navegação e leitura

### Jogadores
A navegação agora possui grupos claros: **Personagem**, **Mesa**, **Desenvolvimento** e **Consulta**. No celular, quatro destinos principais ficam fixos e os restantes entram em **Mais**, evitando uma barra horizontal com nove opções competindo entre si.

### Mestre
O antigo painel único foi dividido conceitualmente em:

- **Visão geral** — sessão e pendências;
- **Combate** — execução da cena;
- **Fichas** — elenco, criação, busca e edição;
- **Aprovações** — habilidades, equipamentos, treinos, votos, notas e condições;
- **Testes**, **Regras** e **Histórico** — consulta.

Isso evita que edição de NPC, encerramento de sessão, aprovação de habilidade e catálogo de condições disputem a mesma página.

## Fichas individuais

Cada ficha recebe uma assinatura visual determinística e discreta derivada da própria identidade da ficha. A cor aparece apenas em detalhes de borda, técnica e destaques. Os atributos e perícias mais altos recebem ênfase visual leve, sem rótulos ou mensagens dizendo que o personagem é “especial”. A individualidade emerge do que a própria ficha já contém.

## Combate

- O painel **Agora** deixa de ocupar a tela por padrão, mas abre automaticamente quando existe uma reação pendente.
- O histórico completo fica recolhido, separando o que está acontecendo **agora** do que já aconteceu.
- Realtime inclui atualizações de participantes, reduzindo telas defasadas durante ajustes do Mestre.
- A navegação e os controles mantêm o motor existente de PA, EA, defesa, reações, dados físicos, Undo, tabuleiro e ações improvisadas.

## PDF

Jogadores agora possuem **Baixar PDF** na própria ficha. O PDF é gerado inteiramente no navegador, sem enviar a ficha para um serviço externo e sem adicionar dependências. Ele inclui:

- identidade, nível e Grau;
- PS, EA, CA e PA;
- Técnica Amaldiçoada;
- atributos, perícias e Crescimento;
- habilidades visíveis;
- equipamentos visíveis;
- votos visíveis;
- história, personalidade, objetivos, aparência e notas.

O PDF usa a mesma assinatura de cor determinística da ficha e suporta os caracteres portugueses usados pelo sistema.

## Decisão de compatibilidade não alterada

O login por nome de personagem + senha visível continua existindo para não invalidar as contas atuais. O projeto historicamente sugere sobrenome como senha, o que é conveniente para uma mesa privada, mas não é uma política de senha forte. Uma futura troca para senhas próprias deve ser feita como migração de autenticação planejada, não silenciosamente dentro de uma revisão de interface.
