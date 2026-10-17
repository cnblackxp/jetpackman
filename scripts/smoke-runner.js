// Starts NW.js with --smoke-test and waits for the game to write its report.
const fs = require('fs');
const { spawn } = require('child_process');

const TIMEOUT_MS = 30000;

// exe: NW.js executable; args: extra args before ours (e.g. the app folder for a bare nw.exe)
function runSmoke(exe, args, base, level, size) {
  return new Promise((resolve, reject) => {
    const extra = size ? [`--smoke-size=${size}`] : [];
    const child = spawn(exe, [...args, `--smoke-test=${base}`, `--smoke-level=${level}`, ...extra], { stdio: 'ignore' });
    const started = Date.now();
    const timer = setInterval(() => {
      if (fs.existsSync(`${base}.json`)) {
        clearInterval(timer);
        resolve({ report: JSON.parse(fs.readFileSync(`${base}.json`, 'utf8')), png: `${base}.png` });
      } else if (Date.now() - started > TIMEOUT_MS) {
        clearInterval(timer);
        child.kill();
        reject(new Error('Timed out: the game never reported back'));
      }
    }, 250);
  });
}

module.exports = { runSmoke };
