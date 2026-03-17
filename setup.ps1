$ErrorActionPreference = "Stop"

Write-Host "[1/8] Move to worker directory" -ForegroundColor Cyan
Set-Location "$PSScriptRoot\worker"

Write-Host "[2/8] Install dependencies" -ForegroundColor Cyan
npm install

Write-Host "[3/8] Wrangler login (browser auth required)" -ForegroundColor Cyan
wrangler login

Write-Host "[4/8] Create Cloudflare resources" -ForegroundColor Cyan
try { wrangler d1 create mechanic-expense-db-v2 | Out-Null } catch { Write-Host "D1 already exists. Reusing." -ForegroundColor Yellow }
try { wrangler kv namespace create SESSIONS | Out-Null } catch { Write-Host "KV namespace already exists or create skipped. Reusing." -ForegroundColor Yellow }
try { wrangler r2 bucket create mechanic-expense-receipts | Out-Null } catch { Write-Host "R2 bucket already exists. Reusing." -ForegroundColor Yellow }

Write-Host "[5/8] Update worker/wrangler.toml IDs" -ForegroundColor Cyan
$d1List = wrangler d1 list --json | ConvertFrom-Json
$d1 = $d1List | Where-Object { $_.name -eq "mechanic-expense-db-v2" } | Select-Object -First 1
if (-not $d1) {
	throw "D1 database 'mechanic-expense-db-v2' was not found."
}
$d1Id = $d1.uuid

$kvList = wrangler kv namespace list | ConvertFrom-Json
$kv = $kvList | Where-Object { $_.title -eq "SESSIONS" } | Select-Object -First 1
if (-not $kv) {
	$kv = $kvList | Where-Object { $_.title -like "*-SESSIONS" } | Select-Object -First 1
}
if (-not $kv) {
	throw "KV namespace 'SESSIONS' was not found."
}
$kvId = $kv.id

Write-Host "Resolved D1 ID: $d1Id" -ForegroundColor DarkCyan
Write-Host "Resolved KV ID: $kvId" -ForegroundColor DarkCyan

$wranglerPath = Join-Path (Get-Location) "wrangler.toml"
$wranglerContent = Get-Content $wranglerPath -Raw
$wranglerContent = $wranglerContent.Replace("REPLACE_WITH_D1_DATABASE_ID", $d1Id)
$wranglerContent = $wranglerContent.Replace("REPLACE_WITH_KV_NAMESPACE_ID", $kvId)
Set-Content -Path $wranglerPath -Value $wranglerContent -Encoding UTF8

Write-Host "[6/8] Set required secrets" -ForegroundColor Cyan
$frontendOrigin = Read-Host "Enter FRONTEND_ORIGIN (e.g. https://<user>.github.io/<repo>)"
$jwtSecret = Read-Host "Enter JWT_SECRET random string"
$wranglerContent = Get-Content $wranglerPath -Raw
$wranglerContent = [regex]::Replace($wranglerContent, 'FRONTEND_ORIGIN\s*=\s*"[^"]*"', "FRONTEND_ORIGIN = `"$frontendOrigin`"")
Set-Content -Path $wranglerPath -Value $wranglerContent -Encoding UTF8
$jwtSecret | wrangler secret put JWT_SECRET

$discordWebhook = Read-Host "Enter DISCORD_WEBHOOK_URL (optional, empty to skip)"
if ($discordWebhook) {
	$discordWebhook | wrangler secret put DISCORD_WEBHOOK_URL
}

Write-Host "[7/8] Apply D1 migration" -ForegroundColor Cyan
wrangler d1 migrations apply mechanic-expense-db-v2

Write-Host "[8/8] Final reminder" -ForegroundColor Cyan
Write-Host "Set frontend/js/config.js API URL to your Workers URL before GitHub Pages release."
Write-Host "Setup completed successfully." -ForegroundColor Green
