# Level design

Levels live in `src/levels.js` as entries in `DEFS`. The **`CAMPAIGN`** list at the bottom of that
file sets the order (= level number) and is the difficulty curve; every level must appear in it once.

## Map format

One character per 40px tile:

| Char | Meaning |
| --- | --- |
| `#` | Rock: deadly to touch |
| `=` | Landing pad: safe; land on top, refills stamina; sides just block |
| `C` | Checkpoint pad: a pad that becomes the respawn point once landed on (flag turns yellow) |
| `S` | Player start: put a **pad directly below it** |
| `G` | Goal (several `G`s are averaged into one goal point) |
| `.` | Air |

Rows shorter than the longest are padded with rock. Outside the map counts as rock.

Write maps as string arrays, or use `buildMap` for big or regular layouts:

```js
map: buildMap(32, 17, (b) => {      // width, height; rock border included
  b.pad(3, 15, 4); b.set(4, 14, 'S'); // pad(col, row, width), set(col, row, char)
  b.rock(11, 14, 4, 2);               // rock(col, row, width, height)
  b.air(5, 3, 4, 2);                  // carve air back out (tunnels in solid rock)
  b.pillar(14, 10, 3);                // pad on a rock column down to the floor
  b.ledge(20, 6, 4);                  // pad on a 1-tile slab, floating
  b.ledge(26, 8, 4, 'C');             // pillar/ledge with 'C' = checkpoint version
  b.checkpoint(30, 12, 3);            // bare checkpoint pad
  b.set(20, 13, 'G');
}),
```

**Checkpoints:** after a death you respawn on the last checkpoint pad you landed on and the timer
keeps running; `R` restarts the whole level. Use them in long levels (from Act 2's peak on).

## Objects (tile units, fractions allowed)

```js
pushers: [{ x, y, angle, power, r }],
//  angle: degrees, 0 = right, 90 = down, 180 = left, -90 = up (any angle)
//  power: launch speed px/s (default 480; current levels use 360-520)
//  r: ring radius in tiles (default 0.8)

movers: [
  { shape: 'saw', r: 0.6, path: [[x1, y1], [x2, y2]], speed: 1.5 },        // tiles/s, ping-pong
  { shape: 'saw', r: 0.6, orbit: { x, y, radius: 2 }, speed: 90 },         // deg/s (negative = reverse)
  { shape: 'block', w: 1, h: 2, path: [[x, y1], [x, y2]], speed: 2 },
  { shape: 'saw', r: 0.7, path: [[x, y]] },                                // single point = static
],
// phase: optional start offset (tiles along the path, or degrees for orbits)

signs: [{ x, y, text: 'Line one\nLine two' }],   // in-world text (Tutorial)
enemies: [{ x, y, range, dash, speed, recharge }], // drones; only x, y required (defaults 6 tiles / 6 tiles / 380 / 1.6 s)
shields: [{ x, y }],                             // gold shield pickups
practice: true,                                  // not part of the campaign (Test Ground)
```

## Reach guide (current tuning)

| Move | Distance |
| --- | --- |
| One thrust straight up from rest | ~110 px ≈ **2.8 tiles** |
| Full bar (4 quick thrusts) upward | roughly 6-7 tiles |
| Pusher at power p, straight up | p² / 1040 px: 480 → 5.5 tiles, 520 → 6.5 tiles |
| Hovering | not sustainable: stamina refills ~1.3 thrusts/s, hovering needs ~1.5/s |

So pads are rest stops: plan one every couple of screens, and before any long climb.

## Design guidelines

The user prefers **forgiving** levels:

- Start on a pad with **at least 3-4 tiles of headroom** (a straight hop must not hit the ceiling;
  the tests check this).
- Gaps you must fly through: **3+ tiles** tall/wide. 2 tiles is very hard; the player is 26px wide.
- Put a pad before long climbs and near the goal when the approach is tricky.
- Saws: slow (1-1.5 tiles/s) unless the level is late; never near the start.
- Pushers that *hinder* (push you back) are fine in later levels; label them with a comment.
- Drones: never within range + sight of the start (tests check). Put a shield before the first drone
  of a section; drones *inside* openings force a choice (destroy it, or bait its dash and slip past).
- When a level is "too tough": widen gaps, add pads, slow or remove hazards before changing physics.

## Difficulty curve (research summary)

Sources: [difficulty curves](https://www.abratabia.com/game-design/difficulty-curves.php),
[Suzy Cube level breakdown](https://gamedeveloper.com/design/lessons-from-suzy-cube-level-design-breakdown),
[Nintendo's four steps](https://www.mcvuk.com/development/video-nintendos-level-design-secrets-in-four-steps),
[browser platformer curves](https://dev.to/gamh5games/designing-difficulty-curves-that-work-in-browser-platformer-games-id8).

- **Sawtooth, not a ramp.** Each peak higher than the last; an easier "breather" level after each peak.
- **Front-load easy.** About 30% of the difficulty range in the first 20% of levels (web players leave fast).
- **One new idea per act**, taught in a safe spot first (kishōtenketsu: introduce → develop → twist →
  conclude), then combine known ideas instead of adding more.
- **Levers:** gap width, pad spacing (= thrust budget between rests), hazard count/speed, timing
  windows, corridor height, pusher reliance (helpful → hostile), level length (+ checkpoints).
- **Rewards and rest:** pads as rest stops, checkpoints after hard sections, an easier last stretch.
- **Hidden spikes only show in playtests** → see `TODO.md` (playtest list, paused solver).

### Current campaign (src/levels.js `CAMPAIGN`)

| Act | Levels | Focus |
| --- | --- | --- |
| 1 Flight school | Tutorial, First Flight, Hop Scotch, The Shaft, **Long Haul** | thrust, pads, stamina budget |
| 2 Pushers | Updraft, Bounce House, The Ridge, Headwind, **Slingshot Canyon** | helpful → hostile pushers, first checkpoint |
| 3 Moving hazards | Serpent Cave, Sawmill, Orbit Garden, Crusher Hall, **Crosswinds** | saws on paths/orbits, crushers |
| 4 Mastery | Starlight Drift, The Needle, Freefall, Clockwork, **Summit** | precision, braking, timing, finale |
| 5 Drones | Watchers, Shield Up, Ricochet, Patrol Route, **Hunting Grounds** | teach drones, the shield, shield bounce |
| 6 Combinations | Calm Waters, Gauntlet Run, Shield Bearer, Pinball Panic, **The Nest** | drones with pushers, alcoves, gates |
| 7 Pressure | Long Night, Saw Hunters, Crusher Ambush, Downdraft, **Fortress** | drones with saws, crushers, descents |
| 8 Finale | Quiet Before, Spiral, Needle's Eye, Storm, **Final Ascent** | everything combined |

Bold = act peak. Each act opens with a breather. Test Ground stays as practice (★).

## Building a level from a sketch

The user draws levels in a paint program. Legend:

| In the drawing | In the game |
| --- | --- |
| White | Air |
| Black | Rock |
| Green line | Landing pad |
| Green flag | Goal |
| Blue arrow | Pusher in that direction |
| Red star | Saw (static unless motion is drawn) |
| Bottom-left pad (usually) | Start |

A 1280×720 drawing = **32×18 tiles** at 40px; divide pixel coordinates by 40. Keep the outer
row/column as rock. Fix anything unplayable (e.g. gaps under 3 tiles) and **say what you changed
and why**. Then add the devlog images (see `docs/WORKFLOW.md`).

## Checklist for a new or changed level

1. Add or edit the entry in `src/levels.js`, and put its name in `CAMPAIGN` where it fits the curve.
2. `npm test`: `tests/levels.test.js` checks every level for: equal row widths, valid
   characters, closed border, start on a pad and clear of rock, goal reachable (flood fill),
   pushers in open air, movers never in walls or near the start, and a safe hop from the start.
3. Look at it: `npm run shot -- <n> devlog/images/level-<n>-<slug>.png`.
4. Menu key hint (`1–N`) updates itself; level select builds itself from `LEVELS`.
5. Kick off `npm run package` in the background.
