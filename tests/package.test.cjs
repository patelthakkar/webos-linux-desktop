const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
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
  for (const file of ['build/session.sh', 'tv/control.sh', 'tv/namespace.sh']) {
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

test('README screenshots exist at the published size', () => {
  for (const name of ['launcher', 'desktop', 'browser', 'appstore']) {
    const size = pngSize(path.join(root, 'docs', `${name}.png`));
    assert.deepEqual(size, { width: 1600, height: 900 });
  }
});
