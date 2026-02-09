#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
README="$ROOT/README.md"
DEVCONTAINER="$ROOT/.devcontainer/devcontainer.json"

if [ ! -f "$README" ]; then
  echo "README.md not found"
  exit 1
fi

pip_lines="$(rg '^.*pip install.*$' "$README" || true)"
if echo "$pip_lines" | rg -q -- '--use-pep517=false'; then
  echo "README contains invalid pip flag: --use-pep517=false"
  exit 1
fi

if ! echo "$pip_lines" | rg -q -- '--no-use-pep517'; then
  echo "README is missing expected fallback pip flag: --no-use-pep517"
  exit 1
fi

if ! rg -q -- 'pip install -e "\.\[dev\]" --no-use-pep517' "$README"; then
  echo "README fallback install command is missing expected editable install with --no-use-pep517"
  exit 1
fi

if ! rg -q -- 'UI calls the API via `/api`' "$README"; then
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
  "$ROOT/scripts/preview.sh"

bash -n "$ROOT/services/api/scripts/dev.sh" "$ROOT/services/api/scripts/preview_api.sh"
python -m py_compile \
  "$ROOT/services/api/scripts/smoke_no_deps.py" \
  "$ROOT/services/api/scripts/demo_walkthrough.py"

for port in 8000 5173; do
  if ! rg -q -- "$port" "$README"; then
    echo "README missing expected port entry: $port"
    exit 1
  fi
  if ! rg -q -- "$port" "$DEVCONTAINER"; then
    echo "devcontainer missing expected port: $port"
    exit 1
  fi
done

echo "OK: README commands validated"
