#!/usr/bin/env node
'use strict';

const { createHash } = require('node:crypto');
const { readFileSync, statSync, writeFileSync, mkdirSync } = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const app = JSON.parse(readFileSync(path.join(root, 'webos-app/appinfo.json'), 'utf8'));
const dist = path.join(root, 'dist');
const ipk = path.join(dist, `${app.id}_${app.version}_all.ipk`);
const bytes = readFileSync(ipk);

const manifest = {
  id: app.id,
  version: app.version,
  type: app.type,
  title: app.title,
  appDescription: app.appDescription,
  iconUri: `https://raw.githubusercontent.com/patelthakkar/webos-linux-desktop/main/webos-app/icon-160.png`,
  sourceUrl: 'https://github.com/patelthakkar/webos-linux-desktop',
  rootRequired: true,
  ipkUrl: path.basename(ipk),
  ipkSize: statSync(ipk).size,
  ipkHash: {
    sha256: createHash('sha256').update(bytes).digest('hex'),
  },
};

mkdirSync(dist, { recursive: true });
const output = path.join(dist, `${app.id}.manifest.json`);
writeFileSync(output, JSON.stringify(manifest, null, 2) + '\n');
console.log(output);
