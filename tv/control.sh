#!/bin/sh
# Run on the TV only. No boot hook is installed.
set -eu
PATH=/usr/sbin:/usr/bin:/sbin:/bin
export PATH
VERSION=1.1.0

# stats and inputs are pure reads. The fixture path lets the parser run off
# the TV without touching a session or a TV setting.
TEST_MODE=${LINUX_DESKTOP_TEST:-0}
if [ "$TEST_MODE" = 1 ]; then
  [ "${1:-status}" = stats ] || { echo 'Test mode only supports stats' >&2; exit 2; }
else
  grep -q '^ID=starfish' /etc/os-release 2>/dev/null || { echo 'TV-only script: refusing this host' >&2; exit 1; }
  [ "$(id -u)" = 0 ] || { echo 'TV root access required' >&2; exit 1; }
fi

BASE=${LINUX_DESKTOP_BASE:-/var/lib/webosbrew/linux-desktop}
PIDFILE=$BASE/session.pid
MODE_FILE=$BASE/session.mode
INPUTS_FILE=${LINUX_DESKTOP_INPUTS:-/proc/bus/input/devices}

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

stats() {
  mem_total=$(awk '/^MemTotal:/ {print $2}' /proc/meminfo 2>/dev/null || true)
  mem_avail=$(awk '/^MemAvailable:/ {print $2}' /proc/meminfo 2>/dev/null || true)
  [ -n "${mem_total:-}" ] || mem_total=0
  [ -n "${mem_avail:-}" ] || mem_avail=0
  if [ "$mem_avail" = 0 ]; then
    mem_avail=$(awk '/^MemFree:|^Buffers:|^Cached:/ {sum += $2} END {print sum + 0}' /proc/meminfo 2>/dev/null || echo 0)
  fi
  mem_used=$((mem_total - mem_avail))
  [ "$mem_used" -ge 0 ] || mem_used=0
  var_free=$(df -k "$BASE" 2>/dev/null | awk 'END {print $4}' || true)
  [ -n "${var_free:-}" ] || var_free=0
  uptime_sec=$(awk '{print int($1)}' /proc/uptime 2>/dev/null || true)
  [ -n "${uptime_sec:-}" ] || uptime_sec=0
  load=$(awk '{print $1}' /proc/loadavg 2>/dev/null || true)
  [ -n "${load:-}" ] || load=0
  mode=persistent
  if running && [ "$(cat "$MODE_FILE" 2>/dev/null || true)" = incognito ]; then
    mode=incognito
  fi
  printf '{"runtimeVersion":"%s","load":"%s","memTotal":%s,"memUsed":%s,"varFree":%s,"uptime":%s,"mode":"%s"}\n' \
    "$VERSION" "$load" "$mem_total" "$mem_used" "$var_free" "$uptime_sec" "$mode"
}

inputs() {
  if [ -r "$BASE/input-devices.sh" ]; then
    sh "$BASE/input-devices.sh" "$INPUTS_FILE"
  else
    printf '%s\n' \
      'usb_keyboard=0' 'usb_keyboard_name=' \
      'usb_pointer=0' 'usb_pointer_name=' \
      'bt_keyboard=0' 'bt_keyboard_name=' \
      'bt_pointer=0' 'bt_pointer_name='
  fi
}

case "${1:-status}" in
  status) status;;
  logs) tail -c 12000 "$BASE/session.log" 2>/dev/null || true;;
  stats) stats;;
  inputs) inputs;;
  start)
    mode=${2:-persistent}
    [ "${INCOGNITO:-0}" = 1 ] && mode=incognito
    case "$mode" in
      persistent|incognito) ;;
      *) echo 'Usage: control.sh start [persistent|incognito]' >&2; exit 2;;
    esac
    exec 9>"$BASE/control.lock"
    flock -x 9
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
    if [ "$mode" = incognito ]; then
      mem_avail=$(awk '/^MemAvailable:/ {print $2}' /proc/meminfo 2>/dev/null || true)
      [ -n "${mem_avail:-}" ] || mem_avail=0
      [ "$mem_avail" -ge 409600 ] || { echo 'Less than 400 MiB available: refusing incognito start' >&2; exit 1; }
    fi
    mkdir -p "$BASE/lower" "$BASE/root" "$BASE/upper" "$BASE/work"
    printf '%s\n' "$mode" > "$MODE_FILE"
    (exec 9>&-; exec setsid unshare -m -p -u -f --kill-child=KILL --propagation private /bin/sh "$BASE/namespace.sh" "$BASE" "$mode") >"$BASE/session.log" 2>&1 </dev/null &
    echo "$!" > "$PIDFILE"
    echo starting
    ;;
  stop)
    exec 9>"$BASE/control.lock"
    flock -x 9
    if running; then
      # webOS SSH/Homebrew can pass SIGTERM as ignored into subprocesses.
      # Killing the verified unshare supervisor triggers PDEATHSIG=KILL on
      # its namespace init: every descendant and mount is then reclaimed.
      pid=$(cat "$PIDFILE")
      kill -KILL "$pid"
      i=0
      while running; do
        i=$((i+1)); [ "$i" -lt 50 ] || { echo 'Stop timed out; inspect session.log' >&2; exit 1; }
        sleep .1
      done
    fi
    rm -f "$PIDFILE" "$MODE_FILE"
    echo stopped
    ;;
  *)
    echo 'Usage: control.sh start [persistent|incognito]|stop|status|logs|stats|inputs' >&2
    exit 2
    ;;
esac
