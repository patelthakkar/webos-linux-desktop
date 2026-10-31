#!/bin/sh
# Ends a Tails session when the launcher stops sending heartbeats.
# Started detached by control.sh; never starts anything by itself.
set -eu
# control.sh holds its lock on fd 9. Never inherit it: this script calls back
# into control.sh stop, which needs that same lock.
exec 9>&-
BASE=${1:?usage: tails-watchdog.sh <base> [seconds]}
TIMEOUT=${2:-30}
WATCHDOG=$BASE/tails/watchdog.pid
HEARTBEAT=$BASE/tails/heartbeat

echo $$ > "$WATCHDOG"

while :; do
  [ "$(cat "$BASE/session.mode" 2>/dev/null || true)" = tails ] || exit 0
  beat=$(cat "$HEARTBEAT" 2>/dev/null || echo 0)
  case "$beat" in ''|*[!0-9]*) beat=0;; esac
  now=$(date +%s)
  if [ $((now - beat)) -gt "$TIMEOUT" ]; then
    rm -f "$WATCHDOG"
    sh "$BASE/control.sh" stop >/dev/null 2>&1 || true
    exit 0
  fi
  sleep 3
done
