#!/usr/bin/env bash
# Starts the trace backend and the UI together.
set -euo pipefail
cd "$(dirname "$0")"

if [ ! -d backend/.venv ]; then
  python3 -m venv backend/.venv
  backend/.venv/bin/pip install -q -r backend/requirements.txt
fi
[ -d frontend/node_modules ] || (cd frontend && npm install)

backend/.venv/bin/uvicorn av.main:app --app-dir backend --port 8137 --reload &
API=$!
trap 'kill $API 2>/dev/null || true' EXIT

cd frontend && npm run dev
