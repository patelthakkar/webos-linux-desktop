# Manual Tor install

The Tor session is experimental. Until this repo is public, install it from your
computer with the commands below. Run them after `gh auth login` and the runtime
install, and replace `YOUR_TV` with the TV's SSH address.

```sh
gh release download v1.2.0 --repo patelthakkar/webos-linux-desktop \
  --pattern linux-desktop-tails.squashfs --output tor-session.squashfs
gh release download v1.2.0 --repo patelthakkar/webos-linux-desktop \
  --pattern linux-desktop-tails.squashfs.sha256 --output tor-session.squashfs.sha256
scp tor-session.squashfs tor-session.squashfs.sha256 root@YOUR_TV:/tmp/
ssh root@YOUR_TV 'TAILS_SOURCE=/tmp/tor-session.squashfs /var/lib/webosbrew/linux-desktop/control.sh tails-install && rm /tmp/tor-session.squashfs /tmp/tor-session.squashfs.sha256'
```

The installer checks the SHA-256 before it copies the layer into place. The
commands still use the internal `tails` names; those are unchanged so existing
installs keep working. Your GitHub credentials stay on your computer.

Open Linux Desktop, turn on **Settings > Tor session**, and start the desktop.
