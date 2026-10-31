#!/bin/sh
set -eu
grep -q '^ID=starfish' /etc/os-release 2>/dev/null || { echo 'TV-only script: refusing this host' >&2; exit 1; }
[ "$$" = 1 ] || { echo 'Must run as PID 1 in a private mount/PID namespace' >&2; exit 1; }
BASE=$1
MODE=${2:-persistent}
ROOT=$BASE/root
TAILS_LOWER=$BASE/tails/lower
LOWER=$BASE/lower
UPPER=$BASE/upper
WORK=$BASE/work
RUN_SIZE=8m
if [ "$MODE" = tails ]; then
  mkdir -p "$TAILS_LOWER"
  mount -n -t squashfs -o loop,ro "$BASE/tails.squashfs" "$TAILS_LOWER"
  LOWER=$TAILS_LOWER:$BASE/lower
  RUN_SIZE=32m
fi
mount -n -t squashfs -o loop,ro "$BASE/rootfs.squashfs" "$BASE/lower"
if [ "$MODE" = incognito ] || [ "$MODE" = tails ]; then
  # One tmpfs holds both overlay layers: overlayfs requires upperdir and
  # workdir on the same filesystem. Exiting the namespace frees it all.
  mkdir -p "$BASE/incognito"
  size=256m
  [ "$MODE" = tails ] && size=384m
  mount -n -t tmpfs -o mode=700,size=$size tmpfs "$BASE/incognito"
  mkdir -p "$BASE/incognito/upper" "$BASE/incognito/work"
  UPPER=$BASE/incognito/upper
  WORK=$BASE/incognito/work
fi
mount -n -t overlay overlay -o "lowerdir=$LOWER,upperdir=$UPPER,workdir=$WORK" "$ROOT"
mount -n -t proc proc "$ROOT/proc"
mount -n -t tmpfs -o mode=755,size=4m tmpfs "$ROOT/dev"
for spec in 'null 1 3 666' 'zero 1 5 666' 'random 1 8 666' 'urandom 1 9 666' 'tty 5 0 666'; do
  set -- $spec
  mknod -m "$4" "$ROOT/dev/$1" c "$2" "$3"
done
mkdir -p "$ROOT/dev/pts" "$ROOT/dev/shm"
mount -n -t devpts -o newinstance,ptmxmode=0666,mode=0620 devpts "$ROOT/dev/pts"
ln -s pts/ptmx "$ROOT/dev/ptmx"
ln -s /proc/self/fd "$ROOT/dev/fd"
mount -n -t tmpfs -o mode=1777,size=64m tmpfs "$ROOT/dev/shm"
mount -n -t tmpfs -o mode=1777,size=96m tmpfs "$ROOT/tmp"
mount -n -t tmpfs -o mode=755,size=$RUN_SIZE tmpfs "$ROOT/run"
mkdir -p "$ROOT/tmp/.X11-unix" "$ROOT/tmp/.ICE-unix"
chmod 1777 "$ROOT/tmp/.X11-unix" "$ROOT/tmp/.ICE-unix"
if [ "$MODE" = tails ]; then
  # No DNS, no LAN, no TV services: the session starts with loopback only.
  printf 'nameserver 127.0.0.1\n' > "$ROOT/etc/resolv.conf"
  hostname amnesia 2>/dev/null || true
  mkdir -p "$ROOT/run/tails"
  chown 1000:1000 "$ROOT/run/tails"
  chmod 700 "$ROOT/run/tails"
else
  cp /etc/resolv.conf "$ROOT/etc/resolv.conf"
  hostname linux-desktop 2>/dev/null || true
fi
cleanup() { kill -TERM "${child:-}" "${appstore:-}" 2>/dev/null || true; }
trap 'cleanup; exit 0' TERM INT
trap cleanup EXIT
if [ "$MODE" != tails ] && [ -x "$ROOT/usr/local/bin/linux-desktop-appstore-daemon" ]; then
  chroot "$ROOT" /usr/local/bin/linux-desktop-appstore-daemon &
  appstore=$!
fi
if [ "$MODE" = tails ]; then
  chroot "$ROOT" /usr/local/bin/tails-desktop-session &
  child=$!
else
  env -i PATH=/usr/sbin:/usr/bin:/sbin:/bin TERM=xterm chroot "$ROOT" /bin/setpriv --reuid=1000 --regid=1000 --clear-groups --bounding-set=-all --no-new-privs /usr/local/bin/desktop-session &
  child=$!
fi
# Exiting PID 1 tears down every process and every mount in this session.
while kill -0 "$child" 2>/dev/null; do
  free_kb=$(df -k "$BASE" | awk 'END {print $4}')
  [ "$free_kb" -ge 65536 ] || { echo 'Storage reserve reached: stopping desktop' >&2; exit 1; }
  sleep 2 & wait $! || true
done
wait "$child"
