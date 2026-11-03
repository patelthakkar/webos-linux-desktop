# Linux Desktop for webOS TVs

An Alpine Linux XFCE desktop for rooted LG webOS TVs. Includes a terminal,
file manager, text editor, and a small App Store. Starts on demand, with no boot
service.

![Linux Desktop launcher](docs/launcher.png)

## Requirements

- Rooted LG TV with an ARM64 kernel, webOS 10.0 or newer, and SSH access.
- About 350 MB free on `/var` and a USB or Bluetooth keyboard and mouse.
- A computer with `ssh`, `scp`, the GitHub CLI, and the webOS CLI configured for
  your TV. Sign in with `gh auth login` using an account with repo access.

Tested on webOS 10.3.1 with 1.7 GB of RAM. No audio or GPU acceleration.

## Quick start

1. Download the runtime and launcher from [version 1.2.0](https://github.com/patelthakkar/webos-linux-desktop/releases/tag/v1.2.0):

   ```sh
   gh release download v1.2.0 --repo patelthakkar/webos-linux-desktop \
     --pattern linux-desktop-runtime.tar \
     --pattern io.github.patelthakkar.linuxdesktop_1.2.0_all.ipk
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
- Tor session (experimental) sends desktop traffic through Tor and keeps session
  files in a 384 MiB RAM overlay. Closing or leaving the app ends it and discards
  those files. Needs 500 MiB of available RAM.

The Tor session is experimental and may change between releases.

The **Settings > Tor session > Install** button downloads the layer from a GitHub
release, which needs the repo to be public. While this one is private, use the
[manual install](docs/manual-tor-install.md). The layer is about 5.8 MB and
checked against its SHA-256. Turn on the switch, start the desktop, and accept
the first-run notices. **Test Tor** checks the connection. The switch resets
after each session. The App Store stays off in Tor sessions, and apps that
ignore the proxy cannot connect.

Tor only covers the desktop. The TV firmware and LG services keep their own
network access and can still see the screen. The first-run check reports LG
data collection settings; it does not change them.

Tor shipped in 1.2.0. The source is on `main`.

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

Build scripts for the experimental Tor layer are in `build/build-tails.sh`. The
desktop shares the TV kernel; it is not a virtual machine.

## License

The launcher and scripts are [MIT licensed](LICENSE). Runtime packages have
their own licenses; see [THIRD-PARTY.md](THIRD-PARTY.md).
