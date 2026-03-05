#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
IS_CODESPACES="false"
if [[ "${CODESPACES:-}" == "true" || -n "${CODESPACE_NAME:-}" || -n "${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN:-}" ]]; then
  IS_CODESPACES="true"
fi

if [[ "$(pwd)" != "${REPO_ROOT}" ]]; then
  echo "Switching to repository root: ${REPO_ROOT}"
  cd "${REPO_ROOT}"
fi

if [[ ! -f "${REPO_ROOT}/package.json" || ! -d "${REPO_ROOT}/server" ]]; then
  echo "Could not verify repository root layout (missing package.json or server/)." >&2
  echo "If you are in Codespaces, locate the repo root with: git rev-parse --show-toplevel" >&2
  exit 1
fi

if command -v git >/dev/null 2>&1 && [[ -d "${REPO_ROOT}/.git" ]]; then
  GIT_BRANCH="$(git -C "${REPO_ROOT}" rev-parse --abbrev-ref HEAD 2>/dev/null || echo unknown)"
  GIT_COMMIT="$(git -C "${REPO_ROOT}" rev-parse --short HEAD 2>/dev/null || echo unknown)"
  echo "Using git revision: ${GIT_BRANCH}@${GIT_COMMIT}"
fi

LOCK_DIR="${REPO_ROOT}/.codespaces-up.lock"
if [[ -d "${LOCK_DIR}" ]]; then
  LOCK_PID="$(cat "${LOCK_DIR}/pid" 2>/dev/null || true)"
  if [[ -n "${LOCK_PID}" ]] && kill -0 "${LOCK_PID}" >/dev/null 2>&1; then
    echo "Another codespaces-up run is already in progress (pid ${LOCK_PID})." >&2
    echo "Stop that process first, then rerun: npm run codespaces:up" >&2
    exit 1
  fi
  rm -rf "${LOCK_DIR}"
fi
mkdir -p "${LOCK_DIR}"
echo "$$" > "${LOCK_DIR}/pid"

release_lock() {
  rm -rf "${LOCK_DIR}"
}

trap release_lock EXIT

cleanup_partial_tailwind_modules() {
  local pkg
  for pkg in tailwindcss tailwindcss-animate "@tailwindcss/typography"; do
    if [[ -d "node_modules/${pkg}" && ! -f "node_modules/${pkg}/package.json" ]]; then
      echo "Detected partial install for ${pkg}; cleaning it before reinstall..."
      rm -rf "node_modules/${pkg}"
    fi
  done
}

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
cleanup_partial_tailwind_modules
if ! npm ci; then
  echo "npm ci failed (package-lock may be out of sync). Attempting lockfile reconciliation..."
  npm install --package-lock-only
  npm ci
fi

validate_node_modules() {
  node <<'NODE'
const fs = require('fs');
const path = require('path');

const checks = [
  'tailwindcss',
  'tailwindcss-animate',
  '@tailwindcss/typography',
  'vite',
  'tsx',
  'drizzle-kit',
  '@types/node',
  '@types/csurf',
  '@types/nodemailer',
  '@types/speakeasy',
];

const root = process.cwd();

for (const pkg of checks) {
  // Resolve package.json via filesystem path instead of require.resolve('<pkg>/package.json')
  // because some packages (e.g. drizzle-kit) do not export that subpath.
  const pkgJson = path.join(root, 'node_modules', ...pkg.split('/'), 'package.json');
  const raw = fs.readFileSync(pkgJson, 'utf8');
  JSON.parse(raw);
}
NODE
}

echo "Validating dependency integrity..."
if ! validate_node_modules; then
  echo "Dependency integrity check failed (likely partial/corrupt install). Reinstalling once..."
  rm -rf node_modules
  npm ci
  validate_node_modules
fi

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
add_db_endpoint "db" "5432"
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
      if pg_isready -h "${host}" -p "${port}" -U "${PGUSER}" -d "${PGDATABASE}" >/dev/null 2>&1; then
        status=0
      else
        status=1
      fi
    else
      DB_WAIT_URL="postgresql://${PGUSER}:${PGPASSWORD}@${host}:${port}/${PGDATABASE}"
      if DB_WAIT_URL="${DB_WAIT_URL}" node -e '
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
        ' >/dev/null 2>&1; then
        status=0
      else
        status=1
      fi
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
FORWARDED_HOST=""
if [[ "${APP_URL}" == https://* ]]; then
  FORWARDED_HOST="${APP_URL#https://}"
fi

echo
echo "Starting application..."
echo "Server URL: ${APP_URL}"
echo "Client URL: ${APP_URL} (Vite is served through Express in this project)"
echo "Ports => server/client: ${PORT}, db: ${PGPORT}"
echo

# Prevent stale/old process from serving old code on the same port.
if command -v lsof >/dev/null 2>&1; then
  EXISTING_PIDS="$(lsof -ti tcp:${PORT} -sTCP:LISTEN 2>/dev/null | tr '\n' ' ')"
  if [[ -n "${EXISTING_PIDS// }" ]]; then
    echo "Found existing listener(s) on port ${PORT}: ${EXISTING_PIDS}. Stopping to avoid stale app output..."
    # shellcheck disable=SC2086
    kill ${EXISTING_PIDS} >/dev/null 2>&1 || true
    sleep 1
  fi
fi

echo "Clearing Vite transform cache..."
rm -rf "${REPO_ROOT}/node_modules/.vite"

npm run dev &
APP_PID=$!

cleanup() {
  if kill -0 "${APP_PID}" >/dev/null 2>&1; then
    kill "${APP_PID}" >/dev/null 2>&1 || true
    wait "${APP_PID}" >/dev/null 2>&1 || true
  fi
  release_lock
}
trap cleanup EXIT INT TERM

SERVER_READY="false"
for attempt in {1..90}; do
  if curl --silent --show-error --fail "http://127.0.0.1:${PORT}/health" >/dev/null 2>&1; then
    if ! kill -0 "${APP_PID}" >/dev/null 2>&1; then
      echo "Server process exited quickly. This is often a port conflict (EADDRINUSE)." >&2
      exit 1
    fi
    SERVER_READY="true"
    break
  fi

  if ! kill -0 "${APP_PID}" >/dev/null 2>&1; then
    echo "Server process exited before health endpoint became ready." >&2
    exit 1
  fi
  sleep 1
done

if [[ "${SERVER_READY}" != "true" ]]; then
  echo "Server not reachable inside container; check HOST binding" >&2
  exit 1
fi

echo "✅ In-container health check passed at http://127.0.0.1:${PORT}/health"

echo "Warming app shell route..."
SHELL_READY="false"
for attempt in {1..120}; do
  if [[ -n "${FORWARDED_HOST}" ]]; then
    if curl --silent --show-error --fail --max-time 10 -H "Host: ${FORWARDED_HOST}" "http://127.0.0.1:${PORT}/" >/dev/null 2>&1; then
      SHELL_READY="true"
      break
    fi
  else
    if curl --silent --show-error --fail --max-time 10 "http://127.0.0.1:${PORT}/" >/dev/null 2>&1; then
      SHELL_READY="true"
      break
    fi
  fi

  if ! kill -0 "${APP_PID}" >/dev/null 2>&1; then
    echo "Server process exited while warming app shell route." >&2
    exit 1
  fi
  sleep 1
done

if [[ "${SHELL_READY}" != "true" ]]; then
  echo "App shell route did not become ready in time." >&2
  exit 1
fi

echo "✅ In-container app shell warm-up passed at http://127.0.0.1:${PORT}/"

if [[ -n "${FORWARDED_HOST}" ]]; then
  if command -v gh >/dev/null 2>&1 && [[ "${CODESPACES_AUTO_PUBLIC_PORT:-true}" == "true" ]]; then
    if gh codespace ports visibility "${PORT}:public" -c "${CODESPACE_NAME}" 2>/dev/null; then
      echo "Port ${PORT} set to Public via gh."
    else
      echo "Could not set port ${PORT} to Public automatically. If you see 502 in the browser, set it in the Ports tab."
    fi
  fi

  echo "Checking forwarded URL reachability..."
  FORWARDED_READY="false"
  LAST_STATUS="000"
  for attempt in {1..45}; do
    LAST_STATUS="$(
      curl -I --silent --output /dev/null --write-out "%{http_code}" --max-time 10 "${APP_URL}/health" 2>/dev/null || true
    )"
    case "${LAST_STATUS}" in
      200|302)
        FORWARDED_READY="true"
        break
        ;;
    esac

    if ! kill -0 "${APP_PID}" >/dev/null 2>&1; then
      echo "Server process exited while checking forwarded URL." >&2
      exit 1
    fi
    sleep 2
  done

  if [[ "${FORWARDED_READY}" == "true" ]]; then
    echo "✅ Forwarded URL check passed (${APP_URL}/health -> HTTP ${LAST_STATUS})."
    echo ""
    echo "  → Open in browser: ${APP_URL}"
    echo "  → If you see 502: In VS Code, open the PORTS tab → find port ${PORT} → set visibility to Public → reload the page."
    echo ""
  else
    echo "Port ${PORT} not reachable from proxy. Ensure PORTS tab forwards ${PORT} and visibility is Public." >&2
    if command -v gh >/dev/null 2>&1; then
      echo "Current forwarded ports:" >&2
      gh codespace ports -c "${CODESPACE_NAME}" --json sourcePort,visibility,browseUrl 2>/dev/null || true
    fi
    exit 1
  fi
fi

wait "${APP_PID}"
