# Jetpack Man

Mouse-controlled jetpack platformer: PixiJS 7, plain JS (no bundler), NW.js desktop build.
The player's feet point at the mouse; left click thrusts away from it, right click toward it;
touching rock kills, green pads are safe.

## Read first

- `docs/ARCHITECTURE.md`: how the code works (core vs. game, frame loop, rules, rendering, routing)
- `docs/LEVEL_DESIGN.md`: map format, objects, reach numbers, design guidelines, sketch legend
- `docs/WORKFLOW.md`: commands, the user's standing rules, devlog procedure, packaging

## Key rules

- Game rules live in `src/core.js` (pure, no PIXI/DOM) and get tests; drawing/input in `src/game.js`.
- `npm test` after every change (it validates every level too).
- After a batch of changes, run `npm run package` **in the background** and keep going.
- Tune feel in small steps and state old → new values; the user prefers forgiving difficulty.
- Devlogs: Markdown in `devlog/`, readable, with `npm run shot` screenshots and technical discussion.
