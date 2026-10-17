# TODO

## Playtest the 20-level campaign (user)

The campaign was rebuilt as a 20-level sawtooth difficulty curve (see `src/levels.js` → `CAMPAIGN`
and `docs/LEVEL_DESIGN.md`). It has **not been playtested**. Note any level that feels:

- impossible or unfair (especially **Summit**, see below)
- easier than the level before it (suspects: Orbit Garden, Freefall, Clockwork)
- out of place in the curve

## Playtest acts 5-8 (levels 21-40, user)

Drones, the gold shield and 20 new levels were added. Watch for: drones that feel unfair (too fast,
too far-reaching), shields placed too late, and whether Spiral / Storm / Final Ascent are beatable.
Drone defaults live in `DEFAULT_TUNING` (`enemyRange`, `enemyWindup`, `enemySpeed`, `enemyDash`,
`enemyRecharge`).

## Level solver (own task, paused)

An automatic solver exists but is paused because full runs are slow (~3.5 min for all levels)
and expensive to iterate on.

- `scripts/solver.js`: best-first search over thrust/wait decisions every 0.2 s using the real
  `src/core.js` physics; `measure()` (closest shaves) and `slack()` (largest extra player radius
  the level is still beatable with: 48 = wide open, 0 = needs a tight line).
- `scripts/solve-levels.js`: prints a per-level table (`node scripts/solve-levels.js [n ...] [--json]`).

Last full run (before any retuning):

| # | Level | Thrusts | Time | Search | Slack |
| --- | --- | --- | --- | --- | --- |
| 1 | Tutorial | 11 | 4.7 | 26 | 40 |
| 2 | First Flight | 6 | 1.8 | 22 | 32 |
| 3 | Hop Scotch | 9 | 2.8 | 16 | 48 |
| 4 | The Shaft | 7 | 3.0 | 15 | 48 |
| 5 | Long Haul | 11 | 4.3 | 26 | 48 |
| 6 | Updraft | 13 | 3.5 | 10335 | 32 |
| 7 | Bounce House | 10 | 5.0 | 62 | 48 |
| 8 | The Ridge | 8 | 4.5 | 213 | 40 |
| 9 | Headwind | 11 | 4.1 | 174 | 48 |
| 10 | Slingshot Canyon | 17 | 5.3 | 108 | 40 |
| 11 | Serpent Cave | 10 | 4.1 | 36 | 48 |
| 12 | Sawmill | 12 | 3.9 | 58 | 48 |
| 13 | Orbit Garden | 12 | 3.5 | 29 | 48 |
| 14 | Crusher Hall | 12 | 5.9 | 547 | 40 |
| 15 | Crosswinds | 14 | 6.4 | 619 | 40 |
| 16 | Starlight Drift | 17 | 7.6 | 57 | 48 |
| 17 | The Needle | 20 | 7.2 | 2869 | 24 |
| 18 | Freefall | 16 | 5.3 | 59 | 48 |
| 19 | Clockwork | 13 | 6.0 | 32 | 48 |
| 20 | Summit | **not solved** (150k states) | | | |
| ★ | Test Ground | 16 | 8.9 | 793 | 40 |

Next steps for this task:

- [ ] Make it fast: check slack only on changed levels, cap failing searches lower, or cache results.
- [ ] Find out whether Summit is truly unbeatable or just too deep for the search; fix the layout.
- [ ] Combine the metrics into one difficulty score and retune late levels so the curve rises.
- [ ] Add `"solve"` npm script + a test that runs it on changed levels only (once fast enough).
- [ ] Optional: draw the solver's route on `npm run shot` screenshots for the devlog.

## Other ideas

- Custom `.exe` icon (rcedit or similar)
- Pause menu
- Ghost replay of your best run
- Prune old build zips in `dist/` (keep newest N)

## Notes

- Summit: the solver showed a ~20-tile climb with no pad on the left route; rest ledges were added
  (on the shelf at row 27, at (14,20) and at (16,11)). Not re-verified by the solver: playtest it first.
