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

# Use grep (POSIX) — ripgrep is not guaranteed on CI runners or minimal images.
if ! grep -Fq "npm run codespaces:up" "$DOC_FILE"; then
  echo "❌ CODESPACES.md must document 'npm run codespaces:up'"
  exit 1
fi

if ! grep -Fq "Server | 5000" "$DOC_FILE"; then
  echo "❌ CODESPACES.md must document server port 5000"
  exit 1
fi

if ! grep -Fq "PostgreSQL | 5432" "$DOC_FILE"; then
  echo "❌ CODESPACES.md must document PostgreSQL port 5432"
  exit 1
fi

if ! grep -qxF "PORT=5000" "$ENV_FILE"; then
  echo "❌ .env.example must set PORT=5000"
  exit 1
fi

if ! grep -qxF "CLIENT_PORT=5000" "$ENV_FILE"; then
  echo "❌ .env.example must set CLIENT_PORT=5000"
  exit 1
fi

if ! grep -qxF "DB_PORT=5432" "$ENV_FILE"; then
  echo "❌ .env.example must set DB_PORT=5432"
  exit 1
fi

echo "✅ Docs validation passed"
