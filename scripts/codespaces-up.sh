#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
IS_CODESPACES="false"
if [[ "${CODESPACES:-}" == "true" || -n "${CODESPACE_NAME:-}" ]]; then
  IS_CODESPACES="true"
fi

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
export HOST="${HOST:-0.0.0.0}"

if [[ "${IS_CODESPACES}" == "true" && ( "${HOST}" == "127.0.0.1" || "${HOST}" == "localhost" ) ]]; then
  echo "HOST was set to ${HOST}; overriding to 0.0.0.0 for Codespaces reachability."
  export HOST="0.0.0.0"
fi

DB_URL_HOST=""
DB_URL_PORT=""
DB_URL_NAME=""
DB_URL_USER=""
DB_URL_PASSWORD=""
if [[ -n "${DATABASE_URL:-}" ]]; then
  DB_URL_PARSED="$(
    node -e '
      try {
        const raw = process.env.DATABASE_URL || "";
        if (!raw) process.exit(0);
        const u = new URL(raw);
        const host = u.hostname || "";
        const port = u.port || "";
        const db = (u.pathname || "").replace(/^\//, "");
        const user = decodeURIComponent(u.username || "");
        const pass = decodeURIComponent(u.password || "");
        process.stdout.write(`${host}|${port}|${db}|${user}|${pass}\n`);
      } catch {
        process.stdout.write("||||\n");
      }
    '
  )"
  IFS="|" read -r DB_URL_HOST DB_URL_PORT DB_URL_NAME DB_URL_USER DB_URL_PASSWORD <<<"${DB_URL_PARSED}"
fi

echo "Installing dependencies..."
npm ci

HAS_PG_ISREADY="false"
if command -v pg_isready >/dev/null 2>&1; then
  HAS_PG_ISREADY="true"
else
  echo "pg_isready not found; falling back to Node.js connection checks."
fi

declare -a DB_ENDPOINTS=()
add_db_endpoint() {
  local host="$1"
  local port="$2"
  if [[ -z "${host}" || -z "${port}" ]]; then
    return
  fi
  local endpoint="${host}:${port}"
  local existing
  for existing in "${DB_ENDPOINTS[@]}"; do
    if [[ "${existing}" == "${endpoint}" ]]; then
      return
    fi
  done
  DB_ENDPOINTS+=("${endpoint}")
}

add_db_endpoint "${DB_URL_HOST}" "${DB_URL_PORT:-${PGPORT}}"
add_db_endpoint "${PGHOST}" "${PGPORT}"
if [[ "${IS_CODESPACES}" == "true" ]]; then
  add_db_endpoint "db" "5432"
fi
add_db_endpoint "localhost" "${PGPORT}"
add_db_endpoint "127.0.0.1" "${PGPORT}"

if [[ "${#DB_ENDPOINTS[@]}" -eq 0 ]]; then
  echo "No PostgreSQL endpoints were configured." >&2
  exit 1
fi

echo "Waiting for PostgreSQL (candidates: ${DB_ENDPOINTS[*]})..."
READY_HOST=""
READY_PORT=""
for attempt in {1..60}; do
  for endpoint in "${DB_ENDPOINTS[@]}"; do
    host="${endpoint%%:*}"
    port="${endpoint##*:}"
    if [[ "${HAS_PG_ISREADY}" == "true" ]]; then
      pg_isready -h "${host}" -p "${port}" -U "${PGUSER}" -d "${PGDATABASE}" >/dev/null 2>&1
      status=$?
    else
      DB_WAIT_URL="postgresql://${PGUSER}:${PGPASSWORD}@${host}:${port}/${PGDATABASE}"
      DB_WAIT_URL="${DB_WAIT_URL}" node -e '
        import pg from "pg";
        const { Client } = pg;
        const client = new Client({ connectionString: process.env.DB_WAIT_URL });
        try {
          await client.connect();
          await client.end();
          process.exit(0);
        } catch {
          try { await client.end(); } catch {}
          process.exit(1);
        }
      ' >/dev/null 2>&1
      status=$?
    fi

    if [[ "${status}" -eq 0 ]]; then
      READY_HOST="${host}"
      READY_PORT="${port}"
      break 2
    fi
  done

  if [[ "${attempt}" -eq 60 ]]; then
    echo "Timed out waiting for PostgreSQL at all configured endpoints." >&2
    exit 1
  fi

  sleep 2
done

export PGHOST="${READY_HOST}"
export PGPORT="${READY_PORT}"
if [[ -n "${DB_URL_NAME}" ]]; then
  export PGDATABASE="${DB_URL_NAME}"
fi
if [[ -n "${DB_URL_USER}" ]]; then
  export PGUSER="${DB_URL_USER}"
fi
if [[ -n "${DB_URL_PASSWORD}" ]]; then
  export PGPASSWORD="${DB_URL_PASSWORD}"
fi
export DATABASE_URL="postgresql://${PGUSER}:${PGPASSWORD}@${PGHOST}:${PGPORT}/${PGDATABASE}"
echo "PostgreSQL is ready at ${PGHOST}:${PGPORT}."

echo "Applying database schema..."
if [[ "${IS_CODESPACES}" == "true" || "${DB_PUSH_FORCE:-}" == "true" ]]; then
  npm run db:push -- --force
else
  npm run db:push
fi

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

npm run dev &
APP_PID=$!

cleanup() {
  if kill -0 "${APP_PID}" >/dev/null 2>&1; then
    kill "${APP_PID}" >/dev/null 2>&1 || true
    wait "${APP_PID}" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT INT TERM

SERVER_READY="false"
for attempt in {1..90}; do
  if curl --silent --show-error --fail "http://127.0.0.1:${PORT}/health" >/dev/null 2>&1; then
    SERVER_READY="true"
    break
  fi
  sleep 1
done

if [[ "${SERVER_READY}" != "true" ]]; then
  echo "Server not reachable inside container; check HOST binding" >&2
  exit 1
fi

echo "✅ In-container health check passed at http://127.0.0.1:${PORT}/health"

wait "${APP_PID}"
