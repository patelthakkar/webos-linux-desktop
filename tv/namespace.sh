#!/bin/sh
set -eu
grep -q '^ID=starfish' /etc/os-release 2>/dev/null || { echo 'TV-only script: refusing this host' >&2; exit 1; }
[ "$$" = 1 ] || { echo 'Must run as PID 1 in a private mount/PID namespace' >&2; exit 1; }
BASE=$1
MODE=${2:-persistent}
ROOT=$BASE/root
mount -n -t squashfs -o loop,ro "$BASE/rootfs.squashfs" "$BASE/lower"
UPPER=$BASE/upper
WORK=$BASE/work
if [ "$MODE" = incognito ]; then
  # One tmpfs holds both overlay layers: overlayfs requires upperdir and
  # workdir on the same filesystem. Exiting the namespace frees it all.
  mkdir -p "$BASE/incognito"
  mount -n -t tmpfs -o mode=700,size=256m tmpfs "$BASE/incognito"
  mkdir -p "$BASE/incognito/upper" "$BASE/incognito/work"
  UPPER=$BASE/incognito/upper
  WORK=$BASE/incognito/work
fi
mount -n -t overlay overlay -o "lowerdir=$BASE/lower,upperdir=$UPPER,workdir=$WORK" "$ROOT"
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
mount -n -t tmpfs -o mode=755,size=8m tmpfs "$ROOT/run"
mkdir -p "$ROOT/tmp/.X11-unix" "$ROOT/tmp/.ICE-unix"
chmod 1777 "$ROOT/tmp/.X11-unix" "$ROOT/tmp/.ICE-unix"
cp /etc/resolv.conf "$ROOT/etc/resolv.conf"
hostname linux-desktop 2>/dev/null || true
cleanup() { kill -TERM "${child:-}" "${appstore:-}" 2>/dev/null || true; }
trap 'cleanup; exit 0' TERM INT
trap cleanup EXIT
if [ -x "$ROOT/usr/local/bin/linux-desktop-appstore-daemon" ]; then
  chroot "$ROOT" /usr/local/bin/linux-desktop-appstore-daemon &
  appstore=$!
fi
env -i PATH=/usr/sbin:/usr/bin:/sbin:/bin TERM=xterm chroot "$ROOT" /bin/setpriv --reuid=1000 --regid=1000 --clear-groups --bounding-set=-all --no-new-privs /usr/local/bin/desktop-session &
child=$!
# Exiting PID 1 tears down every process and every mount in this session.
while kill -0 "$child" 2>/dev/null; do
  free_kb=$(df -k "$BASE" | awk 'END {print $4}')
  [ "$free_kb" -ge 65536 ] || { echo 'Storage reserve reached: stopping desktop' >&2; exit 1; }
  sleep 2 & wait $! || true
done
wait "$child"
