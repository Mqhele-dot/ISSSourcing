#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

if [[ "$(pwd)" != "${REPO_ROOT}" ]]; then
  echo "Run this command from the repository root: ${REPO_ROOT}" >&2
  exit 1
fi

if [[ ! -f "${REPO_ROOT}/package.json" || ! -d "${REPO_ROOT}/server" ]]; then
  echo "Could not verify repository root layout (missing package.json or server/)." >&2
  exit 1
fi

if [[ ! -f .env && -f .env.example ]]; then
  cp .env.example .env
  echo "Created .env from .env.example"
fi

if [[ -f .env ]]; then
  # shellcheck source=/dev/null
  set -a
  source .env
  set +a
fi

export PGHOST="${PGHOST:-db}"
export PGPORT="${PGPORT:-5432}"
export PGDATABASE="${PGDATABASE:-inventory_dev}"
export PGUSER="${PGUSER:-postgres}"
export PGPASSWORD="${PGPASSWORD:-postgres}"
export PORT="${PORT:-5000}"
export DATABASE_URL="${DATABASE_URL:-postgresql://${PGUSER}:${PGPASSWORD}@${PGHOST}:${PGPORT}/${PGDATABASE}}"

echo "Installing dependencies..."
npm ci

if ! command -v pg_isready >/dev/null 2>&1; then
  echo "pg_isready is required but was not found in PATH." >&2
  exit 1
fi

echo "Waiting for PostgreSQL at ${PGHOST}:${PGPORT}..."
for attempt in {1..45}; do
  if pg_isready -h "${PGHOST}" -p "${PGPORT}" -U "${PGUSER}" -d "${PGDATABASE}" >/dev/null 2>&1; then
    echo "PostgreSQL is ready."
    break
  fi

  if [[ "${attempt}" -eq 45 ]]; then
    echo "Timed out waiting for PostgreSQL." >&2
    exit 1
  fi

  sleep 2
done

echo "Applying database schema..."
npm run db:push

APP_URL="http://localhost:${PORT}"
if [[ -n "${CODESPACE_NAME:-}" && -n "${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN:-}" ]]; then
  APP_URL="https://${CODESPACE_NAME}-${PORT}.${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN}"
fi

echo
echo "Starting application..."
echo "Server URL: ${APP_URL}"
echo "Client URL: ${APP_URL} (Vite is served through Express in this project)"
echo "Ports => server/client: ${PORT}, db: ${PGPORT}"
echo

exec npm run dev
