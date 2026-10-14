const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root,'manifest.json'),'utf8'));
const pkg = JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
if (manifest.version !== pkg.version) throw new Error('Manifest/package versions disagree');
const assets = [manifest.background.service_worker, manifest.action.default_popup,
  ...Object.values(manifest.icons), 'offscreen.html', 'alert.wav', 'src/core/detection.js'];
for (const html of [manifest.action.default_popup, 'offscreen.html']) {
  const source = fs.readFileSync(path.join(root,html),'utf8');
  for (const match of source.matchAll(/(?:src|href)="([^"]+)"/g)) assets.push(match[1]);
}
for (const asset of new Set(assets)) {
  if (!fs.existsSync(path.join(root,asset))) throw new Error(`Missing extension asset: ${asset}`);
}
for (const file of ['background.js','popup.js','offscreen.js','src/core/detection.js']) {
  const result = spawnSync(process.execPath,['--check',path.join(root,file)],{stdio:'inherit'});
  if (result.status !== 0) process.exit(result.status || 1);
}
console.log(`Manifest v${manifest.version}, extension assets and JavaScript syntax: OK`);
