#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "Running project doctor checks..."

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is not installed"
  exit 1
fi

NODE_VERSION="$(node -v)"
NODE_MAJOR="${NODE_VERSION#v}"
NODE_MAJOR="${NODE_MAJOR%%.*}"
NODE_MINOR="${NODE_VERSION#v${NODE_MAJOR}.}"
NODE_MINOR="${NODE_MINOR%%.*}"
if [[ "$NODE_MAJOR" -lt 22 || ( "$NODE_MAJOR" -eq 22 && "$NODE_MINOR" -lt 12 ) ]]; then
  echo "Node.js 22.12+ required (found $NODE_VERSION)"
  exit 1
fi
echo "Node.js: $NODE_VERSION"

if ! command -v python3 >/dev/null 2>&1; then
  echo "python3 is not installed"
  exit 1
fi
PYTHON_VERSION="$(python3 --version 2>&1)"
echo "$PYTHON_VERSION"

required_scripts=(
  "$ROOT_DIR/scripts/codespaces-up.sh"
  "$ROOT_DIR/scripts/doctor.sh"
  "$ROOT_DIR/scripts/test-runtime.sh"
)

for script in "${required_scripts[@]}"; do
  if [[ ! -f "$script" ]]; then
    echo "Missing required script: $script"
    exit 1
  fi
  if [[ ! -x "$script" ]]; then
    echo "Script is not executable: $script"
    exit 1
  fi
done

validate_readme="$ROOT_DIR/scripts/validate-readme.mjs"
if [[ ! -f "$validate_readme" ]]; then
  echo "Missing required script: $validate_readme"
  exit 1
fi
echo "Required shell scripts exist and are executable"

node "$validate_readme"

echo "Doctor checks passed"
