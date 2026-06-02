param(
  [string]$NpmVersion = "10.9.2"
)

$ErrorActionPreference = "Stop"

$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $RepoRoot

$localCache = Join-Path $RepoRoot ".npm-cache-local"
$nodeModules = Join-Path $RepoRoot "node_modules"

Write-Host "Repairing Windows dependency install in $RepoRoot"
Write-Host "Using project-local npm cache: $localCache"

if (Test-Path $nodeModules) {
  Write-Host "Removing node_modules..."
  Remove-Item -LiteralPath $nodeModules -Recurse -Force
}

if (Test-Path $localCache) {
  Write-Host "Removing stale local npm cache..."
  Remove-Item -LiteralPath $localCache -Recurse -Force
}

$env:npm_config_cache = $localCache

Write-Host "Installing dependencies with npm@$NpmVersion..."
npx -y "npm@$NpmVersion" ci --no-audit --no-fund

Write-Host "Verifying install..."
npm run check

Write-Host "Dependency repair complete."
