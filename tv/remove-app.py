#!/usr/bin/env python3
"""Remove the webOS package through the TV installer."""
import json
import os
import pathlib
import selectors
import subprocess
import time

project = pathlib.Path(__file__).resolve().parents[1]
metadata = json.loads((project / 'webos-app/appinfo.json').read_text())
host = os.environ.get('TV_HOST')
if not host:
    raise SystemExit('Set TV_HOST to the TV address, for example TV_HOST=192.0.2.10')
port = os.environ.get('TV_PORT', '22')
user = os.environ.get('TV_USER', 'root')
key = os.environ.get('TV_KEY', str(pathlib.Path.home() / '.ssh/lgtv_root_ed25519'))
ssh = ['ssh', '-i', key, '-p', port,
       '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', '-o', 'StrictHostKeyChecking=accept-new']
remote = f'{user}@{host}'
params = json.dumps({'id': metadata['id'], 'subscribe': True})
cmd = f"timeout 30 luna-send -i luna://com.webos.appInstallService/dev/remove '{params}'"
process = subprocess.Popen(ssh + ['-tt', remote, cmd], stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
selector = selectors.DefaultSelector()
selector.register(process.stdout, selectors.EVENT_READ)
buffer = b''
removed = False
try:
    deadline = time.monotonic() + 35
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
                raise SystemExit(result.get('errorText', 'The TV rejected the uninstall request.'))
            if result.get('statusValue') == 31:
                removed = True
                break
        if removed:
            break
finally:
    selector.close()
    process.terminate()
    try:
        process.wait(timeout=5)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait()

if not removed:
    raise SystemExit('The TV did not confirm the removal. The app may not be installed.')
print('Removed ' + metadata['id'])
