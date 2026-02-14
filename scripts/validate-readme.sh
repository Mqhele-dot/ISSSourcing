#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DOC_FILE="$ROOT_DIR/CODESPACES.md"
ENV_FILE="$ROOT_DIR/.env.example"

if [[ ! -f "$DOC_FILE" ]]; then
  echo "❌ Missing docs file: $DOC_FILE"
  exit 1
fi

if [[ ! -f "$ENV_FILE" ]]; then
  echo "❌ Missing env template: $ENV_FILE"
  exit 1
fi

if ! rg -q "npm run codespaces:up" "$DOC_FILE"; then
  echo "❌ CODESPACES.md must document 'npm run codespaces:up'"
  exit 1
fi

if ! rg -q "Server \\| 5000" "$DOC_FILE"; then
  echo "❌ CODESPACES.md must document server port 5000"
  exit 1
fi

if ! rg -q "PostgreSQL \\| 5432" "$DOC_FILE"; then
  echo "❌ CODESPACES.md must document PostgreSQL port 5432"
  exit 1
fi

if ! rg -q "^PORT=5000$" "$ENV_FILE"; then
  echo "❌ .env.example must set PORT=5000"
  exit 1
fi

if ! rg -q "^CLIENT_PORT=5000$" "$ENV_FILE"; then
  echo "❌ .env.example must set CLIENT_PORT=5000"
  exit 1
fi

if ! rg -q "^DB_PORT=5432$" "$ENV_FILE"; then
  echo "❌ .env.example must set DB_PORT=5432"
  exit 1
fi

echo "✅ Docs validation passed"
