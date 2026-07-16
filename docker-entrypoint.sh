#!/bin/sh
set -eu

XVFB_SCREEN="${XVFB_SCREEN:-1400x900x24}"

Xvfb "$DISPLAY" -screen 0 "$XVFB_SCREEN" -ac +extension GLX +render -noreset &
XVFB_PID="$!"

fluxbox >/tmp/fluxbox.log 2>&1 &
x11vnc -display "$DISPLAY" -forever -shared -nopw -rfbport "$VNC_PORT" >/tmp/x11vnc.log 2>&1 &
websockify --web=/usr/share/novnc/ "$NOVNC_PORT" "localhost:$VNC_PORT" >/tmp/novnc.log 2>&1 &

cleanup() {
  kill "$XVFB_PID" 2>/dev/null || true
}
trap cleanup INT TERM EXIT

dbus-run-session -- npm start -- --no-sandbox --disable-gpu --disable-dev-shm-usage
