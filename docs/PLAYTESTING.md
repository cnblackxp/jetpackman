# Playtesting

How to actually play a level from the agent side, and what playing taught us. Read this before
designing or tuning levels: tests and the solver prove a level *can* be beaten; only playing shows
whether a human-style approach works.

## Why not just click in the browser pane?

The Claude browser pane throttles a page that isn't focused: in one test ~3 s of real time advanced
the game by only 0.1 s, so real-time clicking is meaningless there. Instead, drive the **real game**
(its click handler, camera, rules, effects) with synthetic input and step time yourself.

## The playtest bot

Serve the game (`npm start` or the `jetpackman` preview), open `#/level/<n>`, then run this in the
page (it uses the debug hook `window.__jetpack`):

```js
const J = __jetpack, s = J.state, app = J.app;
app.ticker.stop();                       // we step time ourselves
let now = performance.now() + 1e5;
window.bot = {
  // advance the game in exact 1/60 s frames; stops at the moment you die or win
  tick(sec) { const n = Math.round(sec * 60), was = s.mode;
    for (let i = 0; i < n; i++) { now += 1000 / 60; app.ticker.update(now); if (was === 'play' && s.mode !== 'play') break; }
    return bot.info(); },
  // mouse at (dx, dy) world px from the player, then click: button 0 = left, 2 = right
  click(dx, dy, button = 0) { const p = s.p, gx = p.x + dx + J.world.position.x, gy = p.y + dy + J.world.position.y;
    J.mouse.x = gx; J.mouse.y = gy; app.stage.emit('pointermove', { global: { x: gx, y: gy } });
    app.stage.emit('pointerdown', { global: { x: gx, y: gy }, button }); return bot.info(); },
  info() { const p = s.p; return { mode: s.mode, tile: [+(p.x / 40).toFixed(1), +(p.y / 40).toFixed(1)],
    v: [Math.round(p.vx), Math.round(p.vy)], grounded: p.grounded, stamina: Math.round(p.stamina), coins: s.coins }; },
  land(max = 25) { let r; for (let i = 0; i < max; i++) { r = bot.tick(0.2); if (r.grounded || r.mode !== 'play') break; }
    bot.tick(0.3); return r; },
};
```

Remember **left click thrusts away from the mouse**, so `bot.click(-40, 70)` (mouse below-left)
sends you up-right. After a death, `bot.tick(1.3)` (let CRASHED finish) then `bot.click(0, 70)`.

## Human-like playtest (many runs, mouse imprecision)

The bot above has perfect aim and frame-exact timing; players with a mouse don't. For that, use

```bash
node scripts/human-playtest.js Sawmill 400
```

It plays a level hundreds of times like a person: aim off by up to ±10°, clicks ±0.1 s off, 0.25 s
reaction time, waits on pads until the hazards ahead look clear (and are moving away), launches
up-right, then steers every 0.3-0.4 s (flatter near a ceiling), misjudging its landing by ±1 tile.
It reports success per crossing and **where** deaths happen. Add a route for a level in `ROUTES`.

Treat the numbers as a pessimistic floor (it never hovers or lines up carefully), but low
per-crossing rates and clustered death spots point straight at unfair geometry.

**Sawmill, measured this way:** 3-wide pads with 9-tile gaps landed only ~75% of hops even
*without* saws; twin saws per lane left almost no window; a pad one row higher hit the low ceiling.
After the fixes (6-wide pads, 4-tile gaps, one slower saw per lane at r 0.45, a 9-row corridor, a
mid checkpoint) crossings went from 37% / 2% to 67-98%.

## A winning Tutorial run (22.2 s, 4/6 coins)

| Step | Input | Result |
| --- | --- | --- |
| Over the low wall to pad 2 | `click(-40,70)`, `tick(0.2)`, `click(-40,70)`, `land()` | peak row ~5, lands ~11 tiles right |
| Coin above a pad | one small hop, e.g. `click(-15,70)` | +1 coin, lands back on the pad |
| Up to the raised pad (+3 rows) | same two steep thrusts | |
| Long glide down to pad 4 (14 tiles) | `click(-70,25)`, `tick(0.25)`, `click(-70,25)` | flat pushes give a lot of speed |
| Pusher over the wall | `click(-35,70)` into the ring | carried over on its own (after the fix) |
| Saw + gap to the goal | wait until the saw is low, then two steep thrusts | flies over the saw, wins |

## What playing taught us (use when designing)

- **Thrusts:** one adds ~340 px/s; gravity eats it in ~0.65 s. A lone thrust lifts ~2.8 tiles.
  Two steep thrusts 0.2 s apart (the 0.1 s cooldown swallows faster clicks) carry you ~11 tiles
  across and ~5 up. Flat thrusts are fast but **sink**: always aim a little upward when crossing.
- **Pushers are small targets.** You must commit your height before reaching them. Give the
  approach room, and make sure the push *alone* clears what it's meant to clear, with ≥1 tile
  margin from walls *and* the ceiling (the Tutorial's 3-tile slot was far too tight).
- **Gaps over deadly floor** need the far pad reachable with a 2-thrust arc; a single shallow thrust
  falls short of a 4-tile gap.
- **Timing hazards:** waiting on a pad is free (stamina refills), so players will watch a saw and go.
  Make sure there's a safe pad within view of each timed hazard.
- **Respawn fairness:** no drone may see a checkpoint (now tested), long levels need checkpoints
  (Tutorial got one halfway), and climbs need a ledge every ~5 rows: one stamina bar is ~7 tiles of
  height and stamina never refills in the air.
- **Floating coins** one hop above a pad are collected with a tiny hop: the right height.
