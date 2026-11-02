# Third-party software

The original launcher and build scripts in this repository are MIT licensed. See
`LICENSE`.

The Linux runtime image contains Alpine Linux packages. Those packages keep
their own copyright and licenses. The image is a binary redistribution, so keep
the package license files and source references when you publish it.

Main components:

| Component | License | Source |
| --- | --- | --- |
| Alpine Linux 3.22 (musl, BusyBox, apk-tools) | GPL-2.0-only and others | https://alpinelinux.org/ |
| XFCE 4.20 (session, window manager, panel, desktop, Thunar) | GPL-2.0-or-later, LGPL-2.1-or-later | https://xfce.org/ |
| TigerVNC 1.15 | GPL-2.0-or-later | https://tigervnc.org/ |
| noVNC 1.6, including the `vnc_tv.html` copy with a small CSS change | MPL-2.0 | https://github.com/novnc/noVNC |
| websockify | LGPL-3.0-or-later | https://github.com/novnc/websockify |
| NetSurf 3.11 | GPL-2.0-or-later | https://www.netsurf-browser.org/ |
| GTK 3 | LGPL-2.1-or-later | https://www.gtk.org/ |
| PyGObject | LGPL-2.1-or-later | https://pygobject.gnome.org/ |
| Python 3 | PSF-2.0 | https://www.python.org/ |

The optional Tor layer is a separate Alpine package set, mounted read-only over
the runtime during a Tor session.
It adds:

| Component | License | Source |
| --- | --- | --- |
| Tor 0.4.9 | BSD-3-Clause | https://www.torproject.org/ |
| torsocks 2.5 | GPL-2.0-only | https://gitlab.torproject.org/tpo/core/torsocks |
| socat 1.8 | GPL-2.0-only with OpenSSL exception | http://www.dest-unreach.org/socat/ |
| iproute2 6.15 | GPL-2.0-only | https://www.kernel.org/pub/linux/utils/net/iproute2/ |
| libevent, OpenSSL, libcap, libseccomp, libmnl, libxtables | BSD, Apache-2.0, and others | https://pkgs.alpinelinux.org/ |

The Tor session scripts are MIT licensed with the rest of the launcher.

The App Store installs additional Alpine packages on demand. Each installed
package remains under its own license and is recorded by `apk`. The App Store
does not strip license files from those packages.

Alpine packages do not install a common license directory in this image. The
package database is under `/lib/apk/db`; the package metadata and source
packages are at <https://pkgs.alpinelinux.org/> and
<https://gitlab.alpinelinux.org/alpine/aports>. If you redistribute the runtime
image, include this notice and make the corresponding package sources available
(for example by linking the Alpine source package pages for the exact versions
in the image).
