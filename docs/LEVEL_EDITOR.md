# Level editor (experimental)

Make new levels and edit existing ones on the map, play-test them in one key, and save them into the
game.

```bash
npm start            # then open http://localhost:8123/#/editor  (or Menu → Level Editor)
```

The editor needs somewhere to save, so it only appears when the game runs from `npm start` (the dev
server writes the file) or from the desktop build (it writes the file itself). On GitHub Pages and
other static hosts, the Level Editor button is hidden and `#/editor` goes to the menu. Levels you
saved still ship to those hosts, because they live in a normal source file.

## Using it

| Do this | How |
| --- | --- |
| Paint tiles | Pick Rock / Pad / Checkpoint / Air on the left (keys `1`-`3`), left-drag on the map |
| Erase | Right click (a tile becomes air; an object is removed) |
| Rectangle | `R`, or Shift+drag with the brush |
| Fill an area | `F`, then click |
| Start / goal | `4` / `5`, click (there's only one of each: placing moves it) |
| Place objects | Saw `6`, Drone `7`, Coin `8`, Fuel `9`, Pistol `0`, and more in the palette; click to place, drag while placing to adjust |
| Edit an object | Click it (Ctrl+click works with any tool); drag to move; drag its dots for path points, orbit radius or push direction; exact numbers in the right panel |
| Snapping | Objects snap to half tiles; hold Alt for fine placement |
| Pan / zoom | Space+drag or middle drag; mouse wheel zooms at the cursor; `H` fits the level |
| Undo / redo | Ctrl+Z / Ctrl+Y (everything, including resizes) |
| Play-test | `P` from the start, Shift+`P` from the cursor; Esc comes back exactly where you were |
| Preview motion | `M` animates saws and crushers |
| Save | Ctrl+S |
| Resize | Level panel: ＋/− per side (Shift: 5 at a time); objects move along when you add on the top or left |
| Coins | "Auto coins" applies the built-in rule (one above each pad + a few challenge coins) |

The **Checks** panel re-runs on every change, using the same rules as the level tests
(`Core.validateLevel`). Click an entry to jump to it; it's also circled on the map.

- **Errors** make a level unplayable: no start or goal, a start not on a pad, a goal walled off, an
  open map edge (the edge is locked to rock anyway). You can still save; the level is kept as a
  **draft** that the game ignores until it's fixed.
- **Warnings** are unfair spots: a drone that sees the start or a checkpoint, a saw through rock or
  over the start, items stuck in rock, a low ceiling over the start.

Nothing gets lost:
- every change is also kept as a draft in the browser, and reopening the level offers to restore it;
- leaving with unsaved changes asks first;
- each save keeps the previous file as `src/levels-custom.prev.js` (git-ignored).

## Where levels go

Everything the editor saves is in **`src/levels-custom.js`** (format in `src/custom-io.js`):

```js
{ overrides: { 'First Flight': def, ... },   // edited built-in levels, replacing the original by name
  levels: [def, ...] }                        // new levels: the "Custom" act in level select
```

A `def` has the same shape as in `src/levels.js`: map rows plus object lists, all in tile units.
Saved defs carry `editor: true`, so their coins are exactly the ones placed in the editor, and
`draft: true` while they have errors.

- **Built-in levels** keep their name, because the campaign refers to them by name. Saving one that's
  identical to the original removes the override. "Revert" in the level list throws your edits away.
- **Edited built-in levels** must still pass `npm test`, which runs the full level checks.
- **Custom levels** only need to be free of errors. They're practice levels: they don't affect
  campaign progress.
- **Committing** `src/levels-custom.js` publishes your levels everywhere: the GitHub Pages build and
  desktop packages.

## How it fits together

- `src/editor.js` holds the editor screen: DOM panels and a Canvas 2D map with its own simple
  drawing, so it never touches the game renderer. It is created on first visit to `#/editor`.
- `scripts/dev-server.js` (`npm start`) serves the game and has two endpoints:
  - `GET /api/editor` answers `{ ok: true }`;
  - `POST /api/levels` checks the data, then writes the file atomically.

  It listens on 127.0.0.1 only and refuses posts from other origins.
- Play-test: `#/editor/test` loads the editor's level into the normal game (`state.editorTest`).
  Winning or Esc goes back to the editor. Nothing is recorded.
- `src/levels.js` merges `CUSTOM_LEVELS` after the built-in levels are assembled. It also exposes
  `LEVELS.builtin` (the originals, for Revert), `LEVELS.customData` and `LEVELS.autoCoins` for the
  editor.

## Research: what makes a level editor easy to use

Notes from looking at Super Mario Maker, LDtk, Tiled, community editors and editor devlogs. Each
idea led to a design decision here:

- **Create and play in one motion.** Super Mario Maker's best-loved feature is switching between
  building and playing instantly, and coming back to the same spot.
  → `P` / Shift+`P`, and Esc returns with undo history intact.
- **Direct manipulation, one-to-one.** Mario Maker reviewers praise dragging pieces from a palette
  straight onto the level, with no forms needed.
  → click to place, drag to move, drag handles for paths, radius and direction. Forms are only for
  exact values.
- **Behaviour you can infer.** Mario Maker uses no tutorials: things work the way the game already
  works.
  → objects look like their in-game versions, hover shows a placement preview, and the bottom bar
  always says what the mouse does.
- **Undo for everything, and no empty steps.** "Add undo/redo ASAP" is the top request in editor
  devlogs, and no-op actions shouldn't create undo steps. Some editors lose history on play-test.
  → every change is undoable (including resizes), no-ops are skipped, and history survives
  play-testing.
- **Never lose work.** Devlogs add unsaved-changes warnings after users lose levels.
  → browser drafts, a leave warning, atomic writes and a `.prev` backup.
- **Safety vs expressivity.** A level format should be a finite set of constructs, not code
  (UW PLSE's notes on level editors), with the editor as a structured view of it.
  → the editor edits the same declarative `def` the game uses. The server validates it before
  writing; nothing executes.
- **Clean UI that automates the tedious parts.** LDtk is built around this.
  → snapping, line-interpolated painting, fill and rectangle, "Auto coins", and a locked rock border.
- **Shortcuts for power users, discoverable for everyone.** Mario Maker uses modifier buttons for
  copy, erase and multi-select.
  → every palette item and tool shows its key, and `?` lists them all.
- **Validate as you go.** Readability guides say a player should understand a level's goal in
  seconds, and playtesting beats guessing.
  → live checks with jump-to, plus one-key play-testing.

Sources:
- [UW PLSE: level editors](https://uwplse.org/2025/11/18/level-editors.html)
- [LDtk](https://ldtk.io/)
- [LDtk 0.9 devlog](https://deepnight.itch.io/ldtk/devlog/243249/090-biomes-tags)
- [Super Mario Maker review (vooks)](https://vooks.net/super-mario-maker-review)
- [Delightful design in Super Mario Maker (PopMatters)](https://popmatters.com/delightful-design-in-super-mario-maker-2495458717.html)
- [Nintendo Life first impressions](https://www.nintendolife.com/news/2014/06/first_impressions_getting_creative_with_mario_maker)
- [The True Slime King editor changelog](https://josh-penn-pierson.itch.io/the-true-slime-king/devlog/206729/changelog-v133-level-editor-improvements)
- [Project Interim editor patch notes](https://kraftas.itch.io/project-interim-level-editor/devlog/973441/major-patch-030-patch-notes)
- [itch.io undo/redo request](https://itch.io/post/15213662)
- [2D platformer level design](https://gravedangergame.com/2d-platformer-level-design/)
