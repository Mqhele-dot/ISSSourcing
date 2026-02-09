#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

"$ROOT/scripts/validate-readme-commands.sh"

set +e
"$ROOT/scripts/smoke-codespaces.sh"
smoke_rc=$?
set -e

if [ "$smoke_rc" -eq 2 ]; then
  echo "Smoke returned 2: dependency install likely blocked by proxy/index restrictions; continuing to dev preview."
elif [ "$smoke_rc" -ne 0 ]; then
  echo "Smoke failed with exit code $smoke_rc"
  exit "$smoke_rc"
fi

"$ROOT/scripts/dev-codespaces.sh"
