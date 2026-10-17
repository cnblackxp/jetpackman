// Downloads, verifies and unpacks the NW.js runtime. Shared by package-nw.js and run-nw.js.
// Downloads are cached in .cache/nwjs so repeat builds are offline and fast.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');
const AdmZip = require('adm-zip');

const ROOT = path.resolve(__dirname, '..');
const CACHE = path.join(ROOT, '.cache', 'nwjs');

function runtimeName(version, platform, arch) {
  return `nwjs-v${version}-${platform}-${arch}`;
}

async function fetchOk(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${url} failed: ${res.status} ${res.statusText}`);
  return res;
}

async function download(url, dest) {
  const res = await fetchOk(url);
  const total = Number(res.headers.get('content-length')) || 0;
  let done = 0, lastPct = -1;
  const body = Readable.fromWeb(res.body);
  body.on('data', (chunk) => {
    done += chunk.length;
    const pct = total ? Math.floor((done / total) * 100) : -1;
    if (pct !== lastPct && pct % 10 === 0) {
      lastPct = pct;
      process.stdout.write(`  ${pct}% (${(done / 1e6).toFixed(0)} MB)\n`);
    }
  });
  const part = `${dest}.part`;
  await pipeline(body, fs.createWriteStream(part));
  fs.renameSync(part, dest);
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

// Checks the zip against the official SHASUMS256.txt for that release.
async function verify(version, file) {
  const name = path.basename(file);
  let sums;
  try {
    sums = await (await fetchOk(`https://dl.nwjs.io/v${version}/SHASUMS256.txt`)).text();
  } catch (e) {
    console.warn(`  could not fetch checksums (${e.message}); skipping verification`);
    return;
  }
  const line = sums.split('\n').find((l) => l.trim().endsWith(name));
  if (!line) { console.warn(`  no checksum listed for ${name}; skipping verification`); return; }
  const expected = line.trim().split(/\s+/)[0].toLowerCase();
  const actual = sha256(file);
  if (actual !== expected) {
    fs.rmSync(file, { force: true });
    throw new Error(`checksum mismatch for ${name} (expected ${expected}, got ${actual}); deleted, try again`);
  }
  console.log('  checksum OK');
}

// Returns the path of the cached runtime zip, downloading it if needed.
async function getRuntimeZip(version, platform = 'win', arch = 'x64') {
  const name = runtimeName(version, platform, arch);
  const zipPath = path.join(CACHE, `${name}.zip`);
  if (fs.existsSync(zipPath)) {
    console.log(`NW.js ${version} (${platform}-${arch}) found in cache`);
    return zipPath;
  }
  fs.mkdirSync(CACHE, { recursive: true });
  const url = `https://dl.nwjs.io/v${version}/${name}.zip`;
  console.log(`Downloading ${url}`);
  await download(url, zipPath);
  await verify(version, zipPath);
  return zipPath;
}

// Extracts the runtime into `dest` (without the zip's top-level folder).
function extractRuntime(zipPath, dest) {
  const top = `${path.basename(zipPath, '.zip')}/`;
  const zip = new AdmZip(zipPath);
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of zip.getEntries()) {
    if (entry.isDirectory || !entry.entryName.startsWith(top)) continue;
    const rel = entry.entryName.slice(top.length);
    const out = path.join(dest, rel);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, entry.getData());
  }
}

// Unpacked runtime in the cache (for running the game without packaging).
async function getRuntimeDir(version, platform = 'win', arch = 'x64') {
  const dir = path.join(CACHE, runtimeName(version, platform, arch));
  if (!fs.existsSync(path.join(dir, platform === 'win' ? 'nw.exe' : 'nw'))) {
    extractRuntime(await getRuntimeZip(version, platform, arch), dir);
  }
  return dir;
}

module.exports = { ROOT, getRuntimeZip, extractRuntime, getRuntimeDir };
