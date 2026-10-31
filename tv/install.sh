#!/usr/bin/env bash
# Deploy the Linux runtime image to a rooted TV. Run this on the computer, not the TV.
set -euo pipefail
cd "$(dirname "$0")/.."

: "${TV_HOST:?Set TV_HOST to the TV address, for example TV_HOST=192.0.2.10}"
TV_PORT=${TV_PORT:-22}
TV_USER=${TV_USER:-root}
TV_KEY=${TV_KEY:-$HOME/.ssh/lgtv_root_ed25519}
BASE=/var/lib/webosbrew/linux-desktop
REMOTE="$TV_USER@$TV_HOST"

[ -r "$TV_KEY" ] || { echo "SSH key not found: $TV_KEY" >&2; exit 1; }
[ -r artifacts/rootfs.squashfs ] || { echo 'Build the runtime first: bash build/build-rootfs.sh' >&2; exit 1; }
[ -r artifacts/rootfs.squashfs.sha256 ] || { echo 'Missing artifacts/rootfs.squashfs.sha256' >&2; exit 1; }

ssh_opts=(-i "$TV_KEY" -p "$TV_PORT" -o BatchMode=yes -o ConnectTimeout=10 -o StrictHostKeyChecking=accept-new)
(cd artifacts && sha256sum -c rootfs.squashfs.sha256)
expected=$(sha256sum artifacts/rootfs.squashfs | cut -d ' ' -f1)

ssh "${ssh_opts[@]}" "$REMOTE" "test ! -e '$BASE/rootfs.squashfs' && mkdir -p '$BASE'"
size=$(du -k artifacts/rootfs.squashfs | cut -f1)
available=$(ssh "${ssh_opts[@]}" "$REMOTE" "df -k '$BASE' | awk 'END {print \$4}'")
if (( available - size < 102400 )); then
  echo 'The image would leave less than 100 MiB free on the TV. Not deploying.' >&2
  exit 1
fi

tar -cf - tv/control.sh tv/namespace.sh tv/input-devices.sh artifacts/rootfs.squashfs |
  ssh "${ssh_opts[@]}" "$REMOTE" "set -eu; cd '$BASE'; tar -xf -; echo '$expected  artifacts/rootfs.squashfs' | sha256sum -c -; mv artifacts/rootfs.squashfs rootfs.squashfs; mv tv/control.sh tv/namespace.sh tv/input-devices.sh .; rmdir artifacts tv; chmod 755 control.sh namespace.sh input-devices.sh"
ssh "${ssh_opts[@]}" "$REMOTE" "echo '$expected  $BASE/rootfs.squashfs' | sha256sum -c -"
