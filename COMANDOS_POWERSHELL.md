# Comandos PowerShell — instalação e publicação

Os comandos abaixo assumem Windows + PowerShell e que você extraiu a pasta do projeto.

## 1. Abrir o projeto

```powershell
cd "C:\CAMINHO\correntes-do-destino-ficha"
code .
```

Confirme Node e Git:

```powershell
node --version
git --version
```

Se você usa GitHub CLI:

```powershell
gh --version
```

## 2. Instalar dependências e testar as fórmulas

```powershell
npm install
npm run test:system
```

## 3. Criar um projeto no Supabase

Abra o painel e crie um projeto gratuito:

```powershell
Start-Process "https://supabase.com/dashboard"
```

No painel, copie:

- Project URL
- Publishable key
- Project Ref

Para o login por nome de personagem funcionar sem uma caixa de e-mail real, vá em **Authentication > Providers > Email** e deixe o cadastro por senha ativo e a exigência de confirmação de e-mail desativada para este projeto fechado de RPG.

## 4. Criar o `.env`

Troque os dois valores:

```powershell
$SUPABASE_URL = "https://SEU-PROJECT-REF.supabase.co"
$SUPABASE_KEY = "sb_publishable_COLE_AQUI"

@"
VITE_SUPABASE_URL=$SUPABASE_URL
VITE_SUPABASE_PUBLISHABLE_KEY=$SUPABASE_KEY
"@ | Set-Content .env -Encoding UTF8
```

## 5. Rodar localmente

```powershell
npm run dev
```

O Vite vai mostrar o endereço local. Abra-o no navegador.

## 6. Aplicar banco de dados no Supabase

Login e vínculo com o projeto:

```powershell
npx supabase@latest login
npx supabase@latest projects list
$PROJECT_REF = "SEU_PROJECT_REF"
npx supabase@latest link --project-ref $PROJECT_REF
```

Aplicar a migration:

```powershell
npx supabase@latest db push
```

Deploy da função de backup sem depender de Docker:

```powershell
npx supabase@latest functions deploy session-backup --use-api
```

## 7. Criar o repositório do site

Faça login no GitHub CLI se necessário:

```powershell
gh auth login
```

Inicialize e publique:

```powershell
git init
git add .
git commit -m "feat: ficha Correntes do Destino v0.1"
git branch -M main

gh repo create CorrentesDoDestinoFicha --public --source=. --remote=origin --push
```

Pegue seu login do GitHub:

```powershell
$OWNER = gh api user --jq .login
$SITE_REPO = "CorrentesDoDestinoFicha"
```

Configure as variáveis públicas do build:

```powershell
gh variable set VITE_SUPABASE_URL --repo "$OWNER/$SITE_REPO" --body "$SUPABASE_URL"
gh variable set VITE_SUPABASE_PUBLISHABLE_KEY --repo "$OWNER/$SITE_REPO" --body "$SUPABASE_KEY"
```

Tente habilitar Pages usando workflow:

```powershell
gh api --method POST "repos/$OWNER/$SITE_REPO/pages" -f build_type=workflow
```

Se esse comando responder que Pages já existe, pode ignorar. Se a API não habilitar automaticamente, abra **Settings > Pages** do repositório e escolha **GitHub Actions** como fonte.

Depois faça um novo push para disparar o deploy:

```powershell
git add .
git commit -m "chore: configurar publicação" 2>$null
git push
```

Acompanhe:

```powershell
gh run watch --repo "$OWNER/$SITE_REPO"
```

## 8. Criar repositório PRIVADO de backups

O backup contém inclusive dados exclusivos do mestre, portanto use repositório privado.

```powershell
$BACKUP_REPO = "CorrentesDoDestinoBackups"
gh repo create "$OWNER/$BACKUP_REPO" --private --add-readme
```

Crie um Fine-grained Personal Access Token no GitHub com acesso somente a esse repositório e permissão **Contents: Read and write**. Depois:

```powershell
$GITHUB_BACKUP_TOKEN = Read-Host "Cole o token de backup do GitHub"

npx supabase@latest secrets set "GITHUB_TOKEN=$GITHUB_BACKUP_TOKEN"
npx supabase@latest secrets set "GITHUB_REPO=$OWNER/$BACKUP_REPO"
npx supabase@latest secrets set "GITHUB_BRANCH=main"
npx supabase@latest secrets set "GITHUB_BACKUP_PATH=backups/latest.json"
```

Republique a Edge Function depois dos secrets:

```powershell
npx supabase@latest functions deploy session-backup --use-api
```

## 9. Criar sua conta de mestre

Primeiro entre no site e use **Primeiro acesso** para cadastrar o nome que você quer usar como conta de mestre.

Depois existem duas opções.

### Opção A: PowerShell

No Supabase, copie a chave **service_role legada/JWT** apenas para essa operação local. Não salve essa chave no repositório.

```powershell
$SERVICE_ROLE = Read-Host "Cole a service_role do Supabase"

.\scripts\promote-master.ps1 `
  -ProjectUrl $SUPABASE_URL `
  -ServiceRoleKey $SERVICE_ROLE `
  -CharacterName "Pedro Mestre"
```

Troque `Pedro Mestre` exatamente pelo nome usado no cadastro. Saia do site e entre de novo.

### Opção B: SQL Editor

Abra `scripts/promote-master.sql`, ajuste o e-mail técnico e execute no SQL Editor do Supabase.

## 10. Criar o acesso de Jin para testar

Na tela do próprio site use:

```text
Personagem: Jin Okkotsu
Senha: Okkotsu
```

Use **Primeiro acesso** na primeira vez. Depois use **Entrar**.

## 11. Desenvolvimento normal depois disso

Abrir projeto:

```powershell
cd "C:\CAMINHO\correntes-do-destino-ficha"
code .
npm run dev
```

Publicar mudanças:

```powershell
git add .
git commit -m "update: ajustes do sistema"
git push
```

## 12. Se mudar o banco ou Edge Function

```powershell
npx supabase@latest db push
npx supabase@latest functions deploy session-backup --use-api
git add .
git commit -m "update: banco e função"
git push
```

## 13. Build local antes de publicar

```powershell
npm run test:system
npm run build
npm run preview
```

## Observação de segurança

Nunca coloque no `.env` do Vite, no GitHub Pages ou em arquivo versionado:

- service_role / secret key do Supabase
- token de escrita do GitHub

O front-end deve receber somente a URL e a publishable key do Supabase.
