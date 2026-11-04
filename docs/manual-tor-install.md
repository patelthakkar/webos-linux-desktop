# Manual Tor install

The Tor session is experimental. These commands install it by hand. Run them on
your computer after the runtime install, and replace `YOUR_TV` with the TV's SSH
address.

```sh
curl -fLO https://github.com/patelthakkar/webos-linux-desktop/releases/download/v1.2.0/linux-desktop-tails.squashfs
curl -fLO https://github.com/patelthakkar/webos-linux-desktop/releases/download/v1.2.0/linux-desktop-tails.squashfs.sha256
scp linux-desktop-tails.squashfs linux-desktop-tails.squashfs.sha256 root@YOUR_TV:/tmp/
ssh root@YOUR_TV 'TAILS_SOURCE=/tmp/linux-desktop-tails.squashfs /var/lib/webosbrew/linux-desktop/control.sh tails-install && rm /tmp/linux-desktop-tails.squashfs /tmp/linux-desktop-tails.squashfs.sha256'
```

The installer checks the SHA-256 before it copies the layer into place. The
commands use the internal `tails` names; those are unchanged so existing
installs keep working.

Open Linux Desktop, turn on **Settings > Tor session**, and start the desktop.
