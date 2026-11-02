# Manual Tor install

Use this while the repo is private. Run these commands on your computer, after
`gh auth login` and the runtime install. Replace `YOUR_TV` with the TV's SSH address.

```sh
gh release download v1.2.0 --repo patelthakkar/webos-linux-desktop \
  --pattern linux-desktop-tails.squashfs --output tor-session.squashfs
gh release download v1.2.0 --repo patelthakkar/webos-linux-desktop \
  --pattern linux-desktop-tails.squashfs.sha256 --output tor-session.squashfs.sha256
scp tor-session.squashfs tor-session.squashfs.sha256 root@YOUR_TV:/tmp/
ssh root@YOUR_TV 'TAILS_SOURCE=/tmp/tor-session.squashfs /var/lib/webosbrew/linux-desktop/control.sh tails-install && rm /tmp/tor-session.squashfs /tmp/tor-session.squashfs.sha256'
```

The installer verifies the checksum. Existing filenames and control commands
stay unchanged for compatibility; they do not identify the operating system.
Your GitHub credentials stay on your computer.

Reopen Linux Desktop, turn on **Settings > Tor session**, and start the desktop.
