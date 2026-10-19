# Workflow

How work on this project is done, including the user's standing preferences.

## Commands

```bash
npm install             # deps + copies PixiJS into vendor/
npm start               # http://localhost:8123 (scripts/dev-server.js); level editor at #/editor
npm test                # unit + level tests (node --test, no deps)
npm run desktop         # run from source in NW.js
npm run package         # Windows build -> dist/JetpackMan-<ver>-win-x64-<date>_<time>.zip
npm run test:desktop    # launch the newest build, check it loads a level
npm run shot -- <n|menu|levels|options> <out.png>   # screenshot via NW.js
```

The Claude desktop browser preview uses `.claude/launch.json` (`jetpackman` on port 8123).

## Standing rules from the user

1. **Rebuild after every change.** Once a batch of edits is done, run `npm run package` **in the
   background** and keep working; don't wait or ask. Report the new zip name when it finishes.
   (EBUSY = a running copy of the game, or a shell/Explorer window, is inside `dist/`.)
2. **Tune in small steps.** The user tunes by feel; big jumps overshoot. Always state old → new.
3. **Forgiving difficulty.** See `docs/LEVEL_DESIGN.md`.
4. **Devlogs** (when asked for one): see below.

## Devlog procedure

When the user asks for a devlog:

1. Write `devlog/<YYYY-MM-DD>_devlog-<NN>_<slug>.md`: **Markdown, easy to read**: short
   sections, tables, a few code snippets, and a **technical discussion** of what changed and why
   (decisions, bugs found, numbers before → after). Cover everything since the previous entry.
2. **Attach game screenshots**: generate them with `npm run shot` into `devlog/images/` and embed
   them with relative links (`![..](images/..png)`). Look at each image before using it.
3. Add a row to `devlog/README.md` (newest first).

When the user sends a **level sketch**: build the level, then save into `devlog/images/`:
`<date>_<slug>_sketch.png` (their drawing), `<date>_<slug>_level.png` (`npm run shot`), and
`<date>_<slug>_side-by-side.png` (labelled composite, made with PowerShell `System.Drawing`),
and list them in `devlog/README.md`.

## Making changes safely

- Rules go in `src/core.js` with a test in `tests/core.test.js`. Keep core free of PIXI/DOM.
- Run `npm test` after every change; for levels it's the main safety net.
- Visual check: browser preview, or `npm run shot`. In the hidden preview pane the game barely
  ticks, so verify behaviour with Core functions instead of waiting on animation.
- `localStorage` keys are versioned (`jetpackman.best.v2`); bump the version if the format changes.
- Keep `README.md` (user-facing) and these docs in sync when commands or rules change.

## Packaging internals

`scripts/nw-runtime.js` downloads `https://dl.nwjs.io/v<ver>/nwjs-v<ver>-win-x64.zip`, verifies
it against `SHASUMS256.txt`, and caches it in `.cache/nwjs/`. `scripts/package-nw.js` extracts it,
renames `nw.exe`, drops non-English locales (`--all-locales` keeps them), copies `index.html`,
`src/`, `vendor/`, writes a trimmed `package.json` manifest, zips, and deletes the unzipped
folders of older builds (their zips stay). NW.js version: `package.json` → `nwjs.version`
(currently 0.117.0); override with `--nw=<ver>` or `NWJS_VERSION`.

## Publishing

- **Browser:** GitHub Pages serves `main` (root) at https://cnblackxp.github.io/jetpackman/; every push
  to `main` updates it. `vendor/pixi.min.js` is committed so the site needs no CDN.
- **Desktop release:** push a tag `v*` → `.github/workflows/release.yml` runs `npm test`, `npm run package`
  and attaches the zip to a GitHub release. Bump `version` in `package.json` and `VERSION` in
  `src/core.js` to match the tag (the game is alpha: 0.0.x).

## Open tasks

See [`TODO.md`](../TODO.md): playtest list for the 20-level campaign and the paused level solver.

## Known gaps / ideas

- `.exe` still has the default NW.js icon (needs rcedit or similar).
- Windows-only packaging.
- `PIXI.Text` gets blurry when `npm run shot` zooms out a very wide level (Tutorial).
- Ideas: pause menu, ghost replay of best run, more sketch levels, level editor from drawings.
