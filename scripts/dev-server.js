// Local server for playing and editing: serves the game, and lets the level editor save.
// Usage: npm start   (then open http://localhost:8123, or http://localhost:8123/#/editor)
//
// API (only reachable from this machine: the server listens on 127.0.0.1):
//   GET  /api/editor  -> { ok: true }                 the editor shows up only when this answers
//   POST /api/levels  -> body { overrides, levels }    rewrites src/levels-custom.js
// The previous file is kept as src/levels-custom.prev.js, so one bad save can always be undone.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { renderCustomFile, checkCustomData } = require('../src/custom-io.js');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.PORT) || 8123;
const CUSTOM_FILE = path.join(ROOT, 'src', 'levels-custom.js');
const MAX_BODY = 8 * 1024 * 1024;

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.md': 'text/markdown; charset=utf-8', '.wav': 'audio/wav', '.mp3': 'audio/mpeg',
};

function send(res, status, body, type = 'application/json') {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

function saveLevels(req, res) {
  let size = 0;
  const chunks = [];
  req.on('data', (c) => {
    size += c.length;
    if (size > MAX_BODY) { send(res, 413, { ok: false, error: 'Too big' }); req.destroy(); return; }
    chunks.push(c);
  });
  req.on('end', () => {
    if (res.writableEnded) return;
    let data;
    try { data = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch (e) {
      send(res, 400, { ok: false, error: 'Not JSON' }); return;
    }
    const problem = checkCustomData(data);
    if (problem) { send(res, 400, { ok: false, error: problem }); return; }
    try {
      if (fs.existsSync(CUSTOM_FILE)) fs.copyFileSync(CUSTOM_FILE, CUSTOM_FILE.replace(/\.js$/, '.prev.js'));
      const tmp = `${CUSTOM_FILE}.tmp`;
      fs.writeFileSync(tmp, renderCustomFile(data));
      fs.renameSync(tmp, CUSTOM_FILE); // all or nothing: a crash mid-write never leaves half a file
      console.log(`saved ${Object.keys(data.overrides).length} edited + ${data.levels.length} custom level(s)`);
      send(res, 200, { ok: true });
    } catch (e) {
      send(res, 500, { ok: false, error: e.message });
    }
  });
}

function serveFile(req, res) {
  let rel;
  try { rel = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch (e) { send(res, 400, 'Bad path', 'text/plain'); return; }
  if (rel.endsWith('/')) rel += 'index.html';
  const file = path.normalize(path.join(ROOT, rel));
  if (!file.startsWith(ROOT + path.sep)) { send(res, 403, 'Forbidden', 'text/plain'); return; }
  fs.readFile(file, (err, buf) => {
    if (err) { send(res, 404, 'Not found', 'text/plain'); return; }
    send(res, 200, buf, TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream');
  });
}

const server = http.createServer((req, res) => {
  const url = req.url.split('?')[0];
  if (url === '/api/editor' && req.method === 'GET') { send(res, 200, { ok: true }); return; }
  if (url === '/api/levels' && req.method === 'POST') {
    // Same-origin only: refuse saves posted by other sites open in the browser
    const origin = req.headers.origin;
    if (origin && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) { send(res, 403, { ok: false, error: 'Origin' }); return; }
    saveLevels(req, res);
    return;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') { send(res, 405, 'Method not allowed', 'text/plain'); return; }
  serveFile(req, res);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Jetpack Man: http://localhost:${PORT}   (level editor: http://localhost:${PORT}/#/editor)`);
});
