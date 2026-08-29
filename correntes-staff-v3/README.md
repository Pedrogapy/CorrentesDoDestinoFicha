# Correntes do Destino — Staff V3

Inclui Aventurine Tsukihara, Akane Kurogami, Haruki Kisaragi, Kiyomi Fushizato, Marcão e a atualização de Kento Nanami.

## Mecânicas adicionadas

- Proteções podem gerar um recurso especial para o personagem que originou o efeito. Aposta Fortificada usa isso para gerar Aposta Cega.
- Efeitos podem refletir uma porcentagem do dano final ao atacante. Selo de Retaliação usa 50%.
- A migration envolve o `resolve_combat_hit` do Staff V2; dados físicos e todas as regras anteriores são processados primeiro.

## Aplicação

Na raiz do projeto:

```powershell
powershell -ExecutionPolicy Bypass -File ".\correntes-staff-v3\APLICAR_STAFF_V3.ps1"
```

O importador autentica a conta normal de Mestre, mostra uma prévia, salva backup dos NPCs existentes e exige a confirmação `APLICAR`. Nanami é atualizado pelo nome, sem duplicação.

O pacote não faz `git push`.
