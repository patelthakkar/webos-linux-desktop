#!/bin/sh
# Run on the TV only. No boot hook is installed.
set -eu
grep -q '^ID=starfish' /etc/os-release 2>/dev/null || { echo 'TV-only script: refusing this host' >&2; exit 1; }
[ "$(id -u)" = 0 ] || { echo 'TV root access required' >&2; exit 1; }
BASE=/var/lib/webosbrew/linux-desktop
PIDFILE=$BASE/session.pid
running() {
  [ -r "$PIDFILE" ] || return 1
  pid=$(cat "$PIDFILE")
  case "$pid" in ''|*[!0-9]*) return 1;; esac
  [ "$pid" -gt 1 ] || return 1
  [ -r "/proc/$pid/cmdline" ] || return 1
  tr '\000' ' ' < "/proc/$pid/cmdline" | grep -q "^unshare .* $BASE/namespace.sh "
}
status() {
  if running; then
    if curl -fsS --max-time 2 http://127.0.0.1:6080/vnc.html >/dev/null; then echo running; else echo starting; fi
  else echo stopped; fi
}
case "${1:-status}" in
  status) status;;
  logs) tail -c 12000 "$BASE/session.log" 2>/dev/null || true;;
  start|stop)
    exec 9>"$BASE/control.lock"
    flock -x 9
    if [ "$1" = start ]; then
      if running; then status; exit 0; fi
      [ -r "$BASE/rootfs.squashfs" ] || { echo 'Missing rootfs' >&2; exit 1; }
      free_kb=$(df -k "$BASE" | awk 'END {print $4}')
      [ "$free_kb" -ge 98304 ] || { echo 'Less than 96 MiB free: refusing start' >&2; exit 1; }
      # Never hijack an existing unrelated service.
      for port in 6080 5907; do
        if grep -qi ":$(printf '%04X' "$port") .* 0A " /proc/net/tcp /proc/net/tcp6; then
          echo "Port $port already in use" >&2; exit 1
        fi
      done
      mkdir -p "$BASE/lower" "$BASE/root" "$BASE/upper" "$BASE/work"
      (exec 9>&-; exec setsid unshare -m -p -u -f --kill-child=KILL --propagation private /bin/sh "$BASE/namespace.sh" "$BASE") >"$BASE/session.log" 2>&1 </dev/null &
      echo "$!" > "$PIDFILE"
      echo starting
    else
      if running; then
        # webOS SSH/Homebrew can pass SIGTERM as ignored into subprocesses.
        # Killing the verified unshare supervisor triggers PDEATHSIG=KILL on
        # its namespace init: every descendant and mount is then reclaimed.
        kill -KILL "$pid"
        i=0
        while running; do
          i=$((i+1)); [ "$i" -lt 50 ] || { echo 'Stop timed out; inspect session.log' >&2; exit 1; }
          sleep .1
        done
      fi
      rm -f "$PIDFILE"
      echo stopped
    fi;;
  *) echo 'Usage: control.sh start|stop|status|logs' >&2; exit 2;;
esac
