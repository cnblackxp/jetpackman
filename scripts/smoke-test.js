// Launches the newest packaged desktop build, lets it load a level, and checks its report.
// Usage: npm run test:desktop   (run `npm run package` first)
const fs = require('fs');
const os = require('os');
const path = require('path');
const { ROOT } = require('./nw-runtime');
const { runSmoke } = require('./smoke-runner');
const pkg = require('../package.json');

// Newest dated build folder in dist/
function latestBuild() {
  const dist = path.join(ROOT, 'dist');
  if (!fs.existsSync(dist)) return null;
  const dirs = fs.readdirSync(dist, { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name.startsWith(`${pkg.nwjs.appName}-`))
    .map((e) => path.join(dist, e.name))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  return dirs[0] || null;
}

const build = latestBuild();
const exe = build && path.join(build, `${pkg.nwjs.appName}.exe`);
if (!exe || !fs.existsSync(exe)) {
  console.error('No build found in dist/. Run `npm run package` first.');
  process.exit(1);
}

console.log(`Launching ${path.relative(ROOT, exe)}`);
runSmoke(exe, [], path.join(os.tmpdir(), `jetpackman-smoke-${Date.now()}`), 1)
  .then(({ report, png }) => {
    console.log(JSON.stringify(report, null, 2));
    console.log(`Screenshot: ${png}`);
    if (!report.ok) throw new Error('Desktop smoke test FAILED');
    console.log('Desktop smoke test passed');
  })
  .catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
