$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

Write-Host ""
Write-Host "=====================================================" -ForegroundColor Cyan
Write-Host " CORRENTES DO DESTINO - STAFF V2 / MANDATO REAL" -ForegroundColor Cyan
Write-Host "=====================================================" -ForegroundColor Cyan
Write-Host ""

if (-not (Test-Path ".\package.json") -or -not (Test-Path ".\src") -or -not (Test-Path ".\supabase")) {
    throw "Execute este arquivo na raiz do projeto CorrentesDoDestinoFicha."
}

$PatchDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$MigrationSource = Join-Path $PatchDir "202608280003_staff_mechanics_v084.sql"
$MigrationTarget = Join-Path (Get-Location) "supabase\migrations\202608280003_staff_mechanics_v084.sql"
$Importer = Join-Path $PatchDir "apply-staff.mjs"
$PhysicalDiceMigration = Join-Path (Get-Location) "supabase\migrations\202608260001_physical_dice_v083.sql"

if (-not (Test-Path $PhysicalDiceMigration)) {
    throw "Este pacote espera o sistema v0.8.3. Nao encontrei 202608260001_physical_dice_v083.sql."
}
if (-not (Test-Path $MigrationSource)) { throw "Migration do Staff V2 nao encontrada." }
if (-not (Test-Path $Importer)) { throw "Importador do Staff V2 nao encontrado." }

Write-Host "[1/4] Copiando migration de mecanicas..." -ForegroundColor Yellow
Copy-Item $MigrationSource $MigrationTarget -Force
Write-Host "OK: $MigrationTarget" -ForegroundColor Green

Write-Host ""
Write-Host "[2/4] Validando importador..." -ForegroundColor Yellow
node --check $Importer
if ($LASTEXITCODE -ne 0) { throw "Falha no node --check." }
Write-Host "Importador valido." -ForegroundColor Green

Write-Host ""
Write-Host "[3/4] Aplicando migration no Supabase..." -ForegroundColor Yellow
npx supabase@latest db push
if ($LASTEXITCODE -ne 0) {
    throw "db push falhou. Os NPCs ainda nao foram alterados."
}
Write-Host "Banco atualizado." -ForegroundColor Green

Write-Host ""
Write-Host "[4/4] Atualizando/criando o Staff..." -ForegroundColor Yellow
node $Importer
if ($LASTEXITCODE -ne 0) {
    throw "A migration foi aplicada, mas a sincronizacao do Staff falhou. Leia o erro acima antes de tentar novamente."
}

Write-Host ""
Write-Host "STAFF V2 CONCLUIDO." -ForegroundColor Green
Write-Host "Daiki agora e Nv. 80 e as mecanicas avancadas estao ativas." -ForegroundColor Green
Write-Host ""
Write-Host "Nenhum git push foi feito automaticamente." -ForegroundColor DarkGray
