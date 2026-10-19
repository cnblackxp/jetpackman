// Plays a level the way a person with a mouse would, many times, and reports how often each
// crossing succeeds. Uses the real rules from src/core.js.
//
// The "person": stands on a pad, watches the hazards ahead with a reaction delay, goes when they
// look clear, and performs a simple hop: a few thrusts whose aim is off by up to ±AIM_ERR degrees
// and whose timing is off by up to ±TIME_ERR seconds. No frame-perfect inputs.
//
// Usage: node scripts/human-playtest.js <level name> [runs]
const Core = require('../src/core.js');
const LEVELS = require('../src/levels.js');

const AIM_ERR = 10;      // degrees
const TIME_ERR = 0.1;    // seconds
const REACTION = 0.25;   // seconds between "it's clear" and the first click
const FRAME = 1 / 60;
const { TILE } = Core;

// Routes: per level, a list of hops. Each hop: the lane of hazards to watch (x in tiles, the height
// band you'll fly through) and the target: the middle of the pad to land on (tile x, pad row).
// The person launches up-right, then steers mid-flight like a player watching where they're going:
// every 0.3-0.4 s they guess where they'll land (±1 tile off) and nudge forward or brake.
// A hop succeeds when you land on any pad further right (or win).
const ROUTES = {
  Sawmill: [
    { watch: { x: 9, y: 7.5 }, target: { x: 14, row: 10 }, ceiling: 4 },
    { watch: { x: 19, y: 7 }, target: { x: 24, row: 10 }, ceiling: 4 },
    { watch: { x: 29, y: 7 }, target: { x: 34, row: 10 }, ceiling: 4 },
    { watch: { x: 39, y: 7 }, target: { x: 46, row: 9 }, ceiling: 4 },
  ],
};

// Rough guess of where a ballistic flight lands at the given row (what a player eyeballs)
function guessLanding(p, row) {
  let x = p.x, y = p.y, vx = p.vx, vy = p.vy;
  for (let i = 0; i < 300 && !(vy > 0 && y >= row * TILE - 22); i++) {
    vy = Math.min(vy + 520 / 60, 420); vx *= 1 - 0.35 / 60; vy *= 1 - 0.35 / 60;
    x += vx / 60; y += vy / 60;
  }
  return x / TILE;
}

let seed = 1;
const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const jitter = (k) => (rand() * 2 - 1) * k;

function playOnce(def, route) {
  const world = Core.createWorld(def);
  const p = Core.createPlayer(world.level);
  const history = []; // hazard positions over time, so the player can react to old information
  const step = () => {
    Core.updateMovers(world, world.clock + FRAME);
    Core.updateStamina(p, FRAME);
    history.push(world.movers.map((m) => ({ x: m.x / TILE, y: m.y / TILE })));
    if (history.length > 120) history.shift();
    return Core.stepPlayer(world, p, FRAME);
  };
  const results = [];
  const deathSpots = [];
  results.deathSpots = deathSpots;
  for (const hop of route) {
    const startX = p.x;
    // wait on the pad until the lane looks clear (as seen REACTION seconds ago), up to 12 s
    let waited = 0;
    for (;;) {
      step(); waited += FRAME;
      // what you saw REACTION s ago, and a moment before that (to tell which way things move)
      const seen = history[Math.max(0, history.length - 1 - Math.round(REACTION / FRAME))];
      const before = history[Math.max(0, history.length - 1 - Math.round((REACTION + 0.1) / FRAME))];
      const clear = seen.every((m, k) => {
        if (Math.abs(m.x - hop.watch.x) >= 1.5) return true;          // not in this lane
        const dist = Math.abs(m.y - hop.watch.y);
        const movingAway = dist > Math.abs(before[k].y - hop.watch.y);
        return dist > 1.5 && movingAway;                               // just passed, heading away
      });
      if (clear || waited > 12) break;
    }
    // launch up-right, then steer with human error
    let outcome = null;
    const thrust = (deg) => {
      const a = ((deg + jitter(AIM_ERR)) * Math.PI) / 180;
      Core.tryThrust(p, { x: Math.cos(a), y: Math.sin(a) });
    };
    thrust(-55);
    let nextLook = 0.3 + jitter(TIME_ERR);
    for (let t = 0; t < 5 && !outcome; t += FRAME) {
      outcome = check(step());
      if (!outcome && p.grounded && p.x > startX + TILE * 3) outcome = 'landed';
      if (outcome || p.grounded || t < nextLook) continue;
      nextLook = t + 0.35 + jitter(TIME_ERR);
      const miss = guessLanding(p, hop.target.row) + jitter(1) - hop.target.x;
      // a player sees the ceiling: correct flatter when it's close
      const roomAbove = p.y / TILE - (hop.ceiling || 0) > 3;
      if (miss < -1.2) thrust(roomAbove ? -30 : -5);          // landing short: push on
      else if (miss > 1.2) thrust(roomAbove ? -150 : -175);   // going too far: brake
    }
    results.push(outcome || 'stuck');
    if (outcome !== 'landed') break;
  }
  return results;

  function check(events) {
    for (const e of events) {
      if (e.type === 'dead') { deathSpots.push(`${(p.x / TILE).toFixed(0)},${(p.y / TILE).toFixed(0)}`); return `died (${e.cause})`; }
      if (e.type === 'won') return 'won';
    }
    return null;
  }
}

const name = process.argv[2] || 'Sawmill';
const runs = Number(process.argv[3]) || 200;
const def = LEVELS.find((l) => l.name === name);
const route = ROUTES[name];
if (!def || !route) { console.error(`No level/route for "${name}". Routes: ${Object.keys(ROUTES).join(', ')}`); process.exit(1); }

const perHop = route.map(() => ({ tries: 0, ok: 0, fails: {}, spots: {} }));
let wins = 0;
for (let i = 0; i < runs; i++) {
  const res = playOnce(def, route);
  res.forEach((r, h) => {
    perHop[h].tries++;
    if (r === 'landed' || r === 'won') perHop[h].ok++;
    else {
      perHop[h].fails[r] = (perHop[h].fails[r] || 0) + 1;
      const spot = res.deathSpots[0];
      if (spot) perHop[h].spots[spot] = (perHop[h].spots[spot] || 0) + 1;
    }
  });
  if (res[res.length - 1] === 'won') wins++;
}
console.log(`${name}: ${runs} human-like runs (aim ±${AIM_ERR}°, timing ±${TIME_ERR}s, reaction ${REACTION}s)`);
perHop.forEach((h, i) => {
  const pct = h.tries ? Math.round((h.ok / h.tries) * 100) : 0;
  const fails = Object.entries(h.fails).map(([k, v]) => `${k} ×${v}`).join(', ');
  console.log(`  hop ${i + 1}: ${pct}% of ${h.tries}${fails ? `   fails: ${fails}` : ''}`);
  const spots = Object.entries(h.spots).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, v]) => `tile ${k} ×${v}`).join(', ');
  if (spots) console.log(`          deaths at: ${spots}`);
});
console.log(`  whole level in one go: ${Math.round((wins / runs) * 100)}%`);
