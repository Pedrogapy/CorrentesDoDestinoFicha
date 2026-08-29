$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

if (-not (Test-Path -LiteralPath ".\package.json") -or -not (Test-Path -LiteralPath ".\supabase")) {
    throw "Execute este arquivo na raiz do projeto Correntes do Destino."
}

$Migration = ".\supabase\migrations\202608290001_staff_v3_mechanics_v085.sql"
$Importer = ".\correntes-staff-v3\apply-staff.mjs"
$Staff = ".\correntes-staff-v3\staff.json"

if (-not (Test-Path -LiteralPath ".\supabase\migrations\202608260001_physical_dice_v083.sql")) { throw "A migration de dados físicos v0.8.3 não foi encontrada." }
if (-not (Test-Path -LiteralPath ".\supabase\migrations\202608280003_staff_mechanics_v084.sql")) { throw "A migration do Staff V2 não foi encontrada." }
if (-not (Test-Path -LiteralPath $Migration)) { throw "A migration do Staff V3 não foi encontrada." }
if (-not (Test-Path -LiteralPath $Importer) -or -not (Test-Path -LiteralPath $Staff)) { throw "O pacote Staff V3 está incompleto." }

Write-Host "[1/4] Validando pacote..." -ForegroundColor Yellow
node --check $Importer
if ($LASTEXITCODE -ne 0) { throw "Falha de sintaxe no importador." }
node $Importer --validate-only
if ($LASTEXITCODE -ne 0) { throw "Falha na validação do Staff V3." }

Write-Host "[2/4] Executando testes..." -ForegroundColor Yellow
npm run test:system
if ($LASTEXITCODE -ne 0) { throw "Os testes falharam." }

Write-Host "[3/4] Aplicando migrations no Supabase vinculado..." -ForegroundColor Yellow
npx supabase@latest db push
if ($LASTEXITCODE -ne 0) { throw "db push falhou. Os NPCs não foram alterados." }

Write-Host "[4/4] Sincronizando Staff V3..." -ForegroundColor Yellow
node $Importer
if ($LASTEXITCODE -ne 0) { throw "A migration foi aplicada, mas a sincronização do Staff falhou." }

Write-Host "STAFF V3 CONCLUÍDO. Nenhum git push foi executado." -ForegroundColor Green
