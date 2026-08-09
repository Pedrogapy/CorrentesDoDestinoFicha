param(
  [Parameter(Mandatory=$true)][string]$ProjectUrl,
  [Parameter(Mandatory=$true)][string]$ServiceRoleKey,
  [Parameter(Mandatory=$true)][string]$CharacterName
)

$ErrorActionPreference = "Stop"

function Convert-ToLoginSlug([string]$Value) {
  $normalized = $Value.Normalize([Text.NormalizationForm]::FormD)
  $chars = New-Object System.Text.StringBuilder
  foreach ($ch in $normalized.ToCharArray()) {
    $category = [Globalization.CharUnicodeInfo]::GetUnicodeCategory($ch)
    if ($category -ne [Globalization.UnicodeCategory]::NonSpacingMark) {
      [void]$chars.Append($ch)
    }
  }
  $slug = $chars.ToString().ToLowerInvariant().Trim()
  $slug = [regex]::Replace($slug, '[^a-z0-9]+', '.')
  $slug = $slug.Trim('.')
  return $slug
}

$email = "$(Convert-ToLoginSlug $CharacterName)@example.com"
$headers = @{
  apikey = $ServiceRoleKey
  Authorization = "Bearer $ServiceRoleKey"
  "Content-Type" = "application/json"
}

Write-Host "Procurando usuÃ¡rio tÃ©cnico: $email" -ForegroundColor Cyan
$usersResponse = Invoke-RestMethod -Method Get -Uri "$ProjectUrl/auth/v1/admin/users?page=1&per_page=1000" -Headers $headers
$user = $usersResponse.users | Where-Object { $_.email -eq $email } | Select-Object -First 1

if (-not $user) {
  throw "UsuÃ¡rio nÃ£o encontrado. Entre/cadastre '$CharacterName' no site antes de promover a conta."
}

$body = @{ role = "master" } | ConvertTo-Json
$encodedId = [uri]::EscapeDataString($user.id)
Invoke-RestMethod -Method Patch -Uri "$ProjectUrl/rest/v1/profiles?id=eq.$encodedId" -Headers ($headers + @{ Prefer = "return=representation" }) -Body $body | Out-Null

Write-Host "Conta '$CharacterName' promovida para MESTRE." -ForegroundColor Green
Write-Host "Saia e entre novamente no site para atualizar a interface." -ForegroundColor Yellow
