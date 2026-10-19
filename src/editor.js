// Level editor (experimental). Opens at #/editor when the game runs from `npm start` (it saves through
// the dev server) or in the desktop build (it writes the file itself). On a plain static host (GitHub
// Pages) there's nowhere to save, so the editor stays hidden.
//
// Ideas behind it (docs/LEVEL_EDITOR.md): edit directly on the map, play-test in one key and come
// back exactly where you were, undo everything, check the level live with the same rules as the tests,
// and never lose work (drafts autosave in the browser; saving keeps the previous file as a backup).
(function (root) {
  const TILE_ITEMS = [
    { id: '#', label: 'Rock', key: '1', hint: 'Deadly to touch' },
    { id: '=', label: 'Pad', key: '2', hint: 'Safe to land on; refills stamina' },
    { id: 'C', label: 'Checkpoint', key: '3', hint: 'A pad that becomes the respawn point' },
    { id: 'S', label: 'Start', key: '4', hint: 'Where the player starts (only one; must stand on a pad)' },
    { id: 'G', label: 'Goal', key: '5', hint: 'The flag (only one)' },
    { id: '.', label: 'Air', key: '', hint: 'Empty space (right click erases too)' },
  ];
  const OBJECT_ITEMS = [
    { id: 'saw', label: 'Saw', key: '6', list: 'movers', hint: 'A saw moving back and forth along a path' },
    { id: 'drone', label: 'Drone', key: '7', list: 'enemies', hint: 'Dashes at the player when they come close' },
    { id: 'coin', label: 'Coin', key: '8', list: 'coins', hint: 'Collectible' },
    { id: 'fuel', label: 'Fuel cell', key: '9', list: 'fuels', hint: '15 s of free thrust' },
    { id: 'gun', label: 'Pistol', key: '0', list: 'guns', hint: '3 bullets; scroll to fire' },
    { id: 'orbit', label: 'Orbit saw', key: '', list: 'movers', hint: 'A saw circling a point' },
    { id: 'crusher', label: 'Crusher', key: '', list: 'movers', hint: 'A sliding block' },
    { id: 'pusher', label: 'Pusher', key: '', list: 'pushers', hint: 'Flings the player in one direction' },
    { id: 'shield', label: 'Shield', key: '', list: 'shields', hint: 'Saves you once; they stack' },
    { id: 'sign', label: 'Sign', key: '', list: 'signs', hint: 'Text in the world' },
  ];
  const TOOLS = [
    { id: 'brush', label: 'Brush', key: 'B', hint: 'Paint tiles or place objects' },
    { id: 'rect', label: 'Rectangle', key: 'R', hint: 'Drag to fill a rectangle (or Shift+drag with the brush)' },
    { id: 'fill', label: 'Fill', key: 'F', hint: 'Fill a connected area' },
    { id: 'select', label: 'Select', key: 'V', hint: 'Select and move objects; drag empty space to pan' },
  ];
  const LISTS = ['pushers', 'movers', 'signs', 'enemies', 'shields', 'coins', 'fuels', 'guns'];
  const DRAFT_KEY = 'jetpackman.editor.draft';
  const LAST_KEY = 'jetpackman.editor.last';
  const COLORS = {
    bg: '#0b0e1a', rock: '#262b47', rockEdge: '#6f7bd0', pad: '#1d5a45', padTop: '#3dff9a',
    cp: '#1b4c66', cpTop: '#7fdcff', grid: 'rgba(143,154,198,0.10)', grid5: 'rgba(143,154,198,0.22)',
  };

  const deep = (o) => JSON.parse(JSON.stringify(o));
  const snap = (v, fine) => (fine ? Math.round(v * 10) / 10 : Math.round(v * 2) / 2);
  const store = {
    get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* storage off */ } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { /* storage off */ } },
  };

  // ---------- Saving: dev server (npm start) or the desktop build's file system ----------
  async function detectBackend() {
    if (typeof nw !== 'undefined' && typeof require === 'function') {
      try {
        const fs = require('fs'), path = require('path');
        const dir = (nw.__dirname || process.cwd());
        const file = path.join(dir, 'src', 'levels-custom.js');
        if (fs.existsSync(path.join(dir, 'src'))) {
          return {
            kind: 'desktop',
            async save(data) {
              if (fs.existsSync(file)) fs.copyFileSync(file, file.replace(/\.js$/, '.prev.js'));
              fs.writeFileSync(`${file}.tmp`, root.CustomIO.renderCustomFile(data));
              fs.renameSync(`${file}.tmp`, file);
            },
          };
        }
      } catch (e) { /* fall through */ }
    }
    if (!/^https?:$/.test(location.protocol)) return null;
    try {
      const r = await fetch('api/editor', { cache: 'no-store' });
      const j = r.ok && (await r.json());
      if (j && j.ok) {
        return {
          kind: 'server',
          async save(data) {
            const res = await fetch('api/levels', {
              method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
            });
            const out = await res.json().catch(() => ({}));
            if (!res.ok || !out.ok) throw new Error(out.error || `HTTP ${res.status}`);
          },
        };
      }
    } catch (e) { /* static host: no editor */ }
    return null;
  }

  function createEditor({ Core, LEVELS, CustomIO, el, onPlay, onExit }) {
    const TILE = Core.TILE;
    let backend = null;
    // Everything saved so far (what src/levels-custom.js holds); we edit a copy and write it all back
    const custom = deep(LEVELS.customData || { overrides: {}, levels: [] });
    custom.overrides = custom.overrides || {};
    custom.levels = custom.levels || [];
    const builtinByName = new Map((LEVELS.builtin || []).map((d) => [d.name, d]));

    // The level being edited
    let doc = null;          // { kind: 'builtin' | 'custom', origName }
    let lvl = null;          // { name, practice, grid: char[][], ...LISTS }
    let undo = [], redo = [], savedJSON = '', lastJSON = '';
    let tool = 'brush', brush = '#';
    let sel = null;          // { list, i }
    let view = { zoom: 24, ox: 40, oy: 40 };
    let hover = null;        // { tx, ty } in tiles (fractional)
    let drag = null;
    let showGrid = true, animate = false, animT = 0, animWorld = null, animKey = '';
    let issues = [], issuesTimer = null, flash = null;
    let needsReload = false, spaceHeld = false, toastTimer = null;

    // ---------- DOM ----------
    el.innerHTML = `
      <div class="ed-top">
        <button class="ed-btn" data-act="open" title="Open a level (O)">☰ Levels</button>
        <button class="ed-btn" data-act="new" title="New level (N)">＋ New</button>
        <div class="ed-title"><span class="ed-name"></span><span class="ed-status"></span></div>
        <button class="ed-btn icon" data-act="undo" title="Undo (Ctrl+Z)">↶</button>
        <button class="ed-btn icon" data-act="redo" title="Redo (Ctrl+Y)">↷</button>
        <button class="ed-btn primary" data-act="play" title="Play-test from the start (P) · Shift+P: from the cursor">▶ Play</button>
        <button class="ed-btn" data-act="save" title="Save (Ctrl+S)">Save</button>
        <button class="ed-btn icon" data-act="help" title="Shortcuts (?)">?</button>
        <button class="ed-btn" data-act="exit" title="Back to the menu">Exit</button>
      </div>
      <div class="ed-main">
        <aside class="ed-left">
          <div class="ed-group">Tools</div><div class="ed-tools"></div>
          <div class="ed-group">Tiles</div><div class="ed-palette ed-tiles"></div>
          <div class="ed-group">Objects</div><div class="ed-palette ed-objects"></div>
        </aside>
        <div class="ed-stage"><canvas class="ed-canvas"></canvas>
          <div class="ed-banner" hidden></div>
          <div class="ed-toast" hidden></div>
        </div>
        <aside class="ed-right">
          <section class="ed-card ed-inspector"></section>
          <section class="ed-card"><h4>Level</h4><div class="ed-levelprops"></div></section>
          <section class="ed-card"><h4>Checks <span class="ed-issue-count"></span></h4><div class="ed-issues"></div></section>
        </aside>
      </div>
      <div class="ed-bottom"><span class="ed-pos"></span><span class="ed-hint"></span></div>
      <div class="ed-modal" hidden><div class="ed-dialog"></div></div>`;
    const $ = (s) => el.querySelector(s);
    const canvas = $('.ed-canvas');
    const ctx = canvas.getContext('2d');

    function button(item, active, onClick) {
      const b = document.createElement('button');
      b.className = 'ed-item' + (active ? ' active' : '');
      b.title = `${item.label}${item.key ? ` (${item.key})` : ''}: ${item.hint}`;
      b.innerHTML = '<canvas width="40" height="40"></canvas><span></span>' + (item.key ? `<kbd>${item.key}</kbd>` : '');
      b.querySelector('span').textContent = item.label;
      drawIcon(b.querySelector('canvas').getContext('2d'), item.id, 40);
      b.addEventListener('click', onClick);
      return b;
    }
    function buildPalette() {
      const tools = $('.ed-tools'); tools.innerHTML = '';
      for (const t of TOOLS) {
        const b = document.createElement('button');
        b.className = 'ed-tool' + (tool === t.id ? ' active' : '');
        b.title = `${t.label} (${t.key}): ${t.hint}`;
        b.innerHTML = `<span></span><kbd>${t.key}</kbd>`;
        b.querySelector('span').textContent = t.label;
        b.addEventListener('click', () => setTool(t.id));
        tools.appendChild(b);
      }
      const tiles = $('.ed-tiles'); tiles.innerHTML = '';
      for (const it of TILE_ITEMS) tiles.appendChild(button(it, brush === it.id, () => setBrush(it.id)));
      const objs = $('.ed-objects'); objs.innerHTML = '';
      for (const it of OBJECT_ITEMS) objs.appendChild(button(it, brush === it.id, () => setBrush(it.id)));
    }
    function setTool(t) { tool = t; buildPalette(); updateHint(); render(); }
    function setBrush(id) {
      brush = id;
      if (tool === 'select' || (isObject(id) && (tool === 'rect' || tool === 'fill'))) tool = 'brush';
      buildPalette(); updateHint(); render();
    }
    const isObject = (id) => OBJECT_ITEMS.some((o) => o.id === id);

    // ---------- Level model ----------
    function fromDef(def) {
      const d = deep(def);
      const l = { name: d.name, practice: !!d.practice, grid: d.map.map((row) => row.split('')) };
      for (const k of LISTS) l[k] = d[k] || [];
      return l;
    }
    function toDef(l = lvl) {
      const def = { name: l.name, map: l.grid.map((r) => r.join('')) };
      for (const k of LISTS) if (l[k].length) def[k] = deep(l[k]);
      if (l.practice) def.practice = true;
      return def;
    }
    const W = () => lvl.grid[0].length, H = () => lvl.grid.length;
    const json = () => JSON.stringify(toDef());
    const dirty = () => lvl && json() !== savedJSON;

    function commit() {
      const j = json();
      if (j === lastJSON) return; // nothing changed: no undo step
      undo.push(lastJSON);
      if (undo.length > 300) undo.shift();
      redo = [];
      lastJSON = j;
      afterChange();
    }
    function restore(j) {
      const def = JSON.parse(j);
      const keepName = lvl.name;
      lvl = fromDef(def);
      if (doc.kind === 'builtin') lvl.name = keepName;
      lastJSON = j;
      if (sel && !(lvl[sel.list] && lvl[sel.list][sel.i])) sel = null;
      afterChange();
    }
    function doUndo() { if (undo.length) { redo.push(lastJSON); restore(undo.pop()); } }
    function doRedo() { if (redo.length) { undo.push(lastJSON); restore(redo.pop()); } }
    function afterChange() {
      store.set(DRAFT_KEY, { key: docKey(), json: lastJSON, time: Date.now() });
      updateTitle(); buildInspector(); buildLevelProps(); scheduleChecks(); render();
    }
    const docKey = () => (doc ? `${doc.kind}:${doc.origName}` : '');

    function openLevel(kind, name) {
      let def;
      if (kind === 'builtin') {
        def = custom.overrides[name] || LEVELS.find((l) => l.name === name && !l.custom) || builtinByName.get(name);
      } else {
        def = custom.levels.find((l) => l.name === name);
      }
      if (!def) { toast(`Can't find "${name}"`); return; }
      doc = { kind, origName: name };
      lvl = fromDef(def);
      lastJSON = savedJSON = json();
      undo = []; redo = []; sel = null;
      store.set(LAST_KEY, { kind, name });
      fitView();
      afterChange();
      offerDraft();
    }
    function offerDraft() {
      const d = store.get(DRAFT_KEY);
      const banner = $('.ed-banner');
      banner.hidden = true;
      if (!d || d.key !== docKey() || d.json === savedJSON) return;
      banner.hidden = false;
      banner.innerHTML = '<span></span> <button class="ed-btn small" data-b="restore">Restore</button> <button class="ed-btn small" data-b="discard">Discard</button>';
      banner.querySelector('span').textContent = `Unsaved changes from ${new Date(d.time).toLocaleString()} were found.`;
      banner.querySelector('[data-b=restore]').onclick = () => { banner.hidden = true; undo.push(lastJSON); restore(d.json); };
      banner.querySelector('[data-b=discard]').onclick = () => { banner.hidden = true; store.del(DRAFT_KEY); };
    }

    function newLevel(name, w, h) {
      const grid = Array.from({ length: h }, (_, r) => Array.from({ length: w }, (_, c) =>
        (r === 0 || c === 0 || r === h - 1 || c === w - 1 ? '#' : '.')));
      // a starter layout: start pad bottom-left, goal pad bottom-right
      for (let c = 1; c <= 5; c++) { grid[h - 4][c] = '='; for (let r = h - 3; r < h - 1; r++) grid[r][c] = '#'; }
      for (let c = w - 7; c <= w - 2; c++) { grid[h - 4][c] = '='; for (let r = h - 3; r < h - 1; r++) grid[r][c] = '#'; }
      grid[h - 5][3] = 'S';
      grid[h - 6][w - 4] = 'G';
      const def = { name, map: grid.map((r) => r.join('')) };
      custom.levels.push({ ...def, draft: true, editor: true });
      doc = { kind: 'custom', origName: name };
      lvl = fromDef(def);
      savedJSON = '';           // never saved yet
      lastJSON = json();
      undo = []; redo = []; sel = null;
      store.set(LAST_KEY, { kind: 'custom', name });
      fitView();
      afterChange();
    }

    // ---------- Saving ----------
    async function save() {
      if (!lvl) return;
      if (!backend) { toast('Saving needs the dev server (npm start) or the desktop build'); return; }
      const name = lvl.name.trim();
      if (!name) { toast('Give the level a name first'); return; }
      const def = toDef();
      def.editor = true;
      const errors = Core.validateLevel(def).filter((x) => x.severity === 'error');
      if (errors.length) def.draft = true;
      const data = deep(custom);
      if (doc.kind === 'builtin') {
        const original = builtinByName.get(doc.origName);
        const same = original && canon(stripMeta(original)) === canon(stripMeta(def));
        if (same) delete data.overrides[doc.origName];
        else data.overrides[doc.origName] = def;
      } else {
        if (builtinByName.has(name)) { toast(`"${name}" is a built-in level's name; pick another`); return; }
        if (data.levels.some((l) => l.name === name && l.name !== doc.origName)) { toast(`There's already a level called "${name}"`); return; }
        const i = data.levels.findIndex((l) => l.name === doc.origName);
        if (i >= 0) data.levels[i] = def; else data.levels.push(def);
      }
      const problem = CustomIO.checkCustomData(data);
      if (problem) { toast(`Can't save: ${problem}`); return; }
      try {
        setStatus('Saving…');
        await backend.save(data);
      } catch (e) {
        toast(`Save failed: ${e.message}`); updateTitle(); return;
      }
      Object.assign(custom, data);
      doc.origName = doc.kind === 'builtin' ? doc.origName : name;
      savedJSON = json();
      needsReload = true;
      store.del(DRAFT_KEY);
      store.set(LAST_KEY, { kind: doc.kind, name: doc.origName });
      updateTitle();
      toast(errors.length ? `Saved as a draft: fix ${errors.length} error(s) to make it playable in the game`
        : doc.kind === 'builtin' ? 'Saved. Your edit replaces the original level in the game' : 'Saved. Find it under Custom in level select');
    }
    // JSON with sorted keys, so key order never makes two equal levels look different
    function canon(o) {
      return JSON.stringify(o, (k, v) => (v && typeof v === 'object' && !Array.isArray(v)
        ? Object.fromEntries(Object.keys(v).sort().map((key) => [key, v[key]])) : v));
    }
    function stripMeta(d) {
      const c = deep(d);
      delete c.editor; delete c.draft;
      for (const k of LISTS) if (c[k] && !c[k].length) delete c[k];
      return c;
    }

    async function deleteCustom(name) {
      if (!confirm(`Delete "${name}"? This can't be undone (the previous file is kept as levels-custom.prev.js).`)) return;
      const data = deep(custom);
      data.levels = data.levels.filter((l) => l.name !== name);
      try { await backend.save(data); } catch (e) { toast(`Delete failed: ${e.message}`); return; }
      Object.assign(custom, data);
      needsReload = true;
      if (doc && doc.kind === 'custom' && doc.origName === name) { doc = null; lvl = null; }
      showOpen();
      render();
    }
    async function revertBuiltin(name) {
      if (!confirm(`Throw away your edits to "${name}" and go back to the original?`)) return;
      const data = deep(custom);
      delete data.overrides[name];
      try { await backend.save(data); } catch (e) { toast(`Revert failed: ${e.message}`); return; }
      Object.assign(custom, data);
      needsReload = true;
      openLevel('builtin', name);
      closeModal();
      toast('Back to the original');
    }

    // ---------- View ----------
    function resize() {
      const dpr = window.devicePixelRatio || 1;
      const r = canvas.getBoundingClientRect();
      canvas.width = Math.max(1, Math.round(r.width * dpr));
      canvas.height = Math.max(1, Math.round(r.height * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      render();
    }
    function fitView() {
      if (!lvl) return;
      const r = canvas.getBoundingClientRect();
      const z = Math.min((r.width - 40) / W(), (r.height - 40) / H());
      view.zoom = Math.max(4, Math.min(48, z));
      view.ox = (r.width - W() * view.zoom) / 2;
      view.oy = (r.height - H() * view.zoom) / 2;
      render();
    }
    function centerOn(x, y) {
      const r = canvas.getBoundingClientRect();
      view.zoom = Math.max(view.zoom, 20);
      view.ox = r.width / 2 - x * view.zoom;
      view.oy = r.height / 2 - y * view.zoom;
      flash = { x, y, until: performance.now() + 1200 };
      render();
    }
    const toTile = (sx, sy) => ({ tx: (sx - view.ox) / view.zoom, ty: (sy - view.oy) / view.zoom });

    // ---------- Tiles ----------
    const inside = (c, r) => c > 0 && r > 0 && c < W() - 1 && r < H() - 1; // the border stays rock
    function setTile(c, r, ch) {
      if (!inside(c, r) || lvl.grid[r][c] === ch) return false;
      if (ch === 'S' || ch === 'G') { // only one of each: move it
        for (const row of lvl.grid) for (let k = 0; k < row.length; k++) if (row[k] === ch) row[k] = '.';
      }
      lvl.grid[r][c] = ch;
      return true;
    }
    function line(c0, r0, c1, r1, fn) {
      const dc = Math.abs(c1 - c0), dr = Math.abs(r1 - r0), sc = c0 < c1 ? 1 : -1, sr = r0 < r1 ? 1 : -1;
      let err = dc - dr, c = c0, r = r0;
      for (;;) {
        fn(c, r);
        if (c === c1 && r === r1) break;
        const e2 = 2 * err;
        if (e2 > -dr) { err -= dr; c += sc; }
        if (e2 < dc) { err += dc; r += sr; }
      }
    }
    function floodFill(c, r, ch) {
      if (!inside(c, r)) return;
      const from = lvl.grid[r][c];
      if (from === ch || ch === 'S' || ch === 'G') return;
      const stack = [[c, r]];
      let n = 0;
      while (stack.length && n < 200000) {
        const [x, y] = stack.pop();
        if (!inside(x, y) || lvl.grid[y][x] !== from) continue;
        lvl.grid[y][x] = ch; n++;
        stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
      }
    }
    function fillRect(a, b, ch) {
      const c0 = Math.min(a.c, b.c), c1 = Math.max(a.c, b.c), r0 = Math.min(a.r, b.r), r1 = Math.max(a.r, b.r);
      for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) if (ch !== 'S' && ch !== 'G') setTile(c, r, ch);
    }

    // ---------- Objects ----------
    function kindOf(list, o) {
      if (list === 'movers') return o.shape === 'block' ? 'crusher' : o.orbit ? 'orbit' : 'saw';
      return { pushers: 'pusher', enemies: 'drone', shields: 'shield', coins: 'coin', fuels: 'fuel', guns: 'gun', signs: 'sign' }[list];
    }
    function makeObject(id, x, y) {
      switch (id) {
        case 'saw': return { shape: 'saw', r: 0.55, path: [[x, y], [x + 4, y]], speed: 2 };
        case 'orbit': return { shape: 'saw', r: 0.55, orbit: { x, y, radius: 3 }, speed: 90 };
        case 'crusher': return { shape: 'block', w: 3, h: 1, path: [[x, y], [x + 6, y]], speed: 2.5 };
        case 'pusher': return { x, y, angle: -90, power: 480 };
        case 'sign': return { x, y, text: 'Text' };
        default: return { x, y };
      }
    }
    const listOf = (id) => OBJECT_ITEMS.find((o) => o.id === id).list;
    function objPoints(list, o) { // handles: [{ x, y, role, index }]
      const k = kindOf(list, o);
      if (k === 'saw' || k === 'crusher') return o.path.map(([x, y], index) => ({ x, y, role: 'point', index }));
      if (k === 'orbit') {
        return [{ x: o.orbit.x, y: o.orbit.y, role: 'center' },
          { x: o.orbit.x + o.orbit.radius, y: o.orbit.y, role: 'radius' }];
      }
      if (k === 'pusher') {
        const a = ((o.angle || 0) * Math.PI) / 180;
        return [{ x: o.x, y: o.y, role: 'center' }, { x: o.x + Math.cos(a) * 1.8, y: o.y + Math.sin(a) * 1.8, role: 'angle' }];
      }
      return [{ x: o.x, y: o.y, role: 'center' }];
    }
    function hitObject(tx, ty) {
      const tol = Math.max(0.35, 8 / view.zoom);
      for (let li = LISTS.length - 1; li >= 0; li--) {
        const list = LISTS[li];
        for (let i = lvl[list].length - 1; i >= 0; i--) {
          const o = lvl[list][i], k = kindOf(list, o);
          if (k === 'saw' || k === 'crusher') {
            const pts = o.path;
            for (let j = 0; j < pts.length; j++) {
              const [ax, ay] = pts[j], [bx, by] = pts[Math.min(j + 1, pts.length - 1)];
              if (distToSeg(tx, ty, ax, ay, bx, by) < (k === 'crusher' ? Math.max(o.w, o.h) / 2 : (o.r || 0.6)) + tol * 0.5) return { list, i };
            }
          } else if (k === 'orbit') {
            const d = Math.hypot(tx - o.orbit.x, ty - o.orbit.y);
            if (d < 0.6 + tol || Math.abs(d - o.orbit.radius) < 0.6) return { list, i };
          } else if (Math.hypot(tx - o.x, ty - o.y) < (k === 'pusher' ? (o.r || 0.8) : 0.55) + tol * 0.5) {
            return { list, i };
          }
        }
      }
      return null;
    }
    function hitHandle(tx, ty) {
      if (!sel) return null;
      const o = lvl[sel.list][sel.i];
      const tol = Math.max(0.3, 9 / view.zoom);
      const pts = objPoints(sel.list, o);
      for (let j = pts.length - 1; j >= 0; j--) if (Math.hypot(tx - pts[j].x, ty - pts[j].y) < tol) return pts[j];
      return null;
    }
    function distToSeg(px, py, ax, ay, bx, by) {
      const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
      const t = l2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2)) : 0;
      return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
    }
    function startMove(tx, ty, fine) {
      const o = lvl[sel.list][sel.i];
      return { kind: 'move', start: { tx, ty }, orig: deep(o), p0: objPoints(sel.list, o)[0], fine };
    }
    let inspectorTimer = 0;
    function buildInspectorSoon() { clearTimeout(inspectorTimer); inspectorTimer = setTimeout(buildInspector, 60); }
    function moveObject(list, o, dx, dy) {
      const k = kindOf(list, o);
      if (k === 'saw' || k === 'crusher') o.path = o.path.map(([x, y]) => [x + dx, y + dy]);
      else if (k === 'orbit') { o.orbit.x += dx; o.orbit.y += dy; }
      else { o.x += dx; o.y += dy; }
    }
    function round(o) { return JSON.parse(JSON.stringify(o, (k, v) => (typeof v === 'number' ? Math.round(v * 100) / 100 : v))); }
    function deleteSelected() {
      if (!sel) return;
      lvl[sel.list].splice(sel.i, 1);
      sel = null;
      commit();
    }
    function duplicateSelected() {
      if (!sel) return;
      const copy = deep(lvl[sel.list][sel.i]);
      moveObject(sel.list, copy, 1, 1);
      lvl[sel.list].push(copy);
      sel = { list: sel.list, i: lvl[sel.list].length - 1 };
      commit();
    }

    // ---------- Mouse ----------
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('pointerdown', (e) => {
      if (!lvl) return;
      canvas.setPointerCapture(e.pointerId);
      const r = canvas.getBoundingClientRect(), sx = e.clientX - r.left, sy = e.clientY - r.top;
      const { tx, ty } = toTile(sx, sy);
      const c = Math.floor(tx), row = Math.floor(ty);
      const fine = e.altKey;
      if (e.button === 1 || spaceHeld) { drag = { kind: 'pan', sx, sy, ox: view.ox, oy: view.oy }; return; }
      if (e.button === 2) { // erase: an object under the cursor, else tiles
        const hit = hitObject(tx, ty);
        if (hit) { lvl[hit.list].splice(hit.i, 1); sel = null; commit(); return; }
        drag = { kind: 'paint', ch: '.', last: { c, r: row } };
        setTile(c, row, '.'); render();
        return;
      }
      // 1) handles of the selected object
      const h = hitHandle(tx, ty);
      if (h) { drag = { kind: 'handle', h, fine }; return; }
      // 2) an object under the cursor: select it and drag it (any tool)
      const hit = hitObject(tx, ty);
      if (hit && (tool === 'select' || isObject(brush) || e.ctrlKey)) {
        sel = hit;
        drag = startMove(tx, ty, fine);
        buildInspector(); render();
        return;
      }
      if (tool === 'select') { sel = null; buildInspector(); drag = { kind: 'pan', sx, sy, ox: view.ox, oy: view.oy }; render(); return; }
      // 3) place / paint
      if (isObject(brush)) {
        const o = makeObject(brush, snap(tx, fine), snap(ty, fine));
        const list = listOf(brush);
        lvl[list].push(round(o));
        sel = { list, i: lvl[list].length - 1 };
        drag = startMove(tx, ty, fine);
        buildInspector(); render();
        return;
      }
      if (tool === 'fill') { floodFill(c, row, brush); commit(); return; }
      if (tool === 'rect' || e.shiftKey) { drag = { kind: 'rect', a: { c, r: row }, b: { c, r: row } }; render(); return; }
      if (brush === 'S' || brush === 'G') { setTile(c, row, brush); commit(); return; }
      drag = { kind: 'paint', ch: brush, last: { c, r: row } };
      setTile(c, row, brush); render();
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!lvl) return;
      const r = canvas.getBoundingClientRect(), sx = e.clientX - r.left, sy = e.clientY - r.top;
      const { tx, ty } = toTile(sx, sy);
      hover = { tx, ty };
      updatePos();
      if (!drag) { render(); return; }
      const c = Math.floor(tx), row = Math.floor(ty);
      if (drag.kind === 'pan') { view.ox = drag.ox + sx - drag.sx; view.oy = drag.oy + sy - drag.sy; }
      else if (drag.kind === 'paint') {
        line(drag.last.c, drag.last.r, c, row, (x, y) => setTile(x, y, drag.ch));
        drag.last = { c, r: row };
      } else if (drag.kind === 'rect') drag.b = { c, r: row };
      else if (drag.kind === 'move') {
        // move from where the drag started, so snapping never drifts
        const fine = drag.fine || e.altKey;
        const nx = snap(drag.p0.x + tx - drag.start.tx, fine), ny = snap(drag.p0.y + ty - drag.start.ty, fine);
        const o = deep(drag.orig);
        moveObject(sel.list, o, nx - drag.p0.x, ny - drag.p0.y);
        lvl[sel.list][sel.i] = round(o);
        buildInspectorSoon();
      } else if (drag.kind === 'handle') {
        const o = lvl[sel.list][sel.i], h = drag.h, fine = drag.fine || e.altKey;
        const x = snap(tx, fine), y = snap(ty, fine);
        if (h.role === 'point') o.path[h.index] = [x, y];
        else if (h.role === 'center') {
          const p0 = objPoints(sel.list, o)[0];
          moveObject(sel.list, o, x - p0.x, y - p0.y);
        } else if (h.role === 'radius') o.orbit.radius = Math.max(0.5, snap(Math.hypot(tx - o.orbit.x, ty - o.orbit.y), fine));
        else if (h.role === 'angle') {
          let a = (Math.atan2(ty - o.y, tx - o.x) * 180) / Math.PI;
          if (!fine) a = Math.round(a / 15) * 15;
          o.angle = Math.round(a);
        }
        lvl[sel.list][sel.i] = round(o);
        buildInspectorSoon();
      }
      render();
    });
    const endDrag = () => {
      if (!drag) return;
      if (drag.kind === 'rect') fillRect(drag.a, drag.b, drag.ch || brush);
      const was = drag;
      drag = null;
      if (was.kind !== 'pan') commit();
      buildInspector(); render();
    };
    canvas.addEventListener('pointerup', endDrag);
    canvas.addEventListener('pointercancel', endDrag);
    canvas.addEventListener('pointerleave', () => { hover = null; updatePos(); render(); });
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const r = canvas.getBoundingClientRect(), sx = e.clientX - r.left, sy = e.clientY - r.top;
      if (!e.ctrlKey && Math.abs(e.deltaX) > Math.abs(e.deltaY)) { view.ox -= e.deltaX; render(); return; }
      const before = toTile(sx, sy);
      const z = Math.max(4, Math.min(80, view.zoom * Math.pow(1.0015, -e.deltaY)));
      view.zoom = z;
      view.ox = sx - before.tx * z;
      view.oy = sy - before.ty * z;
      render();
    }, { passive: false });

    // ---------- Keyboard ----------
    function onKey(e) {
      if (!active) return;
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement && document.activeElement.tagName);
      const k = e.key, ctrl = e.ctrlKey || e.metaKey;
      if (ctrl && (k === 's' || k === 'S')) { e.preventDefault(); save(); return; }
      if (typing) { if (k === 'Escape') document.activeElement.blur(); return; }
      if (!$('.ed-modal').hidden) { if (k === 'Escape') closeModal(); return; }
      if (k === ' ') { spaceHeld = true; e.preventDefault(); return; }
      if (ctrl && (k === 'z' || k === 'Z')) { e.preventDefault(); if (e.shiftKey) doRedo(); else doUndo(); return; }
      if (ctrl && (k === 'y' || k === 'Y')) { e.preventDefault(); doRedo(); return; }
      if (ctrl && (k === 'd' || k === 'D')) { e.preventDefault(); duplicateSelected(); return; }
      if (ctrl) return;
      if (k === 'Escape') { sel = null; buildInspector(); render(); return; }
      if (k === 'Delete' || k === 'Backspace') { e.preventDefault(); deleteSelected(); return; }
      if (k === 'p' || k === 'P') { play(e.shiftKey); return; }
      if (k === 'o' || k === 'O') { showOpen(); return; }
      if (k === 'n' || k === 'N') { showNew(); return; }
      if (k === 'g' || k === 'G') { showGrid = !showGrid; render(); return; }
      if (k === 'm' || k === 'M') { animate = !animate; animT = 0; toast(animate ? 'Animating saws and crushers (M to stop)' : 'Animation off'); render(); return; }
      if (k === 'Home' || k === 'h' || k === 'H') { fitView(); return; }
      if (k === '?') { showHelp(); return; }
      const t = TOOLS.find((x) => x.key.toLowerCase() === k.toLowerCase());
      if (t) { setTool(t.id); return; }
      const item = [...TILE_ITEMS, ...OBJECT_ITEMS].find((x) => x.key === k);
      if (item) setBrush(item.id);
    }
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', (e) => { if (e.key === ' ') spaceHeld = false; });
    window.addEventListener('blur', () => { spaceHeld = false; });
    window.addEventListener('resize', () => { if (active) resize(); });
    window.addEventListener('beforeunload', (e) => { if (active && dirty()) { e.preventDefault(); e.returnValue = ''; } });

    // ---------- Buttons ----------
    el.querySelector('.ed-top').addEventListener('click', (e) => {
      const act = e.target.closest('[data-act]') && e.target.closest('[data-act]').dataset.act;
      if (act === 'open') showOpen();
      else if (act === 'new') showNew();
      else if (act === 'undo') doUndo();
      else if (act === 'redo') doRedo();
      else if (act === 'play') play(false);
      else if (act === 'save') save();
      else if (act === 'help') showHelp();
      else if (act === 'exit') exit();
    });
    function exit() {
      if (dirty() && !confirm('You have unsaved changes. Leave the editor anyway? (They stay in this browser as a draft.)')) return;
      onExit(needsReload);
    }
    function play(fromCursor) {
      if (!lvl) return;
      const def = toDef();
      const errors = Core.validateLevel(def).filter((x) => x.severity === 'error');
      if (errors.length) { toast(`Can't play yet: ${errors[0].message}`); if (errors[0].x != null) centerOn(errors[0].x, errors[0].y); return; }
      if (!def.coins) def.coins = [];
      const spawn = fromCursor && hover ? { x: hover.tx * TILE, y: hover.ty * TILE } : null;
      onPlay(def, spawn);
    }

    // ---------- Panels ----------
    function updateTitle() {
      $('.ed-name').textContent = lvl ? lvl.name : 'No level open';
      setStatus(!lvl ? '' : !savedJSON ? 'never saved' : dirty() ? '● unsaved' : 'saved');
      $('[data-act=undo]').disabled = !undo.length;
      $('[data-act=redo]').disabled = !redo.length;
    }
    function setStatus(t) { const s = $('.ed-status'); s.textContent = t; s.className = 'ed-status' + (t.includes('unsaved') ? ' warn' : ''); }
    function updatePos() {
      $('.ed-pos').textContent = hover && lvl ? `x ${hover.tx.toFixed(1)}  y ${hover.ty.toFixed(1)}  ·  ${W()}×${H()}  ·  zoom ${Math.round(view.zoom)}px` : '';
    }
    function updateHint() {
      const item = [...TILE_ITEMS, ...OBJECT_ITEMS].find((x) => x.id === brush);
      const t = TOOLS.find((x) => x.id === tool);
      $('.ed-hint').textContent = tool === 'select'
        ? 'Select: click an object to edit it, drag to move · drag empty space to pan'
        : `${t.label} · ${item.label}: left click ${isObject(brush) ? 'places' : 'paints'}, right click erases · Space/middle drag pans, wheel zooms · P plays`;
    }

    function field(parent, label, value, onChange, opts = {}) {
      const row = document.createElement('label');
      row.className = 'ed-field';
      row.innerHTML = '<span></span>';
      row.querySelector('span').textContent = label;
      const input = document.createElement(opts.textarea ? 'textarea' : 'input');
      if (!opts.textarea) input.type = opts.type || 'number';
      if (opts.step) input.step = opts.step;
      if (opts.placeholder != null) input.placeholder = opts.placeholder;
      if (opts.disabled) input.disabled = true;
      input.value = value == null ? '' : value;
      input.addEventListener('input', () => {
        const v = opts.type === 'text' || opts.textarea ? input.value : input.value === '' ? undefined : Number(input.value);
        if (v !== undefined && typeof v === 'number' && !Number.isFinite(v)) return;
        onChange(v); render();
      });
      input.addEventListener('change', () => commit());
      row.appendChild(input);
      parent.appendChild(row);
      return input;
    }
    function buildInspector() {
      const box = $('.ed-inspector');
      box.innerHTML = '';
      const h = document.createElement('h4');
      box.appendChild(h);
      if (!lvl || !sel || !lvl[sel.list] || !lvl[sel.list][sel.i]) {
        h.textContent = 'Selection';
        const p = document.createElement('p');
        p.className = 'ed-muted';
        p.textContent = 'Click an object to edit it. Pick a tile or object on the left, then paint or place it on the map.';
        box.appendChild(p);
        return;
      }
      const o = lvl[sel.list][sel.i], k = kindOf(sel.list, o);
      h.textContent = OBJECT_ITEMS.find((x) => x.id === k).label;
      const set = (fn) => (v) => { fn(v); };
      if (k === 'saw' || k === 'crusher') {
        if (k === 'saw') field(box, 'Radius (tiles)', o.r, set((v) => { o.r = v; }), { step: 0.05, placeholder: 0.6 });
        else {
          field(box, 'Width', o.w, set((v) => { o.w = v; }), { step: 0.5 });
          field(box, 'Height', o.h, set((v) => { o.h = v; }), { step: 0.5 });
        }
        field(box, 'Speed (tiles/s)', o.speed, set((v) => { o.speed = v; }), { step: 0.1, placeholder: 2 });
        field(box, 'Phase (tiles along the path)', o.phase, set((v) => { o.phase = v || undefined; }), { step: 0.5, placeholder: 0 });
        const pts = document.createElement('div');
        pts.className = 'ed-muted';
        pts.textContent = `Path: ${o.path.map(([x, y]) => `(${x}, ${y})`).join(' → ')}. Drag the dots on the map.`;
        box.appendChild(pts);
        const row = document.createElement('div');
        row.className = 'ed-row';
        const add = document.createElement('button'); add.className = 'ed-btn small'; add.textContent = '+ Point';
        add.onclick = () => { const [x, y] = o.path[o.path.length - 1]; o.path.push([x + 2, y]); commit(); };
        const rem = document.createElement('button'); rem.className = 'ed-btn small'; rem.textContent = '− Point';
        rem.disabled = o.path.length <= 2;
        rem.onclick = () => { o.path.pop(); commit(); };
        row.append(add, rem);
        box.appendChild(row);
      } else if (k === 'orbit') {
        field(box, 'Saw radius (tiles)', o.r, set((v) => { o.r = v; }), { step: 0.05, placeholder: 0.6 });
        field(box, 'Orbit radius (tiles)', o.orbit.radius, set((v) => { if (v > 0) o.orbit.radius = v; }), { step: 0.5 });
        field(box, 'Speed (degrees/s, minus = other way)', o.speed, set((v) => { o.speed = v; }), { step: 5 });
        field(box, 'Phase (degrees)', o.phase, set((v) => { o.phase = v || undefined; }), { step: 15, placeholder: 0 });
        field(box, 'Centre x', o.orbit.x, set((v) => { if (v != null) o.orbit.x = v; }), { step: 0.5 });
        field(box, 'Centre y', o.orbit.y, set((v) => { if (v != null) o.orbit.y = v; }), { step: 0.5 });
      } else {
        field(box, 'x', o.x, set((v) => { if (v != null) o.x = v; }), { step: 0.5 });
        field(box, 'y', o.y, set((v) => { if (v != null) o.y = v; }), { step: 0.5 });
        if (k === 'pusher') {
          field(box, 'Direction (degrees: 0 right, -90 up)', o.angle, set((v) => { o.angle = v || 0; }), { step: 15 });
          field(box, 'Power (px/s)', o.power, set((v) => { o.power = v; }), { step: 20, placeholder: 480 });
          field(box, 'Size (tiles)', o.r, set((v) => { o.r = v; }), { step: 0.1, placeholder: 0.8 });
        } else if (k === 'drone') {
          field(box, 'Sight range (tiles)', o.range, set((v) => { o.range = v; }), { step: 0.5, placeholder: 6 });
          field(box, 'Dash length (tiles)', o.dash, set((v) => { o.dash = v; }), { step: 0.5, placeholder: 6 });
          field(box, 'Dash speed (px/s)', o.speed, set((v) => { o.speed = v; }), { step: 10, placeholder: 380 });
          field(box, 'Rest between dashes (s)', o.recharge, set((v) => { o.recharge = v; }), { step: 0.1, placeholder: 1.6 });
        } else if (k === 'sign') {
          field(box, 'Text (Enter for a new line)', o.text, set((v) => { o.text = v; }), { textarea: true });
        }
      }
      const row = document.createElement('div');
      row.className = 'ed-row';
      const dup = document.createElement('button'); dup.className = 'ed-btn small'; dup.textContent = 'Duplicate (Ctrl+D)'; dup.onclick = duplicateSelected;
      const del = document.createElement('button'); del.className = 'ed-btn small danger'; del.textContent = 'Delete (Del)'; del.onclick = deleteSelected;
      row.append(dup, del);
      box.appendChild(row);
    }

    function buildLevelProps() {
      const box = $('.ed-levelprops');
      box.innerHTML = '';
      if (!lvl) return;
      const builtin = doc.kind === 'builtin';
      field(box, builtin ? 'Name (built-in levels keep their name)' : 'Name', lvl.name, (v) => { lvl.name = v; updateTitle(); },
        { type: 'text', disabled: builtin });
      const size = document.createElement('div');
      size.className = 'ed-size';
      size.innerHTML = `<span class="ed-muted">Size ${W()} × ${H()} tiles. Grow or shrink a side:</span>
        <div class="ed-grid4">
          <span></span><span><button class="ed-btn small" data-s="top+">＋</button><button class="ed-btn small" data-s="top-">−</button><br>top</span><span></span>
          <span>left<br><button class="ed-btn small" data-s="left+">＋</button><button class="ed-btn small" data-s="left-">−</button></span><span></span>
          <span>right<br><button class="ed-btn small" data-s="right+">＋</button><button class="ed-btn small" data-s="right-">−</button></span>
          <span></span><span>bottom<br><button class="ed-btn small" data-s="bottom+">＋</button><button class="ed-btn small" data-s="bottom-">−</button></span><span></span>
        </div><span class="ed-muted">Shift+click: 5 at a time</span>`;
      size.addEventListener('click', (e) => {
        const b = e.target.closest('[data-s]');
        if (!b) return;
        const side = b.dataset.s.slice(0, -1), grow = b.dataset.s.endsWith('+');
        resizeSide(side, (grow ? 1 : -1) * (e.shiftKey ? 5 : 1));
      });
      box.appendChild(size);
      const coins = document.createElement('div');
      coins.className = 'ed-row';
      const auto = document.createElement('button'); auto.className = 'ed-btn small';
      auto.textContent = 'Auto coins';
      auto.title = 'Replace all coins with one above each pad plus a few challenge coins (the built-in rule)';
      auto.onclick = () => {
        if (lvl.coins.length && !confirm('Replace all coins with automatic ones?')) return;
        lvl.coins = LEVELS.autoCoins(toDef()).map((c) => round(c));
        commit();
      };
      const clear = document.createElement('button'); clear.className = 'ed-btn small'; clear.textContent = 'Clear coins';
      clear.onclick = () => { lvl.coins = []; commit(); };
      coins.append(auto, clear);
      box.appendChild(coins);
    }
    function resizeSide(side, n) {
      const w = W(), h = H();
      const nw = side === 'left' || side === 'right' ? w + n : w, nh = side === 'top' || side === 'bottom' ? h + n : h;
      if (nw < 6 || nh < 6 || nw > 400 || nh > 400) return;
      const dx = side === 'left' ? n : 0, dy = side === 'top' ? n : 0;
      const old = lvl.grid;
      const grid = Array.from({ length: nh }, (_, r) => Array.from({ length: nw }, (_, c) => {
        if (r === 0 || c === 0 || r === nh - 1 || c === nw - 1) return '#';
        const or = r - dy, oc = c - dx;
        const ch = or > 0 && oc > 0 && or < h - 1 && oc < w - 1 ? old[or][oc] : '.';
        return ch;
      }));
      lvl.grid = grid;
      if (dx || dy) for (const list of LISTS) lvl[list].forEach((o, i) => { moveObject(list, o, dx, dy); lvl[list][i] = round(o); });
      if (dx || dy) view.ox -= dx * view.zoom, view.oy -= dy * view.zoom;
      commit();
    }

    function scheduleChecks() {
      clearTimeout(issuesTimer);
      issuesTimer = setTimeout(runChecks, 200);
    }
    function runChecks() {
      if (!lvl) return;
      issues = Core.validateLevel(toDef());
      const box = $('.ed-issues');
      box.innerHTML = '';
      const errs = issues.filter((x) => x.severity === 'error').length;
      $('.ed-issue-count').textContent = issues.length ? `${errs} error${errs === 1 ? '' : 's'}, ${issues.length - errs} warning${issues.length - errs === 1 ? '' : 's'}` : '';
      if (!issues.length) {
        const ok = document.createElement('p'); ok.className = 'ed-ok'; ok.textContent = '✓ No problems found';
        box.appendChild(ok);
      }
      for (const it of issues) {
        const b = document.createElement('button');
        b.className = `ed-issue ${it.severity}`;
        b.textContent = `${it.severity === 'error' ? '✖' : '⚠'} ${it.message}`;
        b.title = it.x != null ? 'Click to show it on the map' : '';
        if (it.x != null) b.onclick = () => centerOn(it.x, it.y);
        box.appendChild(b);
      }
      render();
    }

    // ---------- Dialogs ----------
    function modal(html) {
      const m = $('.ed-modal');
      m.hidden = false;
      const d = m.querySelector('.ed-dialog');
      d.innerHTML = html;
      m.onclick = (e) => { if (e.target === m) closeModal(); };
      return d;
    }
    function closeModal() { $('.ed-modal').hidden = true; }
    function showOpen() {
      const d = modal(`<h3>Open a level</h3><input class="ed-search" placeholder="Search levels…">
        <div class="ed-list"></div><div class="ed-row end"><button class="ed-btn" data-x="new">＋ New level</button><button class="ed-btn" data-x="close">Close</button></div>`);
      const list = d.querySelector('.ed-list');
      const search = d.querySelector('.ed-search');
      function fill() {
        const q = search.value.trim().toLowerCase();
        list.innerHTML = '';
        const section = (title) => { const h = document.createElement('div'); h.className = 'ed-group'; h.textContent = title; list.appendChild(h); };
        const row = (name, note, onOpen, extra) => {
          if (q && !name.toLowerCase().includes(q)) return;
          const r = document.createElement('div');
          r.className = 'ed-level';
          const b = document.createElement('button');
          b.className = 'ed-level-open';
          b.innerHTML = '<span></span><small></small>';
          b.querySelector('span').textContent = name;
          b.querySelector('small').textContent = note;
          b.onclick = () => { if (dirty() && !confirm('Discard unsaved changes to this level? (A draft stays in this browser.)')) return; closeModal(); onOpen(); };
          r.appendChild(b);
          if (extra) r.appendChild(extra);
          list.appendChild(r);
        };
        section('Custom levels');
        if (!custom.levels.length) {
          const p = document.createElement('p'); p.className = 'ed-muted'; p.textContent = 'None yet. Make one with ＋ New level.'; list.appendChild(p);
        }
        for (const l of custom.levels) {
          const del = document.createElement('button');
          del.className = 'ed-btn small danger'; del.textContent = 'Delete';
          del.onclick = () => deleteCustom(l.name);
          row(l.name, l.draft ? 'draft (has errors, not in the game yet)' : `${l.map[0].length}×${l.map.length}`, () => openLevel('custom', l.name), del);
        }
        section('Game levels');
        LEVELS.forEach((l, i) => {
          if (l.custom) return;
          const edited = custom.overrides[l.name];
          let extra = null;
          if (edited) {
            extra = document.createElement('button');
            extra.className = 'ed-btn small'; extra.textContent = 'Revert';
            extra.title = 'Throw away your edits and go back to the original';
            extra.onclick = () => revertBuiltin(l.name);
          }
          row(`${i + 1}. ${l.name}`, edited ? (edited.draft ? 'edited (draft)' : 'edited') : '', () => openLevel('builtin', l.name), extra);
        });
      }
      search.addEventListener('input', fill);
      d.querySelector('[data-x=close]').onclick = closeModal;
      d.querySelector('[data-x=new]').onclick = showNew;
      fill();
      search.focus();
    }
    function showNew() {
      const d = modal(`<h3>New level</h3>
        <label class="ed-field"><span>Name</span><input data-n="name" type="text" value="My Level"></label>
        <label class="ed-field"><span>Width (tiles)</span><input data-n="w" type="number" value="60" min="10" max="400"></label>
        <label class="ed-field"><span>Height (tiles)</span><input data-n="h" type="number" value="24" min="10" max="400"></label>
        <p class="ed-muted">The screen shows about 32×20 tiles. You can resize later.</p>
        <div class="ed-row end"><button class="ed-btn" data-x="cancel">Cancel</button><button class="ed-btn primary" data-x="ok">Create</button></div>`);
      const nameI = d.querySelector('[data-n=name]');
      let base = 'My Level', n = 1;
      const taken = (s) => custom.levels.some((l) => l.name === s) || builtinByName.has(s);
      while (taken(nameI.value)) nameI.value = `${base} ${++n}`;
      nameI.select(); nameI.focus();
      d.querySelector('[data-x=cancel]').onclick = closeModal;
      const ok = () => {
        const name = nameI.value.trim();
        const w = Math.round(Number(d.querySelector('[data-n=w]').value)), h = Math.round(Number(d.querySelector('[data-n=h]').value));
        if (!name) { toast('Give it a name'); return; }
        if (taken(name)) { toast(`There's already a level called "${name}"`); return; }
        if (!(w >= 10 && w <= 400 && h >= 10 && h <= 400)) { toast('Size must be 10 to 400 tiles'); return; }
        if (dirty() && !confirm('Discard unsaved changes to the current level? (A draft stays in this browser.)')) return;
        closeModal();
        newLevel(name, w, h);
        toast('New level: paint with the tools on the left, press P to play it');
      };
      d.querySelector('[data-x=ok]').onclick = ok;
      d.addEventListener('keydown', (e) => { if (e.key === 'Enter') ok(); });
    }
    function showHelp() {
      const d = modal(`<h3>Level editor shortcuts</h3><div class="ed-help">
        <div><kbd>Left click</kbd> paint tile / place object</div><div><kbd>Right click</kbd> erase (tile or object)</div>
        <div><kbd>Shift</kbd>+drag rectangle with the brush</div><div><kbd>Alt</kbd>+drag fine placement (no snapping)</div>
        <div><kbd>Space</kbd>+drag or middle drag: pan</div><div><kbd>Wheel</kbd> zoom at the cursor · <kbd>H</kbd> fit level</div>
        <div><kbd>B</kbd> brush · <kbd>R</kbd> rectangle · <kbd>F</kbd> fill · <kbd>V</kbd> select</div><div><kbd>1</kbd>–<kbd>0</kbd> palette items</div>
        <div><kbd>Ctrl+Z</kbd> undo · <kbd>Ctrl+Y</kbd> redo</div><div><kbd>Ctrl+S</kbd> save</div>
        <div><kbd>P</kbd> play from the start · <kbd>Shift+P</kbd> play from the cursor</div><div><kbd>Esc</kbd> while playing: back here</div>
        <div><kbd>Del</kbd> delete selected · <kbd>Ctrl+D</kbd> duplicate</div><div><kbd>Ctrl</kbd>+click selects an object with any tool</div>
        <div><kbd>M</kbd> animate saws and crushers</div><div><kbd>G</kbd> grid · <kbd>O</kbd> open · <kbd>N</kbd> new</div>
        </div><p class="ed-muted">The map edge is always rock. Saving with errors keeps the level as a draft that the game ignores.
        Built-in levels you edit replace the original in the game (Revert in the level list undoes that).</p>
        <div class="ed-row end"><button class="ed-btn primary" data-x="close">Got it</button></div>`);
      d.querySelector('[data-x=close]').onclick = closeModal;
    }
    function toast(text) {
      const t = $('.ed-toast');
      t.textContent = text;
      t.hidden = false;
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => { t.hidden = true; }, 3200);
    }

    // ---------- Drawing ----------
    let raf = 0;
    function render() { if (!raf) raf = requestAnimationFrame(draw); }
    function draw(now) {
      raf = 0;
      if (!active) return;
      const r = canvas.getBoundingClientRect();
      ctx.fillStyle = COLORS.bg;
      ctx.fillRect(0, 0, r.width, r.height);
      if (!lvl) {
        ctx.fillStyle = '#8f9ac6'; ctx.font = '16px Segoe UI, sans-serif'; ctx.textAlign = 'center';
        ctx.fillText('Open a level (O) or make a new one (N)', r.width / 2, r.height / 2);
        return;
      }
      const z = view.zoom;
      const c0 = Math.max(0, Math.floor(-view.ox / z)), r0 = Math.max(0, Math.floor(-view.oy / z));
      const c1 = Math.min(W() - 1, Math.ceil((r.width - view.ox) / z)), r1 = Math.min(H() - 1, Math.ceil((r.height - view.oy) / z));
      const X = (tx) => view.ox + tx * z, Y = (ty) => view.oy + ty * z;
      const g = lvl.grid;
      const isRock = (c, rr) => rr < 0 || c < 0 || rr >= H() || c >= W() || g[rr][c] === '#';
      for (let rr = r0; rr <= r1; rr++) {
        for (let c = c0; c <= c1; c++) {
          const ch = g[rr][c], x = X(c), y = Y(rr);
          if (ch === '#') {
            ctx.fillStyle = COLORS.rock; ctx.fillRect(x, y, z + 0.5, z + 0.5);
            ctx.fillStyle = COLORS.rockEdge;
            const t = Math.max(1, z / 12);
            if (!isRock(c, rr - 1)) ctx.fillRect(x, y, z, t);
            if (!isRock(c, rr + 1)) ctx.fillRect(x, y + z - t, z, t);
            if (!isRock(c - 1, rr)) ctx.fillRect(x, y, t, z);
            if (!isRock(c + 1, rr)) ctx.fillRect(x + z - t, y, t, z);
          } else if (ch === '=' || ch === 'C') {
            ctx.fillStyle = ch === '=' ? COLORS.pad : COLORS.cp; ctx.fillRect(x, y, z + 0.5, z + 0.5);
            ctx.fillStyle = ch === '=' ? COLORS.padTop : COLORS.cpTop; ctx.fillRect(x, y, z + 0.5, Math.max(2, z / 6));
          }
        }
      }
      if (showGrid && z >= 8) {
        ctx.lineWidth = 1;
        for (let c = c0; c <= c1 + 1; c++) {
          ctx.strokeStyle = c % 5 === 0 ? COLORS.grid5 : COLORS.grid;
          ctx.beginPath(); ctx.moveTo(Math.round(X(c)) + 0.5, Y(r0)); ctx.lineTo(Math.round(X(c)) + 0.5, Y(r1 + 1)); ctx.stroke();
        }
        for (let rr = r0; rr <= r1 + 1; rr++) {
          ctx.strokeStyle = rr % 5 === 0 ? COLORS.grid5 : COLORS.grid;
          ctx.beginPath(); ctx.moveTo(X(c0), Math.round(Y(rr)) + 0.5); ctx.lineTo(X(c1 + 1), Math.round(Y(rr)) + 0.5); ctx.stroke();
        }
      }
      // start and goal
      for (let rr = 0; rr < H(); rr++) for (let c = 0; c < W(); c++) {
        if (g[rr][c] === 'S' || g[rr][c] === 'G') {
          ctx.save(); ctx.translate(X(c + 0.5), Y(rr + 0.5)); ctx.scale(z / 40, z / 40);
          iconPath(ctx, g[rr][c]); ctx.restore();
        }
      }
      // objects
      let world = null;
      if (animate) {
        const key = lastJSON;
        if (key !== animKey) { try { animWorld = Core.createWorld(toDef()); } catch (e) { animWorld = null; } animKey = key; }
        world = animWorld;
        if (world) { animT += 1 / 60; Core.updateMovers(world, animT); }
      }
      for (const list of LISTS) {
        lvl[list].forEach((o, i) => {
          const k = kindOf(list, o);
          const selected = sel && sel.list === list && sel.i === i;
          drawObject(k, o, selected, world && list === 'movers' ? world.movers[i] : null, X, Y, z);
        });
      }
      // selection handles
      if (sel && lvl[sel.list] && lvl[sel.list][sel.i]) {
        for (const p of objPoints(sel.list, lvl[sel.list][sel.i])) {
          ctx.fillStyle = p.role === 'center' || p.role === 'point' ? '#ffffff' : '#ffe066';
          ctx.strokeStyle = '#0b0e1a'; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.arc(X(p.x), Y(p.y), 5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        }
      }
      // issues on the map
      for (const it of issues) {
        if (it.x == null) continue;
        ctx.strokeStyle = it.severity === 'error' ? '#ff4d6d' : '#ffc93d'; ctx.lineWidth = 2;
        ctx.setLineDash([4, 3]);
        ctx.beginPath(); ctx.arc(X(it.x), Y(it.y), Math.max(10, z * 0.8), 0, Math.PI * 2); ctx.stroke();
        ctx.setLineDash([]);
      }
      if (flash && now < flash.until) {
        const k = (flash.until - now) / 1200;
        ctx.strokeStyle = `rgba(255,255,255,${k})`; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(X(flash.x), Y(flash.y), z * (1.2 + (1 - k) * 2), 0, Math.PI * 2); ctx.stroke();
        render();
      }
      // brush preview
      if (drag && drag.kind === 'rect') {
        const a = drag.a, b = drag.b;
        const x = X(Math.min(a.c, b.c)), y = Y(Math.min(a.r, b.r));
        ctx.fillStyle = 'rgba(127,220,255,0.18)'; ctx.strokeStyle = '#7fdcff'; ctx.lineWidth = 2;
        ctx.fillRect(x, y, (Math.abs(a.c - b.c) + 1) * z, (Math.abs(a.r - b.r) + 1) * z);
        ctx.strokeRect(x, y, (Math.abs(a.c - b.c) + 1) * z, (Math.abs(a.r - b.r) + 1) * z);
      } else if (hover && !drag && tool !== 'select') {
        if (isObject(brush)) {
          ctx.globalAlpha = 0.45;
          ctx.save(); ctx.translate(X(snap(hover.tx)), Y(snap(hover.ty))); ctx.scale(z / 40, z / 40); iconPath(ctx, brush); ctx.restore();
          ctx.globalAlpha = 1;
        } else {
          const c = Math.floor(hover.tx), rr = Math.floor(hover.ty);
          ctx.strokeStyle = inside(c, rr) ? '#ffffff' : '#ff4d6d'; ctx.lineWidth = 2;
          ctx.strokeRect(X(c) + 1, Y(rr) + 1, z - 2, z - 2);
        }
      }
      // level outline
      ctx.strokeStyle = 'rgba(223,230,255,0.35)'; ctx.lineWidth = 1;
      ctx.strokeRect(X(0) - 0.5, Y(0) - 0.5, W() * z + 1, H() * z + 1);
      if (animate) render();
    }

    function drawObject(k, o, selected, live, X, Y, z) {
      const S = z / 40;
      ctx.save();
      if (k === 'saw' || k === 'crusher') {
        ctx.strokeStyle = selected ? '#ffe066' : 'rgba(255,255,255,0.35)'; ctx.lineWidth = selected ? 2 : 1.5;
        ctx.setLineDash([6, 5]);
        ctx.beginPath(); o.path.forEach(([x, y], j) => (j ? ctx.lineTo(X(x), Y(y)) : ctx.moveTo(X(x), Y(y)))); ctx.stroke();
        ctx.setLineDash([]);
        const [px, py] = live ? [live.x / TILE, live.y / TILE] : o.path[0];
        if (k === 'saw') drawSaw(X(px), Y(py), (o.r || 0.6) * z, selected);
        else {
          ctx.fillStyle = '#8a92ad'; ctx.strokeStyle = selected ? '#ffe066' : '#dfe6ff'; ctx.lineWidth = 2;
          ctx.fillRect(X(px - o.w / 2), Y(py - o.h / 2), o.w * z, o.h * z);
          ctx.strokeRect(X(px - o.w / 2), Y(py - o.h / 2), o.w * z, o.h * z);
        }
      } else if (k === 'orbit') {
        ctx.strokeStyle = selected ? '#ffe066' : 'rgba(255,255,255,0.3)'; ctx.lineWidth = selected ? 2 : 1.5; ctx.setLineDash([6, 5]);
        ctx.beginPath(); ctx.arc(X(o.orbit.x), Y(o.orbit.y), o.orbit.radius * z, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
        const a = ((o.phase || 0) * Math.PI) / 180;
        const [px, py] = live ? [live.x / TILE, live.y / TILE] : [o.orbit.x + Math.cos(a) * o.orbit.radius, o.orbit.y + Math.sin(a) * o.orbit.radius];
        drawSaw(X(px), Y(py), (o.r || 0.6) * z, selected);
        ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.beginPath(); ctx.arc(X(o.orbit.x), Y(o.orbit.y), 2.5, 0, Math.PI * 2); ctx.fill();
      } else if (k === 'pusher') {
        const r = (o.r || 0.8) * z, a = ((o.angle || 0) * Math.PI) / 180;
        ctx.strokeStyle = '#7fdcff'; ctx.lineWidth = Math.max(1.5, 3 * S);
        ctx.fillStyle = 'rgba(127,220,255,0.15)';
        ctx.beginPath(); ctx.arc(X(o.x), Y(o.y), r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(X(o.x), Y(o.y)); ctx.lineTo(X(o.x) + Math.cos(a) * 1.8 * z, Y(o.y) + Math.sin(a) * 1.8 * z); ctx.stroke();
        if (selected) { ctx.strokeStyle = '#ffe066'; ctx.beginPath(); ctx.arc(X(o.x), Y(o.y), r + 4, 0, Math.PI * 2); ctx.stroke(); }
      } else {
        if (k === 'drone' && selected) {
          ctx.strokeStyle = 'rgba(255,77,109,0.6)'; ctx.setLineDash([5, 5]); ctx.lineWidth = 1.5;
          ctx.beginPath(); ctx.arc(X(o.x), Y(o.y), (o.range || 6) * z, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
        }
        ctx.translate(X(o.x), Y(o.y)); ctx.scale(S, S);
        iconPath(ctx, k);
        if (k === 'sign') {
          ctx.fillStyle = '#dfe6ff'; ctx.font = '13px Segoe UI, sans-serif'; ctx.textAlign = 'center';
          String(o.text || '').split('\n').forEach((t, j) => ctx.fillText(t, 0, 34 + j * 15));
        }
        if (selected) { ctx.strokeStyle = '#ffe066'; ctx.lineWidth = 2.5; ctx.strokeRect(-20, -20, 40, 40); }
      }
      ctx.restore();
    }
    function drawSaw(x, y, r, selected) {
      ctx.fillStyle = '#c9cfdc'; ctx.strokeStyle = selected ? '#ffe066' : '#5b6275'; ctx.lineWidth = 2;
      ctx.beginPath();
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2, rr = i % 2 ? r * 0.8 : r;
        ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
      }
      ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#ff4d6d'; ctx.beginPath(); ctx.arc(x, y, r * 0.25, 0, Math.PI * 2); ctx.fill();
    }

    // ---------- Lifecycle ----------
    let active = false;
    async function open() {
      active = true;
      el.classList.add('active');
      buildPalette(); updateHint();
      requestAnimationFrame(() => {
        resize();
        if (!lvl) {
          const last = store.get(LAST_KEY);
          const exists = last && (last.kind === 'builtin' ? builtinByName.has(last.name) : custom.levels.some((l) => l.name === last.name));
          if (exists) openLevel(last.kind, last.name);
          else showOpen();
        }
        updateTitle(); runChecks();
      });
      if (!backend) backend = await detectBackend();
      if (!backend) toast('Saving is off here: run the game with npm start to save levels');
    }
    function close() { active = false; el.classList.remove('active'); closeModal(); }

    return { open, close, isActive: () => active };
  }

  // Small icons shared by the palette and the map (drawn around 0,0 at a 40px tile scale)
  function iconPath(ctx, id) {
    ctx.lineJoin = 'round';
    switch (id) {
      case 'S':
        ctx.fillStyle = '#ffc93d'; ctx.beginPath(); ctx.arc(0, -6, 7, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#ff6b4a'; ctx.fillRect(-7, 0, 14, 14);
        ctx.fillStyle = '#8a92ad'; ctx.fillRect(-12, 1, 5, 11);
        break;
      case 'G':
        ctx.strokeStyle = '#dfe6ff'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(-8, 16); ctx.lineTo(-8, -16); ctx.stroke();
        ctx.fillStyle = '#3dff9a'; ctx.beginPath(); ctx.moveTo(-8, -16); ctx.lineTo(14, -9); ctx.lineTo(-8, -2); ctx.fill();
        break;
      case 'saw': case 'orbit': {
        ctx.fillStyle = '#c9cfdc'; ctx.strokeStyle = '#5b6275'; ctx.lineWidth = 2; ctx.beginPath();
        for (let i = 0; i < 16; i++) { const a = (i / 16) * Math.PI * 2, r = i % 2 ? 11 : 14; ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r); }
        ctx.closePath(); ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#ff4d6d'; ctx.beginPath(); ctx.arc(0, 0, 3.5, 0, Math.PI * 2); ctx.fill();
        if (id === 'orbit') { ctx.strokeStyle = '#ffe066'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(0, 0, 18, -0.6, 1.4); ctx.stroke(); }
        break;
      }
      case 'crusher':
        ctx.fillStyle = '#8a92ad'; ctx.strokeStyle = '#dfe6ff'; ctx.lineWidth = 2; ctx.fillRect(-16, -7, 32, 14); ctx.strokeRect(-16, -7, 32, 14);
        break;
      case 'drone':
        ctx.fillStyle = '#9b5de5'; ctx.beginPath();
        for (let i = 0; i < 16; i++) { const a = (i / 16) * Math.PI * 2, r = i % 2 ? 9 : 14; ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r); }
        ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#ff4d6d'; ctx.beginPath(); ctx.arc(0, 0, 4, 0, Math.PI * 2); ctx.fill();
        break;
      case 'coin':
        ctx.fillStyle = '#d99a1c'; ctx.beginPath(); ctx.ellipse(0, 0, 9, 10, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#ffd95e'; ctx.beginPath(); ctx.ellipse(0, 0, 6.5, 7.5, 0, 0, Math.PI * 2); ctx.fill();
        break;
      case 'fuel':
        ctx.fillStyle = '#1d3a52'; ctx.fillRect(-8, -12, 16, 24);
        ctx.fillStyle = '#7fdcff'; ctx.fillRect(-6, -6, 12, 16);
        ctx.fillStyle = '#9aa3b5'; ctx.fillRect(-4, -16, 8, 4);
        break;
      case 'gun':
        ctx.strokeStyle = '#d9a441'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(0, 0, 15, 0, Math.PI * 2); ctx.stroke();
        ctx.fillStyle = '#4a5163'; ctx.fillRect(-11, -6, 20, 6);
        ctx.fillStyle = '#2b2f3a'; ctx.fillRect(-9, 0, 7, 9);
        break;
      case 'shield':
        ctx.strokeStyle = '#ffd166'; ctx.lineWidth = 3; ctx.fillStyle = 'rgba(58,47,16,0.8)'; ctx.beginPath();
        for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; ctx.lineTo(Math.cos(a) * 13, Math.sin(a) * 13); }
        ctx.closePath(); ctx.fill(); ctx.stroke();
        break;
      case 'pusher':
        ctx.strokeStyle = '#7fdcff'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(0, 0, 12, 0, Math.PI * 2); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0, 6); ctx.lineTo(0, -16); ctx.moveTo(-6, -10); ctx.lineTo(0, -16); ctx.lineTo(6, -10); ctx.stroke();
        break;
      case 'sign':
        ctx.fillStyle = '#343b66'; ctx.strokeStyle = '#a9b4ff'; ctx.lineWidth = 2; ctx.fillRect(-14, -10, 28, 18); ctx.strokeRect(-14, -10, 28, 18);
        ctx.fillStyle = '#dfe6ff'; ctx.fillRect(-9, -5, 18, 2); ctx.fillRect(-9, 0, 12, 2);
        break;
      default: break;
    }
  }
  function drawIcon(ctx, id, size) {
    ctx.clearRect(0, 0, size, size);
    const tile = { '#': ['#262b47', '#6f7bd0'], '=': ['#1d5a45', '#3dff9a'], C: ['#1b4c66', '#7fdcff'], '.': ['#0b0e1a', '#3a4166'] }[id];
    if (tile) {
      ctx.fillStyle = tile[0]; ctx.fillRect(6, 6, size - 12, size - 12);
      ctx.fillStyle = tile[1];
      if (id === '#') { ctx.strokeStyle = tile[1]; ctx.lineWidth = 2; ctx.strokeRect(7, 7, size - 14, size - 14); }
      else if (id === '.') { ctx.strokeStyle = tile[1]; ctx.setLineDash([3, 3]); ctx.strokeRect(7, 7, size - 14, size - 14); }
      else ctx.fillRect(6, 6, size - 12, 5);
      return;
    }
    ctx.save(); ctx.translate(size / 2, size / 2); ctx.scale(size / 44, size / 44); iconPath(ctx, id); ctx.restore();
  }

  root.LevelEditor = { createEditor, detectBackend };
})(typeof self !== 'undefined' ? self : this);
