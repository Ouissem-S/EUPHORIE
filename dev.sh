#!/usr/bin/env bash
# Start the EUPHORIE server and web dev server together. Ctrl+C stops both.
set -e

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

trap "kill 0" EXIT

(
  cd "$ROOT/server"
  source .venv/bin/activate
  # ElevenLabs host voice: read from server/.env (exported shell vars also pass through).
  # Don't set them to "" here: load_dotenv won't override an existing (even empty) var.
  EUPHORIE_KEY="${EUPHORIE_KEY:-pick-a-secret}" uvicorn app.main:app --reload --reload-dir app --port 8000
) &

(
  cd "$ROOT/web"
  npm run dev
) &

wait
