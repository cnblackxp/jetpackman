// Sanity checks for every level in src/levels.js, so map edits can't silently break one.
const test = require('node:test');
const assert = require('node:assert/strict');
const Core = require('../src/core.js');
const LEVELS = require('../src/levels.js');

const { TILE, DEFAULT_TUNING: CFG } = Core;

// 4-way flood fill through open tiles: can you get from start to goal at all?
function reachable(level) {
  const key = (c, r) => r * level.cols + c;
  const goalC = Math.floor(level.goal.x / TILE), goalR = Math.floor(level.goal.y / TILE);
  const seen = new Set([key(level.start.col, level.start.row)]);
  const queue = [[level.start.col, level.start.row]];
  while (queue.length) {
    const [c, r] = queue.shift();
    if (c === goalC && r === goalR) return true;
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nc = c + dc, nr = r + dr;
      if (Core.isBlock(level, nc, nr) || seen.has(key(nc, nr))) continue;
      seen.add(key(nc, nr));
      queue.push([nc, nr]);
    }
  }
  return false;
}

test('there is a tutorial first and at least one practice level', () => {
  assert.equal(LEVELS[0].name, 'Tutorial');
  assert.ok(LEVELS.some((l) => l.practice));
  assert.equal(new Set(LEVELS.map((l) => l.name)).size, LEVELS.length, 'names are unique');
});

for (const [i, def] of LEVELS.entries()) {
  test(`level ${i + 1} "${def.name}" is well formed`, async (t) => {
    const world = Core.createWorld(def);
    const { level } = world;

    await t.test('every row has the same width', () => {
      assert.equal(new Set(def.map.map((r) => r.length)).size, 1);
    });

    await t.test('only known tile characters are used', () => {
      for (const row of def.map) assert.match(row, /^[#=CSG.]+$/);
    });

    await t.test('the border is closed', () => {
      for (let c = 0; c < level.cols; c++) {
        assert.ok(Core.isBlock(level, c, 0) && Core.isBlock(level, c, level.rows - 1), `column ${c}`);
      }
      for (let r = 0; r < level.rows; r++) {
        assert.ok(Core.isBlock(level, 0, r) && Core.isBlock(level, level.cols - 1, r), `row ${r}`);
      }
    });

    await t.test('the player starts standing on a pad, clear of rock', () => {
      assert.ok(Core.isPad(level, level.start.col, level.start.row + 1), 'tile under S is a pad');
      assert.ok(!Core.circleHitsSolid(level, level.start.x, level.start.y, CFG.radius));
    });

    await t.test('the goal can be reached through open space', () => {
      assert.ok(reachable(level));
      assert.ok(!Core.circleHitsSolid(level, level.goal.x, level.goal.y, CFG.radius));
    });

    await t.test('pushers sit in open air', () => {
      for (const b of world.pushers) {
        assert.ok(!Core.circleHitsSolid(level, b.x, b.y, b.r * 0.5), `pusher at ${b.x / TILE},${b.y / TILE}`);
      }
    });

    await t.test('movers stay out of walls and never touch the start', () => {
      for (let time = 0; time < 30; time += 0.05) {
        Core.updateMovers(world, time);
        for (const m of world.movers) {
          const c = Math.floor(m.x / TILE), r = Math.floor(m.y / TILE);
          assert.ok(!Core.isBlock(level, c, r), `mover centre inside a wall at t=${time.toFixed(2)}`);
        }
        assert.ok(!Core.hitsMover(world.movers, level.start.x, level.start.y, CFG.radius + 20),
          `mover too close to the start at t=${time.toFixed(2)}`);
      }
    });

    await t.test('a straight hop from the start lands back on the start pad', () => {
      const w = Core.createWorld(def);
      const p = Core.createPlayer(w.level);
      assert.equal(Core.tryThrust(p, { x: 0, y: -1 }), 'thrust');
      const events = [];
      for (let i = 0; i < 60 * 5 && !p.grounded; i++) {
        Core.updateMovers(w, w.clock + 1 / 60);
        Core.updateEnemies(w, p, 1 / 60);
        events.push(...Core.stepPlayer(w, p, 1 / 60).map((e) => e.type));
        assert.ok(!events.includes('dead'), `died after hopping (events: ${events})`);
      }
      assert.deepEqual(events, ['landed']);
      assert.equal(p.y, level.start.y);
    });

    await t.test('drones and shields sit in open air', () => {
      for (const e of world.enemies) {
        assert.ok(!Core.circleHitsBlock(level, e.homeX, e.homeY, e.r + 2), `drone at ${e.homeX / TILE},${e.homeY / TILE}`);
      }
      for (const sh of world.shields) {
        assert.ok(!Core.circleHitsBlock(level, sh.x, sh.y, 14), `shield at ${sh.x / TILE},${sh.y / TILE}`);
      }
    });

    await t.test('fuel cells and pistols sit in open air', () => {
      for (const it of [...world.fuels, ...world.guns]) {
        assert.ok(!Core.circleHitsBlock(level, it.x, it.y, 14), `item at ${it.x / TILE},${it.y / TILE}`);
      }
    });

    await t.test('coins sit in open air and do not overlap the start', () => {
      for (const c of world.coins) {
        assert.ok(!Core.circleHitsBlock(level, c.x, c.y, 8), `coin at ${c.x / TILE},${c.y / TILE}`);
      }
      assert.ok(world.coins.length > 0, 'every level has coins');
      // coins float: none sits right on top of a pad (you fly, you don't walk)
      for (const c of world.coins) {
        const col = Math.floor(c.x / TILE), below = Math.floor(c.y / TILE + 0.9);
        assert.ok(!Core.isPad(level, col, below), `coin at ${c.x / TILE},${c.y / TILE} rests on a pad`);
      }
    });

    await t.test('no drone can see a checkpoint pad from within range (no respawn traps)', () => {
      for (const cp of level.checkpoints) {
        for (let k = 0; k < cp.width; k++) {
          const x = (cp.col + k + 0.5) * TILE, y = cp.y - CFG.standOffset; // where you'd stand / respawn
          for (const e of world.enemies) {
            const d = Math.hypot(x - e.homeX, y - e.homeY);
            const sees = d < e.range + TILE && Core.lineOfSight(level, e.homeX, e.homeY, x, y);
            assert.ok(!sees, `drone at ${e.homeX / TILE},${e.homeY / TILE} watches the checkpoint at col ${cp.col + k}, row ${cp.row}`);
          }
        }
      }
    });

    await t.test('no drone can see the start pad from within range', () => {
      for (const e of world.enemies) {
        const d = Math.hypot(level.start.x - e.homeX, level.start.y - e.homeY);
        const sees = d < e.range + 2 * TILE && Core.lineOfSight(level, e.homeX, e.homeY, level.start.x, level.start.y);
        assert.ok(!sees, `drone at ${e.homeX / TILE},${e.homeY / TILE} threatens the start`);
      }
    });

    await t.test('signs have text', () => {
      for (const s of world.signs) assert.ok(typeof s.text === 'string' && s.text.length > 0);
    });
  });
}
