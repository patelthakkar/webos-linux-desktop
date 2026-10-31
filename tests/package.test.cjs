const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, mkdtempSync, rmSync } = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');

function pngSize(file) {
  const data = readFileSync(file);
  assert.equal(data.subarray(1, 4).toString(), 'PNG');
  return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
}

test('TV package has valid metadata and correctly sized icons', () => {
  const app = JSON.parse(readFileSync(path.join(root, 'webos-app/appinfo.json')));
  assert.equal(app.id, 'io.github.patelthakkar.linuxdesktop');
  assert.equal(app.type, 'web');
  assert.equal(app.resolution, '1920x1080');
  assert.equal(app.vendor, 'Patel Thakkar');
  readFileSync(path.join(root, 'webos-app', app.main));
  assert.deepEqual(pngSize(path.join(root, 'webos-app', app.icon)), { width: 80, height: 80 });
  assert.deepEqual(pngSize(path.join(root, 'webos-app', app.largeIcon)), { width: 130, height: 130 });
  assert.deepEqual(pngSize(path.join(root, 'webos-app/icon-160.png')), { width: 160, height: 160 });
});

test('all entry points parse without executing any TV commands', () => {
  for (const file of ['build/build-rootfs.sh', 'tv/install.sh', 'tests/verify-tv.sh', 'release.sh']) {
    execFileSync('bash', ['-n', path.join(root, file)]);
  }
  for (const file of ['build/session.sh', 'tv/control.sh', 'tv/namespace.sh', 'tv/input-devices.sh']) {
    execFileSync('sh', ['-n', path.join(root, file)]);
  }
  execFileSync(process.execPath, ['--check', path.join(root, 'webos-app/app.js')]);
});

test('App Store catalog and package-helper tests pass', () => {
  execFileSync('python3', ['-m', 'unittest', 'discover', '-s', 'tests', '-p', 'test_appstore.py'], {
    cwd: root,
    stdio: 'pipe',
  });
});

test('runtime stays lightweight and uses signed packages only', () => {
  const packages = readFileSync(path.join(root, 'build/packages.txt'), 'utf8').split('\n').filter(Boolean);
  for (const heavy of ['xfce4', 'tumbler', 'xfce4-power-manager', 'webkit2gtk-4.1']) {
    assert.equal(packages.includes(heavy), false, `${heavy} is not part of the lightweight runtime`);
  }
  assert.ok(packages.includes('netsurf'));
  assert.ok(packages.includes('py3-gobject3'));
  const lock = readFileSync(path.join(root, 'build/packages.lock'), 'utf8').split('\n').filter(Boolean);
  assert.equal(lock.length, packages.length);
  for (const name of packages) assert.ok(lock.some((line) => line.startsWith(`${name}=`)), `${name} is pinned`);
  const daemon = readFileSync(path.join(root, 'build/appstore/appstore-daemon.py'), 'utf8');
  assert.equal(daemon.includes('--allow-untrusted'), false);
  assert.ok(daemon.includes('PROTECTED'));
});

test('launcher and package versions stay in sync', () => {
  const app = JSON.parse(readFileSync(path.join(root, 'webos-app/appinfo.json')));
  const pkg = JSON.parse(readFileSync(path.join(root, 'package.json')));
  const source = readFileSync(path.join(root, 'webos-app/app.js'), 'utf8');
  assert.equal(app.version, pkg.version);
  assert.ok(source.includes(`const APP_VERSION = '${app.version}'`));
});

test('stats reports load, memory, storage, uptime, and runtime version', () => {
  const app = JSON.parse(readFileSync(path.join(root, 'webos-app/appinfo.json')));
  const base = mkdtempSync(path.join(os.tmpdir(), 'linux-desktop-'));
  try {
    const data = JSON.parse(execFileSync('sh', [path.join(root, 'tv/control.sh'), 'stats'], {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...process.env,
        LINUX_DESKTOP_TEST: '1',
        LINUX_DESKTOP_BASE: base,
      },
    }).trim());
    assert.equal(data.runtimeVersion, app.version);
    assert.ok(Number.isFinite(Number(data.load)), 'load average is numeric');
    assert.ok(data.memTotal > 0);
    assert.ok(data.memUsed >= 0);
    assert.ok(data.memUsed <= data.memTotal);
    assert.ok(data.varFree > 0);
    assert.ok(data.uptime > 0);
    assert.equal(data.mode, 'persistent');
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test('input parser separates USB and Bluetooth HID and ignores virtual remotes', () => {
  function parsePairs(output) {
    const data = {};
    for (const line of output.trim().split('\n')) {
      const split = line.indexOf('=');
      if (split > 0) data[line.slice(0, split)] = line.slice(split + 1);
    }
    return data;
  }
  const script = path.join(root, 'tv/input-devices.sh');
  const run = (fixture) => parsePairs(execFileSync('sh', [script, path.join(root, 'tests/fixtures', fixture)], {
    encoding: 'utf8',
  }));

  const tv = run('input-devices-tv.txt');
  assert.equal(tv.usb_keyboard, '0', 'the real TV capture has no USB keyboard');
  assert.equal(tv.usb_pointer, '0', 'the real TV capture has no USB pointer');
  assert.equal(tv.bt_keyboard, '0', 'the real TV capture has no Bluetooth keyboard');
  assert.equal(tv.bt_pointer, '0', 'the real TV capture has no Bluetooth pointer');
  assert.equal(tv.usb_keyboard_name, '');

  const usb = run('input-devices-usb.txt');
  assert.equal(usb.usb_keyboard, '1', 'USB keyboard is detected');
  assert.equal(usb.usb_keyboard_name, 'Logitech USB Keyboard');
  assert.equal(usb.usb_pointer, '1', 'USB mouse is detected');
  assert.equal(usb.usb_pointer_name, 'Logitech USB Optical Mouse');
  assert.equal(usb.bt_keyboard, '0');
  assert.equal(usb.bt_pointer, '0');

  const bt = run('input-devices-bt.txt');
  assert.equal(bt.usb_keyboard, '0', 'the virtual LGE remote is not USB');
  assert.equal(bt.usb_pointer, '0');
  assert.equal(bt.bt_keyboard, '1', 'Bluetooth keyboard is detected through uhid');
  assert.equal(bt.bt_keyboard_name, 'Apple Bluetooth Keyboard');
  assert.equal(bt.bt_pointer, '1', 'Bluetooth trackpad is detected');
  assert.equal(bt.bt_pointer_name, 'Apple Bluetooth Trackpad');
});

test('README screenshots exist at the published size', () => {
  for (const name of ['launcher', 'desktop', 'browser', 'appstore']) {
    const size = pngSize(path.join(root, 'docs', `${name}.png`));
    assert.deepEqual(size, { width: 1600, height: 900 });
  }
});
