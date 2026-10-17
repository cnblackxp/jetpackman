// Copies runtime libraries out of node_modules so the game works offline
// (the desktop build has no internet guarantee). Runs on `npm install`.
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const FILES = [
  { from: 'node_modules/pixi.js/dist/pixi.min.js', to: 'vendor/pixi.min.js' },
];

for (const { from, to } of FILES) {
  const src = path.join(ROOT, from);
  if (!fs.existsSync(src)) {
    console.warn(`vendor: ${from} not found, skipping (the game will fall back to the CDN)`);
    continue;
  }
  fs.mkdirSync(path.dirname(path.join(ROOT, to)), { recursive: true });
  fs.copyFileSync(src, path.join(ROOT, to));
  console.log(`vendor: ${from} -> ${to}`);
}
