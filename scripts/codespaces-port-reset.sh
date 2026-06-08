#!/usr/bin/env bash
# Rebuild GitHub Codespaces forwarding for the app port and verify the public URL.
set -euo pipefail

PORT="${1:-${PORT:-5000}}"
CS="${CODESPACE_NAME:-}"
DOMAIN="${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN:-}"
URL_FILE=".codespace-app-url"

if [[ -z "${CS}" || -z "${DOMAIN}" ]]; then
  echo "This must run inside a GitHub Codespace with CODESPACE_NAME and GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN set." >&2
  exit 1
fi

if ! [[ "${PORT}" =~ ^[0-9]+$ ]] || [[ "${PORT}" -lt 1 || "${PORT}" -gt 65535 ]]; then
  echo "Invalid port: ${PORT}" >&2
  exit 1
fi

CANONICAL_URL="https://${CS}-${PORT}.${DOMAIN}"

echo "== Codespaces port reset =="
echo "Codespace: ${CS}"
echo "Port: ${PORT}"
echo "Expected public URL: ${CANONICAL_URL}"
echo ""

echo "== Local listener check =="
LOCAL_STATUS="$(curl --silent --output /dev/null --write-out "%{http_code}" --max-time 5 "http://127.0.0.1:${PORT}/health" 2>/dev/null || true)"
if [[ "${LOCAL_STATUS}" != "200" ]]; then
  echo "Local health check failed: http://127.0.0.1:${PORT}/health -> HTTP ${LOCAL_STATUS}" >&2
  echo "Start the app first with: npm run codespaces:up" >&2
  exit 1
fi
echo "Local app is healthy on 127.0.0.1:${PORT}."
echo ""

if ! command -v gh >/dev/null 2>&1; then
  echo "GitHub CLI (gh) is missing, so the repo cannot reset port visibility automatically." >&2
  echo "Use the Codespaces PORTS panel: port ${PORT} -> Visibility -> Public -> Open in Browser." >&2
  exit 1
fi

echo "== GitHub auth check =="
if ! gh auth status >/dev/null 2>&1; then
  echo "GitHub CLI is not authenticated." >&2
  echo "Run: gh auth login" >&2
  echo "Then rerun: npm run codespaces:port:reset" >&2
  exit 1
fi
echo "gh is authenticated."
echo ""

echo "== Rebuild forward =="
gh codespace ports forward "${PORT}:${PORT}" -c "${CS}" >/dev/null 2>&1 || true
gh codespace ports visibility "${PORT}:public" -c "${CS}" >/dev/null
echo "Port ${PORT} is forwarded and set to Public."
echo ""

echo "== Resolve browse URL =="
PORTS_JSON="$(gh codespace ports -c "${CS}" --json sourcePort,visibility,browseUrl,protocol 2>/dev/null || echo "[]")"
BROWSE_URL="$(
  PORTS_JSON="${PORTS_JSON}" PORT="${PORT}" CANONICAL_URL="${CANONICAL_URL}" node -e '
    const ports = JSON.parse(process.env.PORTS_JSON || "[]");
    const port = Number(process.env.PORT);
    const row = Array.isArray(ports) ? ports.find((p) => Number(p.sourcePort) === port) : null;
    process.stdout.write(row?.browseUrl || process.env.CANONICAL_URL || "");
  '
)"
if [[ -z "${BROWSE_URL}" ]]; then
  BROWSE_URL="${CANONICAL_URL}"
fi
printf "APP_URL=%s\nPORT=%s\n" "${BROWSE_URL}" "${PORT}" > "${URL_FILE}"
printf "APP_URL=%s\nPORT=%s\n" "${BROWSE_URL}" "${PORT}" > ".local-dev-url"
echo "Public URL: ${BROWSE_URL}"
echo "Wrote ${URL_FILE} and .local-dev-url."
echo ""

echo "== Public URL check =="
PUBLIC_STATUS="$(curl -I --silent --output /dev/null --write-out "%{http_code}" --max-time 10 "${BROWSE_URL}/health" 2>/dev/null || true)"
case "${PUBLIC_STATUS}" in
  200|302)
    echo "Public health check passed: ${BROWSE_URL}/health -> HTTP ${PUBLIC_STATUS}"
    echo ""
    echo "Open this exact URL in other apps:"
    echo "${BROWSE_URL}"
    ;;
  401)
    echo "Public health check returned HTTP 401." >&2
    echo "GitHub is still treating the forwarded port as private or authenticated-only." >&2
    echo "Open the Codespaces PORTS panel, set port ${PORT} to Public, then rerun this script." >&2
    exit 1
    ;;
  502)
    echo "Public health check returned HTTP 502." >&2
    echo "The app is healthy locally, but GitHub's port proxy cannot reach it yet." >&2
    echo "Wait 10 seconds, rerun this script, or remove/re-add port ${PORT} from the PORTS panel." >&2
    exit 1
    ;;
  *)
    echo "Public health check failed: ${BROWSE_URL}/health -> HTTP ${PUBLIC_STATUS}" >&2
    echo "Local health is good, so this is a Codespaces forwarding/visibility problem." >&2
    echo "Current ports:"
    echo "${PORTS_JSON}"
    exit 1
    ;;
esac
