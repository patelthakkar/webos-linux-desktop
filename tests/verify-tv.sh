#!/usr/bin/env bash
# Read-only inspection of an already-running TV desktop. Run on the phone.
set -euo pipefail
cd "$(dirname "$0")/../.."
./tv.sh 'set -eu
base=/var/lib/webosbrew/linux-desktop
state=$("$base/control.sh" status)
echo "Desktop: $state"
[ "$state" = running ]
curl -fsS --max-time 5 http://127.0.0.1:6080/vnc.html >/dev/null
echo "noVNC HTTP: OK"
node -e '\''const net=require("net"); const s=net.connect(5907,"127.0.0.1"); s.setTimeout(3000,()=>{s.destroy();process.exit(1)}); s.once("data",b=>{if(!b.toString().startsWith("RFB 003."))process.exitCode=1; else console.log("VNC protocol: "+b.toString().trim());s.destroy()});s.on("error",()=>process.exit(1))'\''
echo "Listener addresses (must be loopback):"
awk '\''$2 ~ /:(17C0|1713)$/ && $4 == "0A" {print $2; if ($2 !~ /^0100007F:/) bad=1} END {exit bad}'\'' /proc/net/tcp
awk '\''$2 ~ /:(17C0|1713)$/ && $4 == "0A" {print $2; if ($2 !~ /^00000000000000000000000001000000:/) bad=1} END {exit bad}'\'' /proc/net/tcp6
echo "Resources:"
free -m
df -k "$base"
echo "No desktop mount is visible in the host namespace:"
if grep -F "$base/root " /proc/mounts; then exit 1; fi
echo PASS'
