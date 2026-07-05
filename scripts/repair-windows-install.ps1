$ErrorActionPreference = "Stop"

$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $RepoRoot

$localCache = Join-Path $RepoRoot ".npm-cache-local"
$localElectronCache = Join-Path $RepoRoot ".electron-cache-local"
$localElectronBuilderCache = Join-Path $RepoRoot ".electron-builder-cache-local"
$nodeModules = Join-Path $RepoRoot "node_modules"
$requiredShimPaths = @(
  (Join-Path $RepoRoot "node_modules\.bin\tsc.cmd"),
  (Join-Path $RepoRoot "node_modules\.bin\tsx.cmd"),
  (Join-Path $RepoRoot "node_modules\.bin\vite.cmd")
)

function Test-RequiredInstallShims {
  foreach ($shimPath in $requiredShimPaths) {
    if (!(Test-Path $shimPath)) {
      return $false
    }
  }

  return $true
}

function Remove-TreeRobust {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$Label
  )

  if (!(Test-Path $Path)) {
    return
  }

  for ($attempt = 1; $attempt -le 3; $attempt++) {
    try {
      Remove-Item -LiteralPath $Path -Recurse -Force -ErrorAction Stop
      return
    } catch {
      if ($attempt -eq 3) {
        throw "Could not remove $Label at $Path after $attempt attempts. Close editors/terminals that may be holding files, then rerun this script."
      }

      Write-Host "$Label removal attempt $attempt failed; retrying..."
      Start-Sleep -Seconds (2 * $attempt)
    }
  }
}

function Invoke-NpmCiRepair {
  for ($attempt = 1; $attempt -le 2; $attempt++) {
    Write-Host "Installing dependencies with the local npm command (attempt $attempt/2)..."
    npm.cmd ci --no-audit --no-fund --cache $localCache --fetch-retries 5 --fetch-retry-factor 2 --fetch-retry-mintimeout 2000 --fetch-retry-maxtimeout 20000
    $exitCode = $LASTEXITCODE

    if ($exitCode -eq 0 -and (Test-RequiredInstallShims)) {
      return
    }

    if ($attempt -lt 2) {
      Write-Host "npm ci left a partial install or hit a transient network error; clearing node_modules and retrying once..."
      Remove-TreeRobust -Path $nodeModules -Label "node_modules"
    }
  }

  throw "Dependency install did not create required TypeScript/Vite command shims after retrying npm ci."
}

Write-Host "Repairing Windows dependency install in $RepoRoot"
Write-Host "Using project-local npm cache: $localCache"
Write-Host "Using project-local Electron cache: $localElectronCache"
Write-Host "Using project-local Electron Builder cache: $localElectronBuilderCache"

if (Test-Path $nodeModules) {
  Write-Host "Removing node_modules..."
  Remove-TreeRobust -Path $nodeModules -Label "node_modules"
}

if (Test-Path $localCache) {
  Write-Host "Removing stale local npm cache..."
  Remove-TreeRobust -Path $localCache -Label "local npm cache"
}

if (Test-Path $localElectronCache) {
  Write-Host "Removing stale local Electron cache..."
  Remove-TreeRobust -Path $localElectronCache -Label "local Electron cache"
}

if (Test-Path $localElectronBuilderCache) {
  Write-Host "Removing stale local Electron Builder cache..."
  Remove-TreeRobust -Path $localElectronBuilderCache -Label "local Electron Builder cache"
}

$env:npm_config_cache = $localCache
$env:npm_config_logs_dir = (Join-Path $localCache "_logs")
$env:electron_config_cache = $localElectronCache
$env:ELECTRON_CACHE = $localElectronCache
$env:ELECTRON_BUILDER_CACHE = $localElectronBuilderCache

Invoke-NpmCiRepair

Write-Host "Verifying install..."
npm.cmd run check

Write-Host "Dependency repair complete."
