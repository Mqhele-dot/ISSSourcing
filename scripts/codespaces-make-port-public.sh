#!/usr/bin/env bash
# Force GitHub Codespaces port 5000 to Public and show forwarding state (fixes browser 401/502 when app is up on 127.0.0.1).
set -euo pipefail

PORT="${1:-${PORT:-5000}}"
CS="${CODESPACE_NAME:-}"

if [[ -z "${CS}" ]]; then
  echo "CODESPACE_NAME is not set. Run this inside a GitHub Codespace terminal." >&2
  exit 1
fi

if ! command -v gh >/dev/null 2>&1; then
  echo "GitHub CLI (gh) is not installed. Use the VS Code Ports tab: port ${PORT} → Visibility → Public." >&2
  exit 1
fi

echo "== gh auth =="
gh auth status || {
  echo "Run: gh auth login  (needed to change port visibility from the terminal)" >&2
  exit 1
}

echo "== Forward + Public: ${PORT} (codespace: ${CS}) =="
gh codespace ports forward "${PORT}:${PORT}" -c "${CS}" 2>/dev/null || true
gh codespace ports visibility "${PORT}:public" -c "${CS}"

echo "== Ports (JSON) =="
gh codespace ports -c "${CS}" --json sourcePort,visibility,browseUrl,protocol 2>/dev/null || true

echo ""
echo "Open the **browseUrl** above, or in VS Code: Ports → port ${PORT} → globe / Open in Browser."
echo "If the browser still shows 502: wait ~10s, hard reload, or remove and re-forward port ${PORT}."
