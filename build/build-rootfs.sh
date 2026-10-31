#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
project=$PWD
work=${DESKTOP_BUILD_DIR:-/tmp/opencode/linux-desktop-build}
mkdir -p "$work" artifacts
base=https://dl-cdn.alpinelinux.org/alpine/v3.22/releases/aarch64
archive=alpine-minirootfs-3.22.7-aarch64.tar.gz
curl -fL --retry 3 "$base/$archive" -o "$work/$archive"
curl -fsSL "$base/$archive.sha256" -o "$work/$archive.sha256"
(cd "$work" && sha256sum -c "$archive.sha256")
root="$work/root"
if [ -e "$root" ]; then echo "Build directory already exists: $root; choose a new DESKTOP_BUILD_DIR" >&2; exit 1; fi
sudo mkdir "$root"
sudo tar -xzf "$work/$archive" -C "$root"
sudo cp /etc/resolv.conf "$root/etc/resolv.conf"
printf '%s\n' 'https://dl-cdn.alpinelinux.org/alpine/v3.22/main' 'https://dl-cdn.alpinelinux.org/alpine/v3.22/community' | sudo tee "$root/etc/apk/repositories" >/dev/null
# Mount only in a disposable namespace, never into the phone's global namespace.
sudo unshare -m --propagation private bash -s -- "$root" "$project" <<'BUILD'
set -euo pipefail
root=$1
project=$2
mount -t proc proc "$root/proc"
mount --rbind /dev "$root/dev"
mount --make-rslave "$root/dev"
mount -t tmpfs tmpfs "$root/tmp"
packages=$(cat "$project/build/packages.lock" 2>/dev/null || cat "$project/build/packages.txt")
chroot "$root" /sbin/apk add --no-cache $packages
chroot "$root" /usr/sbin/adduser -D -u 1000 desk
chroot "$root" /bin/sh -c 'passwd -l desk; mkdir -p /home/desk/.config/xfce4/xfconf/xfce-perchannel-xml; chown -R desk:desk /home/desk'
BUILD
sudo install -m 755 build/session.sh "$root/usr/local/bin/desktop-session"
sudo rm -f "$root/etc/xdg/autostart/thunar-daemon.desktop"
sudo python3 build/patch-xfce-session.py "$root/etc/xdg/xfce4/xfconf/xfce-perchannel-xml/xfce4-session.xml"
sudo rm -f "$root"/usr/share/dbus-1/services/org.xfce.FileManager.service "$root"/usr/share/dbus-1/services/org.xfce.Thunar.service "$root"/usr/share/dbus-1/services/org.xfce.Thunar.FileManager1.service
sudo install -d "$root/usr/local/share/linux-desktop-appstore" "$root/usr/share/applications" "$root/home/desk/Downloads"
sudo install -m 755 build/appstore/appstore-daemon.py "$root/usr/local/bin/linux-desktop-appstore-daemon"
sudo install -m 755 build/appstore/appstore-gui.py "$root/usr/local/bin/linux-desktop-appstore"
sudo install -m 644 build/appstore/catalog.json "$root/usr/local/share/linux-desktop-appstore/catalog.json"
sudo install -m 644 build/appstore/linux-desktop-appstore.desktop "$root/usr/share/applications/linux-desktop-appstore.desktop"
sudo cp "$root/usr/share/novnc/vnc.html" "$root/usr/share/novnc/vnc_tv.html"
sudo sed -i 's|</head>|<style>#noVNC_control_bar_anchor, #noVNC_status, #noVNC_transition, #noVNC_connect_dlg { display:none !important; } body { background-color:#000 !important; }</style></head>|' "$root/usr/share/novnc/vnc_tv.html"
sudo mkdir -p "$root/home/desk/.config/xfce4/xfconf/xfce-perchannel-xml"
sudo cp build/xfwm4.xml "$root/home/desk/.config/xfce4/xfconf/xfce-perchannel-xml/xfwm4.xml"
sudo cp build/xfce4-panel.xml "$root/home/desk/.config/xfce4/xfconf/xfce-perchannel-xml/xfce4-panel.xml"
for entry in '2 terminal' '3 files' '4 editor' '5 browser' '6 appstore'; do
  read -r id name <<< "$entry"
  sudo mkdir -p "$root/home/desk/.config/xfce4/panel/launcher-$id"
  sudo cp "build/launchers/$name.desktop" "$root/home/desk/.config/xfce4/panel/launcher-$id/"
done
sudo chown -R 1000:1000 "$root/home/desk"
sudo mksquashfs "$root" artifacts/rootfs.squashfs -noappend -comp xz -processors 2 -no-progress
(cd artifacts && sha256sum rootfs.squashfs > rootfs.squashfs.sha256)
du -h artifacts/rootfs.squashfs
