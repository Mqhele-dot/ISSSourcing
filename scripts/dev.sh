#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

(cd "$ROOT/services/api" && uvicorn app.main:app --reload --port 8000) &
API_PID=$!
trap 'kill $API_PID' EXIT

(cd "$ROOT/apps/desktop/frontend" && npm run dev)
