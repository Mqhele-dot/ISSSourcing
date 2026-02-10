#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -lt 2 ]; then
  echo "usage: $0 <url> <timeout_seconds>"
  exit 1
fi

URL="$1"
TIMEOUT="$2"
START=$(date +%s)

while true; do
  if curl -fsS "$URL" >/dev/null 2>&1; then
    echo "ready: $URL"
    exit 0
  fi

  NOW=$(date +%s)
  ELAPSED=$((NOW - START))
  if [ "$ELAPSED" -ge "$TIMEOUT" ]; then
    echo "timeout waiting for $URL"
    exit 1
  fi
  sleep 1
done
