#!/usr/bin/env bash
# Start backend (uvicorn) + frontend (vite) in the background.
# Logs: backend/backend.log, frontend/frontend.log
# PIDs: .pids/backend.pid, .pids/frontend.pid

set -e
cd "$(dirname "$0")"
mkdir -p .pids

is_running() {
  local pidfile="$1"
  [[ -f "$pidfile" ]] && kill -0 "$(cat "$pidfile")" 2>/dev/null
}

# ---- Backend ----
if is_running .pids/backend.pid; then
  echo "✓ backend already running (pid $(cat .pids/backend.pid))"
else
  echo "▸ starting backend on :8000"
  (
    cd backend
    if [[ ! -d .venv ]]; then
      echo "  creating .venv…"
      python3 -m venv .venv
      .venv/bin/pip install -q -r requirements.txt
    fi
    nohup setsid .venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 8000 \
      > backend.log 2>&1 < /dev/null &
    echo $! > ../.pids/backend.pid
  )
  echo "  pid $(cat .pids/backend.pid) → backend/backend.log"
fi

# ---- Frontend ----
if is_running .pids/frontend.pid; then
  echo "✓ frontend already running (pid $(cat .pids/frontend.pid))"
else
  echo "▸ starting frontend on :5173"
  (
    cd frontend
    if [[ ! -d node_modules ]]; then
      echo "  installing node_modules…"
      npm install --silent
    fi
    # --host exposes vite on LAN/Tailscale interfaces
    nohup setsid npm run dev -- --host 0.0.0.0 > frontend.log 2>&1 < /dev/null &
    echo $! > ../.pids/frontend.pid
  )
  echo "  pid $(cat .pids/frontend.pid) → frontend/frontend.log"
fi

echo
echo "dashboard:  http://localhost:5173"
TS_IP=$(command -v tailscale >/dev/null && tailscale ip -4 2>/dev/null | head -1 || true)
if [[ -n "$TS_IP" ]]; then
  echo "tailscale:  http://$TS_IP:5173"
fi
echo "stop with:  ./stop.sh"
