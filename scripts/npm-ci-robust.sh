#!/usr/bin/env bash
# Run npm ci; on failure (e.g. ENOTEMPTY while replacing node_modules), remove node_modules and retry once.
# Set SKIP_NPM_CI_RETRY=1 to disable the clean retry.
set -euo pipefail

verify_tailwind_packages() {
  # Tailwind config imports these; missing dirs break Vite/PostCSS and Tailwind CSS IntelliSense (see /workspace errors).
  local pkg
  for pkg in tailwindcss tailwindcss-animate @tailwindcss/typography; do
    if [[ ! -d "node_modules/${pkg}" ]]; then
      echo "Missing dependency after npm ci: ${pkg}" >&2
      echo "Fix from repo root: rm -rf node_modules && npm ci" >&2
      exit 1
    fi
  done
}

if npm ci; then
  verify_tailwind_packages
  exit 0
fi

if [[ "${SKIP_NPM_CI_RETRY:-}" == "1" ]]; then
  exit 1
fi

echo "npm ci failed (often ENOTEMPTY: partial or locked node_modules on Codespaces). Removing node_modules and retrying once…" >&2
rm -rf node_modules
if npm ci; then
  verify_tailwind_packages
  exit 0
fi
exit 1
