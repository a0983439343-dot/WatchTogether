#!/bin/sh
set -eu

node /opt/bgutil/build/main.js --host 127.0.0.1 &
BGUTIL_PID=$!

cleanup() {
  kill "$BGUTIL_PID" 2>/dev/null || true
}

trap cleanup EXIT INT TERM

exec node /app/server.js
