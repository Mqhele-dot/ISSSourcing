#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

if [ ! -d ".venv" ]; then
  python -m venv .venv
fi

./.venv/bin/python -m pip install --upgrade pip setuptools wheel || true
./.venv/bin/pip install -e ".[dev]"
./.venv/bin/python -c "import fastapi; print('fastapi ok', fastapi.__version__)"

export PYTHONPATH=.
./.venv/bin/python -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
