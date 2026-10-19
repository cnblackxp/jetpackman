# Jetpack Man

Mouse-controlled jetpack platformer built with PixiJS. Your feet always point at the mouse:
left click thrusts away from it, right click toward it. Land only on green pads.

**▶ Play in your browser: https://cnblackxp.github.io/jetpackman/**

**Windows desktop version:** download the zip from [Releases](https://github.com/cnblackxp/jetpackman/releases/latest).

Docs for development: [`docs/`](docs/) · Development diary: [`devlog/`](devlog/)

## Setup

```bash
npm install          # also copies PixiJS into vendor/ so the game works offline
```

## Commands

| Command | What it does |
| --- | --- |
| `npm start` | Serves the game at http://localhost:8123 (needs Python) |
| `npm test` | Unit tests for game rules + checks on every level |
| `npm run desktop` | Runs the game in NW.js from source (downloads NW.js on first run) |
| `npm run package` | Builds the Windows desktop version and zips it |
| `npm run test:desktop` | Launches the newest packaged build and checks it loads a level |
| `npm run shot -- <n> <file.png>` | Renders level n to a PNG (for the devlog) |

## Distributing the desktop version

```bash
npm run package
```

Produces:

- `dist/JetpackMan-<version>-win-x64-<date>_<time>/` – the runnable folder (`JetpackMan.exe` + NW.js runtime)
- `dist/JetpackMan-<version>-win-x64-<date>_<time>.zip` – the same folder zipped, ready to share

Each build is stamped with the date and time it was made. Older builds keep their zip; their
unzipped folder (a ~450 MB duplicate) is deleted automatically.

### Releases

Pushing a version tag builds the desktop zip on GitHub and attaches it to a release
(`.github/workflows/release.yml`; tests run first):

```bash
git tag v0.0.2
```

```bash
git push origin v0.0.2
```

The game is in **alpha** (version `0.0.1`, shown in game). Keep `version` in `package.json` and
`VERSION` in `src/core.js` equal; a test checks they match.

The browser version on GitHub Pages updates on every push to `main`.

Players unzip it and run `JetpackMan.exe`. The NW.js runtime is downloaded once from
dl.nwjs.io, checked against the official SHA-256 checksums, and cached in `.cache/nwjs/`.

Options: `npm run package -- --arch=ia32` (32-bit), `--nw=<version>` (other NW.js version,
default in `package.json` → `nwjs.version`), `--all-locales` (keep every Chromium UI language).

Desktop-only extras: the window opens normal-sized and can be resized, minimized and
maximized; Options has **Fullscreen** and **Start in fullscreen**; F11 toggles fullscreen;
the menu has **Quit**.

## Project layout

- `src/core.js` – game rules (physics, stamina, collisions, routing, settings); no PIXI, unit tested
- `src/levels.js` – level data (map format documented at the top)
- `src/audio.js` – synthesized sound effects
- `src/game.js` – rendering, input, menus
- `assets/sprites/` – pixel-art character: the original sheet plus frames cut by
  `python scripts/extract-sprites.py assets/sprites/jetpackman-sheet.png`
- `tests/` – `node --test` suites
- `scripts/` – vendoring, NW.js download/packaging, desktop smoke test, level screenshots
- `devlog/` – level sketches next to how they turned out in game
