// Builds the Windows desktop version with NW.js and zips it for distribution.
//
//   npm run package                    -> dist/JetpackMan-<version>-win-x64-<YYYY-MM-DD_HH-mm-ss>.zip
//   npm run package -- --arch=ia32     -> 32-bit build
//   npm run package -- --nw=0.118.0    -> different NW.js version (or set NWJS_VERSION)
//   npm run package -- --all-locales   -> keep every Chromium UI language (adds ~120 MB)
//
// Every build is stamped with the date and time it was made. Older builds keep their zip, but their
// unzipped folder (a ~450 MB duplicate of the zip) is removed to save disk space.
//
// Output folder layout (also inside the zip):
//   JetpackMan.exe, NW.js runtime files, package.json, index.html, src/, vendor/
const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');
const { ROOT, getRuntimeZip, extractRuntime } = require('./nw-runtime');

const pkg = require('../package.json');

// Files and folders that make up the game itself
const APP_FILES = ['index.html', 'src', 'vendor', 'assets'];

function parseArgs(argv) {
  const out = {};
  for (const a of argv) {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    if (m) out[m[1]] = m[2] ?? true;
  }
  return out;
}

// The game is English only; dropping the other ~200 Chromium UI locales saves ~120 MB.
// Pass --all-locales to keep them.
function trimLocales(dir) {
  if (!fs.existsSync(dir)) return;
  for (const f of fs.readdirSync(dir)) {
    if (!/^en-(US|GB)[._]/.test(f)) fs.rmSync(path.join(dir, f), { recursive: true, force: true });
  }
}

// The NW.js manifest: the window settings from package.json, minus the npm-only fields.
function appManifest() {
  return {
    name: pkg.name,
    productName: pkg.productName,
    version: pkg.version,
    main: pkg.main,
    window: pkg.window,
    'chromium-args': pkg['chromium-args'],
  };
}

function dirSize(dir) {
  let total = 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    total += e.isDirectory() ? dirSize(p) : fs.statSync(p).size;
  }
  return total;
}

const mb = (bytes) => `${(bytes / 1e6).toFixed(1)} MB`;

// Local date and time, safe for file names: 2026-10-17_18-42-05
function timestamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
}

// Removes unzipped folders of older builds (their zips stay).
function pruneOldFolders(distDir, appName, keep) {
  for (const e of fs.readdirSync(distDir, { withFileTypes: true })) {
    if (!e.isDirectory() || e.name === keep || !e.name.startsWith(`${appName}-`)) continue;
    try {
      fs.rmSync(path.join(distDir, e.name), { recursive: true, force: true });
      console.log(`  removed old folder ${e.name} (zip kept)`);
    } catch (err) {
      console.warn(`  could not remove ${e.name} (${err.code}); is that build still running?`);
    }
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const version = String(args.nw || process.env.NWJS_VERSION || pkg.nwjs.version).replace(/^v/, '');
  const platform = 'win';
  const arch = args.arch || 'x64';
  const appName = pkg.nwjs.appName;

  if (!fs.existsSync(path.join(ROOT, 'vendor', 'pixi.min.js'))) {
    throw new Error('vendor/pixi.min.js is missing: run `npm install` first');
  }

  const buildName = `${appName}-${pkg.version}-${platform}-${arch}-${timestamp()}`;
  const distDir = path.join(ROOT, 'dist');
  const outDir = path.join(distDir, buildName);
  const zipPath = path.join(distDir, `${buildName}.zip`);

  console.log(`Packaging ${pkg.productName} ${pkg.version} with NW.js ${version} (${platform}-${arch})`);
  const runtimeZip = await getRuntimeZip(version, platform, arch);

  console.log(`Building ${path.relative(ROOT, outDir)}`);
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.rmSync(zipPath, { force: true });
  extractRuntime(runtimeZip, outDir);
  fs.renameSync(path.join(outDir, 'nw.exe'), path.join(outDir, `${appName}.exe`));
  if (!('all-locales' in args)) trimLocales(path.join(outDir, 'locales'));

  for (const f of APP_FILES) {
    fs.cpSync(path.join(ROOT, f), path.join(outDir, f), { recursive: true });
  }
  fs.writeFileSync(path.join(outDir, 'package.json'), JSON.stringify(appManifest(), null, 2));

  console.log(`Zipping ${path.relative(ROOT, zipPath)}`);
  const zip = new AdmZip();
  zip.addLocalFolder(outDir, buildName);
  zip.writeZip(zipPath);
  pruneOldFolders(distDir, appName, buildName);

  console.log('');
  console.log(`Done.`);
  console.log(`  Folder: ${path.relative(ROOT, outDir)} (${mb(dirSize(outDir))})`);
  console.log(`  Zip:    ${path.relative(ROOT, zipPath)} (${mb(fs.statSync(zipPath).size)})`);
  console.log(`  Run:    ${path.join(path.relative(ROOT, outDir), `${appName}.exe`)}`);
}

main().catch((e) => {
  console.error(`\nPackaging failed: ${e.message}`);
  if (e.code === 'EBUSY' || e.code === 'EPERM') {
    console.error('The previous build is in use. Close the running game (and any Explorer window inside dist/) and try again.');
  }
  process.exit(1);
});
