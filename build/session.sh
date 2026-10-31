#!/bin/sh
set -eu
export HOME=/home/desk USER=desk LOGNAME=desk DISPLAY=:7
export XDG_RUNTIME_DIR=/tmp/runtime-desk
export XDG_SESSION_TYPE=x11 XDG_CURRENT_DESKTOP=XFCE
export LIBGL_ALWAYS_SOFTWARE=1
cd "$HOME"
mkdir -p "$XDG_RUNTIME_DIR" /tmp/.X11-unix
chmod 700 "$XDG_RUNTIME_DIR"
cleanup() { kill "$vnc" "${ws:-}" "${desktop:-}" 2>/dev/null || true; }
trap cleanup EXIT
trap 'exit 0' TERM INT
Xvnc :7 -geometry 1280x720 -depth 24 -desktop "Linux Desktop" -localhost -rfbport 5907 -SecurityTypes None -AlwaysShared -FrameRate 20 -nolisten tcp &
vnc=$!
i=0
while [ ! -S /tmp/.X11-unix/X7 ]; do
  kill -0 "$vnc"
  i=$((i+1)); [ "$i" -lt 100 ] || exit 1
  sleep .1
done
websockify --web /usr/share/novnc 127.0.0.1:6080 127.0.0.1:5907 &
ws=$!
dbus-run-session -- xfce4-session &
desktop=$!
while kill -0 "$vnc" "$ws" "$desktop" 2>/dev/null; do sleep 2; done
exit 1
