// Pure game logic: no PIXI, no DOM. Loaded as a plain <script> in the browser
// (exposed as window.JetpackCore) and with require() in the Node tests.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.JetpackCore = api;
})(typeof self !== 'undefined' ? self : this, function () {
  const TILE = 40;
  const VERSION = '0.0.1';   // keep in sync with package.json (a test checks)
  const STAGE = 'alpha';

  const DEFAULT_TUNING = Object.freeze({
    gravity: 520,          // px/s^2
    thrust: 340,           // velocity added per thrust, px/s
    opposingKeep: 0.4,     // share of velocity against the thrust direction that survives a thrust
    maxSpeed: 720,         // px/s
    maxFall: 420,          // terminal falling speed, px/s
    airDrag: 0.35,         // fraction of velocity lost per second
    clickCooldown: 0.1,    // s between thrusts
    radius: 13,            // player collision radius
    standOffset: 22,       // distance from a surface to the player's centre when standing
    staminaMax: 100,
    thrustCost: 25,        // 4 thrusts per full bar; any stamina left lets you thrust once more
    staminaRegen: 32,      // per second
    regenDelay: 0.3,       // s after a thrust before refilling starts
    exhaustedRegenMultiplier: 1.5, // refill faster while locked out after running dry
    goalRadius: 44,        // px: touching anywhere inside the flag's glow wins (was 28, the inner ring)
    pusherRadius: 0.8,     // tiles, default
    pusherPower: 480,      // px/s, default
    substeps: 4,
    hoverDrag: 6,          // while hovering: how fast motion settles (~0.5 s) into the slow sink
    hoverSinkSpeed: 30,    // while hovering you drift down at this speed (px/s; falling is up to 420)
    hoverDrain: 3,         // stamina used per second while hovering (full bar lasts ~33 s; works at 0 too)
    // Drones: idle until you're in range and in sight, wind up, dash, then recharge
    enemyRadius: 16,       // px
    enemyRange: 6,         // tiles: how close you must be to wake one
    enemyWindup: 0.45,     // s of visible warning before a dash (aim follows you meanwhile)
    enemySpeed: 380,       // px/s while dashing
    enemyDash: 6,          // tiles travelled per dash (stops early at walls)
    enemyRecharge: 1.6,    // s of rest after each dash
    // Shield item
    shieldPickupRadius: 18, // px
    coinRadius: 12,        // px: coins are collected when the player's circle touches this
    itemRadius: 26,        // px: fuel cell / pistol pickups
    fuelDuration: 15,      // s of free thrusting from a fuel cell (stamina locked full)
    gunAmmo: 3,            // bullets per pistol; picking up another refills to this, never more
    bulletSpeed: 900,      // px/s
    bulletLife: 1.2,       // s before a bullet fizzles
    bulletRadius: 14,      // px: generous hit size vs drones (aiming while flying is hard)
    shieldInvuln: 0.5,     // s of safety after the shield saves you
    bounceRestitution: 0.8,// share of speed kept when bouncing off rock
    bounceMinSpeed: 220,   // px/s: a bounce always pushes you away at least this fast
  });

  // ---------- Levels ----------
  // Map characters: '#' deadly rock, '=' safe pad, 'C' checkpoint pad, 'S' start, 'G' goal, '.' air.
  function parseLevel(def, cfg = DEFAULT_TUNING) {
    if (!def || !Array.isArray(def.map) || def.map.length === 0) {
      throw new Error(`Level "${def && def.name}" has no map`);
    }
    const cols = Math.max(...def.map.map((r) => r.length));
    const map = def.map.map((r) => r.padEnd(cols, '#'));
    let start = null, gx = 0, gy = 0, gn = 0;
    map.forEach((row, r) => {
      for (let c = 0; c < cols; c++) {
        if (row[c] === 'S') {
          if (start) throw new Error(`Level "${def.name}" has more than one start`);
          start = { x: c * TILE + TILE / 2, y: (r + 1) * TILE - cfg.standOffset, col: c, row: r };
        } else if (row[c] === 'G') {
          gx += c * TILE + TILE / 2; gy += r * TILE + TILE / 2; gn++;
        }
      }
    });
    // Each horizontal run of 'C' tiles is one checkpoint (flag drawn at its centre)
    const checkpoints = [];
    map.forEach((row, r) => {
      for (let c = 0; c < cols; c++) {
        if (row[c] !== 'C' || row[c - 1] === 'C') continue;
        let end = c;
        while (row[end + 1] === 'C') end++;
        checkpoints.push({ x: ((c + end + 1) / 2) * TILE, y: r * TILE, col: c, row: r, width: end - c + 1 });
      }
    });
    if (!start) throw new Error(`Level "${def.name}" has no start (S)`);
    if (!gn) throw new Error(`Level "${def.name}" has no goal (G)`);
    return {
      name: def.name,
      practice: !!def.practice,
      map, cols, rows: map.length,
      start,
      goal: { x: gx / gn, y: gy / gn },
      checkpoints,
    };
  }

  function tileAt(level, c, r) {
    if (c < 0 || r < 0 || c >= level.cols || r >= level.rows) return '#';
    return level.map[r][c];
  }
  const isSolid = (level, c, r) => tileAt(level, c, r) === '#';
  const isPad = (level, c, r) => tileAt(level, c, r) === '=' || tileAt(level, c, r) === 'C';
  const isCheckpoint = (level, c, r) => tileAt(level, c, r) === 'C';
  const isBlock = (level, c, r) => isSolid(level, c, r) || isPad(level, c, r);

  // Everything that changes while a level is played: pushers, movers, the clock.
  function createWorld(def, cfg = DEFAULT_TUNING) {
    const level = parseLevel(def, cfg);
    const world = {
      level,
      clock: 0,
      pushers: (def.pushers || []).map((b) => ({
        x: b.x * TILE, y: b.y * TILE,
        r: (b.r || cfg.pusherRadius) * TILE,
        angle: (b.angle || 0) * Math.PI / 180,
        power: b.power || cfg.pusherPower,
        touching: false,
      })),
      movers: (def.movers || []).map((d) => ({
        shape: d.shape || 'saw',
        speed: d.speed || 2,
        phase: d.phase || 0,
        r: (d.r || 0.6) * TILE,
        w: (d.w || 1) * TILE,
        h: (d.h || 1) * TILE,
        path: d.path && d.path.map(([x, y]) => ({ x: x * TILE, y: y * TILE })),
        orbit: d.orbit && { x: d.orbit.x * TILE, y: d.orbit.y * TILE, radius: d.orbit.radius * TILE },
        x: 0, y: 0,
        alive: true, // saws can be shot to pieces
      })),
      signs: (def.signs || []).map((s) => ({ x: s.x * TILE, y: s.y * TILE, text: s.text })),
      enemies: (def.enemies || []).map((e) => ({
        homeX: e.x * TILE, homeY: e.y * TILE,
        range: (e.range || cfg.enemyRange) * TILE,
        dash: (e.dash || cfg.enemyDash) * TILE,
        speed: e.speed || cfg.enemySpeed,
        recharge: e.recharge != null ? e.recharge : cfg.enemyRecharge,
        r: cfg.enemyRadius,
      })),
      shields: (def.shields || []).map((sh) => ({ x: sh.x * TILE, y: sh.y * TILE })),
      coins: (def.coins || []).map((c) => ({ x: c.x * TILE, y: c.y * TILE, taken: false })),
      fuels: (def.fuels || []).map((f) => ({ x: f.x * TILE, y: f.y * TILE, taken: false })),
      guns: (def.guns || []).map((g) => ({ x: g.x * TILE, y: g.y * TILE, taken: false })),
      bullets: [],
    };
    resetActors(world);
    updateMovers(world, 0);
    return world;
  }

  // Puts drones back home (alive, idle) and shield pickups back in place.
  // Called when a level starts and whenever the player respawns.
  // Full reset (level start, or a death with no checkpoint): every drone back home and alive,
  // every shield and coin back in place.
  function resetActors(world) {
    for (const c of world.coins) c.taken = false;
    for (const e of world.enemies) {
      Object.assign(e, { x: e.homeX, y: e.homeY, state: 'idle', timer: 0, dir: { x: 0, y: 0 }, traveled: 0, alive: true });
    }
    for (const sh of world.shields) sh.taken = false;
    for (const f of world.fuels) f.taken = false;
    for (const g of world.guns) g.taken = false;
    for (const m of world.movers) m.alive = true;
    world.bullets = [];
  }

  // Checkpoint save: what's been destroyed / picked up so far, and whether you carry a shield.
  function snapshotActors(world, p) {
    return {
      enemies: world.enemies.map((e) => e.alive),
      shields: world.shields.map((sh) => !!sh.taken),
      coins: world.coins.map((c) => !!c.taken),
      fuels: world.fuels.map((f) => !!f.taken),
      guns: world.guns.map((g) => !!g.taken),
      movers: world.movers.map((m) => m.alive !== false),
      shield: p ? +p.shield || 0 : 0,
      ammo: p ? p.ammo || 0 : 0,
    };
  }

  // Back to a checkpoint save: drones destroyed before it stay gone (the rest return home),
  // pickups taken before it stay taken, everything after it comes back.
  function restoreActors(world, snap) {
    resetActors(world);
    world.enemies.forEach((e, i) => { e.alive = snap.enemies[i]; });
    world.shields.forEach((sh, i) => { sh.taken = snap.shields[i]; });
    world.coins.forEach((c, i) => { c.taken = snap.coins[i]; });
    world.guns.forEach((g, i) => { g.taken = !!(snap.guns && snap.guns[i]); });
    world.movers.forEach((m, i) => { m.alive = !snap.movers || snap.movers[i] !== false; });
  }

  // ---------- Collision ----------
  function circleHitsSolid(level, x, y, radius) {
    const c0 = Math.floor((x - radius) / TILE), c1 = Math.floor((x + radius) / TILE);
    const r0 = Math.floor((y - radius) / TILE), r1 = Math.floor((y + radius) / TILE);
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        if (!isSolid(level, c, r)) continue;
        const nx = Math.max(c * TILE, Math.min(x, (c + 1) * TILE));
        const ny = Math.max(r * TILE, Math.min(y, (r + 1) * TILE));
        if ((x - nx) ** 2 + (y - ny) ** 2 < radius * radius) return true;
      }
    }
    return false;
  }

  function circleHitsBlock(level, x, y, radius) {
    const c0 = Math.floor((x - radius) / TILE), c1 = Math.floor((x + radius) / TILE);
    const r0 = Math.floor((y - radius) / TILE), r1 = Math.floor((y + radius) / TILE);
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        if (!isBlock(level, c, r)) continue;
        const nx = Math.max(c * TILE, Math.min(x, (c + 1) * TILE));
        const ny = Math.max(r * TILE, Math.min(y, (r + 1) * TILE));
        if ((x - nx) ** 2 + (y - ny) ** 2 < radius * radius) return true;
      }
    }
    return false;
  }

  // True if nothing solid (rock or pad) lies on the straight line between two points.
  function lineOfSight(level, x0, y0, x1, y1) {
    const steps = Math.ceil(Math.hypot(x1 - x0, y1 - y0) / 8);
    for (let i = 1; i < steps; i++) {
      const x = x0 + ((x1 - x0) * i) / steps, y = y0 + ((y1 - y0) * i) / steps;
      if (isBlock(level, Math.floor(x / TILE), Math.floor(y / TILE))) return false;
    }
    return true;
  }

  // The shield saves you from rock: push out of the wall and reflect the velocity.
  function bounceOffRock(level, p, cfg = DEFAULT_TUNING) {
    const R = cfg.radius;
    for (let pass = 0; pass < 3; pass++) {
      let best = null;
      const c0 = Math.floor((p.x - R) / TILE), c1 = Math.floor((p.x + R) / TILE);
      const r0 = Math.floor((p.y - R) / TILE), r1 = Math.floor((p.y + R) / TILE);
      for (let r = r0; r <= r1; r++) {
        for (let c = c0; c <= c1; c++) {
          if (!isSolid(level, c, r)) continue;
          const nx = Math.max(c * TILE, Math.min(p.x, (c + 1) * TILE));
          const ny = Math.max(r * TILE, Math.min(p.y, (r + 1) * TILE));
          const d = Math.hypot(p.x - nx, p.y - ny);
          if (d < R && (!best || d < best.d)) best = { nx, ny, d };
        }
      }
      if (!best) return;
      const ux = best.d > 1e-3 ? (p.x - best.nx) / best.d : 0;
      const uy = best.d > 1e-3 ? (p.y - best.ny) / best.d : -1;
      p.x = best.nx + ux * (R + 0.5);
      p.y = best.ny + uy * (R + 0.5);
      const vn = p.vx * ux + p.vy * uy;
      if (vn < 0) { p.vx -= (1 + cfg.bounceRestitution) * vn * ux; p.vy -= (1 + cfg.bounceRestitution) * vn * uy; }
      const out = p.vx * ux + p.vy * uy;
      if (out < cfg.bounceMinSpeed) { p.vx += ux * (cfg.bounceMinSpeed - out); p.vy += uy * (cfg.bounceMinSpeed - out); }
    }
  }

  // Touching a pad's top while moving down lands you; its other sides just block.
  // Returns 'landed', 'blocked' or null.
  function resolvePads(level, p, cfg = DEFAULT_TUNING) {
    const R = cfg.radius;
    let result = null;
    const c0 = Math.floor((p.x - R) / TILE), c1 = Math.floor((p.x + R) / TILE);
    const r0 = Math.floor((p.y - R) / TILE), r1 = Math.floor((p.y + R) / TILE);
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        if (!isPad(level, c, r)) continue;
        const nx = Math.max(c * TILE, Math.min(p.x, (c + 1) * TILE));
        const ny = Math.max(r * TILE, Math.min(p.y, (r + 1) * TILE));
        const d = Math.hypot(p.x - nx, p.y - ny);
        if (d >= R) continue;
        const ux = d > 1e-3 ? (p.x - nx) / d : 0;
        const uy = d > 1e-3 ? (p.y - ny) / d : -1;
        if (uy < -0.7 && p.vy >= 0) {
          p.grounded = true;
          p.landedOn = { col: c, row: r, checkpoint: isCheckpoint(level, c, r) };
          p.vx = 0; p.vy = 0;
          p.y = r * TILE - cfg.standOffset;
          return 'landed';
        }
        p.x = nx + ux * R;
        p.y = ny + uy * R;
        const vn = p.vx * ux + p.vy * uy;
        if (vn < 0) { p.vx -= ux * vn; p.vy -= uy * vn; }
        result = 'blocked';
      }
    }
    return result;
  }

  // ---------- Movers ----------
  // Path movers ping-pong at `speed` tiles/s; orbit movers turn at `speed` deg/s.
  function moverPosition(m, t) {
    if (m.orbit) {
      const a = (m.phase + m.speed * t) * Math.PI / 180;
      return { x: m.orbit.x + Math.cos(a) * m.orbit.radius, y: m.orbit.y + Math.sin(a) * m.orbit.radius };
    }
    const pts = m.path, seg = [];
    let L = 0;
    for (let i = 1; i < pts.length; i++) {
      const l = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
      seg.push(l); L += l;
    }
    if (L === 0) return { x: pts[0].x, y: pts[0].y };
    let s = (((m.phase + m.speed * t) * TILE) % (2 * L) + 2 * L) % (2 * L);
    if (s > L) s = 2 * L - s;
    let i = 0;
    while (i < seg.length - 1 && s > seg[i]) { s -= seg[i]; i++; }
    const k = s / seg[i];
    return { x: pts[i].x + (pts[i + 1].x - pts[i].x) * k, y: pts[i].y + (pts[i + 1].y - pts[i].y) * k };
  }

  function updateMovers(world, t) {
    world.clock = t;
    for (const m of world.movers) Object.assign(m, moverPosition(m, t));
  }

  function hitsMover(movers, x, y, radius) {
    for (const m of movers) {
      if (m.alive === false) continue;
      if (m.shape === 'block') {
        const nx = Math.max(m.x - m.w / 2, Math.min(x, m.x + m.w / 2));
        const ny = Math.max(m.y - m.h / 2, Math.min(y, m.y + m.h / 2));
        if (Math.hypot(x - nx, y - ny) < radius) return true;
      } else if (Math.hypot(x - m.x, y - m.y) < m.r * 0.85 + radius) {
        return true; // saws are a little forgiving: teeth don't count
      }
    }
    return false;
  }

  // Fires once per entry; the player's velocity becomes the pusher's push.
  function checkPushers(pushers, p, cfg = DEFAULT_TUNING) {
    let fired = null;
    for (const b of pushers) {
      const inside = Math.hypot(p.x - b.x, p.y - b.y) < b.r + cfg.radius * 0.5;
      if (inside && !b.touching && !fired) {
        p.vx = Math.cos(b.angle) * b.power;
        p.vy = Math.sin(b.angle) * b.power;
        p.grounded = false;
        p.heading = { x: Math.cos(b.angle), y: Math.sin(b.angle) };
        fired = b;
      }
      b.touching = inside;
    }
    return fired;
  }

  // ---------- Player ----------
  // spawn: optional { x, y } to respawn at a checkpoint instead of the start
  function createPlayer(level, cfg = DEFAULT_TUNING, spawn = null) {
    return {
      x: spawn ? spawn.x : level.start.x, y: spawn ? spawn.y : level.start.y, vx: 0, vy: 0,
      launched: !!spawn, // has thrust at least once (starts the timer)
      grounded: true,    // standing on a pad: no gravity
      cooldown: 0,
      stamina: cfg.staminaMax,
      exhausted: false,  // hit 0: locked until full again
      regenDelay: 0,
      heading: null,     // unit vector of the last thrust/pusher while its push lasts
      hovering: false,   // middle mouse held: slow sink instead of gravity, stamina slowly drains
      shield: 0,         // gold shields carried (they stack; each hit uses one)
      invuln: 0,         // s left of safety right after the shield saved you
      fuel: 0,           // s left of free thrusting (fuel cell)
      ammo: 0,           // pistol bullets (0 = no pistol)
    };
  }

  // Unit vector for a thrust. Left click pushes away from the mouse, right click toward it.
  function thrustDirection(p, mx, my, toward) {
    let dx = p.x - mx, dy = p.y - my;
    const len = Math.hypot(dx, dy);
    if (len < 1) return null;
    dx /= len; dy /= len;
    return toward ? { x: -dx, y: -dy } : { x: dx, y: dy };
  }

  // Returns 'thrust', 'cooldown', 'empty' (no stamina) or 'blocked' (pushing into the pad you stand on).
  // Any stamina above 0 allows a thrust; it always costs thrustCost, so a partial bar drains to 0
  // and starts the lockout.
  function tryThrust(p, dir, cfg = DEFAULT_TUNING) {
    if (!dir || p.cooldown > 0) return 'cooldown';
    if (p.grounded && dir.y > 0.35) return 'blocked';
    const free = p.fuel > 0; // fuel cell: thrusting costs nothing
    if (!free && (p.exhausted || p.stamina <= 0)) {
      p.cooldown = cfg.clickCooldown;
      return 'empty';
    }
    if (!free) {
      p.stamina -= cfg.thrustCost;
      p.regenDelay = cfg.regenDelay;
      if (p.stamina <= 0) { p.stamina = 0; p.exhausted = true; }
    }

    // Mostly cancel motion fighting the thrust so every thrust responds
    const along = p.vx * dir.x + p.vy * dir.y;
    if (along < 0) {
      p.vx -= dir.x * along * (1 - cfg.opposingKeep);
      p.vy -= dir.y * along * (1 - cfg.opposingKeep);
    }
    p.vx += dir.x * cfg.thrust;
    p.vy += dir.y * cfg.thrust;
    clampSpeed(p, cfg.maxSpeed);
    p.launched = true;
    p.grounded = false;
    p.heading = { x: dir.x, y: dir.y };
    p.cooldown = cfg.clickCooldown;
    return 'thrust';
  }

  // Returns 'refilled' on the frame an exhausted bar becomes usable again, 'fuelOut' when a fuel
  // cell runs out.
  function updateStamina(p, dt, cfg = DEFAULT_TUNING) {
    p.cooldown = Math.max(0, p.cooldown - dt);
    if (p.fuel > 0) { // fuel cell: stamina locked full
      p.fuel = Math.max(0, p.fuel - dt);
      p.stamina = cfg.staminaMax;
      p.exhausted = false;
      return p.fuel === 0 ? 'fuelOut' : null;
    }
    // Hovering never refills stamina; it drains it very slowly (and keeps working at 0)
    if (p.hovering && !p.grounded) {
      if (p.stamina > 0) {
        p.stamina = Math.max(0, p.stamina - cfg.hoverDrain * dt);
        if (p.stamina === 0) p.exhausted = true;
      }
      return null;
    }
    p.regenDelay = Math.max(0, p.regenDelay - dt);
    if (p.regenDelay <= 0) {
      const rate = cfg.staminaRegen * (p.exhausted ? cfg.exhaustedRegenMultiplier : 1);
      p.stamina = Math.min(cfg.staminaMax, p.stamina + rate * dt);
    }
    if (p.exhausted && p.stamina >= cfg.staminaMax) {
      p.exhausted = false;
      return 'refilled';
    }
    return null;
  }

  function clampSpeed(p, max) {
    const sp = Math.hypot(p.vx, p.vy);
    if (sp > max) { p.vx *= max / sp; p.vy *= max / sp; }
  }

  // ---------- Drones ----------
  // idle -> (player in range and in sight) -> windup -> dash -> recharge -> idle
  // p: the player, or null when there's nothing to chase (dead / menus).
  // Returns events: { type: 'enemyWindup', enemy } | { type: 'enemyDash', enemy }
  function updateEnemies(world, p, dt, cfg = DEFAULT_TUNING) {
    const events = [];
    for (const e of world.enemies) {
      if (!e.alive) continue;
      if (e.state === 'idle') {
        if (p && Math.hypot(p.x - e.x, p.y - e.y) < e.range && lineOfSight(world.level, e.x, e.y, p.x, p.y)) {
          e.state = 'windup';
          e.timer = cfg.enemyWindup;
          events.push({ type: 'enemyWindup', enemy: e });
        }
      }
      if (e.state === 'windup') {
        if (p) { // keep aiming at the player until the dash starts
          const d = Math.hypot(p.x - e.x, p.y - e.y) || 1;
          e.dir = { x: (p.x - e.x) / d, y: (p.y - e.y) / d };
        }
        e.timer -= dt;
        if (e.timer <= 0) {
          e.state = 'dash';
          e.traveled = 0;
          events.push({ type: 'enemyDash', enemy: e });
        }
      } else if (e.state === 'dash') {
        let move = e.speed * dt;
        while (move > 0 && e.state === 'dash') {
          const step = Math.min(6, move);
          move -= step;
          const nx = e.x + e.dir.x * step, ny = e.y + e.dir.y * step;
          if (circleHitsBlock(world.level, nx, ny, e.r)) { stopEnemy(e, cfg); break; }
          e.x = nx; e.y = ny;
          e.traveled += step;
          if (e.traveled >= e.dash) stopEnemy(e, cfg);
        }
      } else if (e.state === 'recharge') {
        e.timer -= dt;
        if (e.timer <= 0) e.state = 'idle';
      }
    }
    return events;
  }

  function stopEnemy(e, cfg) {
    e.state = 'recharge';
    e.timer = e.recharge;
  }

  // Shield pickups and drone contact. Pushes events; returns true if the player died.
  function touchActors(world, p, cfg, events) {
    const R = cfg.radius;
    for (const f of world.fuels) {
      if (!f.taken && Math.hypot(p.x - f.x, p.y - f.y) < cfg.itemRadius + R) {
        f.taken = true;
        p.fuel = cfg.fuelDuration;
        events.push({ type: 'fuel', item: f });
      }
    }
    for (const g of world.guns) {
      // a full pistol leaves the pickup where it is (ammo never stacks past gunAmmo)
      if (!g.taken && p.ammo < cfg.gunAmmo && Math.hypot(p.x - g.x, p.y - g.y) < cfg.itemRadius + R) {
        g.taken = true;
        p.ammo = cfg.gunAmmo;
        events.push({ type: 'gun', item: g });
      }
    }
    for (const c of world.coins) {
      if (!c.taken && Math.hypot(p.x - c.x, p.y - c.y) < cfg.coinRadius + R) {
        c.taken = true;
        events.push({ type: 'coin', coin: c });
      }
    }
    for (const sh of world.shields) {
      if (sh.taken) continue;
      if (Math.hypot(p.x - sh.x, p.y - sh.y) < cfg.shieldPickupRadius + R) {
        sh.taken = true;
        p.shield = (+p.shield || 0) + 1;
        events.push({ type: 'shield', item: sh, count: p.shield });
      }
    }
    for (const e of world.enemies) {
      if (!e.alive || Math.hypot(p.x - e.x, p.y - e.y) >= e.r + R) continue;
      if (p.invuln > 0) continue;
      if (e.state === 'dash') {
        // The drone hit you mid-dash: with a shield it is still destroyed, but the shield breaks
        // in the trade (and you're knocked along its dash); without one you die
        if (!p.shield) { events.push({ type: 'dead', cause: 'enemy' }); return true; }
        p.shield = Math.max(0, p.shield - 1);
        p.invuln = cfg.shieldInvuln;
        p.vx = e.dir.x * 320; p.vy = e.dir.y * 320;
        p.grounded = false;
        e.alive = false;
        events.push({ type: 'shieldLost', enemy: e });
        events.push({ type: 'enemyKilled', enemy: e });
      } else if (p.shield) {
        // You hit the drone with the shield: it's destroyed, you keep the shield
        e.alive = false;
        events.push({ type: 'enemyKilled', enemy: e });
      } else {
        events.push({ type: 'dead', cause: 'enemy' });
        return true;
      }
    }
    return false;
  }

  // ---------- Pistol ----------
  // Fires one bullet from the player's head in `dir` (a unit vector: the way the head points,
  // i.e. away from the mouse). Returns 'fired' or 'empty'.
  function fire(world, p, dir, cfg = DEFAULT_TUNING) {
    if (!dir || !(p.ammo > 0)) return 'empty';
    p.ammo--;
    world.bullets.push({
      x: p.x + dir.x * 22, y: p.y + dir.y * 22,
      vx: dir.x * cfg.bulletSpeed, vy: dir.y * cfg.bulletSpeed, life: cfg.bulletLife,
    });
    return 'fired';
  }

  // Moves bullets; they stop at rock, pads and crushers, and destroy drones and saws they touch.
  // Returns events: { type: 'bulletHit', x, y } | { type: 'enemyKilled', enemy, byBullet: true }
  //   | { type: 'sawDestroyed', saw }
  function updateBullets(world, dt, cfg = DEFAULT_TUNING) {
    const events = [];
    world.bullets = world.bullets.filter((b) => {
      b.life -= dt;
      if (b.life <= 0) return false;
      const steps = Math.max(1, Math.ceil((Math.hypot(b.vx, b.vy) * dt) / 6));
      for (let i = 0; i < steps; i++) {
        b.x += (b.vx * dt) / steps;
        b.y += (b.vy * dt) / steps;
        if (circleHitsBlock(world.level, b.x, b.y, 3)) { events.push({ type: 'bulletHit', x: b.x, y: b.y }); return false; }
        const saw = world.movers.find((m) => m.alive !== false && m.shape !== 'block'
          && Math.hypot(b.x - m.x, b.y - m.y) < m.r * 0.85 + cfg.bulletRadius);
        if (saw) {
          saw.alive = false;
          events.push({ type: 'sawDestroyed', saw });
          return false;
        }
        if (hitsMover(world.movers.filter((m) => m.shape === 'block'), b.x, b.y, 3)) {
          events.push({ type: 'bulletHit', x: b.x, y: b.y }); // crushers are bulletproof
          return false;
        }
        const e = world.enemies.find((en) => en.alive && Math.hypot(b.x - en.x, b.y - en.y) < en.r + cfg.bulletRadius);
        if (e) {
          e.alive = false;
          events.push({ type: 'enemyKilled', enemy: e, byBullet: true });
          return false;
        }
      }
      return true;
    });
    return events;
  }

  // Landing on a pad refills stamina completely. Returns true if anything was refilled.
  function refillOnLanding(p, cfg = DEFAULT_TUNING) {
    const wasLow = p.stamina < cfg.staminaMax || p.exhausted;
    p.stamina = cfg.staminaMax;
    p.exhausted = false;
    p.regenDelay = 0;
    p.heading = null;
    return wasLow;
  }

  // Advances the player by dt. Returns events in order:
  // { type: 'pusher', pusher } | { type: 'landed', refilled, checkpoint } | { type: 'dead' } | { type: 'won' }
  // | { type: 'shield' } | { type: 'shieldLost' } | { type: 'bounce' } | { type: 'enemyKilled', enemy }
  // | { type: 'coin', coin }.  'dead' carries a cause: 'rock' | 'saw' | 'crusher' | 'enemy'
  // checkpoint is { x, y } (where to respawn) when the pad landed on is a checkpoint, else null.
  function stepPlayer(world, p, dt, cfg = DEFAULT_TUNING) {
    const events = [];
    const { level } = world;
    const R = cfg.radius;
    const reachedGoal = () => Math.hypot(p.x - level.goal.x, p.y - level.goal.y) < cfg.goalRadius;
    p.invuln = Math.max(0, (p.invuln || 0) - dt);

    // A saw or crusher: the shield (or the safety window after it) knocks you away instead.
    // Returns the death cause ('saw' | 'crusher') when it kills, else false.
    const hitHazard = () => {
      const hit = world.movers.find((m) => hitsMover([m], p.x, p.y, R));
      if (!hit) return false;
      if (p.invuln > 0) return false;
      if (!p.shield) return hit.shape === 'block' ? 'crusher' : 'saw';
      let best = null;
      for (const m of world.movers) {
        if (m.alive === false) continue;
        const d = Math.hypot(p.x - m.x, p.y - m.y);
        if (!best || d < best.d) best = { m, d };
      }
      const ux = best.d > 1e-3 ? (p.x - best.m.x) / best.d : 0, uy = best.d > 1e-3 ? (p.y - best.m.y) / best.d : -1;
      const sp = Math.max(Math.hypot(p.vx, p.vy), cfg.bounceMinSpeed);
      p.vx = ux * sp; p.vy = uy * sp;
      p.grounded = false;
      p.shield = Math.max(0, p.shield - 1);
      p.invuln = cfg.shieldInvuln;
      events.push({ type: 'bounce' });
      return false;
    };

    if (p.grounded) {
      const cause = hitHazard();
      if (cause) { events.push({ type: 'dead', cause }); return events; }
      if (touchActors(world, p, cfg, events)) return events;
      if (p.launched && reachedGoal()) events.push({ type: 'won' });
      if (p.grounded) return events;
    }

    const h = dt / cfg.substeps;
    for (let i = 0; i < cfg.substeps; i++) {
      const b = checkPushers(world.pushers, p, cfg);
      if (b) events.push({ type: 'pusher', pusher: b });
      if (p.hovering) {
        // Settle toward a gentle sink: sideways motion dies out, vertical eases to hoverSinkSpeed
        const k = cfg.hoverDrag * h;
        p.vx -= p.vx * k;
        p.vy += (cfg.hoverSinkSpeed - p.vy) * k;
      } else {
        p.vy += cfg.gravity * h;
        const drag = 1 - cfg.airDrag * h;
        p.vx *= drag; p.vy *= drag;
      }
      if (p.vy > cfg.maxFall) p.vy = cfg.maxFall;
      clampSpeed(p, cfg.maxSpeed);
      p.x += p.vx * h;
      p.y += p.vy * h;

      if (circleHitsSolid(level, p.x, p.y, R)) {
        if (p.shield || p.invuln > 0) {
          bounceOffRock(level, p, cfg);
          if (p.shield) {
            p.shield = Math.max(0, p.shield - 1);
            p.invuln = cfg.shieldInvuln;
            events.push({ type: 'bounce' });
          }
        } else {
          events.push({ type: 'dead', cause: 'rock' });
          return events;
        }
      }
      if (resolvePads(level, p, cfg) === 'landed') {
        const checkpoint = p.landedOn && p.landedOn.checkpoint ? { x: p.x, y: p.y } : null;
        events.push({ type: 'landed', refilled: refillOnLanding(p, cfg), checkpoint });
      }
      // The heading marker lasts until the push is used up (no longer moving that way)
      if (p.heading && p.vx * p.heading.x + p.vy * p.heading.y <= 0) p.heading = null;
      const cause = hitHazard();
      if (cause) { events.push({ type: 'dead', cause }); return events; }
      if (touchActors(world, p, cfg, events)) return events;
      if (reachedGoal()) { events.push({ type: 'won' }); return events; }
      if (p.grounded) break;
    }
    return events;
  }

  // ---------- Routing ----------
  // #/menu, #/levels, #/options, #/level/<n> (1-based). Anything else redirects.
  function parseRoute(hash, levelCount) {
    const [screen, arg] = String(hash || '').replace(/^#\/?/, '').split('/');
    if (screen === 'menu' || screen === 'levels' || screen === 'options') return { screen };
    if (screen === 'level') {
      const n = Number(arg);
      if (Number.isInteger(n) && n >= 1 && n <= levelCount) return { screen: 'game', level: n - 1 };
      return { screen: 'levels', redirect: '#/levels' };
    }
    return { screen: 'menu', redirect: '#/menu' };
  }
  const levelHash = (index) => `#/level/${index + 1}`;

  // ---------- Progress ----------
  // Next level after beating `index`, or null when the run ends there.
  function nextLevelAfter(levels, index) {
    const next = levels[index + 1];
    if (!next || next.practice || levels[index].practice) return null;
    return index + 1;
  }

  // Best times are keyed by level name so inserting or reordering levels keeps them right.
  // First campaign level without a best time (null when all are beaten).
  function firstUnbeaten(levels, best) {
    for (let i = 0; i < levels.length; i++) {
      if (!levels[i].practice && best[levels[i].name] == null) return i;
    }
    return null;
  }

  function recordBest(best, name, time) {
    const out = Object.assign({}, best);
    const t = Math.round(time * 100) / 100;
    if (out[name] == null || t < out[name]) out[name] = t;
    return out;
  }

  // Most coins collected in one finished run, keyed by level name
  function recordCoins(best, name, coins) {
    const out = Object.assign({}, best);
    if (out[name] == null || coins > out[name]) out[name] = coins;
    return out;
  }

  // ---------- Settings ----------
  const DEFAULT_SETTINGS = Object.freeze({
    volume: 0.6, muted: false, screenShake: true, aimLine: false,
    headingMarker: true,     // small cursor showing where the current thrust is carrying you
    startFullscreen: false,  // desktop (NW.js) build only
    playerSkin: 'classic',   // 'classic' (drawn) or 'pixel' (sprite sheet art)
    bloodEffects: true,      // blood bursts when killed by saws/crushers (off: plain debris)
    laserSight: true,        // red sight line from the pistol while you have bullets
  });
  const PLAYER_SKINS = ['classic', 'pixel'];
  const BOOLEAN_SETTINGS = ['muted', 'screenShake', 'aimLine', 'headingMarker', 'startFullscreen', 'bloodEffects', 'laserSight'];

  function sanitizeSettings(raw) {
    const s = Object.assign({}, DEFAULT_SETTINGS);
    if (!raw || typeof raw !== 'object') return s;
    if (typeof raw.volume === 'number' && Number.isFinite(raw.volume)) s.volume = Math.min(1, Math.max(0, raw.volume));
    for (const k of BOOLEAN_SETTINGS) if (typeof raw[k] === 'boolean') s[k] = raw[k];
    if (PLAYER_SKINS.includes(raw.playerSkin)) s.playerSkin = raw.playerSkin;
    return s;
  }

  return {
    TILE, VERSION, STAGE, DEFAULT_TUNING, PLAYER_SKINS,
    parseLevel, createWorld, tileAt, isSolid, isPad, isCheckpoint, isBlock,
    circleHitsSolid, circleHitsBlock, hitsMover, lineOfSight, bounceOffRock, resolvePads,
    updateEnemies, resetActors, snapshotActors, restoreActors, fire, updateBullets,
    moverPosition, updateMovers, hitsMover, checkPushers,
    createPlayer, thrustDirection, tryThrust, updateStamina, refillOnLanding, stepPlayer,
    parseRoute, levelHash,
    nextLevelAfter, firstUnbeaten, recordBest, recordCoins,
    DEFAULT_SETTINGS, sanitizeSettings,
  };
});
