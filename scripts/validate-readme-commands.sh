#!/usr/bin/env bash
set -euo pipefail

if [ ! -d .git ]; then
  echo "Run this from repo root: cd /workspaces/ISSSourcing && ./scripts/validate-readme-commands.sh"
  exit 1
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
README="$ROOT/README.md"
DEVCONTAINER="$ROOT/.devcontainer/devcontainer.json"

has() { command -v "$1" >/dev/null 2>&1; }

matches() {
  local pattern="$1" file="$2"
  if has rg; then
    rg -q -- "$pattern" "$file"
  else
    grep -Eq -- "$pattern" "$file"
  fi
}

extract_pip_lines() {
  local file="$1"
  if has rg; then
    rg '^.*pip install.*$' "$file" || true
  else
    grep -E '^.*pip install.*$' "$file" || true
  fi
}

if [ ! -f "$README" ]; then
  echo "README.md not found"
  exit 1
fi

pip_lines="$(extract_pip_lines "$README")"
if printf '%s' "$pip_lines" | grep -Eq -- '--use-pep517=false'; then
  echo "README contains invalid pip flag: --use-pep517=false"
  exit 1
fi

if ! matches 'requirements-runtime\.txt' "$README"; then
  echo "README is missing runtime requirements guidance"
  exit 1
fi

if ! matches 'pip install -e \.' "$README"; then
  echo "README is missing editable app install guidance"
  exit 1
fi

if ! matches 'UI calls the API via `/api`' "$README"; then
  echo "README is missing explicit /api proxy guidance for Codespaces preview"
  exit 1
fi

required_paths=(
  "scripts/dev-codespaces.sh"
  "scripts/smoke-codespaces.sh"
  "scripts/wait-for.sh"
  "services/api/scripts/dev.sh"
  "services/api/scripts/smoke_no_deps.py"
  "services/api/scripts/demo_walkthrough.py"
  "services/api/scripts/preview_api.sh"
  "scripts/preview.sh"
  "scripts/api.sh"
)

for rel in "${required_paths[@]}"; do
  abs="$ROOT/$rel"
  if [ ! -e "$abs" ]; then
    echo "Missing referenced script: $rel"
    exit 1
  fi
  if [ ! -x "$abs" ]; then
    echo "Referenced script is not executable: $rel"
    exit 1
  fi
done

bash -n \
  "$ROOT/scripts/dev-codespaces.sh" \
  "$ROOT/scripts/smoke-codespaces.sh" \
  "$ROOT/scripts/wait-for.sh" \
  "$ROOT/scripts/preview.sh" \
  "$ROOT/scripts/api.sh"

bash -n "$ROOT/services/api/scripts/dev.sh" "$ROOT/services/api/scripts/preview_api.sh"
python -m py_compile \
  "$ROOT/services/api/scripts/smoke_no_deps.py" \
  "$ROOT/services/api/scripts/demo_walkthrough.py"

for port in 8000 5173; do
  if ! matches "$port" "$README"; then
    echo "README missing expected port entry: $port"
    exit 1
  fi
  if ! matches "$port" "$DEVCONTAINER"; then
    echo "devcontainer missing expected port: $port"
    exit 1
  fi
done

echo "OK: README commands validated"
