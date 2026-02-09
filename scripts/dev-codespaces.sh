#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
API_DIR="$ROOT/services/api"
API_PY="$API_DIR/.venv/bin/python"
API_PIP="$API_DIR/.venv/bin/pip"

ensure_backend_deps() {
  cd "$API_DIR"
  if [ ! -d ".venv" ]; then
    python -m venv .venv
  fi

  echo "==> Backend dependency install"
  "$API_PY" -m pip install -U pip setuptools wheel || true
  if ! "$API_PIP" install -e ".[dev]"; then
    echo "Backend deps could not be installed (likely proxy/index policy)."
    echo "Try API-only preview: services/api/scripts/preview_api.sh"
    echo "Or set PIP_INDEX_URL / NPM registry to your org mirror."
    exit 2
  fi

  "$API_PY" -c "import fastapi; print('fastapi ok', fastapi.__version__)"
}

echo "==> Backend bootstrap"
ensure_backend_deps

cd "$API_DIR"
echo "==> Starting backend"
export PYTHONPATH=.
"$API_PY" -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000 &
API_PID=$!

trap 'kill $API_PID 2>/dev/null || true' EXIT

"$ROOT/scripts/wait-for.sh" "http://127.0.0.1:8000/health" 45

echo "==> Frontend bootstrap"
cd "$ROOT/apps/desktop/frontend"
if [ ! -d "node_modules" ]; then
  npm install
fi

echo "==> Reviewer instructions"
echo "1) Open the Codespaces Ports tab"
echo "2) Open port 5173 in browser"
echo "3) API is behind /api (no need to open 8000 directly)"
echo "Quick verification:"
echo "  curl -s http://127.0.0.1:8000/health"
echo "  curl -s http://127.0.0.1:8000/health/deep"
echo "UI URL format: https://<your-codespace-name>-5173.app.github.dev"

echo "==> Starting frontend"
npm run dev:codespaces
