#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

"$ROOT/scripts/validate-readme-commands.sh"

set +e
"$ROOT/services/api/scripts/preview_api.sh"
api_rc=$?
set -e

if [ "$api_rc" -eq 2 ]; then
  echo "Backend deps could not be installed (likely proxy/index policy)."
  echo "Try API-only preview: services/api/scripts/preview_api.sh"
  echo "Or set PIP_INDEX_URL / NPM registry to your org mirror."
  exit 2
elif [ "$api_rc" -ne 0 ]; then
  echo "API preview failed with exit code $api_rc"
  exit "$api_rc"
fi

"$ROOT/scripts/dev-codespaces.sh"
