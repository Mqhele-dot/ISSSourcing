$ErrorActionPreference = "Stop"

$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $RepoRoot

$localCache = Join-Path $RepoRoot ".npm-cache-local"
$electronCache = Join-Path $RepoRoot ".electron-cache-local"
$electronBuilderCache = Join-Path $RepoRoot ".electron-builder-cache-local"
$nodeModules = Join-Path $RepoRoot "node_modules"

Write-Host "Repairing Windows dependency install in $RepoRoot"
Write-Host "Using project-local npm cache: $localCache"
Write-Host "Using project-local Electron cache: $electronCache"
Write-Host "Using project-local Electron Builder cache: $electronBuilderCache"

if (Test-Path $nodeModules) {
  Write-Host "Removing node_modules..."
  Remove-Item -LiteralPath $nodeModules -Recurse -Force
}

if (Test-Path $localCache) {
  Write-Host "Removing stale local npm cache..."
  Remove-Item -LiteralPath $localCache -Recurse -Force
}

if (Test-Path $electronCache) {
  Write-Host "Removing stale local Electron cache..."
  Remove-Item -LiteralPath $electronCache -Recurse -Force
}

if (Test-Path $electronBuilderCache) {
  Write-Host "Removing stale local Electron Builder cache..."
  Remove-Item -LiteralPath $electronBuilderCache -Recurse -Force
}

$env:npm_config_cache = $localCache
$env:ELECTRON_CACHE = $electronCache
$env:electron_config_cache = $electronCache
$env:ELECTRON_BUILDER_CACHE = $electronBuilderCache

Write-Host "Installing dependencies with the local npm command..."
npm.cmd ci --no-audit --no-fund

$tscCmd = Join-Path $RepoRoot "node_modules\.bin\tsc.cmd"
$tsxCmd = Join-Path $RepoRoot "node_modules\.bin\tsx.cmd"
if (!(Test-Path $tscCmd) -or !(Test-Path $tsxCmd)) {
  throw "Dependency install did not create required TypeScript command shims."
}

Write-Host "Verifying install..."
npm.cmd run check

Write-Host "Dependency repair complete."
