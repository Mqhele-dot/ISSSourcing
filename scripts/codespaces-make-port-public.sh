#!/usr/bin/env bash
# Backwards-compatible wrapper. Use codespaces-port-reset.sh for the full reset + verification flow.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PORT="${1:-${PORT:-5000}}"

bash "${SCRIPT_DIR}/codespaces-port-reset.sh" "${PORT}"
