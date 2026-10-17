// Runs the solver on every level (or the ones given) and prints a difficulty table.
// Usage: npm run solve            -> all levels
//        npm run solve -- 3 7     -> levels 3 and 7
//        npm run solve -- --json  -> also write devlog/solver-report.json
//
// Columns:
//   thrusts   fewest-ish thrusts the solver needed (stamina pressure)
//   time      seconds of flying in its run
//   search    states explored before finding a route (how hard the route is to find)
//   slack     largest extra player radius (px) the level is still beatable with:
//             48 = wide open ... 0 = needs a tight line
//   close     seconds the solver's run spent within 16 px of something deadly
const fs = require('fs');
const path = require('path');
const LEVELS = require('../src/levels.js');
const { solve, measure, slack } = require('./solver');

const args = process.argv.slice(2);
const json = args.includes('--json');
const picked = args.filter((a) => /^\d+$/.test(a)).map(Number);
const indexes = picked.length ? picked.map((n) => n - 1) : LEVELS.map((_, i) => i);

const rows = [];
let failed = 0;
console.log(' #  Level               thrusts   time  search  slack  close');
for (const i of indexes) {
  const def = LEVELS[i];
  const t0 = Date.now();
  const r = solve(def);
  const m = r.solved ? { ...measure(def, r.actions), slack: slack(def) } : {};
  const ms = Date.now() - t0;
  if (!r.solved) failed++;
  rows.push({ n: i + 1, name: def.name, solved: r.solved, thrusts: r.thrusts, time: r.time,
    search: r.expansions, ...m, ms });
  const cols = r.solved
    ? `${String(r.thrusts).padStart(7)} ${String(r.time).padStart(6)} ${String(r.expansions).padStart(7)} ` +
      `${String(m.slack).padStart(6)} ${String(m.closeCalls).padStart(6)}`
    : `  NOT SOLVED (searched ${r.expansions} states; got closest at tile ${r.closest.x},${r.closest.y}, ` +
      `${r.closest.tilesFromGoal} tiles from the goal)`;
  console.log(`${String(i + 1).padStart(2)}  ${def.name.padEnd(18)} ${cols}   (${(ms / 1000).toFixed(1)}s)`);
}

if (json) {
  const out = path.join(__dirname, '..', 'devlog', 'solver-report.json');
  fs.writeFileSync(out, JSON.stringify(rows, null, 2));
  console.log(`\nWrote ${path.relative(process.cwd(), out)}`);
}
if (failed) {
  console.error(`\n${failed} level(s) could not be solved`);
  process.exit(1);
}
