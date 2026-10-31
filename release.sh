#!/usr/bin/env bash
# Build the runtime image, webOS package, and Homebrew manifest.
# Upload everything in dist/ to one GitHub release.
set -euo pipefail
cd "$(dirname "$0")"

if [ "${1:-}" != "--skip-rootfs" ]; then
  bash build/build-rootfs.sh
fi

[ -r artifacts/rootfs.squashfs ] || { echo 'Missing artifacts/rootfs.squashfs' >&2; exit 1; }
[ -r artifacts/rootfs.squashfs.sha256 ] || { echo 'Missing artifacts/rootfs.squashfs.sha256' >&2; exit 1; }

rm -rf dist
mkdir -p dist/runtime
cp artifacts/rootfs.squashfs artifacts/rootfs.squashfs.sha256 dist/runtime/
cp tv/control.sh tv/namespace.sh tv/input-devices.sh THIRD-PARTY.md dist/runtime/
tar -cf dist/linux-desktop-runtime.tar -C dist/runtime .
rm -rf dist/runtime

if command -v ares-package >/dev/null 2>&1; then
  ares-package --outdir dist webos-app
else
  npx --no-install ares-package --outdir dist webos-app
fi

node scripts/make-manifest.js
(cd dist && sha256sum *.ipk *.manifest.json *.tar > SHA256SUMS)
ls -lh dist
