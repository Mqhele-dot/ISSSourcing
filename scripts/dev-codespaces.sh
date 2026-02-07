#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "==> Starting backend"
cd "$ROOT/services/api"
source .venv/bin/activate
export PYTHONPATH=.
python -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000 &
API_PID=$!

trap 'kill $API_PID 2>/dev/null || true' EXIT

echo "==> Starting frontend"
cd "$ROOT/apps/desktop/frontend"
npm run dev -- --host 0.0.0.0 --port 5173
