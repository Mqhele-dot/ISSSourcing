#!/usr/bin/env bash
set -euo pipefail

cd /workspace

if [ ! -f .env ]; then
  cp .env.example .env
fi

bash scripts/npm-ci-robust.sh

echo "Waiting for PostgreSQL to become ready..."
for attempt in {1..30}; do
  if pg_isready -h "${PGHOST:-db}" -p "${PGPORT:-5432}" -U "${PGUSER:-postgres}" >/dev/null 2>&1; then
    break
  fi

  if [ "$attempt" -eq 30 ]; then
    echo "PostgreSQL did not become ready in time." >&2
    exit 1
  fi

  sleep 2
done

npm run db:push
