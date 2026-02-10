#!/usr/bin/env bash
set -euo pipefail

if [ ! -d .git ]; then
  echo "Run this from repo root: cd /workspaces/ISSSourcing && ./scripts/dev-codespaces.sh"
  exit 1
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
API_DIR="$ROOT/services/api"
API_PY="$API_DIR/.venv/bin/python"
API_PIP="$API_DIR/.venv/bin/pip"
API_CONSTRAINTS="$API_DIR/constraints.txt"
API_VENDOR="$API_DIR/vendor"
API_REQS="$API_DIR/requirements-runtime.txt"

backend_deps_ok() {
  "$API_PY" -c "import fastapi, uvicorn; print('deps ok')" >/dev/null 2>&1
}

install_runtime() {
  if "$API_PIP" install -r "$API_REQS"; then
    "$API_PIP" install -e "$API_DIR" --no-deps --no-build-isolation
    return 0
  fi

  if [ -d "$API_VENDOR" ] && compgen -G "$API_VENDOR/*.whl" >/dev/null; then
    echo "==> Retrying runtime install from local vendor wheels"
    "$API_PIP" install --no-index --find-links "$API_VENDOR" -c "$API_CONSTRAINTS" -r "$API_REQS"
    "$API_PIP" install -e "$API_DIR" --no-deps --no-build-isolation
    return 0
  fi
  return 1
}

install_dev_tools_if_requested() {
  if [ "${SCT_DEV:-0}" = "1" ]; then
    "$API_PIP" install -c "$API_CONSTRAINTS" pytest ruff black || true
  fi
}

ensure_backend_deps() {
  cd "$API_DIR"
  if [ ! -d ".venv" ]; then
    python -m venv .venv
  fi

  if backend_deps_ok; then
    echo "==> Backend runtime deps already installed"
    install_dev_tools_if_requested
    return 0
  fi

  echo "==> Backend runtime dependency install"
  "$API_PY" -m pip install -U pip setuptools wheel || true
  if ! install_runtime; then
    echo "Backend deps could not be installed (likely proxy/index policy)."
    echo "Try API-only preview: services/api/scripts/preview_api.sh"
    echo "Or set PIP_INDEX_URL / NPM registry to your org mirror."
    exit 2
  fi

  install_dev_tools_if_requested
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
