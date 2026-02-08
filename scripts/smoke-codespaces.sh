#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
API_DIR="$ROOT/services/api"
API_PY="$API_DIR/.venv/bin/python"
API_PIP="$API_DIR/.venv/bin/pip"

echo "==> Backend no-deps smoke"
cd "$API_DIR"
if [ ! -d ".venv" ]; then
  python -m venv .venv
fi
PYTHONPATH=. "$API_PY" scripts/smoke_no_deps.py

echo "==> Backend tests"
"$API_PY" -m pip install -U pip setuptools wheel || true
"$API_PIP" install -e ".[dev]" || {
  echo "Dependency install blocked; run inside Codespaces or configure proxy"
  exit 2
}
"$API_PY" -c "import fastapi; print('fastapi ok', fastapi.__version__)" || {
  echo "FastAPI import failed after install"
  exit 2
}
PYTHONPATH=. "$API_PY" -m pytest -q

echo "==> Frontend typecheck/build (requires deps)"
cd "$ROOT/apps/desktop/frontend"
if [ ! -d "node_modules" ]; then
  npm ci || npm install || {
    echo "Dependency install blocked; run inside Codespaces or configure proxy"
    exit 2
  }
fi
npm run build || {
  echo "Frontend build failed; if network/proxy is restricted, configure npm proxy and retry"
  exit 2
}
