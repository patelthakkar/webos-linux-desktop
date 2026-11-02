#!/bin/sh
# Run on the TV only. No boot hook is installed.
set -eu
PATH=/usr/sbin:/usr/bin:/sbin:/bin
export PATH
VERSION=1.2.0

# stats and inputs are pure reads. The fixture path lets the parser run off
# the TV without touching a session or a TV setting.
TEST_MODE=${LINUX_DESKTOP_TEST:-0}
if [ "$TEST_MODE" = 1 ]; then
  [ "${1:-status}" = stats ] || [ "${1:-}" = telemetry ] || {
    echo 'Test mode only supports stats and telemetry' >&2; exit 2;
  }
else
  grep -q '^ID=starfish' /etc/os-release 2>/dev/null || { echo 'TV-only script: refusing this host' >&2; exit 1; }
  [ "$(id -u)" = 0 ] || { echo 'TV root access required' >&2; exit 1; }
fi

BASE=${LINUX_DESKTOP_BASE:-/var/lib/webosbrew/linux-desktop}
PIDFILE=$BASE/session.pid
MODE_FILE=$BASE/session.mode
INPUTS_FILE=${LINUX_DESKTOP_INPUTS:-/proc/bus/input/devices}
TAILS_LAYER=$BASE/tails.squashfs
TAILS_DIR=$BASE/tails
TAILS_STATE=$TAILS_DIR/state
TAILS_HEARTBEAT=$TAILS_DIR/heartbeat
TAILS_WATCHDOG=$TAILS_DIR/watchdog.pid
TAILS_VERSION=1.2.0
TAILS_URL=${TAILS_URL:-https://github.com/patelthakkar/webos-linux-desktop/releases/download/v1.2.0/linux-desktop-tails.squashfs}
HB_TIMEOUT=${TAILS_HB_TIMEOUT:-30}

running() {
  [ -r "$PIDFILE" ] || return 1
  pid=$(cat "$PIDFILE")
  case "$pid" in ''|*[!0-9]*) return 1;; esac
  [ "$pid" -gt 1 ] || return 1
  [ -r "/proc/$pid/cmdline" ] || return 1
  tr '\000' ' ' < "/proc/$pid/cmdline" | grep -q "^unshare .* $BASE/namespace.sh "
}

mode() {
  running || { echo persistent; return; }
  cat "$MODE_FILE" 2>/dev/null || echo persistent
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
  session_mode=persistent
  if running; then
    stored=$(cat "$MODE_FILE" 2>/dev/null || true)
    case "$stored" in incognito|tails) session_mode=$stored;; esac
  fi
  printf '{"runtimeVersion":"%s","load":"%s","memTotal":%s,"memUsed":%s,"varFree":%s,"uptime":%s,"mode":"%s"}\n' \
    "$VERSION" "$load" "$mem_total" "$mem_used" "$var_free" "$uptime_sec" "$session_mode"
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

# --- Tor session -------------------------------------------------------

tails_installed() {
  [ -r "$TAILS_LAYER" ] && [ -s "$TAILS_LAYER" ]
}

tails_get() {
  [ -r "$TAILS_STATE" ] || return 0
  sed -n "s/^$1=//p" "$TAILS_STATE" 2>/dev/null | tail -n 1
}

tails_set() {
  mkdir -p "$TAILS_DIR"
  tmp=$TAILS_STATE.$$
  { grep -v "^$1=" "$TAILS_STATE" 2>/dev/null || true; printf '%s=%s\n' "$1" "$2"; } > "$tmp"
  mv "$tmp" "$TAILS_STATE"
}

tails_telemetry() {
  if [ -r "$BASE/telemetry-check.sh" ]; then
    sh "$BASE/telemetry-check.sh"
  else
    printf '%s\n' '{"ok":false,"checked":0,"unknown":0,"blockerRules":0,"issues":[],"items":[]}'
  fi
}

tails_status() {
  installed=false
  bytes=0
  version=
  if tails_installed; then
    installed=true
    bytes=$(wc -c < "$TAILS_LAYER" | tr -d ' ')
    version=$(tails_get version)
  fi
  ack=false
  [ "$(tails_get ack)" = 1 ] && ack=true
  telemetry_ack=false
  [ "$(tails_get telemetry_ack)" = 1 ] && telemetry_ack=true
  printf '{"installed":%s,"version":"%s","bytes":%s,"ack":%s,"telemetryAck":%s,"session":"%s","mode":"%s","heartbeat":%s,"telemetry":%s}\n' \
    "$installed" "$version" "$bytes" "$ack" "$telemetry_ack" "$(status)" "$(mode)" \
    "$([ -r "$TAILS_HEARTBEAT" ] && cat "$TAILS_HEARTBEAT" || echo 0)" "$(tails_telemetry)"
}

tails_install() {
  need_kb=40960
  free_kb=$(df -k "$BASE" | awk 'END {print $4}')
  [ "$free_kb" -ge "$need_kb" ] || { echo 'Less than 40 MiB free on /var' >&2; exit 1; }
  mkdir -p "$TAILS_DIR"
  part=$TAILS_LAYER.part
  sum=$TAILS_LAYER.sum
  rm -f "$part" "$sum"
  if [ -n "${TAILS_SOURCE:-}" ]; then
    [ -r "$TAILS_SOURCE" ] || { echo "Missing $TAILS_SOURCE" >&2; exit 1; }
    cp "$TAILS_SOURCE" "$part"
    if [ -r "$TAILS_SOURCE.sha256" ]; then
      cp "$TAILS_SOURCE.sha256" "$sum"
    else
      sha256sum "$part" > "$sum"
    fi
  else
    curl -fL --retry 3 --max-time 600 "$TAILS_URL" -o "$part" >/dev/null 2>&1 || {
      rm -f "$part"; echo 'Tor session download failed' >&2; exit 1;
    }
    curl -fsSL --retry 3 --max-time 60 "$TAILS_URL.sha256" -o "$sum" >/dev/null 2>&1 || {
      rm -f "$part" "$sum"; echo 'Tor session checksum download failed' >&2; exit 1;
    }
  fi
  want=$(awk '{print $1; exit}' "$sum")
  case "$want" in
    *[!0-9a-f]*|'') rm -f "$part" "$sum"; echo 'Invalid Tor session checksum' >&2; exit 1;;
  esac
  [ ${#want} -eq 64 ] || { rm -f "$part" "$sum"; echo 'Invalid Tor session checksum' >&2; exit 1; }
  got=$(sha256sum "$part" | awk '{print $1}')
  [ "$got" = "$want" ] || { rm -f "$part" "$sum"; echo 'Tor session checksum mismatch' >&2; exit 1; }
  mv "$part" "$TAILS_LAYER"
  printf '%s\n' "$want" > "$TAILS_DIR/layer.sha256"
  rm -f "$sum" "$TAILS_STATE"
  tails_set version "$TAILS_VERSION"
  echo installed
}

tails_remove() {
  if running && [ "$(mode)" = tails ]; then
    echo 'Stop the Tor session before removing it' >&2; exit 1
  fi
  rm -f "$TAILS_LAYER" "$TAILS_DIR/layer.sha256"
  rm -f "$TAILS_STATE"
  echo removed
}

tails_ack() {
  case "${2:-}" in
    notice) tails_set ack 1; echo ok;;
    telemetry) tails_set telemetry_ack 1; echo ok;;
    *) echo 'Usage: control.sh tails-ack notice|telemetry' >&2; exit 2;;
  esac
}

tails_heartbeat() {
  running && [ "$(mode)" = tails ] || { echo 'No Tor session' >&2; exit 1; }
  mkdir -p "$TAILS_DIR"
  # Atomic replace: a short read must never look like a stale heartbeat.
  date +%s > "$TAILS_HEARTBEAT.new"
  mv "$TAILS_HEARTBEAT.new" "$TAILS_HEARTBEAT"
  echo ok
}

tails_net() {
  running && [ "$(mode)" = tails ] || { echo '{"tor":false,"reason":"no-session"}'; return 0; }
  if curl -fsS --max-time 10 --socks5-hostname 127.0.0.1:9050 \
      https://check.torproject.org/api/ip 2>/dev/null | grep -q '"IsTor":true'; then
    echo '{"tor":true}'
  else
    echo '{"tor":false,"reason":"probe-failed"}'
  fi
}

tails_watchdog_start() {
  mkdir -p "$TAILS_DIR"
  if [ -r "$TAILS_WATCHDOG" ] && kill -0 "$(cat "$TAILS_WATCHDOG" 2>/dev/null)" 2>/dev/null; then
    return 0
  fi
  date +%s > "$TAILS_HEARTBEAT"
  ( exec 9>&-; exec setsid sh "$BASE/tails-watchdog.sh" "$BASE" "$HB_TIMEOUT" ) >/dev/null 2>&1 &
}

tails_watchdog_stop() {
  if [ -r "$TAILS_WATCHDOG" ]; then
    kill -KILL "$(cat "$TAILS_WATCHDOG" 2>/dev/null)" 2>/dev/null || true
    rm -f "$TAILS_WATCHDOG"
  fi
}

tail_check_start() {
  tails_installed || { echo 'Tor session is not installed' >&2; exit 3; }
  [ "$(tails_get ack)" = 1 ] || { echo 'Tor session first-run notice not accepted' >&2; exit 4; }
  if [ "$(tails_get telemetry_ack)" != 1 ]; then
    tm=$(tails_telemetry)
    case "$tm" in
      *'"ok":true'*) ;;
      *) echo 'Tor session telemetry warning not accepted' >&2; exit 5;;
    esac
  fi
}

# --- commands ----------------------------------------------------------

case "${1:-status}" in
  status) status;;
  logs) tail -c 12000 "$BASE/session.log" 2>/dev/null || true;;
  stats) stats;;
  inputs) inputs;;
  telemetry) tails_telemetry;;
  tails-status) tails_status;;
  tails-install) tails_install;;
  tails-remove) tails_remove;;
  tails-ack) tails_ack "$@";;
  tails-net) tails_net;;
  tails-heartbeat) tails_heartbeat;;
  start)
    new_mode=${2:-persistent}
    [ "${INCOGNITO:-0}" = 1 ] && new_mode=incognito
    [ "${TAILS:-0}" = 1 ] && new_mode=tails
    case "$new_mode" in
      persistent|incognito|tails) ;;
      *) echo 'Usage: control.sh start [persistent|incognito|tails]' >&2; exit 2;;
    esac
    exec 9>"$BASE/control.lock"
    flock -x 9
    if running; then status; exit 0; fi
    [ -r "$BASE/rootfs.squashfs" ] || { echo 'Missing rootfs' >&2; exit 1; }
    if [ "$new_mode" = tails ]; then
      tail_check_start
      [ -r "$BASE/tails.squashfs" ] || { echo 'Tor session is not installed' >&2; exit 3; }
    fi
    free_kb=$(df -k "$BASE" | awk 'END {print $4}')
    [ "$free_kb" -ge 98304 ] || { echo 'Less than 96 MiB free: refusing start' >&2; exit 1; }
    # Never hijack an existing unrelated service.
    for port in 6080 5907 9050; do
      [ "$port" = 9050 ] && [ "$new_mode" != tails ] && continue
      if grep -qi ":$(printf '%04X' "$port") .* 0A " /proc/net/tcp /proc/net/tcp6; then
        echo "Port $port already in use" >&2; exit 1
      fi
    done
    if [ "$new_mode" = incognito ] || [ "$new_mode" = tails ]; then
      mem_avail=$(awk '/^MemAvailable:/ {print $2}' /proc/meminfo 2>/dev/null || true)
      [ -n "${mem_avail:-}" ] || mem_avail=0
      need=409600
      [ "$new_mode" = tails ] && need=512000
      [ "$mem_avail" -ge "$need" ] || { echo "Less than $((need / 1024)) MiB available: refusing $new_mode start" >&2; exit 1; }
    fi
    mkdir -p "$BASE/lower" "$BASE/root" "$BASE/upper" "$BASE/work"
    printf '%s\n' "$new_mode" > "$MODE_FILE"
    if [ "$new_mode" = tails ]; then
      mkdir -p "$TAILS_DIR"
      date +%s > "$TAILS_HEARTBEAT"
    fi
    (exec 9>&-; exec setsid unshare -m -p -u -f --kill-child=KILL --propagation private /bin/sh "$BASE/namespace.sh" "$BASE" "$new_mode") >"$BASE/session.log" 2>&1 </dev/null &
    echo "$!" > "$PIDFILE"
    if [ "$new_mode" = tails ]; then tails_watchdog_start; fi
    echo starting
    ;;
  stop)
    exec 9>"$BASE/control.lock"
    flock -x 9
    tails_watchdog_stop
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
    rm -f "$PIDFILE" "$MODE_FILE" "$TAILS_HEARTBEAT"
    echo stopped
    ;;
  *)
    echo 'Usage: control.sh start [persistent|incognito|tails]|stop|status|logs|stats|inputs|telemetry|tails-status|tails-install|tails-remove|tails-ack|tails-net|tails-heartbeat' >&2
    exit 2
    ;;
esac
