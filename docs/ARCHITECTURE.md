# Architecture

How Jetpack Man works internally. Read this before changing game code.

## Files

```text
index.html          screens (menu / level select / options) as HTML+CSS, script tags
src/core.js         game RULES: pure functions, no PIXI, no DOM          -> unit tested
src/levels.js       level DATA (+ buildMap helper)                         -> validated by tests
src/audio.js        synthesized sound effects (WebAudio), window.Sfx
src/game.js         rendering (PIXI), input, camera, HUD, screens, routing, settings, smoke test
vendor/pixi.min.js  PixiJS 7.4.2, copied from node_modules by `npm install` (git-ignored)
tests/              node --test suites
scripts/            build tooling (vendoring, NW.js packaging, smoke test, screenshots)
```

No bundler and no modules: every file is a classic `<script>` loaded in order:
`pixi → core → levels → audio → game`. `core.js` and `levels.js` use a UMD wrapper so they're
`window.JetpackCore` / `window.LEVELS` in the browser and `require()`-able in Node.

**Rule of thumb:** anything that decides *what happens* goes in `core.js` (and gets a test);
anything that decides *how it looks or sounds* goes in `game.js` / `audio.js`.

## Units and coordinates

- 1 tile = **40 px** (`Core.TILE`). Level files use **tile units**; `createWorld` converts to px.
- Screen y grows downward. Angles: 0° = right, 90° = down, -90° = up.
- Velocities are px/s, accelerations px/s², times in seconds.

## Core data

```js
world = Core.createWorld(LEVELS[i])
// {
//   level:   { name, practice, map[], cols, rows, start{x,y,col,row}, goal{x,y}, checkpoints[] },
//   clock:   seconds; drives movers (keeps running through deaths)
//   pushers: [{ x, y, r, angle(rad), power, touching }],
//   movers:  [{ shape:'saw'|'block', x, y, r, w, h, speed, phase, path[]|orbit{} }],
//   signs:   [{ x, y, text }],
// }

player = Core.createPlayer(world.level, cfg, spawn?)   // spawn = checkpoint { x, y }
// { x, y, vx, vy, launched, grounded, cooldown, stamina, exhausted, regenDelay, heading }
```

- `launched`: has thrust at least once (starts the level timer; the goal only counts after it).
- `grounded`: standing on a pad, so no gravity is applied. Players start grounded on the start pad.
- `exhausted`: stamina hit 0; no thrusting until the bar is full again.
- `heading`: unit vector of the last thrust/pusher while its push lasts (drives the heading marker).

## Tuning

All feel numbers live in `Core.DEFAULT_TUNING` (`src/core.js`). Current values:

| Key | Value | Meaning |
| --- | --- | --- |
| gravity | 520 | px/s² |
| thrust | 340 | velocity added per thrust |
| opposingKeep | 0.4 | share of velocity *against* the thrust that survives a thrust |
| maxSpeed / maxFall | 720 / 420 | speed caps |
| airDrag | 0.35 | fraction of velocity lost per second |
| clickCooldown | 0.1 | s between thrusts |
| radius / standOffset | 13 / 22 | collision circle; centre height when standing |
| staminaMax / thrustCost | 100 / 25 | 4 thrusts per bar |
| staminaRegen / regenDelay | 32 / 0.3 | refill rate; pause after a thrust |
| exhaustedRegenMultiplier | 1.5 | faster refill while locked out |
| goalRadius | 44 | px: win radius (the flag's outer glow; the ring is drawn at 28) |
| pusherRadius / pusherPower | 0.8 tiles / 480 | pusher defaults |
| substeps | 4 | physics substeps per frame (anti-tunnelling) |
| hoverDrag / hoverSinkSpeed / hoverDrain | 6 / 30 / 3 | hover settle rate; sink px/s; stamina per s |
| enemyRadius / Range / Windup / Speed / Dash / Recharge | 16 px / 6 tiles / 0.45 s / 380 / 6 tiles / 1.6 s | drone defaults |
| shieldPickupRadius / shieldInvuln | 18 px / 0.5 s | shield |
| bounceRestitution / bounceMinSpeed | 0.8 / 220 | shield bounce |

The user tunes by feel: change values **in small steps** and report before → after.

## Frame loop (`game.js`, `app.ticker`)

```text
dt = min(frame time, 1/30)
Core.updateMovers(world, clock + dt)        (also behind menus, as a live backdrop)
if playing:
  Core.updateStamina(p, dt)                 -> 'refilled' plays a ding
  events = Core.stepPlayer(world, p, dt)    -> handleEvents(): sounds, particles, die(), win()
draw: movers, pushers, goal, particles, stamina bar, heading marker, aim line, camera, HUD
```

`Core.stepPlayer` (per substep): pushers → gravity → drag → speed caps → move → **rock check**
(dead) → **pad resolve** (landed / blocked) → **mover check** (dead) → **goal check** (won) →
clear the heading once the push is used up. Grounded players skip movement but are still checked
for movers and the goal.

## Rules (all in core.js)

- **Thrust** (`thrustDirection` + `tryThrust`): left click = away from the mouse, right click =
  toward it. Results: `thrust`, `cooldown`, `empty` (no stamina), `blocked` (pushing down into the
  pad you stand on; free). A thrust first cancels 60% of any velocity opposing it, then adds
  `thrust`, then caps speed.
- **Stamina** (`tryThrust`, `updateStamina`, `refillOnLanding`): any stamina > 0 allows a thrust, which
  always costs 25; reaching 0 locks thrusting until full (refill ×1.5 while locked). Landing on a
  pad refills instantly.
- **Hover** (`p.hovering`, set by game.js while the middle mouse button is held and the player is
  airborne): gravity is replaced by a gentle sink (velocity eases to `hoverSinkSpeed` = 30 px/s down,
  sideways motion dies out, rate `hoverDrag`). Stamina never refills while hovering and drains at
  `hoverDrain` (3/s); at 0 the usual lockout starts but hovering keeps working.
- **Fuel cell** (`p.fuel`, picked up in `touchActors`): `fuelDuration` (15 s) of free thrusts;
  `updateStamina` keeps stamina full and returns `'fuelOut'` when it ends.
- **Pistol** (`p.ammo`, picked up in `touchActors` only while `ammo < gunAmmo`, so pickups never
  stack past 3): game.js fires on a mouse-wheel gesture (latched until 220 ms without wheel events,
  so one scroll = one shot) via `fire(world, p, dir)`, `dir` = where the head points (away from the
  mouse). `updateBullets` moves bullets, stops them at rock/pads (`bulletHit`) and kills drones
  (`enemyKilled`, `byBullet`). Ammo is part of checkpoint snapshots.
- **Drones** (`updateEnemies`, called by game.js before `stepPlayer`): `idle` → (player within
  `range` and `lineOfSight`) → `windup` (0.45 s, keeps aiming; events `enemyWindup`) → `dash` (moves
  `dash` tiles at `speed`, stops early at rock/pads; `enemyDash`) → `recharge` (`recharge` s) → `idle`.
  `resetActors(world)` restores drones and shield pickups on every (re)spawn.
- **Shield** (`p.shield` is a count: shields stack, each save uses one; picked up in `touchActors`): touching any drone destroys it
  (`enemyKilled`); if it was mid-dash the shield also breaks in the trade (`shieldLost`); touching rock
  (`bounceOffRock`: push out, reflect at 0.8, at least 220 px/s outward) or a saw/crusher (knocked
  away) uses it up (`bounce`). Every save grants `shieldInvuln` (0.5 s) of safety. Without a shield,
  touching any drone kills.
- **Rock** (`circleHitsSolid`): circle vs. tile grid, closest-point test. Outside the map counts as rock.
- **Pads** (`resolvePads`): contact normal pointing up (`uy < -0.7`) while falling = land and snap to
  `top - standOffset`; otherwise push the circle out and remove the velocity into the pad.
  `C` tiles are pads too; landing on one makes the `landed` event carry `checkpoint: { x, y }`.
  game.js stores it in `state.checkpoint`; `resetPlayer()` respawns there (timer keeps running),
  `resetPlayer(true)` (R key) restarts from the start.
- **Pushers** (`checkPushers`): on *entering* (edge-triggered via `touching`), velocity =
  direction × power.
- **Movers** (`moverPosition`, `hitsMover`): path movers ping-pong by distance along the polyline;
  orbit movers rotate at deg/s. Saws hit at `0.85 × r + radius`, blocks with rect-vs-circle.
- **Routing** (`parseRoute`), **progress** (`nextLevelAfter`, `firstUnbeaten`, `recordBest`),
  **settings** (`sanitizeSettings`): pure helpers used by game.js.

## Rendering (`game.js`)

Stage order: `starLayer` (parallax 0.3) → `world` → `hud` → `reticle`.
`world` children: `signLayer, pusherG, terrainG, goalG, moverLayer, aimG, player, fxG, headingG, staminaG`.

- Terrain is drawn once per level into one `Graphics` (rock with speckles and lit edges; pads
  green with a bright top).
- Pushers, goal, particles, stamina bar and heading marker are redrawn every frame.
- The player is a `Container` drawn feet-down; `rotation = atan2(mouse - player) - π/2`.
- The stamina bar and heading marker are separate from the player so they never rotate.
- The camera lerps toward the player, clamps to the level, centres small levels and adds screen
  shake on death (if enabled). In `photoMode` (screenshots) it scales the whole level to fit.

## Screens and URL routing

HTML `<section class="screen">` overlays for `menu`, `levels`, `options`; the game screen is
just the canvas. `route()` reads `location.hash` via `Core.parseRoute` and calls `showScreen`.
Navigation always goes through `navigate(hash)` so history works. A level loads on every
`#/level/<n>` route. Menus show level 1 as a live backdrop.

## Deaths, checkpoints and pause

- **Death screen:** `die(cause)` sets `mode = 'dead'`; a "YOU DIED"-style overlay (`deathLayer`: dark
  band, red CRASHED, then "click to restart") fades in over `DEATH_FADE` (1.1 s). A click after that
  calls `resetPlayer()`; `R` restarts the whole level any time. There is no automatic respawn.
- **Checkpoint saves:** landing on a checkpoint pad stores `Core.snapshotActors(world, p)` (which drones
  are destroyed, shields/coins taken, whether you carry a shield). Dying with a checkpoint calls
  `Core.restoreActors` + restores the shield; dying without one calls `Core.resetActors` (everything back).
- **Pause:** `Esc` during play sets `state.paused` and opens the menu over the frozen level (no movers,
  drones or timer). The menu shows **Resume**; returning to `#/level/<same>` resumes, while clicking any
  other level link (`state.forceRestart`) starts fresh.

## Coins and effects

- **Coins** (`world.coins`, collected in `touchActors` → `coin` event). `autoCoins` (levels.js) floats one
  coin ~2 tiles above the middle of each pad (not the start pad or next to the goal) and adds 2-3
  challenge coins in open air 3.5-7 tiles from any pad and far from the goal, clear of rock (1.2 tiles,
  3 tiles of air below), saws, crushers and drones. Levels can add more by hand. A respawn at a checkpoint keeps
  collected coins (`resetActors(world, true)`); a full restart resets them. The HUD shows `◆ got/total`;
  the most coins of a finished run per level are saved in `jetpackman.coins.v1` (`recordCoins`).
- **Deaths carry a cause** (`'rock' | 'saw' | 'crusher' | 'enemy'`); `die(cause)` in game.js picks the
  effect and sound: blood burst + splatter that fades over ~6 s (saw), a flattened splat (crusher),
  electric sparks (drone), rubble and dust (rock). `settings.bloodEffects` off → plain debris.
- **Feel (no gameplay numbers changed):** green ripples + motes on landing, squash on landing and stretch on
  thrust (`squash`, eases back), camera leads slightly toward the velocity (`state.look`), faint
  streaks above 420 px/s, 0.35 s / 0.5 s of slow motion (×0.3) after a death / win, confetti on win.
- **Stars:** three `TilingSprite` fields (parallax 0.1 / 0.25 / 0.45) that also drift slowly
  (2.5 / 5 / 9 px/s); the nearest twinkles gently.

## Character art

`player` is a container holding two looks: `classicArt` (the drawn figure) and `pixelArt` (a sprite
using `assets/sprites/jetpackman-fly-0..3.png`, 57×92 frames drawn at half size, mirrored to face +x).
`settings.playerSkin` ('classic' | 'pixel', Options → Character art) picks one via `applySkin()`;
`animatePixelArt()` cycles the 4 stride frames at 8 fps while airborne and moving.
Frames come from the sheet via `scripts/extract-sprites.py` (flood-fill background removal,
shared crop box, Lanczos resize). The packager ships `assets/`.

## Version

`Core.VERSION` ('0.0.1') + `Core.STAGE` ('alpha') are shown in the menu (bottom right) and the
in-game HUD (top right). Must equal `package.json` → `version` (tested).

## Persistence (`localStorage`, all wrapped in try/catch)

| Key | Content |
| --- | --- |
| `jetpackman.settings` | `{ volume, muted, screenShake, aimLine, headingMarker, startFullscreen, playerSkin }` |
| `jetpackman.best.v2` | `{ [levelName]: bestSeconds }`; keyed by **name** so reordering levels is safe |

## Audio (`audio.js`)

`window.Sfx` synthesizes everything with oscillators and filtered noise. Master gain =
`volume × 0.35` → compressor → speakers. The context is created/resumed on the first user
gesture (`Sfx.unlock`). Effects: `thrust(toward)`, `empty`, `refilled`, `refill`, `pusher`, `land`,
`death`, `win`, `uiHover`, `uiClick`.

## Desktop (NW.js)

- Detected with `typeof nw !== 'undefined'` → `body.desktop` shows `.desktop-only` options
  (Start in fullscreen, Quit).
- `setFullscreen()` uses `nw.Window` in NW.js, the Fullscreen API in browsers. F11 toggles.
- Window settings come from `package.json` → `window` (1280×800, min 800×560, resizable).
- **Smoke test hook:** `--smoke-test=<file> [--smoke-level=<n|menu|levels|options>]` opens that
  screen, writes `<file>.json` (report) + `<file>.png` (via `nw.Window.capturePage`, because PIXI's
  `extract` mangles semi-transparent lines), then quits. The tool forces a render before capturing
  because background windows skip frames.

## Debugging

`window.__jetpack = { state, Core, CFG, loadLevel, resetPlayer, mouse }` in the browser console.
Note: when the browser tab is hidden, `requestAnimationFrame` is throttled and the game barely
ticks. Simulate with `Core` functions in Node instead.
