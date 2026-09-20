#!/usr/bin/env bash
set -Eeuo pipefail

cd "$(dirname "$0")/.."

if ! command -v opencode >/dev/null 2>&1; then
  printf '%s\n' "OpenCode is not installed. Running the project installer..."
  bash scripts/install-opencode.sh
fi

if ! command -v curl >/dev/null 2>&1; then
  printf '%s\n' "curl is required to check OpenCode readiness." >&2
  exit 1
fi

host="${OPENCODE_HOST:-127.0.0.1}"
port="${OPENCODE_PORT:-4096}"
health_url="http://${host}:${port}/global/health"
opencode_pid=""

cleanup() {
  if [[ -n "$opencode_pid" ]] && kill -0 "$opencode_pid" 2>/dev/null; then
    printf '\n%s\n' "Stopping OpenCode (PID $opencode_pid)..."
    kill "$opencode_pid" 2>/dev/null || true
    wait "$opencode_pid" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

if curl -fsS --max-time 2 "$health_url" >/dev/null 2>&1; then
  printf '%s\n' "Using existing OpenCode at $health_url"
else
  if ss -ltn "sport = :$port" 2>/dev/null | grep -q LISTEN; then
    printf '%s\n' "Port $port is occupied, but OpenCode is not healthy there." >&2
    printf '%s\n' "Stop the process using that port, then run this command again." >&2
    exit 1
  fi

  printf '%s\n' "Starting OpenCode with web search enabled..."
  OPENCODE_ENABLE_EXA=1 opencode serve --hostname "$host" --port "$port" &
  opencode_pid=$!

  for _ in {1..30}; do
    if curl -fsS --max-time 2 "$health_url" >/dev/null 2>&1; then
      break
    fi
    if ! kill -0 "$opencode_pid" 2>/dev/null; then
      printf '%s\n' "OpenCode exited before becoming healthy." >&2
      exit 1
    fi
    sleep 1
  done

  if ! curl -fsS --max-time 2 "$health_url" >/dev/null 2>&1; then
    printf '%s\n' "OpenCode did not become healthy at $health_url." >&2
    exit 1
  fi
fi

printf '%s\n' "Starting Tappd-In at http://localhost:${PORT:-3000}"
npm start
