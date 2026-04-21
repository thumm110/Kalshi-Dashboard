#!/usr/bin/env bash
# Stop backend + frontend started by start.sh.

set -e
cd "$(dirname "$0")"

stop_one() {
  local name="$1" pidfile=".pids/$1.pid"
  if [[ ! -f "$pidfile" ]]; then
    echo "· no pidfile for $name"
    return
  fi
  local pid
  pid=$(cat "$pidfile")
  if kill -0 "$pid" 2>/dev/null; then
    echo "▸ stopping $name (pid $pid)"
    # kill the whole process group so child workers (vite, uvicorn reloaders) go too
    kill -TERM -"$pid" 2>/dev/null || kill -TERM "$pid"
    for _ in 1 2 3 4 5; do
      kill -0 "$pid" 2>/dev/null || break
      sleep 0.3
    done
    if kill -0 "$pid" 2>/dev/null; then
      echo "  still alive, SIGKILL"
      kill -KILL -"$pid" 2>/dev/null || kill -KILL "$pid"
    fi
  else
    echo "· $name not running (stale pidfile)"
  fi
  rm -f "$pidfile"
}

stop_one backend
stop_one frontend

# Safety net: kill anything still bound to our ports
for port in 8000 5173; do
  pids=$(ss -ltnp 2>/dev/null | awk -v p=":$port" '$4 ~ p {print}' | grep -oP 'pid=\K[0-9]+' | sort -u || true)
  for pid in $pids; do
    echo "▸ port $port still held by pid $pid, killing"
    kill -TERM "$pid" 2>/dev/null || true
  done
done

echo "done."
