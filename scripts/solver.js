// Automatic level solver: searches for a sequence of thrusts that beats a level using the real
// game physics from src/core.js. Used to prove levels are beatable and to measure difficulty.
//
// The player makes a decision every DECISION seconds: wait, or thrust in one of N directions.
// Best-first search, guided by the walking distance to the goal through open tiles.
// It can miss solutions (states are bucketed), but a found solution is always a real one.
const Core = require('../src/core.js');

const { TILE } = Core;
const FRAME = 1 / 60;
const DECISION_FRAMES = 12;   // decide every 0.2 s
const DIRECTIONS = 16;
const ACTIONS = [null, ...Array.from({ length: DIRECTIONS }, (_, i) => {
  const a = (i / DIRECTIONS) * Math.PI * 2;
  return { x: Math.cos(a), y: Math.sin(a) };
})];

// Binary heap keyed on .f
class Heap {
  constructor() { this.a = []; }
  get size() { return this.a.length; }
  push(n) {
    const a = this.a; a.push(n);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p].f <= a[i].f) break;
      [a[p], a[i]] = [a[i], a[p]]; i = p;
    }
  }
  pop() {
    const a = this.a, top = a[0], last = a.pop();
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1;
        let m = i;
        if (l < a.length && a[l].f < a[m].f) m = l;
        if (r < a.length && a[r].f < a[m].f) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]]; i = m;
      }
    }
    return top;
  }
}

// Distance (px) from every open tile to the goal, moving through open tiles (8-way).
function distanceField(level) {
  const { cols, rows } = level;
  const dist = new Float64Array(cols * rows).fill(Infinity);
  const gc = Math.floor(level.goal.x / TILE), gr = Math.floor(level.goal.y / TILE);
  dist[gr * cols + gc] = 0;
  const queue = [[gc, gr]];
  const steps = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, 1.41], [1, -1, 1.41], [-1, 1, 1.41], [-1, -1, 1.41]];
  // Dijkstra-lite: small grids, so repeated relaxation with a simple queue is fine
  while (queue.length) {
    const [c, r] = queue.shift();
    const d0 = dist[r * cols + c];
    for (const [dc, dr, w] of steps) {
      const nc = c + dc, nr = r + dr;
      if (Core.isBlock(level, nc, nr)) continue;
      if (dc && dr && (Core.isBlock(level, c + dc, r) || Core.isBlock(level, c, r + dr))) continue;
      const nd = d0 + w * TILE;
      if (nd < dist[nr * cols + nc]) { dist[nr * cols + nc] = nd; queue.push([nc, nr]); }
    }
  }
  return (x, y) => {
    const c = Math.floor(x / TILE), r = Math.floor(y / TILE);
    if (c < 0 || r < 0 || c >= cols || r >= rows) return Infinity;
    const d = dist[r * cols + c];
    return d === Infinity ? Infinity : d + Math.hypot(x - ((c + 0.5) * TILE), y - ((r + 0.5) * TILE)) * 0.5;
  };
}

const clone = (p) => ({ ...p, heading: p.heading && { ...p.heading } });

// Simulates one decision from a node. Returns { p, clock, touching, outcome } or null if dead.
function simulate(world, node, action, cfg) {
  const p = clone(node.p);
  world.pushers.forEach((b, i) => { b.touching = !!(node.touching & (1 << i)); });
  let clock = node.clock;
  let thrusted = false;
  if (action) thrusted = Core.tryThrust(p, action, cfg) === 'thrust';
  if (action && !thrusted) return null; // useless action (no stamina / blocked): same as waiting
  for (let f = 0; f < DECISION_FRAMES; f++) {
    clock += FRAME;
    Core.updateMovers(world, clock);
    Core.updateStamina(p, FRAME, cfg);
    for (const e of Core.stepPlayer(world, p, FRAME, cfg)) {
      if (e.type === 'dead') return null;
      if (e.type === 'won') return { p, clock, touching: 0, won: true, thrusted };
    }
  }
  let touching = 0;
  world.pushers.forEach((b, i) => { if (b.touching) touching |= 1 << i; });
  return { p, clock, touching, won: false, thrusted };
}

function stateKey(s, timed) {
  const p = s.p;
  return [
    Math.round(p.x / 8), Math.round(p.y / 8),
    Math.round(p.vx / 45), Math.round(p.vy / 45),
    p.exhausted ? -1 : Math.floor(p.stamina / 12.5),
    p.grounded ? 1 : 0,
    s.touching,
    timed ? Math.floor(s.clock / 0.5) : 0,
  ].join(',');
}

// Returns { solved, thrusts, time, expansions, path: [{x,y}] , actions }
// margin: extra px added to the player's radius (and stand height), to test how forgiving a level is
function solve(def, { maxExpansions = 150000, margin = 0 } = {}) {
  const cfg = { ...Core.DEFAULT_TUNING, radius: Core.DEFAULT_TUNING.radius + margin,
    standOffset: Core.DEFAULT_TUNING.standOffset + margin };
  const world = Core.createWorld(def, cfg);
  const h = distanceField(world.level);
  const timed = world.movers.length > 0;
  const start = { p: Core.createPlayer(world.level, cfg), clock: 0, touching: 0, parent: null, action: null, thrusts: 0 };
  start.f = h(start.p.x, start.p.y);
  const open = new Heap();
  open.push(start);
  const seen = new Set([stateKey(start, timed)]);
  let expansions = 0;
  let closest = { d: start.f, x: start.p.x, y: start.p.y };

  while (open.size && expansions < maxExpansions) {
    const node = open.pop();
    expansions++;
    const nd = h(node.p.x, node.p.y);
    if (nd < closest.d) closest = { d: nd, x: node.p.x, y: node.p.y };
    for (const action of ACTIONS) {
      const s = simulate(world, node, action, cfg);
      if (!s) continue;
      const child = { ...s, parent: node, action, thrusts: node.thrusts + (s.thrusted ? 1 : 0) };
      if (s.won) return finish(child, expansions);
      const key = stateKey(child, timed);
      if (seen.has(key)) continue;
      seen.add(key);
      const d = h(child.p.x, child.p.y);
      if (d === Infinity) continue;
      // Mostly greedy toward the goal, lightly preferring fewer thrusts and less time
      child.f = d + child.thrusts * 15 + child.clock * 20;
      open.push(child);
    }
  }
  // Where the search got stuck (tile coordinates of the closest approach to the goal)
  return { solved: false, expansions,
    closest: { x: +(closest.x / TILE).toFixed(1), y: +(closest.y / TILE).toFixed(1), tilesFromGoal: +(closest.d / TILE).toFixed(1) } };
}

function finish(node, expansions) {
  const chain = [];
  for (let n = node; n; n = n.parent) chain.push(n);
  chain.reverse();
  return {
    solved: true,
    thrusts: node.thrusts,
    time: Math.round(node.clock * 10) / 10,
    expansions,
    path: chain.map((n) => ({ x: Math.round(n.p.x), y: Math.round(n.p.y) })),
    actions: chain.slice(1).map((n) => n.action),
  };
}

// Free space (px) between the player's circle and the nearest rock tile or hazard.
function clearance(world, p, R) {
  const { level } = world;
  let best = 3 * TILE;
  const c0 = Math.floor(p.x / TILE) - 3, r0 = Math.floor(p.y / TILE) - 3;
  for (let r = r0; r <= r0 + 6; r++) {
    for (let c = c0; c <= c0 + 6; c++) {
      if (!Core.isSolid(level, c, r)) continue;
      const nx = Math.max(c * TILE, Math.min(p.x, (c + 1) * TILE));
      const ny = Math.max(r * TILE, Math.min(p.y, (r + 1) * TILE));
      best = Math.min(best, Math.hypot(p.x - nx, p.y - ny) - R);
    }
  }
  for (const m of world.movers) {
    if (m.shape === 'block') {
      const nx = Math.max(m.x - m.w / 2, Math.min(p.x, m.x + m.w / 2));
      const ny = Math.max(m.y - m.h / 2, Math.min(p.y, m.y + m.h / 2));
      best = Math.min(best, Math.hypot(p.x - nx, p.y - ny) - R);
    } else {
      best = Math.min(best, Math.hypot(p.x - m.x, p.y - m.y) - m.r * 0.85 - R);
    }
  }
  return best;
}

// Replays a solution frame by frame and measures how precise it had to be.
//   minClearance: closest shave (px) with rock or a hazard while flying
//   closeCalls:   seconds spent within 16 px of something deadly
function measure(def, actions) {
  const world = Core.createWorld(def);
  const p = Core.createPlayer(world.level);
  const R = Core.DEFAULT_TUNING.radius;
  let clock = 0, minClearance = Infinity, close = 0;
  for (const action of actions) {
    if (action) Core.tryThrust(p, action);
    for (let f = 0; f < DECISION_FRAMES; f++) {
      clock += FRAME;
      Core.updateMovers(world, clock);
      Core.updateStamina(p, FRAME);
      const events = Core.stepPlayer(world, p, FRAME).map((e) => e.type);
      if (!p.grounded) {
        const cl = clearance(world, p, R);
        minClearance = Math.min(minClearance, cl);
        if (cl < 16) close += FRAME;
      }
      if (events.includes('won') || events.includes('dead')) {
        return { minClearance: Math.round(minClearance), closeCalls: Math.round(close * 10) / 10 };
      }
    }
  }
  return { minClearance: Math.round(minClearance), closeCalls: Math.round(close * 10) / 10 };
}

// Largest margin (px of extra player radius) the level can still be beaten with: a measure of how
// much precision it demands. 48 = wide open, 0 = needs a tight line.
function slack(def, margins = [48, 40, 32, 24, 16, 8]) {
  for (const m of margins) if (solve(def, { margin: m, maxExpansions: 60000 }).solved) return m;
  return 0;
}

module.exports = { solve, measure, slack };
