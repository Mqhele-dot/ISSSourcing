#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
API_DIR="$ROOT/services/api"
UI_DIR="$ROOT/apps/desktop/frontend"
API_PY="$API_DIR/.venv/bin/python"
API_PIP="$API_DIR/.venv/bin/pip"

fail() {
  echo "verify-codespaces failed: $1"
  echo "next action: $2"
  exit 1
}

echo "==> environment"
hostname || true
node -v || true
python -V || true

cd "$API_DIR"
[ -d .venv ] || python -m venv .venv

echo "==> no-deps smoke"
PYTHONPATH=. "$API_PY" scripts/smoke_no_deps.py || fail "no-deps smoke failed" "Run PYTHONPATH=. $API_PY scripts/smoke_no_deps.py and inspect traceback"

echo "==> backend dependencies"
"$API_PY" -m pip install -U pip setuptools wheel || true
"$API_PIP" install -e ".[dev]" || fail "backend dependency install blocked" "Configure Codespaces proxy/index access for pip"
"$API_PY" -c "import fastapi; import uvicorn; import pydantic; print('deps ok')" || fail "python deps import check failed" "Verify pyproject dependencies and reinstall"

echo "==> backend tests"
PYTHONPATH=. "$API_PY" -m pytest -q || fail "backend tests failed" "Run PYTHONPATH=. $API_PY -m pytest -q and fix failing tests"

echo "==> frontend install/build"
cd "$UI_DIR"
npm ci || npm install || fail "frontend install failed" "Configure npm registry/proxy access"
npm run build || fail "frontend build failed" "Fix frontend compile/build errors"

echo "==> start backend and verify health"
cd "$API_DIR"
PYTHONPATH=. "$API_PY" -m uvicorn app.main:app --host 0.0.0.0 --port 8000 >/tmp/sct-api.log 2>&1 &
API_PID=$!
trap 'kill $API_PID 2>/dev/null || true' EXIT

"$ROOT/scripts/wait-for.sh" "http://127.0.0.1:8000/health" 45 || fail "health endpoint unavailable" "Inspect /tmp/sct-api.log"
"$ROOT/scripts/wait-for.sh" "http://127.0.0.1:8000/health/deep" 45 || fail "deep health endpoint unavailable" "Inspect /tmp/sct-api.log"

echo "==> verification complete"
echo "UI URL: https://<your-codespace-name>-5173.app.github.dev"
echo "API in browser is proxied as /api"
