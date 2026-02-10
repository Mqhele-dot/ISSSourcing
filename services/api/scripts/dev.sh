#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

API_PY="./.venv/bin/python"
API_PIP="./.venv/bin/pip"
CONSTRAINTS="./constraints.txt"
VENDOR_DIR="./vendor"
REQS="./requirements-runtime.txt"

if [ ! -d ".venv" ]; then
  python -m venv .venv
fi

backend_deps_ok() {
  "$API_PY" -c "import fastapi, uvicorn; print('deps ok')" >/dev/null 2>&1
}

install_runtime() {
  if "$API_PIP" install -r "$REQS"; then
    "$API_PIP" install -e . --no-deps --no-build-isolation
    return 0
  fi
  if [ -d "$VENDOR_DIR" ] && compgen -G "$VENDOR_DIR/*.whl" >/dev/null; then
    "$API_PIP" install --no-index --find-links "$VENDOR_DIR" -c "$CONSTRAINTS" -r "$REQS"
    "$API_PIP" install -e . --no-deps --no-build-isolation
    return 0
  fi
  return 1
}

if ! backend_deps_ok; then
  "$API_PY" -m pip install --upgrade pip setuptools wheel || true
  install_runtime
fi

if [ "${SCT_DEV:-0}" = "1" ]; then
  "$API_PIP" install -c "$CONSTRAINTS" pytest ruff black || true
fi

"$API_PY" -c "import fastapi; print('fastapi ok', fastapi.__version__)"

export PYTHONPATH=.
"$API_PY" -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
