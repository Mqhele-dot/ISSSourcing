#!/usr/bin/env bash
set -euo pipefail

if [ ! -d .git ]; then
  echo "Run this from repo root: cd /workspaces/ISSSourcing && ./scripts/api.sh"
  exit 1
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
API_DIR="$ROOT/services/api"
API_PY="$API_DIR/.venv/bin/python"
API_PIP="$API_DIR/.venv/bin/pip"
API_CONSTRAINTS="$API_DIR/constraints.txt"
API_VENDOR="$API_DIR/vendor"
API_REQS="$API_DIR/requirements-runtime.txt"

cd "$API_DIR"

if [ ! -d .venv ]; then
  python -m venv .venv
fi

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

if ! backend_deps_ok; then
  "$API_PY" -m pip install -U pip setuptools wheel || true
  install_runtime || {
    echo "Backend deps could not be installed (likely proxy/index policy)."
    echo "Try API-only preview: services/api/scripts/preview_api.sh"
    echo "Or set PIP_INDEX_URL / NPM registry to your org mirror."
    exit 2
  }
fi

echo "API URL: http://127.0.0.1:8000"
echo "Codespaces UI proxy base: /api"
export PYTHONPATH=.
"$API_PY" -m uvicorn app.main:app --host 0.0.0.0 --port 8000
