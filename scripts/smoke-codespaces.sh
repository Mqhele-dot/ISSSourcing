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
python -m pip install --upgrade pip || {
  echo "Dependency install blocked; run inside Codespaces or configure proxy"
  exit 2
}
pip install -e .[dev] || {
  echo "Dependency install blocked; run inside Codespaces or configure proxy"
  exit 2
}
PYTHONPATH=. pytest -q

echo "==> Frontend typecheck/build (requires deps)"
cd "$ROOT/apps/desktop/frontend"
if [ ! -d "node_modules" ]; then
  npm install || {
    echo "Dependency install blocked; run inside Codespaces or configure proxy"
    exit 2
  }
fi
npm run build || {
  echo "Frontend build failed; if network/proxy is restricted, configure npm proxy and retry"
  exit 2
}
