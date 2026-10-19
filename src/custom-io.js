// Reading and writing src/levels-custom.js, the file the level editor saves to. Shared by the
// dev server (scripts/dev-server.js), the desktop build's editor (writes the file directly) and tests.
//
// The file holds { overrides: { [built-in level name]: def }, levels: [def, ...] }:
//   overrides  edited copies of built-in levels (replace the original by name)
//   levels     brand-new levels made in the editor (listed under "Custom" in level select)
// A def is the same shape as in src/levels.js (map rows + object lists, tile units). Saved defs carry
// `editor: true` (their coins are exactly what the editor placed) and `draft: true` while they still
// have errors (drafts stay in the editor and never reach the game).
(function (root) {
  const LISTS = ['pushers', 'movers', 'signs', 'enemies', 'shields', 'coins', 'fuels', 'guns'];
  const MAX_SIDE = 400;

  // Returns a description of the first problem, or null when the data is safe to save and load.
  function checkDef(def, where) {
    if (!def || typeof def !== 'object' || Array.isArray(def)) return `${where}: not an object`;
    if (typeof def.name !== 'string' || !def.name.trim() || def.name.length > 60) return `${where}: bad name`;
    if (!Array.isArray(def.map) || def.map.length < 3 || def.map.length > MAX_SIDE) return `${where}: bad map`;
    const w = def.map[0] && def.map[0].length;
    if (!(w >= 3 && w <= MAX_SIDE)) return `${where}: bad map width`;
    for (const row of def.map) {
      if (typeof row !== 'string' || row.length !== w || !/^[#=CSG.]+$/.test(row)) return `${where}: bad map row`;
    }
    for (const key of LISTS) {
      if (def[key] == null) continue;
      if (!Array.isArray(def[key]) || def[key].length > 2000) return `${where}: bad ${key}`;
      for (const item of def[key]) {
        if (!item || typeof item !== 'object') return `${where}: bad ${key} entry`;
        if (!Number.isFinite(item.x) && !(item.path || item.orbit)) return `${where}: ${key} entry without a position`;
      }
    }
    return null;
  }

  function checkCustomData(data) {
    if (!data || typeof data !== 'object') return 'Not an object';
    if (!data.overrides || typeof data.overrides !== 'object' || Array.isArray(data.overrides)) return 'Missing overrides';
    if (!Array.isArray(data.levels)) return 'Missing levels';
    for (const [name, def] of Object.entries(data.overrides)) {
      const p = checkDef(def, `override "${name}"`);
      if (p) return p;
      if (def.name !== name) return `override "${name}" has a different name inside`;
    }
    const names = new Set();
    for (const def of data.levels) {
      const p = checkDef(def, `level "${def && def.name}"`);
      if (p) return p;
      if (names.has(def.name)) return `two custom levels are called "${def.name}"`;
      names.add(def.name);
    }
    return null;
  }

  function renderCustomFile(data) {
    const json = JSON.stringify({ overrides: data.overrides, levels: data.levels }, null, 2);
    return `// Written by the level editor (npm start, then open #/editor). Edits by hand are fine, but the
// editor rewrites this whole file when it saves. See src/custom-io.js for the format.
(function (root) {
  const CUSTOM_LEVELS = ${json.replace(/\n/g, '\n  ')};
  if (typeof module === 'object' && module.exports) module.exports = CUSTOM_LEVELS;
  else root.CUSTOM_LEVELS = CUSTOM_LEVELS;
})(typeof self !== 'undefined' ? self : this);
`;
  }

  const api = { checkCustomData, checkDef, renderCustomFile, LISTS };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CustomIO = api;
})(typeof self !== 'undefined' ? self : this);
