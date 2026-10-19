const test = require('node:test');
const assert = require('node:assert/strict');
const Core = require('../src/core.js');

const { TILE, DEFAULT_TUNING: CFG } = Core;

// 12x8 test room: start pad bottom-left, goal right, a floating pad in the middle.
const ROOM = {
  name: 'Room',
  map: [
    '############',
    '#..........#',
    '#..........#',
    '#....===...#',
    '#.......G..#',
    '#.S........#',
    '#===.......#',
    '############',
  ],
};

function setup(def = ROOM) {
  const world = Core.createWorld(def);
  const p = Core.createPlayer(world.level);
  return { world, p };
}

// Run the simulation for `seconds`, collecting events, stopping on death or win.
function run(world, p, seconds, dt = 1 / 60) {
  const events = [];
  for (let t = 0; t < seconds; t += dt) {
    Core.updateMovers(world, world.clock + dt);
    Core.updateStamina(p, dt);
    for (const e of Core.stepPlayer(world, p, dt)) {
      events.push(e.type);
      if (e.type === 'dead' || e.type === 'won') return events;
    }
  }
  return events;
}

// Puts the player in mid-air at tile coordinates.
function airborne(p, cx, cy, vx = 0, vy = 0) {
  Object.assign(p, { x: cx * TILE, y: cy * TILE, vx, vy, launched: true, grounded: false });
}

test('parseLevel finds start, goal and pads, and pads short rows with rock', () => {
  const level = Core.parseLevel({ name: 'x', map: ['#####', '#S.G', '#===#', '#####'] });
  assert.equal(level.cols, 5);
  assert.equal(level.map[1], '#S.G#');
  assert.deepEqual([level.start.col, level.start.row], [1, 1]);
  assert.equal(level.start.y, 2 * TILE - CFG.standOffset);
  assert.deepEqual(level.goal, { x: 3.5 * TILE, y: 1.5 * TILE });
  assert.ok(Core.isPad(level, 1, 2));
  assert.ok(Core.isSolid(level, 0, 0));
  assert.ok(Core.isSolid(level, -1, 0), 'outside the map counts as rock');
  assert.ok(!Core.isPad(level, -1, 0));
});

test('parseLevel rejects maps without a start or goal, or with two starts', () => {
  assert.throws(() => Core.parseLevel({ name: 'a', map: ['#G#'] }), /no start/);
  assert.throws(() => Core.parseLevel({ name: 'b', map: ['#S#'] }), /no goal/);
  assert.throws(() => Core.parseLevel({ name: 'c', map: ['SSG'] }), /more than one start/);
  assert.throws(() => Core.parseLevel({ name: 'd', map: [] }), /no map/);
});

test('player starts standing on the start pad and does not fall before thrusting', () => {
  const { world, p } = setup();
  assert.equal(p.grounded, true);
  const y0 = p.y;
  assert.deepEqual(run(world, p, 2), []);
  assert.equal(p.y, y0);
});

test('thrustDirection: left click pushes away from the mouse, right click toward it', () => {
  const p = { x: 100, y: 100 };
  assert.deepEqual(Core.thrustDirection(p, 100, 200, false), { x: 0, y: -1 }); // mouse below: go up
  assert.deepEqual(Core.thrustDirection(p, 100, 200, true), { x: -0, y: 1 });  // toward: go down
  const d = Core.thrustDirection(p, 0, 0, false);
  assert.ok(Math.abs(Math.hypot(d.x, d.y) - 1) < 1e-9);
  assert.equal(Core.thrustDirection(p, 100.5, 100, false), null, 'mouse on the player: no direction');
});

test('a thrust adds velocity, launches the player and costs a quarter of the bar', () => {
  const { p } = setup();
  assert.equal(Core.tryThrust(p, { x: 0, y: -1 }), 'thrust');
  assert.equal(p.vy, -CFG.thrust);
  assert.equal(p.stamina, CFG.staminaMax - CFG.thrustCost);
  assert.equal(p.launched, true);
  assert.equal(p.grounded, false);
});

test('four thrusts empty the bar; the fifth fails until it is completely refilled', () => {
  const { p } = setup();
  for (let i = 0; i < 4; i++) {
    p.cooldown = 0;
    assert.equal(Core.tryThrust(p, { x: 0, y: -1 }), 'thrust', `thrust ${i + 1}`);
  }
  assert.equal(p.stamina, 0);
  assert.equal(p.exhausted, true);
  p.cooldown = 0;
  assert.equal(Core.tryThrust(p, { x: 0, y: -1 }), 'empty');

  // Half full is still locked while exhausted
  p.grounded = false;
  Core.updateStamina(p, (CFG.staminaMax / 2) / CFG.staminaRegen + CFG.regenDelay);
  p.cooldown = 0;
  assert.ok(p.stamina >= CFG.thrustCost);
  assert.equal(Core.tryThrust(p, { x: 0, y: -1 }), 'empty');

  let refilled = null;
  for (let i = 0; i < 600 && !refilled; i++) refilled = Core.updateStamina(p, 1 / 60);
  assert.equal(refilled, 'refilled');
  assert.equal(p.stamina, CFG.staminaMax);
  p.cooldown = 0;
  assert.equal(Core.tryThrust(p, { x: 0, y: -1 }), 'thrust');
});

test('less than one thrust of stamina still thrusts, then drains to 0 and locks', () => {
  const { p } = setup();
  p.stamina = 30;
  assert.equal(Core.tryThrust(p, { x: 0, y: -1 }), 'thrust');
  assert.equal(p.exhausted, false, '5 left: not locked yet');
  p.cooldown = 0;
  assert.equal(Core.tryThrust(p, { x: 0, y: -1 }), 'thrust', 'any stamina above 0 allows a thrust');
  assert.equal(p.stamina, 0, 'still costs a full thrust');
  assert.equal(p.exhausted, true);
  p.cooldown = 0;
  assert.equal(Core.tryThrust(p, { x: 0, y: -1 }), 'empty');
});

test('thrust cooldown blocks rapid double clicks', () => {
  const { p } = setup();
  assert.equal(Core.tryThrust(p, { x: 0, y: -1 }), 'thrust');
  assert.equal(Core.tryThrust(p, { x: 0, y: -1 }), 'cooldown');
  Core.updateStamina(p, CFG.clickCooldown);
  assert.equal(Core.tryThrust(p, { x: 0, y: -1 }), 'thrust');
});

test('thrusting down into the pad you stand on is ignored and free', () => {
  const { p } = setup();
  assert.equal(Core.tryThrust(p, { x: 0, y: 1 }), 'blocked');
  assert.equal(p.stamina, CFG.staminaMax);
  assert.equal(p.grounded, true);
});

test('stamina waits for the regen delay, and refills faster while locked out', () => {
  const { p } = setup();
  p.grounded = false;
  Core.tryThrust(p, { x: 0, y: -1 });
  Core.updateStamina(p, CFG.regenDelay / 2);
  assert.equal(p.stamina, 75, 'no refill during the delay');

  const normal = { ...p, stamina: 10, regenDelay: 0, exhausted: false };
  const locked = { ...p, stamina: 10, regenDelay: 0, exhausted: true };
  Core.updateStamina(normal, 0.5);
  Core.updateStamina(locked, 0.5);
  assert.ok(Math.abs(normal.stamina - (10 + CFG.staminaRegen * 0.5)) < 1e-9);
  assert.ok(Math.abs(locked.stamina - (10 + CFG.staminaRegen * CFG.exhaustedRegenMultiplier * 0.5)) < 1e-9);
});

test('a thrust mostly cancels velocity that opposes it', () => {
  const { p } = setup();
  p.grounded = false;
  p.vy = CFG.maxFall; // falling fast
  Core.tryThrust(p, { x: 0, y: -1 });
  assert.ok(Math.abs(p.vy - (CFG.maxFall * CFG.opposingKeep - CFG.thrust)) < 1e-9);
  assert.ok(p.vy < 0, 'one thrust turns a full-speed fall into a climb');
});

test('speed is capped at maxSpeed', () => {
  const { p } = setup();
  p.grounded = false;
  p.vx = CFG.maxSpeed;
  Core.tryThrust(p, { x: 1, y: 0 });
  assert.ok(Math.hypot(p.vx, p.vy) <= CFG.maxSpeed + 1e-9);
});

test('gravity pulls an airborne player down, capped at maxFall', () => {
  const { world, p } = setup();
  airborne(p, 6, 1.5);
  Core.stepPlayer(world, p, 0.1);
  assert.ok(p.vy > 0 && p.y > 1.5 * TILE);
  p.vy = CFG.maxFall * 3;
  Core.stepPlayer(world, p, 1 / 60);
  assert.ok(p.vy <= CFG.maxFall);
});

test('touching rock kills', () => {
  const { world, p } = setup();
  airborne(p, 10, 5, 0, 200); // above the rock floor, falling
  assert.deepEqual(run(world, p, 2), ['dead']);
});

test('falling onto a pad lands safely and stands on it', () => {
  const { world, p } = setup();
  airborne(p, 6, 1.6, 0, 50);
  const events = run(world, p, 1);
  assert.deepEqual(events, ['landed']);
  assert.equal(p.grounded, true);
  assert.equal(p.heading, null);
  assert.equal(p.y, 3 * TILE - CFG.standOffset);
  assert.equal(p.vx, 0);
  assert.equal(p.vy, 0);
});

test('landing on a pad refills stamina completely and ends a lockout', () => {
  const { world, p } = setup();
  airborne(p, 6, 1.6, 0, 50);
  Object.assign(p, { stamina: 0, exhausted: true, regenDelay: 1 });
  const landed = [];
  for (let i = 0; i < 60 && !p.grounded; i++) landed.push(...Core.stepPlayer(world, p, 1 / 60));
  assert.deepEqual(landed, [{ type: 'landed', refilled: true, checkpoint: null }]);
  assert.equal(p.stamina, CFG.staminaMax);
  assert.equal(p.exhausted, false);

  const q = { ...p, stamina: CFG.staminaMax, exhausted: false };
  assert.equal(Core.refillOnLanding(q), false, 'already full: nothing to refill');
});

test('heading follows the last thrust and clears once its push is used up', () => {
  const { world, p } = setup();
  assert.equal(p.heading, null);
  Core.tryThrust(p, { x: 0, y: -1 }); // straight up from the start pad
  assert.deepEqual(p.heading, { x: 0, y: -1 });
  let steps = 0;
  while (p.heading && steps++ < 600) Core.stepPlayer(world, p, 1 / 60);
  assert.equal(p.heading, null, 'cleared at the top of the hop');
  assert.ok(Math.abs(p.vy) < 20, 'which is where vertical speed reaches ~0');
  assert.ok(!p.grounded);
});

test('pushers set the heading to their direction', () => {
  const def = { ...ROOM, pushers: [{ x: 6, y: 2, angle: 0, power: 500 }] };
  const { world, p } = setup(def);
  airborne(p, 6, 2);
  Core.checkPushers(world.pushers, p);
  assert.deepEqual(p.heading, { x: 1, y: 0 });
});

test('checkpoint pads are safe pads that report a respawn point when landed on', () => {
  const def = { name: 'CP', map: [
    '##########',
    '#........#',
    '#....CCC.#',
    '#.S......#',
    '#===...G.#',
    '##########',
  ] };
  const level = Core.parseLevel(def);
  assert.deepEqual(level.checkpoints, [{ x: 6.5 * TILE, y: 2 * TILE, col: 5, row: 2, width: 3 }]);
  assert.ok(Core.isPad(level, 6, 2) && Core.isCheckpoint(level, 6, 2) && !Core.isCheckpoint(level, 1, 4));

  const world = Core.createWorld(def);
  const p = Core.createPlayer(world.level);
  airborne(p, 6.5, 1.5, 0, 50);
  const events = [];
  for (let i = 0; i < 60 && !p.grounded; i++) events.push(...Core.stepPlayer(world, p, 1 / 60));
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'landed');
  assert.deepEqual(events[0].checkpoint, { x: p.x, y: 2 * TILE - CFG.standOffset });

  const respawned = Core.createPlayer(world.level, CFG, events[0].checkpoint);
  assert.equal(respawned.x, p.x);
  assert.equal(respawned.launched, true, 'respawning keeps the run going');
  assert.equal(respawned.grounded, true);
});

test('landing on a normal pad reports no checkpoint', () => {
  const { world, p } = setup();
  airborne(p, 6, 1.6, 0, 50);
  const events = run(world, p, 1);
  assert.deepEqual(events, ['landed']);
  assert.equal(p.landedOn.checkpoint, false);
});

test('hovering settles into a slow sink and drains stamina very slowly', () => {
  const { world, p } = setup();
  airborne(p, 10, 2.5, -200, -100); // clear air: nothing to land on or hit
  Object.assign(p, { hovering: true, stamina: 40, regenDelay: 0 });
  for (let i = 0; i < 60; i++) {
    Core.updateStamina(p, 1 / 60);
    Core.stepPlayer(world, p, 1 / 60);
  }
  assert.ok(Math.abs(p.vx) < 2, 'sideways motion dies out');
  assert.ok(Math.abs(p.vy - CFG.hoverSinkSpeed) < 3, 'drifts down at the sink speed');
  assert.ok(CFG.hoverSinkSpeed < CFG.maxFall / 10, 'much slower than falling');
  assert.ok(Math.abs(p.stamina - (40 - CFG.hoverDrain)) < 1e-6, 'drains hoverDrain per second, no refill');

  // Keeps working with an empty bar (which triggers the usual lockout)
  Object.assign(p, { stamina: 0.5 });
  Core.updateStamina(p, 1);
  assert.equal(p.stamina, 0);
  assert.equal(p.exhausted, true);
  const y0 = p.y;
  Core.stepPlayer(world, p, 0.5);
  assert.ok(p.y > y0 && p.y - y0 < CFG.hoverSinkSpeed * 0.5 + 1, 'still hovering at 0 stamina');

  p.hovering = false;
  p.exhausted = false;
  Core.updateStamina(p, 0.5);
  assert.ok(p.stamina > 0, 'refills again once hovering stops');
  Core.stepPlayer(world, p, 0.2);
  assert.ok(p.vy > CFG.hoverSinkSpeed * 2, 'normal gravity is back');
});

test('hitting the side or underside of a pad blocks instead of killing', () => {
  const { world, p } = setup();
  airborne(p, 4.6, 3.5, 300, 0); // flying right into the pad's left side
  Core.stepPlayer(world, p, 1 / 30);
  assert.ok(p.x <= 5 * TILE - CFG.radius + 1e-6, 'pushed out of the pad');
  assert.ok(p.vx <= 0 + 1e-9, 'velocity into the pad removed');

  const { world: w2, p: q } = setup();
  airborne(q, 6, 4.5, 0, -300); // rising into the pad from below
  const ev = Core.stepPlayer(w2, q, 1 / 30).map((e) => e.type);
  assert.ok(!ev.includes('dead'));
  assert.ok(q.vy >= 0 - 1e-9);
});

test('reaching the goal wins', () => {
  const { world, p } = setup();
  const g = world.level.goal;
  airborne(p, g.x / TILE - 0.5, g.y / TILE, 0, 0);
  p.x = g.x - CFG.goalRadius + 2;
  assert.deepEqual(run(world, p, 0.1), ['won']);
});

test('pushers fling the player once per touch, in their direction', () => {
  const def = { ...ROOM, pushers: [{ x: 6, y: 2, angle: -45, power: 500 }] };
  const { world, p } = setup(def);
  airborne(p, 6, 2);
  const b = Core.checkPushers(world.pushers, p);
  assert.ok(b);
  assert.ok(Math.abs(p.vx - 500 * Math.SQRT1_2) < 1e-6);
  assert.ok(Math.abs(p.vy + 500 * Math.SQRT1_2) < 1e-6);
  p.vx = 0; p.vy = 0;
  assert.equal(Core.checkPushers(world.pushers, p), null, 'still inside: no second fling');
  p.x = 1.5 * TILE;
  Core.checkPushers(world.pushers, p); // leave
  p.x = 6 * TILE;
  assert.ok(Core.checkPushers(world.pushers, p), 're-entering fires again');
});

test('path movers ping-pong and orbit movers circle', () => {
  const path = { path: [{ x: 0, y: 0 }, { x: 4 * TILE, y: 0 }], speed: 2, phase: 0 };
  assert.deepEqual(Core.moverPosition(path, 0), { x: 0, y: 0 });
  assert.deepEqual(Core.moverPosition(path, 1), { x: 2 * TILE, y: 0 });
  assert.deepEqual(Core.moverPosition(path, 2), { x: 4 * TILE, y: 0 });
  assert.deepEqual(Core.moverPosition(path, 3), { x: 2 * TILE, y: 0 }, 'comes back');
  assert.deepEqual(Core.moverPosition(path, 4), { x: 0, y: 0 });

  const multi = { path: [{ x: 0, y: 0 }, { x: TILE, y: 0 }, { x: TILE, y: TILE }], speed: 1, phase: 0 };
  const pos = Core.moverPosition(multi, 1.5);
  assert.ok(Math.abs(pos.x - TILE) < 1e-9 && Math.abs(pos.y - TILE / 2) < 1e-9, 'follows the second segment');

  const orbit = { orbit: { x: 100, y: 100, radius: 50 }, speed: 90, phase: 0 };
  const q = Core.moverPosition(orbit, 1);
  assert.ok(Math.abs(q.x - 100) < 1e-9 && Math.abs(q.y - 150) < 1e-9);
});

test('saws and blocks kill on contact', () => {
  const saw = [{ shape: 'saw', r: 20, x: 100, y: 100 }]; // kill distance: 0.85 * 20 + 13 = 30
  assert.ok(Core.hitsMover(saw, 100 + 29, 100, 13));
  assert.ok(!Core.hitsMover(saw, 100 + 31, 100, 13), 'outer teeth are forgiving');
  const block = [{ shape: 'block', w: 40, h: 80, x: 100, y: 100 }];
  assert.ok(Core.hitsMover(block, 100 + 20 + 12, 100, 13));
  assert.ok(!Core.hitsMover(block, 100 + 20 + 14, 100, 13));

  const def = { ...ROOM, movers: [{ shape: 'saw', r: 0.6, path: [[2.5, 2], [2.5, 2]] }] };
  const { world, p } = setup(def);
  airborne(p, 2.5, 2.2);
  assert.deepEqual(run(world, p, 0.1), ['dead']);
});

test('a standing player is still killed by a mover passing through', () => {
  const def = { ...ROOM, movers: [{ shape: 'saw', r: 0.6, path: [[2.5, 5.5], [2.5, 5.5]] }] };
  const { world, p } = setup(def);
  assert.equal(p.grounded, true);
  assert.deepEqual(run(world, p, 0.1), ['dead']);
});

test('parseRoute maps hashes to screens and redirects bad ones', () => {
  assert.deepEqual(Core.parseRoute('#/menu', 5), { screen: 'menu' });
  assert.deepEqual(Core.parseRoute('#/levels', 5), { screen: 'levels' });
  assert.deepEqual(Core.parseRoute('#/options', 5), { screen: 'options' });
  assert.deepEqual(Core.parseRoute('#/level/3', 5), { screen: 'game', level: 2 });
  assert.deepEqual(Core.parseRoute('#/level/0', 5), { screen: 'levels', redirect: '#/levels' });
  assert.deepEqual(Core.parseRoute('#/level/9', 5), { screen: 'levels', redirect: '#/levels' });
  assert.deepEqual(Core.parseRoute('#/level/2.5', 5), { screen: 'levels', redirect: '#/levels' });
  assert.deepEqual(Core.parseRoute('', 5), { screen: 'menu', redirect: '#/menu' });
  assert.deepEqual(Core.parseRoute('#/nope', 5), { screen: 'menu', redirect: '#/menu' });
  assert.equal(Core.levelHash(0), '#/level/1');
});

test('progress: next level, first unbeaten level and best times', () => {
  const levels = [{ name: 'a' }, { name: 'b' }, { name: 'c' }, { name: 'p', practice: true }];
  assert.equal(Core.nextLevelAfter(levels, 0), 1);
  assert.equal(Core.nextLevelAfter(levels, 2), null, 'practice level is not next in the run');
  assert.equal(Core.nextLevelAfter(levels, 3), null);

  assert.equal(Core.firstUnbeaten(levels, {}), 0);
  assert.equal(Core.firstUnbeaten(levels, { a: 5, b: 6 }), 2);
  assert.equal(Core.firstUnbeaten(levels, { a: 5, b: 6, c: 7 }), null, 'practice levels are ignored');
  assert.equal(Core.firstUnbeaten([{ name: 'new' }, ...levels], { a: 5 }), 0, 'keyed by name, not index');

  let best = Core.recordBest({}, 'b', 12.345);
  assert.deepEqual(best, { b: 12.35 });
  best = Core.recordBest(best, 'b', 20);
  assert.equal(best.b, 12.35, 'slower time does not replace the best');
  best = Core.recordBest(best, 'b', 9.5);
  assert.equal(best.b, 9.5);
});

test('sanitizeSettings fills defaults and rejects bad values', () => {
  assert.deepEqual(Core.sanitizeSettings(null), Core.DEFAULT_SETTINGS);
  assert.deepEqual(Core.sanitizeSettings('junk'), Core.DEFAULT_SETTINGS);
  const s = Core.sanitizeSettings({
    volume: 3, muted: true, screenShake: 'no', aimLine: true, headingMarker: false, startFullscreen: 1, extra: 1,
  });
  assert.deepEqual(s, {
    volume: 1, muted: true, screenShake: true, aimLine: true, headingMarker: false, startFullscreen: false,
    playerSkin: 'classic', bloodEffects: true, laserSight: true,
  });
  assert.equal(Core.sanitizeSettings({ playerSkin: 'pixel' }).playerSkin, 'pixel');
  assert.equal(Core.sanitizeSettings({ playerSkin: 'robot' }).playerSkin, 'classic', 'unknown skins fall back');
  assert.equal(Core.sanitizeSettings({ volume: -1 }).volume, 0);
  assert.equal(Core.sanitizeSettings({ volume: NaN }).volume, Core.DEFAULT_SETTINGS.volume);
});

// ---------- Drones and the shield ----------

// Open 20x10 room: start bottom-left, goal far right.
const ARENA = {
  name: 'Arena',
  map: [
    '####################',
    '#..................#',
    '#..................#',
    '#..................#',
    '#..................#',
    '#..................#',
    '#..................#',
    '#.S..............G.#',
    '#===...............#',
    '####################',
  ],
};

function arena(extra) {
  const world = Core.createWorld({ ...ARENA, ...extra });
  const p = Core.createPlayer(world.level);
  return { world, p };
}

// Steps drones + player together for `seconds`, collecting event types.
function runAll(world, p, seconds, dt = 1 / 60) {
  const events = [];
  for (let t = 0; t < seconds; t += dt) {
    events.push(...Core.updateEnemies(world, p, dt).map((e) => e.type));
    for (const e of Core.stepPlayer(world, p, dt)) {
      events.push(e.type);
      if (e.type === 'dead' || e.type === 'won') return events;
    }
  }
  return events;
}

test('a drone stays idle until the player is in range and in sight', () => {
  const { world, p } = arena({ enemies: [{ x: 15, y: 3 }] });
  const e = world.enemies[0];
  Core.updateEnemies(world, p, 0.1);
  assert.equal(e.state, 'idle', 'player is ~13 tiles away');

  const walled = Core.createWorld({ ...ARENA, map: ARENA.map.map((r, i) => (i >= 1 && i <= 8 ? r.slice(0, 10) + '#' + r.slice(11) : r)),
    enemies: [{ x: 13, y: 7.5 }] });
  const q = Core.createPlayer(walled.level);
  q.x = 8.5 * TILE;
  Core.updateEnemies(walled, q, 0.1);
  assert.equal(walled.enemies[0].state, 'idle', 'in range but behind a wall');
});

test('a drone winds up, dashes toward you for its dash distance, then recharges and repeats', () => {
  const { world } = arena({ enemies: [{ x: 10, y: 4, dash: 3 }] });
  const e = world.enemies[0];
  const target = { x: 4 * TILE, y: 4 * TILE }; // straight to the left, 6 tiles away... in range (6) after a nudge
  target.x = 5 * TILE;
  const types = [];
  for (let t = 0; t < CFG.enemyWindup + 0.05; t += 1 / 60) types.push(...Core.updateEnemies(world, target, 1 / 60).map((x) => x.type));
  assert.deepEqual(types, ['enemyWindup', 'enemyDash']);
  assert.ok(e.dir.x < -0.99, 'aimed at the player');
  for (let t = 0; t < 2; t += 1 / 60) Core.updateEnemies(world, null, 1 / 60);
  assert.equal(e.state, 'idle', 'recharged');
  assert.ok(Math.abs(e.x - (10 - 3) * TILE) < 7, 'moved its dash distance');
  assert.ok(Math.abs(e.y - 4 * TILE) < 1);
});

test('a dashing drone stops early when it reaches a wall', () => {
  const { world } = arena({ enemies: [{ x: 3, y: 4 }] });
  const e = world.enemies[0];
  const target = { x: 1.2 * TILE, y: 4 * TILE }; // wall just behind the player
  for (let t = 0; t < 1.5; t += 1 / 60) Core.updateEnemies(world, target, 1 / 60);
  assert.ok(e.x > TILE + e.r - 1, 'never enters the wall');
  assert.ok(e.state === 'recharge' || e.state === 'idle' || e.state === 'windup');
});

test('touching a drone without a shield kills you', () => {
  const { world, p } = arena({ enemies: [{ x: 8, y: 4 }] });
  airborne(p, 8, 4.3);
  assert.deepEqual(Core.stepPlayer(world, p, 1 / 60).map((e) => e.type), ['dead']);
});

test('picking up a shield; ramming an idle drone with it destroys the drone', () => {
  const { world, p } = arena({ enemies: [{ x: 12, y: 4 }], shields: [{ x: 6, y: 4 }] });
  airborne(p, 6, 4);
  assert.deepEqual(Core.stepPlayer(world, p, 1 / 60).map((e) => e.type), ['shield']);
  assert.equal(p.shield, 1);
  assert.equal(world.shields[0].taken, true);
  airborne(p, 12, 4.2);
  assert.deepEqual(Core.stepPlayer(world, p, 1 / 60).map((e) => e.type), ['enemyKilled']);
  assert.equal(world.enemies[0].alive, false);
  assert.equal(p.shield, 1, 'you keep the shield');
});

test('a dashing drone that hits your shield is destroyed, but the shield breaks', () => {
  const { world, p } = arena({ enemies: [{ x: 10, y: 4 }] });
  airborne(p, 10, 4.3);
  p.shield = 1;
  Object.assign(world.enemies[0], { state: 'dash', dir: { x: 0, y: 1 } });
  const types = Core.stepPlayer(world, p, 1 / 60).map((e) => e.type);
  assert.deepEqual(types, ['shieldLost', 'enemyKilled']);
  assert.equal(p.shield, 0);
  assert.ok(p.invuln > 0, 'brief safety afterwards');
  assert.equal(world.enemies[0].alive, false, 'the drone is gone');
});

test('flying into a drone with the shield always destroys it, whatever it is doing', () => {
  for (const state of ['idle', 'windup', 'recharge', 'dash']) {
    const { world, p } = arena({ enemies: [{ x: 10, y: 4 }] });
    airborne(p, 10.3, 4);
    p.shield = 1;
    Object.assign(world.enemies[0], { state, dir: { x: 1, y: 0 }, timer: 1 });
    const types = Core.stepPlayer(world, p, 1 / 60).map((e) => e.type);
    assert.ok(types.includes('enemyKilled'), `drone ${state}: ${types}`);
    assert.equal(world.enemies[0].alive, false);
  }
});

test('the shield bounces you off rock once, then is gone', () => {
  const { world, p } = arena();
  airborne(p, 10, 1.5, 0, -300); // flying into the ceiling
  p.shield = 1;
  const types = runAll(world, p, 0.2);
  assert.ok(types.includes('bounce'));
  assert.ok(!types.includes('dead'));
  assert.equal(p.shield, 0);
  assert.ok(p.vy > 0, 'reflected downward');

  // Without the shield (and after the safety window) rock kills again
  p.invuln = 0;
  airborne(p, 10, 1.5, 0, -300);
  assert.deepEqual(runAll(world, p, 0.3), ['dead']);
});

test('the shield also saves you from a saw', () => {
  const { world, p } = arena({ movers: [{ shape: 'saw', r: 0.6, path: [[10, 4]] }] });
  airborne(p, 9.3, 4, 200, 0);
  p.shield = 1;
  const types = runAll(world, p, 0.1);
  assert.deepEqual(types.filter((t) => t !== 'landed'), ['bounce']);
  assert.ok(p.vx < 0, 'knocked away from the saw');
});

test('respawning resets drones and shield pickups', () => {
  const { world } = arena({ enemies: [{ x: 10, y: 4 }], shields: [{ x: 6, y: 4 }] });
  Object.assign(world.enemies[0], { alive: false, x: 0 });
  world.shields[0].taken = true;
  Core.resetActors(world);
  assert.equal(world.enemies[0].alive, true);
  assert.equal(world.enemies[0].x, 10 * TILE);
  assert.equal(world.enemies[0].state, 'idle');
  assert.equal(world.shields[0].taken, false);
});

test('the game version matches package.json and is marked alpha', () => {
  const pkg = require('../package.json');
  assert.equal(Core.VERSION, pkg.version);
  assert.equal(Core.STAGE, 'alpha');
});

test('the win radius is generous: wider than the drawn flag ring', () => {
  assert.ok(CFG.goalRadius >= 40, `goalRadius ${CFG.goalRadius}`);
  const { world, p } = setup();
  const g = world.level.goal;
  airborne(p, g.x / TILE, g.y / TILE);
  p.x = g.x + 38; // well outside the 28 px ring, inside the glow
  assert.deepEqual(Core.stepPlayer(world, p, 1 / 60).map((e) => e.type), ['won']);
});

// ---------- Coins and death causes ----------

test('coins are collected once', () => {
  const { world, p } = arena({ coins: [{ x: 6, y: 4 }, { x: 12, y: 4 }] });
  airborne(p, 6, 4);
  assert.deepEqual(Core.stepPlayer(world, p, 1 / 60).map((e) => e.type), ['coin']);
  assert.equal(world.coins[0].taken, true);
  assert.deepEqual(Core.stepPlayer(world, p, 1 / 60).map((e) => e.type), [], 'not collected twice');
  Core.resetActors(world);
  assert.equal(world.coins[0].taken, false, 'a full reset puts it back');
});

test('a checkpoint save restores drones, pickups, coins and your shield as they were', () => {
  const { world, p } = arena({
    enemies: [{ x: 8, y: 3 }, { x: 14, y: 3 }],
    shields: [{ x: 5, y: 3 }, { x: 16, y: 3 }],
    coins: [{ x: 6, y: 5 }, { x: 15, y: 5 }],
  });
  // before reaching the checkpoint: drone 0 destroyed, shield 0 and coin 0 taken, carrying a shield
  world.enemies[0].alive = false;
  world.shields[0].taken = true;
  world.coins[0].taken = true;
  p.shield = 1;
  const save = Core.snapshotActors(world, p);
  // after the checkpoint: the rest gets used up, then you die
  world.enemies[1].alive = false;
  Object.assign(world.enemies[0], { x: 0 });
  world.shields[1].taken = true;
  world.coins[1].taken = true;

  Core.restoreActors(world, save);
  assert.deepEqual(world.enemies.map((e) => e.alive), [false, true], 'destroyed before the save stays destroyed');
  assert.equal(world.enemies[1].x, 14 * TILE, 'surviving drones return home');
  assert.deepEqual(world.shields.map((sh) => sh.taken), [true, false]);
  assert.deepEqual(world.coins.map((c) => c.taken), [true, false]);
  assert.equal(save.shield, 1, 'the save remembers you carried a shield');
});

test('deaths report what killed you', () => {
  let s = arena();
  airborne(s.p, 10, 1.5, 0, -300);
  assert.equal(runAll(s.world, s.p, 0.3).length, 1);
  s = arena(); airborne(s.p, 10, 1.5, 0, -300);
  assert.deepEqual(Core.stepPlayer(s.world, s.p, 0.2).filter((e) => e.type === 'dead').map((e) => e.cause), ['rock']);

  s = arena({ movers: [{ shape: 'saw', r: 0.6, path: [[10, 4]] }] });
  airborne(s.p, 10, 4.3);
  assert.equal(Core.stepPlayer(s.world, s.p, 1 / 60)[0].cause, 'saw');

  s = arena({ movers: [{ shape: 'block', w: 2, h: 1, path: [[10, 4]] }] });
  airborne(s.p, 10, 4.3);
  assert.equal(Core.stepPlayer(s.world, s.p, 1 / 60)[0].cause, 'crusher');

  s = arena({ enemies: [{ x: 10, y: 4 }] });
  airborne(s.p, 10, 4.3);
  assert.equal(Core.stepPlayer(s.world, s.p, 1 / 60)[0].cause, 'enemy');
});

test('recordCoins keeps the most coins collected', () => {
  let best = Core.recordCoins({}, 'a', 3);
  best = Core.recordCoins(best, 'a', 2);
  assert.equal(best.a, 3);
  best = Core.recordCoins(best, 'a', 5);
  assert.equal(best.a, 5);
});

// ---------- Fuel cell and pistol ----------

test('a fuel cell gives 15 s of free thrusting, then stamina works normally again', () => {
  const { world, p } = arena({ fuels: [{ x: 6, y: 4 }] });
  airborne(p, 6, 4);
  assert.deepEqual(Core.stepPlayer(world, p, 1 / 60).map((e) => e.type), ['fuel']);
  assert.equal(p.fuel, CFG.fuelDuration);
  for (let i = 0; i < 20; i++) {
    p.cooldown = 0;
    assert.equal(Core.tryThrust(p, { x: 0, y: -1 }), 'thrust', `free thrust ${i + 1}`);
  }
  assert.equal(p.stamina, CFG.staminaMax, 'stamina locked full');
  let out = null;
  for (let t = 0; t < CFG.fuelDuration + 0.1 && !out; t += 1 / 60) out = Core.updateStamina(p, 1 / 60);
  assert.equal(out, 'fuelOut');
  for (let i = 0; i < 4; i++) { p.cooldown = 0; Core.tryThrust(p, { x: 0, y: -1 }); }
  p.cooldown = 0;
  assert.equal(Core.tryThrust(p, { x: 0, y: -1 }), 'empty', 'back to 4 thrusts per bar');
});

test('a pistol gives 3 bullets; another one refills to 3 but never stacks', () => {
  const { world, p } = arena({ guns: [{ x: 6, y: 4 }, { x: 10, y: 4 }] });
  airborne(p, 6, 4);
  assert.deepEqual(Core.stepPlayer(world, p, 1 / 60).map((e) => e.type), ['gun']);
  assert.equal(p.ammo, CFG.gunAmmo);
  airborne(p, 10, 4);
  assert.deepEqual(Core.stepPlayer(world, p, 1 / 60).map((e) => e.type), [], 'full: the second pistol stays');
  assert.equal(world.guns[1].taken, false);
  p.ammo = 1;
  assert.deepEqual(Core.stepPlayer(world, p, 1 / 60).map((e) => e.type), ['gun']);
  assert.equal(p.ammo, CFG.gunAmmo, 'refilled to 3, not 4');
});

test('bullets fly from the head, destroy a drone, and stop at rock', () => {
  const { world, p } = arena({ enemies: [{ x: 6, y: 2 }] });
  airborne(p, 6, 7); p.vx = 0; p.vy = 0;
  assert.equal(Core.fire(world, p, { x: 0, y: -1 }), 'empty', 'no pistol, no shot');
  p.ammo = 3;
  assert.equal(Core.fire(world, p, { x: 0, y: -1 }), 'fired');
  assert.equal(p.ammo, 2);
  assert.ok(world.bullets[0].y < p.y - 20, 'starts at the head');
  let events = [];
  for (let i = 0; i < 30 && world.bullets.length; i++) events.push(...Core.updateBullets(world, 1 / 60));
  assert.deepEqual(events.map((e) => e.type), ['enemyKilled']);
  assert.equal(world.enemies[0].alive, false);

  Core.fire(world, p, { x: 1, y: 0 }); // toward the right wall
  events = [];
  for (let i = 0; i < 60 && world.bullets.length; i++) events.push(...Core.updateBullets(world, 1 / 60));
  assert.deepEqual(events.map((e) => e.type), ['bulletHit']);
  assert.equal(world.bullets.length, 0);
});

test('checkpoint saves remember items and ammo', () => {
  const { world, p } = arena({ fuels: [{ x: 6, y: 4 }], guns: [{ x: 10, y: 4 }] });
  world.guns[0].taken = true; p.ammo = 2;
  const save = Core.snapshotActors(world, p);
  world.fuels[0].taken = true;
  Core.restoreActors(world, save);
  assert.equal(world.guns[0].taken, true);
  assert.equal(world.fuels[0].taken, false);
  assert.equal(save.ammo, 2);
});

test('bullets destroy saws (gone until a reset), crushers are bulletproof', () => {
  const { world, p } = arena({ movers: [
    { path: [[6, 3], [6, 3.01]], r: 0.5 },
    { shape: 'block', w: 1, h: 1, path: [[10, 4], [10, 4.01]] },
  ] });
  Core.updateMovers(world, 0);
  airborne(p, 6, 7); p.vx = 0; p.vy = 0; p.ammo = 3;
  Core.fire(world, p, { x: 0, y: -1 });
  let events = [];
  for (let i = 0; i < 30 && world.bullets.length; i++) events.push(...Core.updateBullets(world, 1 / 60));
  assert.deepEqual(events.map((e) => e.type), ['sawDestroyed']);
  assert.equal(world.movers[0].alive, false);
  assert.equal(Core.hitsMover(world.movers, world.movers[0].x, world.movers[0].y, 5), false, 'a broken saw is harmless');

  const save = Core.snapshotActors(world, p);
  Core.resetActors(world);
  assert.equal(world.movers[0].alive, true, 'dying with no checkpoint brings it back');
  Core.restoreActors(world, save);
  assert.equal(world.movers[0].alive, false, 'shot before the checkpoint: stays broken');

  p.x = 10 * Core.TILE; p.y = 7 * Core.TILE;
  Core.fire(world, p, { x: 0, y: -1 });
  events = [];
  for (let i = 0; i < 30 && world.bullets.length; i++) events.push(...Core.updateBullets(world, 1 / 60));
  assert.deepEqual(events.map((e) => e.type), ['bulletHit']);
  assert.equal(world.movers[1].alive, true);
});

test('shields stack: each pickup adds one, each save uses one', () => {
  const { world, p } = arena({ shields: [{ x: 6, y: 4 }, { x: 6.5, y: 4 }] });
  airborne(p, 6.2, 4); p.vx = 0; p.vy = 0;
  const types = Core.stepPlayer(world, p, 1 / 60).map((e) => e.type);
  assert.deepEqual(types, ['shield', 'shield']);
  assert.equal(p.shield, 2);
  // bounce off rock: one shield left
  airborne(p, 1.3, 4, -300, 0);
  Core.stepPlayer(world, p, 1 / 60);
  assert.equal(p.shield, 1);
  assert.equal(Core.snapshotActors(world, p).shield, 1);
});

test('fuel cells always come back on respawn, even ones taken before the checkpoint', () => {
  const { world, p } = arena({ fuels: [{ x: 6, y: 4 }] });
  world.fuels[0].taken = true;
  const save = Core.snapshotActors(world, p);
  Core.restoreActors(world, save);
  assert.equal(world.fuels[0].taken, false);
});

test('parseRoute knows the level editor and its play-test', () => {
  assert.deepEqual(Core.parseRoute('#/editor', 5), { screen: 'editor' });
  assert.deepEqual(Core.parseRoute('#/editor/test', 5), { screen: 'game', test: true });
});

test('validateLevel reports errors and unfair spots with where to look', () => {
  const ok = { name: 'ok', map: ['#######', '#.....#', '#.....#', '#.....#', '#.S..G#', '#=====#', '#######'] };
  assert.deepEqual(Core.validateLevel(ok), []);
  const msgs = (def) => Core.validateLevel(def).map((x) => `${x.severity}: ${x.message}`);
  assert.match(msgs({ name: 'x', map: ['#####', '#.S.#', '#===#', '#####'] })[0], /error: .*no goal/);
  assert.ok(msgs({ ...ok, map: ['#######', '#..#..#', '#..#..#', '#..#..#', '#.S#.G#', '#=====#', '#######'] })
    .some((m) => /walled off/.test(m)));
  assert.ok(msgs({ ...ok, map: ['#######', '#.....#', '#.....#', '#.....#', '#.S..G#', '#.....#', '#######'] })
    .some((m) => /must stand on a pad/.test(m)));
  const warn = Core.validateLevel({ ...ok, enemies: [{ x: 4, y: 3 }] });
  assert.equal(warn[0].severity, 'warning');
  assert.equal(warn[0].x, 4);
});
