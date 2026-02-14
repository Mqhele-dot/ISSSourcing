#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
COMPOSE_FILE="${REPO_ROOT}/scripts/runtime-compose.yml"
COMPOSE_PROJECT="invtrack-runtime-test"
APP_LOG="/tmp/invtrack-runtime-app.log"
APP_PID=""

if [[ "$(pwd)" != "${REPO_ROOT}" ]]; then
  echo "Run this script from repository root: ${REPO_ROOT}" >&2
  exit 1
fi

if [[ ! -f "${REPO_ROOT}/package.json" || ! -d "${REPO_ROOT}/server" ]]; then
  echo "Could not verify repository root layout (missing package.json or server/)." >&2
  exit 1
fi

if [[ ! -f "${COMPOSE_FILE}" ]]; then
  echo "Missing runtime compose file: ${COMPOSE_FILE}" >&2
  exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is required to run runtime tests." >&2
  exit 1
fi

if docker compose version >/dev/null 2>&1; then
  COMPOSE_CMD=(docker compose -p "${COMPOSE_PROJECT}" -f "${COMPOSE_FILE}")
elif command -v docker-compose >/dev/null 2>&1; then
  COMPOSE_CMD=(docker-compose -p "${COMPOSE_PROJECT}" -f "${COMPOSE_FILE}")
else
  echo "Neither 'docker compose' nor 'docker-compose' was found." >&2
  exit 1
fi

cleanup() {
  if [[ -n "${APP_PID}" ]] && kill -0 "${APP_PID}" >/dev/null 2>&1; then
    kill "${APP_PID}" >/dev/null 2>&1 || true
    wait "${APP_PID}" >/dev/null 2>&1 || true
  fi
  "${COMPOSE_CMD[@]}" down -v --remove-orphans >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

echo "🚀 Starting runtime Postgres service..."
"${COMPOSE_CMD[@]}" up -d postgres

PGHOST="127.0.0.1"
PGPORT="54329"
PGDATABASE="inventory_dev"
PGUSER="postgres"
PGPASSWORD="postgres"
DATABASE_URL="postgresql://${PGUSER}:${PGPASSWORD}@${PGHOST}:${PGPORT}/${PGDATABASE}"
PORT="5000"
BASE_URL="http://127.0.0.1:${PORT}"
API_BASE="${BASE_URL}/api"

echo "⏳ Waiting for PostgreSQL readiness..."
DB_READY="false"
for attempt in {1..60}; do
  if "${COMPOSE_CMD[@]}" exec -T postgres pg_isready -U "${PGUSER}" -d "${PGDATABASE}" >/dev/null 2>&1; then
    DB_READY="true"
    break
  fi
  sleep 2
done

if [[ "${DB_READY}" != "true" ]]; then
  echo "Timed out waiting for PostgreSQL service readiness." >&2
  exit 1
fi
echo "✅ PostgreSQL is ready."

if [[ ! -d "${REPO_ROOT}/node_modules" ]]; then
  echo "📦 Installing dependencies..."
  npm ci
fi

echo "🛠️ Applying database schema..."
PGHOST="${PGHOST}" \
PGPORT="${PGPORT}" \
PGDATABASE="${PGDATABASE}" \
PGUSER="${PGUSER}" \
PGPASSWORD="${PGPASSWORD}" \
DATABASE_URL="${DATABASE_URL}" \
npm run db:push

echo "🌱 Seeding demo data..."
PGHOST="${PGHOST}" \
PGPORT="${PGPORT}" \
PGDATABASE="${PGDATABASE}" \
PGUSER="${PGUSER}" \
PGPASSWORD="${PGPASSWORD}" \
DATABASE_URL="${DATABASE_URL}" \
npm run db:seed

echo "🧪 Starting app server on port ${PORT}..."
rm -f "${APP_LOG}"
PGHOST="${PGHOST}" \
PGPORT="${PGPORT}" \
PGDATABASE="${PGDATABASE}" \
PGUSER="${PGUSER}" \
PGPASSWORD="${PGPASSWORD}" \
DATABASE_URL="${DATABASE_URL}" \
PORT="${PORT}" \
NODE_ENV="development" \
AUTO_SEED_ON_EMPTY_DB="false" \
npm run dev >"${APP_LOG}" 2>&1 &
APP_PID=$!

echo "⏳ Waiting for /health/deep..."
APP_READY="false"
for attempt in {1..90}; do
  if curl -fsS "${BASE_URL}/health/deep" >/dev/null 2>&1; then
    APP_READY="true"
    break
  fi
  sleep 2
done

if [[ "${APP_READY}" != "true" ]]; then
  echo "App failed to become healthy in time." >&2
  if [[ -f "${APP_LOG}" ]]; then
    echo "---- app log ----" >&2
    sed -n '1,240p' "${APP_LOG}" >&2
  fi
  exit 1
fi
echo "✅ App is healthy."

echo "🔍 Running API contract tests..."
BASE_URL="${BASE_URL}" API_BASE="${API_BASE}" npm run test:contracts

echo "🔗 Running KPI deep-link tests..."
BASE_URL="${BASE_URL}" API_BASE="${API_BASE}" npm run test:deeplinks

echo "✅ Runtime harness passed."
