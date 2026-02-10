#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

API_PY="./.venv/bin/python"
API_PIP="./.venv/bin/pip"
CONSTRAINTS="./constraints.txt"
VENDOR_DIR="./vendor"

if [ ! -d ".venv" ]; then
  python -m venv .venv
fi

install_backend_editable() {
  if "$API_PIP" install -c "$CONSTRAINTS" -e ".[dev]"; then
    return 0
  fi
  if [ -d "$VENDOR_DIR" ] && compgen -G "$VENDOR_DIR/*.whl" >/dev/null; then
    "$API_PIP" install --no-index --find-links "$VENDOR_DIR" -c "$CONSTRAINTS" -e ".[dev]"
    return 0
  fi
  return 1
}

"$API_PY" -m pip install --upgrade pip setuptools wheel || true
install_backend_editable
"$API_PY" -c "import fastapi; print('fastapi ok', fastapi.__version__)"

export PYTHONPATH=.
"$API_PY" -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
