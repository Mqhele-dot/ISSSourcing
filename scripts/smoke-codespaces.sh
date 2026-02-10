#!/usr/bin/env bash
set -euo pipefail

if [ ! -d .git ]; then
  echo "Run this from repo root: cd /workspaces/ISSSourcing && ./scripts/smoke-codespaces.sh"
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if ! "$SCRIPT_DIR"/validate-readme-commands.sh; then
  echo "README command validation failed; fix docs before running Codespaces smoke."
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
    "$API_PIP" install --no-index --find-links "$API_VENDOR" -c "$API_CONSTRAINTS" -r "$API_REQS"
    "$API_PIP" install -e "$API_DIR" --no-deps --no-build-isolation
    return 0
  fi
  return 1
}

echo "==> Backend no-deps smoke"
cd "$API_DIR"
if [ ! -d ".venv" ]; then
  python -m venv .venv
fi
PYTHONPATH=. "$API_PY" scripts/smoke_no_deps.py

echo "==> Backend runtime checks"
if ! backend_deps_ok; then
  "$API_PY" -m pip install -U pip setuptools wheel || true
  install_runtime || {
    echo "Dependency install blocked; run inside Codespaces or configure proxy"
    exit 2
  }
fi
"$API_PY" -c "import fastapi; print('fastapi ok', fastapi.__version__)" || {
  echo "FastAPI import failed after install"
  exit 2
}

if [ "${SCT_DEV:-0}" = "1" ]; then
  echo "==> Backend tests (SCT_DEV=1)"
  "$API_PIP" install -c "$API_CONSTRAINTS" pytest || true
  PYTHONPATH=. "$API_PY" -m pytest -q || {
    echo "Backend tests failed"
    exit 2
  }
else
  echo "==> Skipping backend pytest (set SCT_DEV=1 to enable)"
fi

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
