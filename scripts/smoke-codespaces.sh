#!/usr/bin/env bash
set -euo pipefail

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

install_backend_editable() {
  if "$API_PIP" install -c "$API_CONSTRAINTS" -e ".[dev]"; then
    return 0
  fi
  if [ -d "$API_VENDOR" ] && compgen -G "$API_VENDOR/*.whl" >/dev/null; then
    "$API_PIP" install --no-index --find-links "$API_VENDOR" -c "$API_CONSTRAINTS" -e ".[dev]"
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

echo "==> Backend tests"
"$API_PY" -m pip install -U pip setuptools wheel || true
install_backend_editable || {
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
