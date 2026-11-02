#!/usr/bin/env bash
# Build the optional Tor layer: Tor, torsocks, socat, iproute2, and the
# session scripts. It is a read-only squashfs mounted over the runtime rootfs.
set -euo pipefail
cd "$(dirname "$0")/.."
project=$PWD
work=${TAILS_BUILD_DIR:-/tmp/opencode/linux-desktop-tails}
base=https://dl-cdn.alpinelinux.org/alpine/v3.22/releases/aarch64
archive=alpine-minirootfs-3.22.7-aarch64.tar.gz
root=$work/root
layer=$work/layer
mkdir -p "$work" artifacts

if [ ! -e "$root" ]; then
  curl -fL --retry 3 "$base/$archive" -o "$work/$archive"
  curl -fsSL "$base/$archive.sha256" -o "$work/$archive.sha256"
  (cd "$work" && sha256sum -c "$archive.sha256")
  mkdir -p "$root"
  sudo tar -xzf "$work/$archive" -C "$root"
fi

sudo cp /etc/resolv.conf "$root/etc/resolv.conf"
printf '%s\n' \
  'https://dl-cdn.alpinelinux.org/alpine/v3.22/main' \
  'https://dl-cdn.alpinelinux.org/alpine/v3.22/community' | sudo tee "$root/etc/apk/repositories" >/dev/null
# Keep the pristine package list so rebuilds on an already-used chroot still
# diff against the minirootfs, not against the previous build.
if [ ! -e "$work/installed.base" ]; then
  sudo cp "$root/lib/apk/db/installed" "$work/installed.base"
fi
cp "$work/installed.base" "$work/installed.before"

# Mount only in a disposable namespace, never into the phone's global namespace.
sudo unshare -m --propagation private bash -s -- "$root" <<'BUILD'
set -euo pipefail
root=$1
mount -t proc proc "$root/proc"
mount --rbind /dev "$root/dev"
mount --make-rslave "$root/dev"
mount -t tmpfs tmpfs "$root/tmp"
chroot "$root" /sbin/apk add --no-cache tor torsocks socat iproute2
BUILD

sudo cp "$root/lib/apk/db/installed" "$work/installed.after"
python3 - "$work/installed.before" "$work/installed.after" "$work/packages.txt" <<'PY'
import sys

def parse(path):
    packages, current = {}, None
    with open(path, encoding='utf-8', errors='replace') as handle:
        for line in handle:
            line = line.rstrip('\n')
            if not line:
                if current:
                    packages[current['P']] = current
                current = None
                continue
            if line[0] in 'PNV':
                key, value = line[0], line[2:]
                if current is None:
                    current = {}
                current[key] = value
    if current:
        packages[current['P']] = current
    return packages

before = parse(sys.argv[1])
after = parse(sys.argv[2])
new = sorted(set(after) - set(before))
upgraded = sorted(p for p in set(after) & set(before) if after[p].get('V') != before[p].get('V'))
if upgraded:
    raise SystemExit(f'Refusing to build: packages would be upgraded ({", ".join(upgraded)})')
with open(sys.argv[3], 'w') as out:
    for name in new:
        out.write(name + '\n')
print(f'{len(new)} new packages, no upgrades')
PY

sudo rm -rf "$layer"
sudo mkdir -p "$layer"
while IFS= read -r name; do
  [ -n "$name" ] || continue
  sudo chroot "$root" /sbin/apk info -L "$name" | sed -n '/contains:$/,$p' | tail -n +2 |
    while IFS= read -r file; do
      [ -n "$file" ] || continue
      sudo mkdir -p "$layer/$(dirname "$file")"
      sudo cp -a "$root/$file" "$layer/$file"
    done
done < "$work/packages.txt"

sudo cp -a build/tails/. "$layer/"
sudo chown -R root:root "$layer"
sudo chmod 755 "$layer"/usr/local/bin/*
sudo mksquashfs "$layer" artifacts/tails.squashfs -noappend -comp xz -processors 2 -no-progress
(cd artifacts && sha256sum tails.squashfs > tails.squashfs.sha256)
du -h artifacts/tails.squashfs
