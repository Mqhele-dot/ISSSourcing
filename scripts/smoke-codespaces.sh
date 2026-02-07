#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "==> Backend tests"
cd "$ROOT/services/api"
if [ ! -d ".venv" ]; then
  python -m venv .venv
fi
# shellcheck disable=SC1091
source .venv/bin/activate
python -m pip install --upgrade pip
pip install -e .[dev]
PYTHONPATH=. pytest -q

echo "==> Frontend typecheck/build (requires deps)"
cd "$ROOT/apps/desktop/frontend"
if [ ! -d "node_modules" ]; then
  npm install
fi
npm run build
