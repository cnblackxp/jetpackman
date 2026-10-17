// Screenshots a whole level or a menu screen to a PNG (runs the game from source in NW.js,
// no packaging needed).
// Usage: npm run shot -- <level number | menu | levels | options> <output.png> [WIDTHxHEIGHT]
//   npm run shot -- 7 devlog/the-ridge.png
//   npm run shot -- menu devlog/menu.png
const fs = require('fs');
const os = require('os');
const path = require('path');
const { ROOT, getRuntimeDir } = require('./nw-runtime');
const { runSmoke } = require('./smoke-runner');
const pkg = require('../package.json');

const [target, outArg, size] = process.argv.slice(2);
const SCREENS = ['menu', 'levels', 'options'];
const validLevel = Number.isInteger(Number(target)) && Number(target) >= 1;
if (!outArg || !(validLevel || SCREENS.includes(target))) {
  console.error('Usage: npm run shot -- <level number | menu | levels | options> <output.png>');
  process.exit(1);
}

(async () => {
  const dir = await getRuntimeDir(String(process.env.NWJS_VERSION || pkg.nwjs.version).replace(/^v/, ''));
  const base = path.join(os.tmpdir(), `jetpackman-shot-${Date.now()}`);
  if (size && !/^\d+x\d+$/.test(size)) throw new Error('Size must look like 1280x800');
  const { report, png } = await runSmoke(path.join(dir, 'nw.exe'), [ROOT], base, target, size);
  if (!report.ok) throw new Error(`Game reported errors: ${JSON.stringify(report.errors)}`);
  const out = path.resolve(ROOT, outArg);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.copyFileSync(png, out);
  const what = SCREENS.includes(target) ? `${target} screen` : `level ${target} (${report.level})`;
  console.log(`${what} -> ${path.relative(ROOT, out)}`);
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
