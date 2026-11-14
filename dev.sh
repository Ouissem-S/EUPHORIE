#!/usr/bin/env bash
# Start the EUPHORIE server and web dev server together. Ctrl+C stops both.
set -e

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

trap "kill 0" EXIT

(
  cd "$ROOT/server"
  source .venv/bin/activate
  EUPHORIE_KEY="${EUPHORIE_KEY:-pick-a-secret}" uvicorn app.main:app --reload --reload-dir app --port 8000
) &

(
  cd "$ROOT/web"
  npm run dev
) &

wait
