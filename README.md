# Linux Desktop for webOS TVs

An Alpine Linux XFCE desktop for rooted LG webOS TVs. Includes a terminal,
file manager, text editor, and a small App Store. Starts on demand, with no boot
service.

![Linux Desktop launcher](docs/launcher.png)

## Requirements

- Rooted LG TV with an ARM64 kernel, webOS 10.0 or newer, and SSH access.
- About 350 MB free on `/var` and a USB or Bluetooth keyboard and mouse.
- A computer with `curl`, `ssh`, `scp`, and the webOS CLI configured for your TV.

Tested on webOS 10.3.1 with 1.7 GB of RAM. No audio or GPU acceleration.

## Quick start

1. Download the runtime and launcher from [version 1.2.0](https://github.com/patelthakkar/webos-linux-desktop/releases/tag/v1.2.0):

   ```sh
   curl -fLO https://github.com/patelthakkar/webos-linux-desktop/releases/download/v1.2.0/linux-desktop-runtime.tar
   curl -fLO https://github.com/patelthakkar/webos-linux-desktop/releases/download/v1.2.0/io.github.patelthakkar.linuxdesktop_1.2.0_all.ipk
   ```

2. Copy and unpack the runtime. Replace `YOUR_TV` with the TV's SSH address:

   ```sh
   scp linux-desktop-runtime.tar root@YOUR_TV:/tmp/
   ssh root@YOUR_TV 'mkdir -p /var/lib/webosbrew/linux-desktop && tar -xf /tmp/linux-desktop-runtime.tar -C /var/lib/webosbrew/linux-desktop && cd /var/lib/webosbrew/linux-desktop && sha256sum -c rootfs.squashfs.sha256 && chmod 755 *.sh && rm /tmp/linux-desktop-runtime.tar'
   ```

3. Install the launcher. Replace `YOUR_DEVICE` with your webOS CLI device name:

   ```sh
   ares-install -d YOUR_DEVICE io.github.patelthakkar.linuxdesktop_1.2.0_all.ipk
   ```

4. Open **Linux Desktop** on the TV and choose **Start desktop**. The first start
   takes about 10 to 20 seconds. If it says **Setup required**, check step 2.

## Sessions

Files under `/home/desk` normally persist. Open Settings to change the next start:

- Incognito keeps session files in RAM. **Stop desktop** erases them; closing
  the app leaves the session running. Needs 400 MiB of available RAM.
- Fresh start closes the running session before opening a new one.
- Tor session routes desktop traffic through Tor and keeps session files in a
  384 MiB RAM overlay. Closing or leaving the app ends it and discards those
  files. Needs 500 MiB of available RAM.

For Tor, open **Settings > Tor session > Install**, turn on the switch, then
start the desktop. The optional download is about 5.8 MB and is checked against
its SHA-256. Accept the first-run notices and use **Test Tor** to check the
connection. The switch resets after each session. The App Store is disabled in
Tor sessions; apps that ignore the proxy cannot connect.

Tor applies only to the desktop. The TV firmware and LG services keep their own
network access. The first-run check reports LG data collection settings but does
not change them. This session does not protect against the TV firmware.

Tor is included in the 1.2.0 release; its source changes are in [PR #1](https://github.com/patelthakkar/webos-linux-desktop/pull/1).

## Remote access

The display ports listen on loopback only. To open the desktop from a computer:

```sh
ssh -N -o ExitOnForwardFailure=yes -L 127.0.0.1:6080:127.0.0.1:6080 root@YOUR_TV
```

Then open <http://127.0.0.1:6080/vnc.html?autoconnect=true&resize=scale>.

## Build

On ARM64 Linux with Node.js 20+, `sudo`, `curl`, `tar`, and `squashfs-tools`:

```sh
npm install
bash build/build-rootfs.sh
npm test
npm run package
```

The Tor layer build and release packaging scripts are in the 1.2.0 source branch
linked above. The desktop shares the TV kernel; it is not a virtual machine.

## License

The launcher and scripts are [MIT licensed](LICENSE). Runtime packages have
their own licenses; see [THIRD-PARTY.md](THIRD-PARTY.md).
