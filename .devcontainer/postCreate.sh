#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "==> Backend venv + deps"
cd "$ROOT/services/api"
python -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
pip install -e .[dev]

echo "==> Frontend deps"
cd "$ROOT/apps/desktop/frontend"
npm install

echo "==> Done"
