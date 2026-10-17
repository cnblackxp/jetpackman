// Runs the game in NW.js straight from the source folder (no packaging), for testing
// the desktop-only options. Usage: npm run desktop
const path = require('path');
const { spawn } = require('child_process');
const { ROOT, getRuntimeDir } = require('./nw-runtime');
const pkg = require('../package.json');

getRuntimeDir(String(process.env.NWJS_VERSION || pkg.nwjs.version).replace(/^v/, ''))
  .then((dir) => {
    const child = spawn(path.join(dir, 'nw.exe'), [ROOT], { stdio: 'inherit', detached: true });
    child.unref();
  })
  .catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
