#!/usr/bin/env bash
# Quick diagnostics for GitHub Codespaces when the forwarded URL shows 502 / blank page.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${REPO_ROOT}"

echo "== InvTrack Codespaces doctor (repo: ${REPO_ROOT}) =="
echo

echo "== Node =="
command -v node >/dev/null && node -v || echo "node: NOT FOUND"
echo

echo "== node_modules =="
if [[ ! -d node_modules ]]; then
  echo "MISSING node_modules — run: rm -rf node_modules && npm ci"
else
  echo "present ($(du -sh node_modules 2>/dev/null | cut -f1 || echo '?'))"
fi
echo

echo "== Required CLI binaries (after npm ci) =="
for name in tsx drizzle-kit vite; do
  bin="node_modules/.bin/${name}"
  if [[ -x "${bin}" ]]; then
    echo "  OK  ${name}"
  else
    echo "  BAD ${name} — ${bin} missing or not executable"
  fi
done
echo

echo "== Port ${PORT:-5000} (inside container) =="
PORT="${PORT:-5000}"
if command -v ss >/dev/null 2>&1; then
  ss -tlnp 2>/dev/null | grep ":${PORT}" || echo "  Nothing listening on ${PORT} (server not running?)"
elif command -v lsof >/dev/null 2>&1; then
  lsof -i ":${PORT}" 2>/dev/null || echo "  Nothing listening on ${PORT} (server not running?)"
else
  echo "  (install ss or lsof for listen check)"
fi
echo

echo "== HTTP ${PORT} localhost =="
# curl still writes http_code to stdout when the connection fails; do not append a second "000".
code="$(
  curl -sS -o /dev/null -w "%{http_code}" --connect-timeout 2 --max-time 3 "http://127.0.0.1:${PORT}/health" 2>/dev/null || true
)"
[[ -z "${code}" ]] && code="000"
if [[ "${code}" == "200" ]]; then
  echo "  OK  GET /health -> ${code} (dev server is up)"
elif [[ "${code}" == "000" ]]; then
  echo "  BAD curl failed — server probably not running. Start: npm run codespaces:up  OR  HOST=0.0.0.0 PORT=${PORT} npm run dev"
else
  echo "  GET /health -> ${code}"
fi
echo

if [[ -n "${CODESPACE_NAME:-}" && -n "${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN:-}" ]]; then
  pub="https://${CODESPACE_NAME}-${PORT}.${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN}"
  echo "== Forwarded URL (browser) =="
  echo "  ${pub}"
  echo "  If browser shows 502 but localhost /health is 200: Ports tab → ${PORT} → Public → Reload."
  echo "  If localhost /health fails: fix npm ci first, then start the dev server (keep terminal open)."
fi

echo
echo "Done."
