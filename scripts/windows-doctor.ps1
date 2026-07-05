# Quick environment check for local development on Windows.
# Run from repo root: npm run doctor:win   OR   powershell -File scripts/windows-doctor.ps1

$ErrorActionPreference = "Continue"
$ok = $true

function Write-Ok($msg) { Write-Host "  [OK] $msg" -ForegroundColor Green }
function Write-Warn($msg) { Write-Host "  [!!] $msg" -ForegroundColor Yellow }
function Write-Bad($msg) { Write-Host "  [XX] $msg" -ForegroundColor Red }

Write-Host ""
Write-Host "ISS Sourcing - Windows local doctor" -ForegroundColor Cyan
Write-Host ""

# Node
try {
  $nodeV = node -v 2>$null
  if ($nodeV) {
    Write-Ok "Node $nodeV"
    $major = [int]($nodeV.TrimStart("v").Split(".")[0])
    if ($major -lt 22) {
      Write-Warn "Node 22.12+ recommended (see package.json engines)."
    }
  } else { throw "no node" }
} catch {
  Write-Bad "Node.js not found. Install LTS from https://nodejs.org/"
  $ok = $false
}

# npm
try {
  $npmV = npm.cmd -v 2>$null
  if ($npmV) { Write-Ok "npm $npmV" } else { throw "no npm" }
} catch {
  Write-Bad "npm not found."
  $ok = $false
}

# Git (optional)
try {
  $gitV = git --version 2>$null
  if ($gitV) { Write-Ok $gitV } else { Write-Warn "Git not in PATH (optional)" }
} catch {
  Write-Warn "Git not in PATH (optional)"
}

# .env
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
if (-not (Test-Path (Join-Path $root ".env"))) {
  Write-Warn "No .env in repo root. Copy .env.example to .env and set DATABASE_URL + SESSION_SECRET."
} else {
  Write-Ok ".env present"
}

# node_modules
$requiredShimPaths = @(
  (Join-Path $root "node_modules\\.bin\\tsc.cmd"),
  (Join-Path $root "node_modules\\.bin\\tsx.cmd"),
  (Join-Path $root "node_modules\\.bin\\vite.cmd")
)

if (-not (Test-Path (Join-Path $root "node_modules"))) {
  Write-Warn "node_modules missing - run: npm install"
  $ok = $false
} else {
  $missingShims = @($requiredShimPaths | Where-Object { -not (Test-Path $_) })
  if ($missingShims.Count -gt 0) {
    Write-Bad "node_modules is missing required command shims (tsc/tsx/vite). Run: npm run repair:win-install"
    $ok = $false
  } else {
    Write-Ok "node_modules present and command shims look complete"
  }
}

# PostgreSQL client hint (optional)
$pg = Get-Command psql -ErrorAction SilentlyContinue
if ($pg) {
  Write-Ok "psql found (optional CLI checks)"
} else {
  Write-Warn "psql not in PATH - OK if you use pgAdmin or Docker only"
}

# PostgreSQL port (default 5432)
try {
  $tcp = New-Object System.Net.Sockets.TcpClient
  $tcp.SendTimeout = 2000
  $tcp.ReceiveTimeout = 2000
  $tcp.Connect("127.0.0.1", 5432)
  if ($tcp.Connected) {
    Write-Ok "Port 5432 is open (PostgreSQL is likely running)"
  }
  $tcp.Close()
} catch {
  Write-Bad "Port 5432 refused - start PostgreSQL service or Docker, then: npm run db:push"
  $ok = $false
}

Write-Host ""
Write-Host "Next steps (see docs/WINDOWS-LOCAL-SETUP.md):" -ForegroundColor Cyan
Write-Host "  1. PostgreSQL running + database created"
Write-Host "  2. npm install"
Write-Host "  3. npm run db:push"
Write-Host '  4. npm run dev then open http://127.0.0.1:5000'
Write-Host ""

if (-not $ok) { exit 1 }
