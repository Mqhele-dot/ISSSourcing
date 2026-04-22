#!/usr/bin/env bash
# Run npm ci; on failure (e.g. ENOTEMPTY while replacing node_modules), remove node_modules and retry once.
# Set SKIP_NPM_CI_RETRY=1 to disable the clean retry.
set -euo pipefail

if npm ci; then
  exit 0
fi

if [[ "${SKIP_NPM_CI_RETRY:-}" == "1" ]]; then
  exit 1
fi

echo "npm ci failed (often ENOTEMPTY: partial or locked node_modules on Codespaces). Removing node_modules and retrying once…" >&2
rm -rf node_modules
exec npm ci
