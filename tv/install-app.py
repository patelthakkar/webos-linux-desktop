#!/usr/bin/env python3
"""Install the webOS package through the TV installer when ares-install fails."""
import json
import os
import pathlib
import re
import selectors
import subprocess
import time

project = pathlib.Path(__file__).resolve().parents[1]
metadata = json.loads((project / 'webos-app/appinfo.json').read_text())
filename = f'{metadata["id"]}_{metadata["version"]}_all.ipk'
package = next(
    (path for path in (project / 'dist' / filename, project / 'artifacts' / filename) if path.is_file()),
    None,
)
if package is None:
    raise SystemExit(f'Package not found: {filename}. Run the package command first.')

host = os.environ.get('TV_HOST')
if not host:
    raise SystemExit('Set TV_HOST to the TV address, for example TV_HOST=192.0.2.10')
port = os.environ.get('TV_PORT', '22')
user = os.environ.get('TV_USER', 'root')
key = os.environ.get('TV_KEY', str(pathlib.Path.home() / '.ssh/lgtv_root_ed25519'))
ssh = ['ssh', '-i', key, '-p', port,
       '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', '-o', 'StrictHostKeyChecking=accept-new']
remote = f'{user}@{host}'

tempdir = subprocess.check_output(ssh + [remote, 'mktemp -d /tmp/linux-desktop-install.XXXXXX'], text=True).strip()
if not re.fullmatch(r'/tmp/linux-desktop-install\.[A-Za-z0-9]+', tempdir):
    raise RuntimeError('Unexpected remote temporary directory')
remote_package = f'{tempdir}/{filename}'
process = None
selector = selectors.DefaultSelector()
buffer = b''
success = False
try:
    with package.open('rb') as data:
        subprocess.run(
            ssh + [remote, f'set -eu; cat > {remote_package}; chmod 755 {tempdir}; chmod 644 {remote_package}'],
            stdin=data,
            check=True,
        )
    params = json.dumps({'id': metadata['id'], 'ipkUrl': remote_package, 'subscribe': True})
    cmd = f"timeout 45 luna-send -i luna://com.webos.appInstallService/dev/install '{params}'"
    process = subprocess.Popen(ssh + ['-tt', remote, cmd], stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    selector.register(process.stdout, selectors.EVENT_READ)
    deadline = time.monotonic() + 50
    while time.monotonic() < deadline:
        if not selector.select(timeout=1):
            if process.poll() is not None:
                break
            continue
        data = process.stdout.read1(16384)
        if not data:
            break
        buffer += data
        while b'\n' in buffer:
            line, buffer = buffer.split(b'\n', 1)
            try:
                result = json.loads(line.strip())
            except (ValueError, UnicodeDecodeError):
                continue
            if result.get('returnValue') is False:
                raise RuntimeError(result.get('errorText', 'Installer rejected the package'))
            if result.get('statusValue') == 30:
                success = True
                break
            if 'failed' in result.get('details', {}).get('state', '').lower():
                raise RuntimeError('TV installer failed: ' + str(result))
        if success:
            break
    if not success:
        raise RuntimeError('TV did not confirm the installed state within 50 seconds')
    print('Installed ' + metadata['id'])
finally:
    selector.close()
    if process is not None:
        process.terminate()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait()
    subprocess.run(ssh + [remote, f'rm -f {remote_package}; rmdir {tempdir}'], check=True)
