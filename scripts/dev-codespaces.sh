#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "==> Backend bootstrap"
cd "$ROOT/services/api"
if [ ! -d ".venv" ]; then
  python -m venv .venv
fi
# shellcheck disable=SC1091
source .venv/bin/activate
python -m pip install --upgrade pip
pip install -e .[dev]

echo "==> Starting backend"
export PYTHONPATH=.
python -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000 &
API_PID=$!

trap 'kill $API_PID 2>/dev/null || true' EXIT

echo "==> Frontend bootstrap"
cd "$ROOT/apps/desktop/frontend"
if [ ! -d "node_modules" ]; then
  npm install
fi

echo "==> Starting frontend"
npm run dev:codespaces
