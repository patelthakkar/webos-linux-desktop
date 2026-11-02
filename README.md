# Linux Desktop for webOS TVs

Alpine Linux XFCE on a rooted LG TV, started from a webOS launcher and shown
through noVNC.

![Linux Desktop launcher](docs/launcher.png)

![XFCE on the TV](docs/desktop.png)

![NetSurf loading HTTPS](docs/browser.png)

![The on-desktop App Store](docs/appstore.png)

Tested on an LG webOS TV running webOS 10.3.1 with an ARM64 kernel and 1.7 GB of
RAM. Other rooted ARM64 webOS TVs may work; a 32-bit-only TV will not run it.

## What you get and need
- Alpine 3.22, XFCE 4.20, 1280 × 720, software rendered. NetSurf 3.11, Terminal,
  Thunar, Mousepad, and a small App Store.
- Settings for live stats, USB and Bluetooth input, incognito, fresh start, and
  About. On-demand startup with no boot hook.
- Rooted LG webOS TV with SSH and Homebrew Channel, webOS 10.0 or newer (tested
  on 10.3.1), about 350 MB free on `/var`, a USB or Bluetooth keyboard and
  mouse, and network access. The Magic Remote is a pointer, not a keyboard.
- Install needs `ssh`, `scp`, `curl`. Build needs ARM64 Linux with `sudo`,
  `curl`, `tar`, `squashfs-tools`, and Node.js 20 or newer.
## Install
The Homebrew package is the launcher; the runtime is a separate 137 MB download.

Runtime:
```sh
curl -LO https://github.com/patelthakkar/webos-linux-desktop/releases/latest/download/linux-desktop-runtime.tar
scp linux-desktop-runtime.tar root@YOUR_TV:/tmp/
ssh root@YOUR_TV 'mkdir -p /var/lib/webosbrew/linux-desktop && tar -xf /tmp/linux-desktop-runtime.tar -C /var/lib/webosbrew/linux-desktop && chmod 755 /var/lib/webosbrew/linux-desktop/*.sh'
```

Check the image with `sha256sum -c rootfs.squashfs.sha256` on the TV, or
`shasum -a 256 -c` on macOS. `bash tv/install.sh` does the same from source.

Launcher:
```sh
npm install
npm run package
ares-install dist/io.github.patelthakkar.linuxdesktop_1.1.0_all.ipk
```

Add `-d <name>` for multiple `ares` devices. If `ares-install` fails with
`Unable to exec`, run `TV_HOST=192.0.2.10 python3 tv/install-app.py`.

Open Linux Desktop and select Start desktop. The first start can take 10 to 20
seconds. Setup required means the runtime is missing.

## Settings
Open the gear in the launcher top bar or the desktop bar.

- Show system stats puts 1-minute load, RAM used and total, free `/var`, and
  uptime in the top bar, refreshed every 6 seconds.
- Incognito uses a 256 MiB RAM overlay. Stop erases its files. Closing the app
  leaves it running until Stop. It refuses below 400 MiB free RAM.
- Fresh start closes the running session before opening the desktop, with a
  confirmation when work will be lost.
- About shows Launcher and Runtime 1.1.0, Patel Thakkar, the repository URL, and
  the Alpine Linux and XFCE versions. Input rows show Detected with the device
  name, or Not connected; Refresh reads the TV kernel with the stats.
  Settings save on the TV; Incognito and Fresh start apply next start.

## Use
Start desktop, Open desktop, Controls, Stop desktop, and Session log. Files
under `/home/desk` persist except in incognito; the desktop does not start on
boot. The 1280 × 720 software-rendered display handles a terminal, text editing,
the browser, and small tools. It is not for video or gaming.


## App Store
The bag icon installs extra Alpine packages into the desktop, separate from
Homebrew Channel. Packages are signed by Alpine and verified by `apk`; the store
never uses `--allow-untrusted`. Installs persist unless Incognito is on. The
store refuses below 64 MB free, removes its APK index after every job, protects
base packages, and accepts only catalog IDs through a root helper. The catalog
covers terminal tools, a file manager, a calculator, an image viewer, and a
screenshot tool.

## SSH tunnel
Both ports listen on loopback only:

```sh
ssh -N -o ExitOnForwardFailure=yes -L 127.0.0.1:6080:127.0.0.1:6080 root@YOUR_TV
```

Open <http://127.0.0.1:6080/vnc.html?autoconnect=true&resize=scale>. There is no
VNC password because neither port is on the LAN; the SSH tunnel authenticates.

## Build
The build needs ARM64 Linux and `sudo`; it does not touch the TV.

```sh
npm install
bash build/build-rootfs.sh
npm test
npm run package
bash release.sh
```

The image is `artifacts/rootfs.squashfs`. Set `DESKTOP_BUILD_DIR` to change the
build directory. Alpine verifies signed packages, top-level versions are pinned
in `build/packages.lock`, and the release SHA-256 pins the artifact. Deploy with
`TV_HOST=192.0.2.10 TV_KEY=~/.ssh/your_tv_key bash tv/install.sh`.

## Release
Upload everything in `dist/` to a GitHub release tagged with the app version:
`linux-desktop-runtime.tar`, `io.github.patelthakkar.linuxdesktop_1.1.0_all.ipk`,
`io.github.patelthakkar.linuxdesktop.manifest.json`, and `SHA256SUMS`. Then fork
[webosbrew/apps-repo](https://github.com/webosbrew/apps-repo), copy
`homebrew/io.github.patelthakkar.linuxdesktop.yml` into `packages/`, and open a
pull request. The URLs assume `patelthakkar/webos-linux-desktop`; update
`scripts/make-manifest.js`, the Homebrew YAML, and `SETUP_URL` in
`webos-app/app.js` if you publish under another name.

## Limits
- No audio, no GPU acceleration, no Firefox or Chromium. NetSurf is limited and
  the App Store catalog is curated and does not auto-update packages.
- ARM64 only. The launcher refuses below 96 MB free on `/var`; a running session
  stops below 64 MB.
- Input detection reads the TV kernel. Passing those devices into the chroot is
  not supported. The chroot shares the TV kernel and network; do not run
  untrusted software.
- The TV's 1.7 GB of RAM is shared with webOS. Close other apps and stop the
  desktop when you are not using it.

## Uninstall
```sh
TV_HOST=192.0.2.10 python3 tv/remove-app.py
ssh root@YOUR_TV '/var/lib/webosbrew/linux-desktop/control.sh stop'
ssh root@YOUR_TV 'rm -rf /var/lib/webosbrew/linux-desktop'
```

The runtime adds no boot service. App Store packages live inside the same
directory; back up anything in `/home/desk` first.

## License
The launcher and build scripts are MIT licensed. See `LICENSE`. The runtime
contains third-party packages under their own licenses. See `THIRD-PARTY.md`
before redistributing the runtime image.
