#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
API_DIR="$ROOT/services/api"
API_PY="$API_DIR/.venv/bin/python"
API_PIP="$API_DIR/.venv/bin/pip"

cd "$API_DIR"

if [ ! -d .venv ]; then
  python -m venv .venv
fi

echo "==> Installing backend dependencies (best effort)"
"$API_PY" -m pip install -U pip setuptools wheel || true
if ! "$API_PIP" install -e ".[dev]"; then
  echo "Dependency install blocked; run inside Codespaces or configure proxy/index access"
  exit 2
fi

echo "==> Starting API on 0.0.0.0:8000"
export PYTHONPATH=.
"$API_PY" -m uvicorn app.main:app --host 0.0.0.0 --port 8000 &
API_PID=$!

cleanup() {
  kill "$API_PID" 2>/dev/null || true
}
trap cleanup EXIT

"$ROOT/scripts/wait-for.sh" "http://127.0.0.1:8000/health" 45

echo "==> Running walkthrough"
"$API_PY" scripts/demo_walkthrough.py

echo "preview_api: walkthrough complete"
