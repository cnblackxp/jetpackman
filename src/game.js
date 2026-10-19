// Rendering, input, screens and glue. Game rules live in core.js.
(function () {
  const Core = window.JetpackCore;
  const { TILE } = Core;
  const CFG = Core.DEFAULT_TUNING;
  const DEATH_FADE = 1.1;   // s for the CRASHED overlay to fade in; then a click restarts

  // ---------- Settings + progress (localStorage, optional) ----------
  const SETTINGS_KEY = 'jetpackman.settings';
  const PROGRESS_KEY = 'jetpackman.best.v2'; // { [levelName]: seconds }
  const COINS_KEY = 'jetpackman.coins.v1';     // { [levelName]: most coins in a finished run }

  function readJSON(key) {
    try { return JSON.parse(localStorage.getItem(key)); } catch { return null; }
  }
  function writeJSON(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode etc. */ }
  }

  let settings = Core.sanitizeSettings(readJSON(SETTINGS_KEY));
  const loadBest = () => readJSON(PROGRESS_KEY) || {};

  function applySettings() {
    Sfx.setVolume(settings.volume);
    Sfx.setMuted(settings.muted);
  }
  applySettings();

  // ---------- Window / fullscreen (desktop build runs in NW.js) ----------
  const nwWin = typeof nw !== 'undefined' && nw.Window ? nw.Window.get() : null;
  document.body.classList.toggle('desktop', !!nwWin);

  const isFullscreen = () => (nwWin ? nwWin.isFullscreen : !!document.fullscreenElement);
  function setFullscreen(on) {
    if (nwWin) {
      if (on) nwWin.enterFullscreen(); else nwWin.leaveFullscreen();
    } else if (on && document.documentElement.requestFullscreen) {
      document.documentElement.requestFullscreen().catch(() => {});
    } else if (!on && document.fullscreenElement) {
      document.exitFullscreen();
    }
    setTimeout(() => { if (state.screen === 'options') buildOptions(); }, 250);
  }
  if (nwWin && settings.startFullscreen) setFullscreen(true);

  // ---------- PIXI setup ----------
  // Screenshot mode (--smoke-test) keeps the drawing buffer so the canvas can be read back
  const SMOKE = typeof nw !== 'undefined' && [...(nw.App.argv || []), ...(nw.App.fullArgv || [])]
    .some((a) => a.startsWith('--smoke-test='));
  const app = new PIXI.Application({ resizeTo: window, background: 0x0b0e1a, antialias: true, preserveDrawingBuffer: SMOKE });
  document.body.appendChild(app.view);
  app.view.addEventListener('contextmenu', (e) => e.preventDefault());

  const starLayer = new PIXI.Container(); // parallax star fields (tiling sprites)
  const world = new PIXI.Container();
  const signLayer = new PIXI.Container();
  const terrainG = new PIXI.Graphics();
  const goalG = new PIXI.Graphics();
  const pusherG = new PIXI.Graphics();
  const moverLayer = new PIXI.Container();
  const aimG = new PIXI.Graphics();
  const fxG = new PIXI.Graphics();
  const staminaG = new PIXI.Graphics(); // separate from the player so it never rotates
  const headingG = new PIXI.Graphics();
  const pickupG = new PIXI.Graphics();  // shield items
  const enemyG = new PIXI.Graphics();   // drones
  const auraG = new PIXI.Graphics();    // shield bubble around the player
  // The player is a container with two looks: the drawn "classic" figure and the pixel-art sprite
  // (Options → Character art). Both face +x with the feet toward +y, so the same rotation works.
  const PIXEL_FRAMES = [0, 1, 2, 3].map((i) => PIXI.Texture.from(`assets/sprites/jetpackman-fly-${i}.png`));
  let classicArt, pixelArt;

  const player = makePlayer();
  const decalG = new PIXI.Graphics();   // splatter that stays for a few seconds
  const rippleG = new PIXI.Graphics();  // landing waves
  const coinG = new PIXI.Graphics();
  const popupLayer = new PIXI.Container(); // floating "+1"s
  world.addChild(signLayer, pusherG, terrainG, decalG, rippleG, goalG, coinG, moverLayer, pickupG, enemyG, aimG,
    player, auraG, fxG, headingG, staminaG, popupLayer);

  const hud = new PIXI.Container();
  const hudText = new PIXI.Text('', { fontFamily: 'Segoe UI, Arial', fontSize: 18, fill: 0xdfe6ff });
  hudText.position.set(16, 12);
  const msgText = new PIXI.Text('', {
    fontFamily: 'Segoe UI, Arial', fontSize: 26, fill: 0xffffff, align: 'center',
    dropShadow: true, dropShadowDistance: 2, dropShadowAlpha: 0.6,
  });
  msgText.anchor.set(0.5);
  const versionText = new PIXI.Text(`v${Core.VERSION} ${Core.STAGE}`, {
    fontFamily: 'Segoe UI, Arial', fontSize: 13, fill: 0x8f9ac6,
  });
  versionText.anchor.set(1, 0);
  hud.addChild(hudText, msgText, versionText);

  // "YOU DIED"-style death screen: a dark band fades in over the (still visible) level,
  // big red CRASHED swells slightly, then a small hint asks for a click.
  const deathLayer = new PIXI.Container();
  const deathBand = new PIXI.Graphics();
  const deathText = new PIXI.Text('CRASHED', {
    fontFamily: 'Georgia, "Times New Roman", serif', fontSize: 104, fontWeight: '700', fill: 0xa8141c,
    letterSpacing: 10, dropShadow: true, dropShadowColor: 0x000000, dropShadowBlur: 12, dropShadowDistance: 0,
  });
  deathText.anchor.set(0.5);
  const deathHint = new PIXI.Text('click to restart', {
    fontFamily: 'Georgia, "Times New Roman", serif', fontSize: 18, fill: 0xd8c9b8, letterSpacing: 3,
  });
  deathHint.anchor.set(0.5);
  deathLayer.addChild(deathBand, deathText, deathHint);
  deathLayer.visible = false;
  hud.addChild(deathLayer);

  function drawDeathScreen(t) {
    const sw = app.screen.width, sh = app.screen.height;
    const k = Math.min(1, t / DEATH_FADE), ease = k * k * (3 - 2 * k);
    const band = Math.min(260, sh * 0.32), cy = sh / 2;
    deathBand.clear();
    // soft-edged dark band: stacked strips get lighter toward the edges, the level shows through
    for (let i = 0; i < 12; i++) {
      const f = i / 12, h = band * (1 - f * 0.55);
      deathBand.beginFill(0x000000, 0.075 * ease).drawRect(0, cy - h / 2, sw, h).endFill();
    }
    deathText.position.set(sw / 2, cy - 6);
    deathText.alpha = ease;
    deathText.scale.set(Math.min(1, sw / 900) * (0.96 + 0.06 * ease));
    const hintK = Math.max(0, Math.min(1, (t - DEATH_FADE) / 0.4));
    deathHint.position.set(sw / 2, cy + band * 0.32);
    deathHint.alpha = hintK * (0.75 + 0.25 * Math.sin(t * 3));
    deathHint.text = state.checkpoint ? 'click to continue from the checkpoint' : 'click to restart';
  }

  const reticle = new PIXI.Graphics();
  reticle.lineStyle(2, 0xffffff, 0.9).drawCircle(0, 0, 8);
  reticle.moveTo(-13, 0).lineTo(-4, 0).moveTo(4, 0).lineTo(13, 0);
  reticle.moveTo(0, -13).lineTo(0, -4).moveTo(0, 4).lineTo(0, 13);

  app.stage.addChild(starLayer, world, hud, reticle);

  // Feet point toward +y locally, so rotating by (aim - 90deg) points the legs at the mouse.
  function makePlayer() {
    const root = new PIXI.Container();
    const c = new PIXI.Container();
    const g = new PIXI.Graphics();
    g.lineStyle(3.5, 0x2b3b6b).moveTo(-2, 4).lineTo(-3, 15).moveTo(3, 4).lineTo(4, 15); // legs
    g.lineStyle(0);
    g.beginFill(0x1a1f33).drawRect(-6, 14, 5, 3).drawRect(2, 14, 5, 3).endFill();         // boots
    g.beginFill(0x8a92ad).drawRoundedRect(-12, -10, 7, 15, 2).endFill();                  // jetpack
    g.beginFill(0x444a5e).drawRect(-11, 5, 5, 3).endFill();                               // nozzle
    g.beginFill(0xe0533d).drawRoundedRect(-5, -8, 10, 14, 3).endFill();                   // body
    g.lineStyle(3, 0xc0402d).moveTo(1, -5).lineTo(7, 1);                                  // arm
    g.lineStyle(0);
    g.beginFill(0xf2c9a0).drawCircle(0, -13, 5.5).endFill();                              // head
    g.beginFill(0x6fd3ff).drawRoundedRect(1, -15, 5, 3.5, 1.5).endFill();                 // visor
    c.addChild(g);
    c.scale.set(1.3);

    // Frames are 2x the classic figure's height (~46 px); the sheet faces left, so mirror it
    const s = new PIXI.Sprite(PIXEL_FRAMES[3]);
    s.anchor.set(0.5);
    s.scale.set(-0.5, 0.5);

    classicArt = c;
    pixelArt = s;
    root.addChild(c, s);
    applySkin();
    return root;
  }

  function applySkin() {
    if (!classicArt) return;
    const pixel = settings.playerSkin === 'pixel';
    classicArt.visible = !pixel;
    pixelArt.visible = pixel;
  }

  // Stride through the walk frames while flying around; stand still when slow or on a pad
  function animatePixelArt(p) {
    if (!pixelArt || !pixelArt.visible) return;
    const moving = !p.grounded && Math.hypot(p.vx, p.vy) > 60;
    pixelArt.texture = PIXEL_FRAMES[moving ? Math.floor(elapsed * 8) % 4 : 3];
  }

  // Three star fields at different depths. Each scrolls with the camera by its own factor and drifts
  // slowly on its own; the nearest one twinkles a little. Kept slow so it never distracts.
  const STAR_FIELDS = [
    { factor: 0.1, drift: 2.5, count: 260, size: [0.3, 0.9], alpha: [0.12, 0.4] },
    { factor: 0.25, drift: 5, count: 130, size: [0.5, 1.3], alpha: [0.25, 0.65] },
    { factor: 0.45, drift: 9, count: 40, size: [0.9, 1.8], alpha: [0.45, 0.9] },
  ];
  const starTiles = [];
  function drawStars() {
    const SIZE = 1024;
    for (const f of STAR_FIELDS) {
      const g = new PIXI.Graphics();
      g.beginFill(0x000000, 0.001).drawRect(0, 0, SIZE, SIZE).endFill();
      for (let i = 0; i < f.count; i++) {
        const r = f.size[0] + Math.random() * (f.size[1] - f.size[0]);
        const a = f.alpha[0] + Math.random() * (f.alpha[1] - f.alpha[0]);
        g.beginFill(Math.random() < 0.15 ? 0xbfe3ff : 0xffffff, a).drawCircle(Math.random() * SIZE, Math.random() * SIZE, r).endFill();
      }
      const tex = app.renderer.generateTexture(g, { region: new PIXI.Rectangle(0, 0, SIZE, SIZE) });
      g.destroy();
      const ts = new PIXI.TilingSprite(tex, app.screen.width, app.screen.height);
      starLayer.addChild(ts);
      starTiles.push({ ts, ...f, offset: Math.random() * SIZE });
    }
  }

  function updateStars(dt, cx, cy) {
    starTiles.forEach((s, i) => {
      s.offset += s.drift * dt;
      s.ts.width = app.screen.width;
      s.ts.height = app.screen.height;
      s.ts.tilePosition.set(-cx * s.factor - s.offset, -cy * s.factor - s.offset * 0.3);
      if (i === starTiles.length - 1) s.ts.alpha = 0.85 + Math.sin(elapsed * 0.9) * 0.15;
    });
  }
  drawStars();

  // ---------- Game state ----------
  const state = {
    screen: 'menu',   // menu | levels | options | game (from the URL hash)
    levelIndex: 0,
    world: null,      // Core.createWorld(...)
    p: null,          // Core.createPlayer(...)
    mode: 'play',     // play | dead | won | done
    respawnTimer: 0,
    levelTime: 0,
    deaths: 0,        // this level
    checkpoint: null, // { x, y } respawn point after reaching a checkpoint pad
    checkpointSave: null, // Core.snapshotActors(...) taken when you last landed on a checkpoint
    paused: false,    // left with Esc: the level waits, frozen, behind the menus
    forceRestart: false, // the next #/level/N route starts fresh instead of resuming
    toast: { text: '', time: 0 }, // short message over the HUD
    cam: { x: 0, y: 0 },
    look: { x: 0, y: 0 }, // camera lead in the direction of travel
    shake: 0,
    coins: 0,         // collected this run
    slowmo: 0,        // seconds of slow motion left (death / win)
  };
  const mouse = { x: 0, y: 0 };
  let particles = [];
  let pusherFlash = new Map();
  let elapsed = 0;
  let refillFlash = 0; // seconds the stamina bar glows after a pad refill
  let photoMode = false; // camera shows the whole level (smoke test screenshots)
  let ripples = [];      // { x, y, age, delay }
  let splats = [];       // { x, y, r, life, color }
  let popups = [];       // { text, life }
  let coinCombo = 0, lastCoinAt = -10;
  const squash = { x: 1, y: 1 }; // player squash & stretch (eases back to 1)

  function loadLevel(i) {
    state.levelIndex = i;
    state.world = Core.createWorld(LEVELS[i], CFG);
    state.deaths = 0;
    state.checkpoint = null;
    state.checkpointSave = null;
    state.paused = false;
    pusherFlash = new Map();
    particles = [];
    ripples = [];
    splats = [];
    popups.forEach((p) => p.text.destroy());
    popups = [];
    drawTerrain();
    buildMoverGraphics();
    buildSigns();
    resetPlayer();
    state.cam.x = state.p.x;
    state.cam.y = state.p.y;
  }

  // After a death you respawn at the last checkpoint (the timer keeps running);
  // without one, or with fromStart (R key), the level restarts.
  // Dying with no checkpoint resets everything. With one, the level goes back to exactly how it was
  // when you last landed on it (drones destroyed, shields and coins taken, your shield).
  function resetPlayer(fromStart = false) {
    if (fromStart) { state.checkpoint = null; state.checkpointSave = null; }
    if (state.checkpoint && state.checkpointSave) Core.restoreActors(state.world, state.checkpointSave);
    else Core.resetActors(state.world);
    state.coins = state.world.coins.filter((c) => c.taken).length;
    state.p = Core.createPlayer(state.world.level, CFG, state.checkpoint);
    if (state.checkpoint && state.checkpointSave) state.p.shield = state.checkpointSave.shield;
    for (const b of state.world.pushers) b.touching = false;
    player.visible = true;
    state.mode = 'play';
    if (!state.checkpoint) state.levelTime = 0;
  }

  const mouseWorld = () => ({ x: mouse.x - world.position.x, y: mouse.y - world.position.y });

  // ---------- Drawing the level ----------
  function drawTerrain() {
    const g = terrainG, level = state.world.level;
    g.clear();
    for (let r = 0; r < level.rows; r++) {
      for (let c = 0; c < level.cols; c++) {
        const x = c * TILE, y = r * TILE;
        if (Core.isPad(level, c, r)) {
          g.beginFill(0x1d4f45).drawRect(x, y, TILE, TILE).endFill();
          g.beginFill(0x2a7a68);
          for (let k = 0; k < 3; k++) g.drawRect(x + 7 + k * 12, y + 10, 4, TILE - 16);
          g.endFill();
          if (!Core.isBlock(level, c, r - 1)) g.beginFill(0x3dff9a).drawRect(x, y, TILE, 4).endFill();
          continue;
        }
        if (!Core.isSolid(level, c, r)) continue;
        g.beginFill(0x2e3350).drawRect(x, y, TILE, TILE).endFill();
        const seed = (c * 73856093) ^ (r * 19349663); // deterministic speckles
        for (let k = 0; k < 3; k++) {
          const sx = ((seed >> (k * 4)) & 31) + 4, sy = ((seed >> (k * 4 + 8)) & 31) + 4;
          g.beginFill(0x252a44).drawCircle(x + sx, y + sy, 2.5).endFill();
        }
        g.beginFill(0x7b88e0, 0.9); // edges facing open air
        if (!Core.isBlock(level, c, r - 1)) g.drawRect(x, y, TILE, 3);
        if (!Core.isBlock(level, c, r + 1)) g.drawRect(x, y + TILE - 2, TILE, 2);
        if (!Core.isBlock(level, c - 1, r)) g.drawRect(x, y, 2, TILE);
        if (!Core.isBlock(level, c + 1, r)) g.drawRect(x + TILE - 2, y, 2, TILE);
        g.endFill();
      }
    }
  }

  function buildSigns() {
    signLayer.removeChildren().forEach((c) => c.destroy({ children: true }));
    for (const s of state.world.signs) {
      const t = new PIXI.Text(s.text, {
        fontFamily: 'Segoe UI, Arial', fontSize: 16, fill: 0xdfe6ff, align: 'center', lineHeight: 22,
      });
      t.anchor.set(0.5);
      const bg = new PIXI.Graphics();
      bg.beginFill(0x0b0e1a, 0.6).lineStyle(1, 0x7b88e0, 0.5)
        .drawRoundedRect(-t.width / 2 - 12, -t.height / 2 - 8, t.width + 24, t.height + 16, 8).endFill();
      const c = new PIXI.Container();
      c.position.set(s.x, s.y);
      c.addChild(bg, t);
      signLayer.addChild(c);
    }
  }

  function makeSaw(r) {
    const g = new PIXI.Graphics();
    const teeth = 12, pts = [];
    for (let i = 0; i < teeth * 2; i++) {
      const a = (i / (teeth * 2)) * Math.PI * 2, rr = i % 2 ? r * 0.78 : r;
      pts.push(Math.cos(a) * rr, Math.sin(a) * rr);
    }
    g.beginFill(0xc9ced9).drawPolygon(pts).endFill();
    g.beginFill(0x6b7180).drawCircle(0, 0, r * 0.55).endFill();
    g.beginFill(0xff5a2e).drawCircle(0, 0, r * 0.18).endFill();
    return g;
  }

  function makeBlock(w, h) {
    const g = new PIXI.Graphics();
    g.beginFill(0xf2b705).drawRect(-w / 2, -h / 2, w, h).endFill();
    g.beginFill(0x3a2f10).drawRect(-w / 2 + 4, -h / 2 + 4, w - 8, h - 8).endFill();
    g.lineStyle(3, 0xf2b705, 0.8)
      .moveTo(-w / 2 + 4, -h / 2 + 4).lineTo(w / 2 - 4, h / 2 - 4)
      .moveTo(w / 2 - 4, -h / 2 + 4).lineTo(-w / 2 + 4, h / 2 - 4);
    return g;
  }

  function buildMoverGraphics() {
    moverLayer.removeChildren().forEach((c) => c.destroy());
    for (const m of state.world.movers) moverLayer.addChild(m.shape === 'block' ? makeBlock(m.w, m.h) : makeSaw(m.r));
  }

  function drawMovers() {
    state.world.movers.forEach((m, i) => {
      const g = moverLayer.children[i];
      g.position.set(m.x, m.y);
      if (m.shape === 'saw') g.rotation = state.world.clock * 8;
    });
  }

  function drawPushers(t) {
    const g = pusherG;
    g.clear();
    for (const b of state.world.pushers) {
      const flash = Math.max(0, (pusherFlash.get(b) || 0) - 0.05);
      pusherFlash.set(b, flash);
      const r = b.r * (1 + Math.sin(t * 5 + b.x) * 0.1 + flash * 0.35);
      g.lineStyle(0).beginFill(0x7fdcff, 0.12 + flash * 0.3).drawCircle(b.x, b.y, r * 1.5).endFill();
      g.lineStyle(3, 0x7fdcff, 0.9).drawCircle(b.x, b.y, r);
      const ux = Math.cos(b.angle), uy = Math.sin(b.angle), vx = -uy, vy = ux;
      const nudge = Math.sin(t * 8) * 2;
      const tipX = b.x + ux * (r * 0.6 + nudge), tipY = b.y + uy * (r * 0.6 + nudge);
      const tailX = b.x - ux * (r * 0.5 - nudge), tailY = b.y - uy * (r * 0.5 - nudge);
      g.lineStyle(3, 0xdff6ff, 1).moveTo(tailX, tailY).lineTo(tipX, tipY);
      g.moveTo(tipX - ux * 8 + vx * 7, tipY - uy * 8 + vy * 7).lineTo(tipX, tipY)
        .lineTo(tipX - ux * 8 - vx * 7, tipY - uy * 8 - vy * 7);
    }
  }

  function drawGoal(t) {
    // Drawn at its classic size; the win radius (CFG.goalRadius) matches the outer glow
    const g = goalG, { x, y } = state.world.level.goal, R = 28;
    const pulse = 1 + Math.sin(t * 4) * 0.12;
    g.clear();
    g.beginFill(0x3dff9a, 0.12).drawCircle(x, y, R * 1.6 * pulse).endFill();
    g.lineStyle(3, 0x3dff9a, 0.9).drawCircle(x, y, R * pulse);
    g.lineStyle(2, 0x3dff9a, 0.5).drawCircle(x, y, R * 0.6 * pulse);
    g.lineStyle(2, 0xdfe6ff).moveTo(x, y + 12).lineTo(x, y - 14);
    g.lineStyle(0).beginFill(0x3dff9a).drawPolygon([x, y - 14, x + 13, y - 9, x, y - 4]).endFill();

    // Checkpoint flags: grey until reached, then yellow and waving
    for (const c of state.world.level.checkpoints) {
      const active = state.checkpoint && Math.abs(state.checkpoint.y + CFG.standOffset - c.y) < 1 &&
        Math.abs(state.checkpoint.x - c.x) <= (c.width * TILE) / 2 + 1;
      const fx = c.x - (c.width * TILE) / 2 + 8, top = c.y - 34;
      const wave = active ? Math.sin(t * 6) * 2 : 0;
      g.lineStyle(2, 0xdfe6ff, 0.9).moveTo(fx, c.y).lineTo(fx, top);
      g.lineStyle(0).beginFill(active ? 0xffe066 : 0x6b7180)
        .drawPolygon([fx, top, fx + 16, top + 5 + wave, fx, top + 11]).endFill();
    }
  }

  // Bar above the player's head, always upright, one segment per thrust
  function drawStamina() {
    const g = staminaG, p = state.p;
    g.clear();
    if (state.mode !== 'play' || state.screen !== 'game') return;
    const w = 44, h = 6, x = p.x - w / 2, y = p.y - 38;
    const color = p.hovering ? 0x7fdcff // hovering
      : p.exhausted ? 0xff4d4d : p.stamina >= CFG.thrustCost ? 0x3dff9a : 0xffc93d;
    g.beginFill(0x000000, 0.55).drawRoundedRect(x - 2, y - 2, w + 4, h + 4, 3).endFill();
    g.beginFill(color, p.exhausted ? 0.6 + Math.sin(elapsed * 14) * 0.3 : 1)
      .drawRect(x, y, w * (p.stamina / CFG.staminaMax), h).endFill();
    g.beginFill(0x000000, 0.8);
    for (let s = CFG.thrustCost; s < CFG.staminaMax; s += CFG.thrustCost) g.drawRect(x + w * (s / CFG.staminaMax) - 1, y, 2, h);
    g.endFill();
    if (refillFlash > 0) {
      g.lineStyle(2, 0xffffff, refillFlash * 1.6).drawRoundedRect(x - 3, y - 3, w + 6, h + 6, 4);
    }
  }

  // Colour for a speed: cyan (slow) -> green -> yellow -> orange -> red (max speed)
  const SPEED_COLORS = [0x7fdcff, 0x3dff9a, 0xffe066, 0xff9f2e, 0xff4d4d];
  function speedColor(speed) {
    const t = Math.min(1, speed / CFG.maxSpeed) * (SPEED_COLORS.length - 1);
    const i = Math.min(SPEED_COLORS.length - 2, Math.floor(t)), k = t - i;
    const a = SPEED_COLORS[i], b = SPEED_COLORS[i + 1];
    const mix = (shift) => Math.round(((a >> shift) & 255) * (1 - k) + ((b >> shift) & 255) * k) << shift;
    return mix(16) | mix(8) | mix(0);
  }

  // Small marker ahead of the player showing where the current thrust is carrying them.
  // Its distance and colour show the momentum; it disappears when the push is used up.
  function drawHeading() {
    const g = headingG, p = state.p;
    g.clear();
    if (!settings.headingMarker || state.screen !== 'game' || state.mode !== 'play' || !p.heading) return;
    const speed = Math.hypot(p.vx, p.vy);
    if (speed < 1) return;
    const ux = p.vx / speed, uy = p.vy / speed;
    const dist = 34 + speed * 0.16;
    const x = p.x + ux * dist, y = p.y + uy * dist;
    const color = speedColor(speed);
    g.lineStyle(1.5, color, 0.35).moveTo(p.x + ux * 22, p.y + uy * 22).lineTo(x - ux * 7, y - uy * 7);
    g.lineStyle(2, color, 0.95).drawCircle(x, y, 5);
    g.lineStyle(0).beginFill(color, 0.95).drawCircle(x, y, 1.8).endFill();
  }

  // Optional faint line showing where a left click would send you
  function drawAimLine() {
    aimG.clear();
    if (!settings.aimLine || state.screen !== 'game' || state.mode !== 'play') return;
    const p = state.p, m = mouseWorld();
    const dir = Core.thrustDirection(p, m.x, m.y, false);
    if (!dir) return;
    aimG.lineStyle(2, 0xffffff, 0.18).moveTo(p.x, p.y).lineTo(m.x, m.y);
    aimG.lineStyle(2, 0xffe066, 0.45).moveTo(p.x + dir.x * 24, p.y + dir.y * 24).lineTo(p.x + dir.x * 60, p.y + dir.y * 60);
  }

  // ---------- Drones, shields ----------
  function hexagon(g, x, y, r, rot) {
    const pts = [];
    for (let i = 0; i < 6; i++) {
      const a = rot + (i / 6) * Math.PI * 2;
      pts.push(x + Math.cos(a) * r, y + Math.sin(a) * r);
    }
    return g.drawPolygon(pts);
  }

  // Gold hexagon pickups, slowly turning and bobbing
  function drawPickups(t) {
    const g = pickupG;
    g.clear();
    for (const sh of state.world.shields) {
      if (sh.taken) continue;
      const y = sh.y + Math.sin(t * 3 + sh.x) * 4;
      g.lineStyle(0).beginFill(0xffd166, 0.15);
      hexagon(g, sh.x, y, 22, t).endFill();
      g.lineStyle(3, 0xffd166, 1).beginFill(0x3a2f10, 0.6);
      hexagon(g, sh.x, y, 13, t).endFill();
      g.lineStyle(0).beginFill(0xfff3c4, 0.9).drawCircle(sh.x, y, 3.5).endFill();
    }
  }

  // Spiky drones: purple when idle, flashing red while winding up, red with a trail when dashing,
  // grey while recharging (the ring shows how long until they can dash again)
  function drawEnemies(t) {
    const g = enemyG;
    g.clear();
    const p = state.p;
    for (const e of state.world.enemies) {
      if (!e.alive) continue;
      const winding = e.state === 'windup', dashing = e.state === 'dash', resting = e.state === 'recharge';
      const body = resting ? 0x5c5f73 : winding ? (Math.sin(t * 40) > 0 ? 0xff4d6d : 0x9b5de5) : dashing ? 0xff4d6d : 0x7b3fc4;
      const shake = winding ? (Math.random() - 0.5) * 3 : 0;
      const x = e.x + shake, y = e.y + shake;
      // range hint when the player is getting close
      const dist = Math.hypot(p.x - e.x, p.y - e.y);
      if (e.state === 'idle' && dist < e.range * 1.4) {
        g.lineStyle(1, 0x9b5de5, 0.25 * (1 - Math.max(0, dist - e.range) / (e.range * 0.4))).drawCircle(e.x, e.y, e.range);
      }
      if (dashing) {
        g.lineStyle(6, 0xff4d6d, 0.25).moveTo(x - e.dir.x * 40, y - e.dir.y * 40).lineTo(x, y);
      }
      if (winding) {
        const k = 1 - e.timer / CFG.enemyWindup;
        g.lineStyle(2, 0xff4d6d, 0.7).drawCircle(x, y, e.r + 4 + k * 10);
        g.lineStyle(2, 0xff4d6d, 0.5).moveTo(x, y).lineTo(x + e.dir.x * 60, y + e.dir.y * 60);
      }
      // spikes
      g.lineStyle(0).beginFill(body);
      const spin = resting ? t * 1.5 : t * 4;
      for (let i = 0; i < 8; i++) {
        const a = spin + (i / 8) * Math.PI * 2;
        g.drawPolygon([
          x + Math.cos(a - 0.25) * e.r * 0.8, y + Math.sin(a - 0.25) * e.r * 0.8,
          x + Math.cos(a) * (e.r + 7), y + Math.sin(a) * (e.r + 7),
          x + Math.cos(a + 0.25) * e.r * 0.8, y + Math.sin(a + 0.25) * e.r * 0.8,
        ]);
      }
      g.drawCircle(x, y, e.r).endFill();
      if (resting) {
        const k = 1 - e.timer / e.recharge;
        g.lineStyle(3, 0xdfe6ff, 0.6).arc(x, y, e.r + 5, -Math.PI / 2, -Math.PI / 2 + k * Math.PI * 2);
        g.lineStyle(0);
      }
      // eye looks at the player
      const look = dist > 1 ? { x: (p.x - e.x) / dist, y: (p.y - e.y) / dist } : { x: 0, y: 0 };
      g.beginFill(0xffffff).drawCircle(x + look.x * 4, y + look.y * 4, 6).endFill();
      g.beginFill(resting ? 0x5c5f73 : 0x1a1f33).drawCircle(x + look.x * 6, y + look.y * 6, 3).endFill();
    }
  }

  // Gold bubble around the player while carrying the shield
  function drawAura(t) {
    const g = auraG;
    g.clear();
    const p = state.p;
    if (!p.shield || state.mode !== 'play') return;
    const pulse = 1 + Math.sin(t * 5) * 0.05;
    g.lineStyle(2.5, 0xffd166, 0.85).beginFill(0xffd166, 0.08);
    hexagon(g, p.x, p.y, 26 * pulse, t * 0.8).endFill();
  }

  // ---------- Particles ----------
  function burst(n, make) { for (let i = 0; i < n; i++) particles.push(make(i)); }

  function flameBurst(p, dir) {
    burst(16, () => {
      const a = Math.atan2(-dir.y, -dir.x) + (Math.random() - 0.5) * 0.7, s = 150 + Math.random() * 250;
      return {
        x: p.x - dir.x * 10, y: p.y - dir.y * 10,
        vx: Math.cos(a) * s + p.vx * 0.3, vy: Math.sin(a) * s + p.vy * 0.3,
        life: 0.25 + Math.random() * 0.2, max: 0.45, size: 2 + Math.random() * 3,
        color: [0xffe066, 0xff9f2e, 0xff5a2e][(Math.random() * 3) | 0], gravity: 0,
      };
    });
  }

  // Soft cyan wisps under the player while hovering
  function hoverPuff(p) {
    particles.push({
      x: p.x + (Math.random() - 0.5) * 14, y: p.y + 16,
      vx: (Math.random() - 0.5) * 30, vy: 40 + Math.random() * 40,
      life: 0.35, max: 0.35, size: 1.5 + Math.random() * 1.5, color: 0x7fdcff, gravity: 0,
    });
  }

  function smokePuff(p, dir) {
    burst(5, () => ({
      x: p.x - dir.x * 10, y: p.y - dir.y * 10,
      vx: -dir.x * 60 + (Math.random() - 0.5) * 60, vy: -dir.y * 60 + (Math.random() - 0.5) * 60,
      life: 0.4, max: 0.4, size: 2 + Math.random() * 2, color: 0x777b8a, gravity: -60,
    }));
  }

  function radialBurst(x, y, n, colors, speed, gravity, life) {
    burst(n, () => {
      const a = Math.random() * Math.PI * 2, s = speed * (0.25 + Math.random());
      return {
        x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s,
        life: life * (0.5 + Math.random() * 0.5), max: life, size: 2 + Math.random() * 3,
        color: colors[(Math.random() * colors.length) | 0], gravity,
      };
    });
  }

  function updateParticles(dt) {
    fxG.clear();
    particles = particles.filter((q) => (q.life -= dt) > 0);
    for (const q of particles) {
      q.vy += q.gravity * dt;
      q.x += q.vx * dt; q.y += q.vy * dt;
      q.vx *= 1 - 2 * dt; q.vy *= 1 - (q.gravity ? 0.5 : 2) * dt;
      fxG.beginFill(q.color, Math.min(1, (q.life / q.max) * 1.5))
        .drawCircle(q.x, q.y, q.size * (0.5 + q.life / q.max)).endFill();
    }
  }

  // ---------- Actions ----------
  function thrust(toward) {
    const p = state.p, m = mouseWorld();
    const dir = Core.thrustDirection(p, m.x, m.y, toward);
    const result = Core.tryThrust(p, dir, CFG);
    if (result === 'thrust') {
      flameBurst(p, dir);
      Sfx.thrust(toward);
      squash.x = 0.86; squash.y = 1.18;
    } else if (result === 'empty') {
      smokePuff(p, dir);
      Sfx.empty();
    }
  }

  const BLOOD = [0x8a0303, 0xb00b0b, 0xd11a1a, 0x5c0000, 0xe0302a];
  const DEBRIS = [0xe0533d, 0x8a92ad, 0xf2c9a0, 0x2b3b6b, 0xffe066];

  // Different deaths look and sound different: saws and crushers spill blood (unless turned off),
  // drones fry you with sparks, rock smashes you into debris.
  function die(cause = 'rock') {
    const p = state.p;
    state.mode = 'dead';
    state.deaths++;
    state.deathTime = 0;
    setTimeout(() => { if (state.mode === 'dead') Sfx.deathSting(); }, 350);
    state.slowmo = 0.35;
    player.visible = false;
    const blood = settings.bloodEffects && (cause === 'saw' || cause === 'crusher');
    if (settings.screenShake) state.shake = cause === 'crusher' ? 18 : 12;

    if (blood && cause === 'saw') {
      radialBurst(p.x, p.y, 70, BLOOD, 420, 1100, 1.3);
      radialBurst(p.x, p.y, 16, DEBRIS, 260, 900, 1.1);
      splatter(p.x, p.y, 16, 60);
      Sfx.deathSaw();
    } else if (blood && cause === 'crusher') {
      burst(70, () => {
        const s = 200 + Math.random() * 380, side = Math.random() < 0.5 ? -1 : 1;
        return { x: p.x, y: p.y, vx: side * s, vy: (Math.random() - 0.7) * 160, life: 0.8 + Math.random() * 0.5,
          max: 1.3, size: 2 + Math.random() * 3, color: BLOOD[(Math.random() * BLOOD.length) | 0], gravity: 900 };
      });
      splatter(p.x, p.y, 14, 70, 0.35);
      Sfx.deathCrush();
    } else if (cause === 'enemy') {
      radialBurst(p.x, p.y, 36, [0x9b5de5, 0x7fdcff, 0xffffff, 0xff4d6d], 360, 300, 0.8);
      radialBurst(p.x, p.y, 18, DEBRIS, 240, 900, 1.1);
      Sfx.deathZap();
    } else {
      radialBurst(p.x, p.y, 40, DEBRIS, 320, 900, 1.2);
      radialBurst(p.x, p.y, 16, [0x6b7180, 0x2e3350], 160, 600, 0.9); // rock dust
      Sfx.death();
    }
  }

  // Blood drops that stay where they land for a few seconds
  function splatter(x, y, n, spread, flatten = 1) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, d = Math.random() * spread;
      splats.push({ x: x + Math.cos(a) * d, y: y + Math.sin(a) * d * flatten, r: 2 + Math.random() * 5,
        life: 5 + Math.random() * 2, color: BLOOD[(Math.random() * BLOOD.length) | 0] });
    }
    if (splats.length > 200) splats.splice(0, splats.length - 200);
  }

  function win() {
    const next = Core.nextLevelAfter(LEVELS, state.levelIndex);
    state.mode = next == null ? 'done' : 'won';
    const name = LEVELS[state.levelIndex].name;
    writeJSON(PROGRESS_KEY, Core.recordBest(loadBest(), name, state.levelTime));
    writeJSON(COINS_KEY, Core.recordCoins(readJSON(COINS_KEY) || {}, name, state.coins));
    const { x, y } = state.world.level.goal;
    radialBurst(x, y, 50, [0x3dff9a, 0xdfe6ff, 0xffe066], 260, 200, 1.4);
    radialBurst(x, y, 40, [0xffc93d, 0xff4d6d, 0x7fdcff, 0x9b5de5], 380, 500, 1.8); // confetti
    ripples.push({ x, y, age: 0, delay: 0, big: true }, { x, y, age: 0, delay: 0.15, big: true });
    state.slowmo = 0.5;
    Sfx.win();
  }

  // ---------- Coins, ripples, splats, popups ----------
  function drawCoins(t) {
    const g = coinG;
    g.clear();
    for (const c of state.world.coins) {
      if (c.taken) continue;
      const y = c.y + Math.sin(t * 2.5 + c.x * 0.05) * 3;
      const spin = Math.cos(t * 3.2 + c.x * 0.02);
      const w = Math.max(1.5, Math.abs(spin) * 9);
      g.beginFill(0xffc93d, 0.18).drawCircle(c.x, y, 14).endFill();
      g.beginFill(0xd99a1c).drawEllipse(c.x, y, w, 9).endFill();
      g.beginFill(0xffd95e).drawEllipse(c.x, y, Math.max(1, w - 2), 7).endFill();
      if (spin > 0.3) g.beginFill(0xfff3c4, 0.9).drawEllipse(c.x - w * 0.3, y - 3, w * 0.25, 2.5).endFill();
    }
  }

  function collectCoin(c) {
    state.coins++;
    coinCombo = elapsed - lastCoinAt < 0.9 ? coinCombo + 1 : 0;
    lastCoinAt = elapsed;
    Sfx.coin(coinCombo);
    radialBurst(c.x, c.y, 12, [0xffd95e, 0xfff3c4, 0xffffff], 150, 0, 0.45);
    const text = new PIXI.Text(coinCombo > 2 ? `+1 ×${coinCombo + 1}` : '+1', {
      fontFamily: 'Segoe UI, Arial', fontSize: 15, fontWeight: '700', fill: 0xffd95e,
      stroke: 0x3a2f10, strokeThickness: 3,
    });
    text.anchor.set(0.5);
    text.position.set(c.x, c.y - 10);
    popupLayer.addChild(text);
    popups.push({ text, life: 0.8 });
  }

  function updateEffects(dt) {
    // landing waves: thin ellipses spreading along the pad
    rippleG.clear();
    ripples = ripples.filter((r) => (r.age += dt) < r.delay + (r.big ? 1.1 : 0.8));
    for (const r of ripples) {
      const k = (r.age - r.delay) / (r.big ? 1.1 : 0.8);
      if (k < 0) continue;
      const rx = (r.big ? 20 : 8) + k * (r.big ? 120 : 64);
      rippleG.lineStyle(2, 0x3dff9a, (1 - k) * 0.8).drawEllipse(r.x, r.y, rx, rx * (r.big ? 1 : 0.16));
    }
    rippleG.lineStyle(0);
    // splatter fades out
    decalG.clear();
    splats = splats.filter((s) => (s.life -= dt) > 0);
    for (const s of splats) decalG.beginFill(s.color, Math.min(1, s.life / 1.5) * 0.85).drawCircle(s.x, s.y, s.r).endFill();
    // floating +1s
    popups = popups.filter((p) => {
      p.life -= dt;
      p.text.y -= 40 * dt;
      p.text.alpha = Math.min(1, p.life * 2.5);
      if (p.life <= 0) { p.text.destroy(); return false; }
      return true;
    });
    // squash & stretch eases back
    const k = 1 - Math.exp(-12 * dt);
    squash.x += (1 - squash.x) * k;
    squash.y += (1 - squash.y) * k;
    player.scale.set(squash.x, squash.y);
  }

  function handleEvents(events) {
    for (const e of events) {
      if (e.type === 'pusher') {
        pusherFlash.set(e.pusher, 1);
        const b = e.pusher;
        burst(14, () => {
          const a = b.angle + Math.PI + (Math.random() - 0.5) * 1.2, s = 80 + Math.random() * 200;
          return { x: b.x, y: b.y, vx: Math.cos(a) * s, vy: Math.sin(a) * s,
            life: 0.3 + Math.random() * 0.3, max: 0.6, size: 2 + Math.random() * 2, color: 0x7fdcff, gravity: 0 };
        });
        Sfx.pusher();
      } else if (e.type === 'landed') {
        Sfx.land();
        const fy = state.p.y + CFG.standOffset; // pad surface
        ripples.push({ x: state.p.x, y: fy, age: 0, delay: 0 }, { x: state.p.x, y: fy, age: 0, delay: 0.12 });
        burst(10, () => ({ x: state.p.x + (Math.random() - 0.5) * 30, y: fy - 2, vx: (Math.random() - 0.5) * 40,
          vy: -20 - Math.random() * 40, life: 0.6 + Math.random() * 0.4, max: 1, size: 1.5 + Math.random() * 1.5,
          color: Math.random() < 0.5 ? 0x3dff9a : 0xc8ffe4, gravity: -20 }));
        squash.x = 1.22; squash.y = 0.78;
        if (e.refilled) { Sfx.refill(); refillFlash = 0.5; }
        const cp = e.checkpoint;
        if (cp) state.checkpointSave = Core.snapshotActors(state.world, state.p); // save on every checkpoint landing
        if (cp && !(state.checkpoint && state.checkpoint.x === cp.x && state.checkpoint.y === cp.y)) {
          const isNew = !state.checkpoint || Math.abs(state.checkpoint.y - cp.y) > 1 ||
            Math.abs(state.checkpoint.x - cp.x) > TILE * 8;
          state.checkpoint = cp;
          if (isNew) {
            Sfx.checkpoint();
            state.toast = { text: 'Checkpoint!', time: 1.4 };
          }
        }
      } else if (e.type === 'enemyWindup') {
        Sfx.enemyAlert();
      } else if (e.type === 'enemyDash') {
        Sfx.enemyDash();
      } else if (e.type === 'shield') {
        Sfx.shieldGet();
        radialBurst(e.item.x, e.item.y, 18, [0xffd166, 0xfff3c4], 160, 0, 0.6);
        state.toast = { text: 'Shield!', time: 1 };
      } else if (e.type === 'shieldLost') {
        Sfx.shieldLost();
        radialBurst(state.p.x, state.p.y, 22, [0xffd166, 0xdfe6ff], 260, 300, 0.7);
        if (settings.screenShake) state.shake = 6;
      } else if (e.type === 'bounce') {
        Sfx.bounce();
        radialBurst(state.p.x, state.p.y, 24, [0xffd166, 0xffffff], 220, 0, 0.5);
        if (settings.screenShake) state.shake = 5;
      } else if (e.type === 'enemyKilled') {
        Sfx.enemyKilled();
        radialBurst(e.enemy.x, e.enemy.y, 30, [0x9b5de5, 0xff4d6d, 0xdfe6ff], 280, 400, 0.9);
      } else if (e.type === 'coin') {
        collectCoin(e.coin);
      } else if (e.type === 'dead') {
        die(e.cause);
      } else if (e.type === 'won') {
        win();
      }
    }
  }

  // ---------- Input ----------
  app.stage.eventMode = 'static';
  app.stage.hitArea = app.screen;
  app.stage.on('pointermove', (e) => { mouse.x = e.global.x; mouse.y = e.global.y; });
  app.stage.on('pointerdown', (e) => {
    mouse.x = e.global.x; mouse.y = e.global.y;
    if (state.screen !== 'game') return;
    if (state.mode === 'play') {
      if (e.button === 0) thrust(false);
      else if (e.button === 2) thrust(true);
    } else if (state.mode === 'won' && e.button === 0) {
      navigate(Core.levelHash(Core.nextLevelAfter(LEVELS, state.levelIndex)));
    } else if (state.mode === 'dead' && state.deathTime >= DEATH_FADE) {
      resetPlayer(); // back to the last checkpoint, or the start
    } else if (state.mode === 'done' && e.button === 0) {
      navigate('#/levels');
    }
  });

  // Hover: hold the middle mouse button (scroll wheel click)
  let hoverHeld = false;
  app.view.addEventListener('mousedown', (e) => { if (e.button === 1) e.preventDefault(); }); // no autoscroll
  app.view.addEventListener('auxclick', (e) => { if (e.button === 1) e.preventDefault(); });
  window.addEventListener('mousedown', (e) => { if (e.button === 1 && state.screen === 'game') hoverHeld = true; });
  window.addEventListener('mouseup', (e) => { if (e.button === 1) hoverHeld = false; });
  window.addEventListener('blur', () => { hoverHeld = false; });

  window.addEventListener('pointerdown', Sfx.unlock);
  window.addEventListener('keydown', (e) => {
    Sfx.unlock();
    if (e.key === 'F11') {
      e.preventDefault();
      setFullscreen(!isFullscreen());
      return;
    }
    if (e.key === 'Escape') {
      if (state.screen === 'game' && (state.mode === 'play' || state.mode === 'dead')) {
        state.paused = true; // keep the level as it is
        hoverHeld = false;
      }
      if (state.screen !== 'menu') navigate('#/menu');
      return;
    }
    if (state.screen !== 'game') return;
    const n = parseInt(e.key, 10);
    if (n >= 1 && n <= LEVELS.length) { navigate(Core.levelHash(n - 1)); return; }
    if ((e.key === 'r' || e.key === 'R') && (state.mode === 'play' || state.mode === 'dead')) resetPlayer(true);
  });

  // ---------- Main loop ----------
  app.ticker.add(() => {
    const rawDt = Math.min(app.ticker.deltaMS / 1000, 1 / 30);
    state.slowmo = Math.max(0, state.slowmo - rawDt);
    const dt = rawDt * (state.slowmo > 0 ? 0.3 : 1); // brief slow motion after a death or a win
    elapsed += dt;
    const p = state.p;
    const w = state.world;
    const playing = state.screen === 'game';

    const frozen = state.paused && !playing; // a paused level waits behind the menus
    if (!frozen && (!playing || state.mode === 'play' || state.mode === 'dead')) Core.updateMovers(w, w.clock + dt);

    if (playing && state.mode === 'play') {
      const hover = hoverHeld && p.launched && !p.grounded;
      if (hover && !p.hovering) Sfx.hover();
      p.hovering = hover;
      if (hover && Math.random() < dt * 30) hoverPuff(p);
      if (Core.updateStamina(p, dt, CFG) === 'refilled') Sfx.refilled();
      if (p.launched) state.levelTime += dt;
      handleEvents(Core.updateEnemies(w, p, dt, CFG));
      handleEvents(Core.stepPlayer(w, p, dt, CFG));
      // faint streaks when flying fast
      const sp = Math.hypot(p.vx, p.vy);
      if (sp > 420 && !p.hovering && state.mode === 'play' && Math.random() < 0.7) {
        particles.push({ x: p.x + (Math.random() - 0.5) * 8, y: p.y + (Math.random() - 0.5) * 8, vx: 0, vy: 0,
          life: 0.22, max: 0.22, size: 2.2, color: 0xdfe6ff, gravity: 0 });
      }
    } else if (playing && state.mode === 'dead') {
      Core.updateEnemies(w, null, dt, CFG);
      state.deathTime += rawDt; // the overlay fades in at real speed, then waits for a click
    }

    const m = mouseWorld();
    player.position.set(state.p.x, state.p.y);
    player.alpha = state.p.invuln > 0 ? 0.45 + 0.4 * Math.sin(elapsed * 40) : 1; // flicker while protected
    animatePixelArt(state.p);
    player.rotation = playing ? Math.atan2(m.y - state.p.y, m.x - state.p.x) - Math.PI / 2 : Math.sin(elapsed) * 0.15;

    drawMovers();
    drawPushers(elapsed);
    drawPickups(elapsed);
    drawCoins(elapsed);
    updateEffects(dt);
    drawEnemies(elapsed);
    drawAura(elapsed);
    drawGoal(elapsed);
    updateParticles(dt);
    refillFlash = Math.max(0, refillFlash - dt);
    drawStamina();
    drawHeading();
    drawAimLine();
    updateCamera(dt);
    updateHud();
    deathLayer.visible = state.screen === 'game' && state.mode === 'dead';
    if (deathLayer.visible) drawDeathScreen(state.deathTime);
    reticle.position.set(mouse.x, mouse.y);
  });

  function updateCamera(dt) {
    const sw = app.screen.width, sh = app.screen.height;
    const level = state.world.level;
    const mw = level.cols * TILE, mh = level.rows * TILE;
    if (photoMode) {
      // Whole level, scaled to fit and centred (for screenshots)
      const s = Math.min(sw / mw, sh / mh, 1);
      world.scale.set(s);
      world.position.set(Math.round((sw - mw * s) / 2), Math.round((sh - mh * s) / 2));
      updateStars(0, 0, 0);
      return;
    }
    world.scale.set(1);
    const k = 1 - Math.exp(-6 * dt);
    // lead slightly in the direction of travel so you see more of where you're going
    const p = state.p, lk = 1 - Math.exp(-2.5 * dt);
    const lx = Math.max(-110, Math.min(110, p.vx * 0.2)), ly = Math.max(-80, Math.min(80, p.vy * 0.15));
    state.look.x += (lx - state.look.x) * lk;
    state.look.y += (ly - state.look.y) * lk;
    state.cam.x += (p.x + state.look.x - state.cam.x) * k;
    state.cam.y += (p.y + state.look.y - state.cam.y) * k;
    let cx = mw <= sw ? mw / 2 : Math.max(sw / 2, Math.min(mw - sw / 2, state.cam.x));
    let cy = mh <= sh ? mh / 2 : Math.max(sh / 2, Math.min(mh - sh / 2, state.cam.y));
    if (state.shake > 0) {
      cx += (Math.random() - 0.5) * state.shake;
      cy += (Math.random() - 0.5) * state.shake;
      state.shake = Math.max(0, state.shake - 40 * dt);
    }
    world.position.set(Math.round(sw / 2 - cx), Math.round(sh / 2 - cy));
    updateStars(dt, cx, cy);
  }

  function updateHud() {
    if (state.screen !== 'game') return;
    const lvl = LEVELS[state.levelIndex];
    hudText.text = `${lvl.practice ? 'Practice' : `Level ${state.levelIndex + 1}`}: ${lvl.name}` +
      `    Time ${state.levelTime.toFixed(1)}s    Deaths ${state.deaths}    ◆ ${state.coins}/${state.world.coins.length}` +
      `    [R] restart  [Esc] menu`;
    msgText.position.set(app.screen.width / 2, app.screen.height * 0.16);
    versionText.position.set(app.screen.width - 14, 14);
    state.toast.time = Math.max(0, state.toast.time - app.ticker.deltaMS / 1000);
    if (state.mode === 'play' && state.toast.time > 0) {
      msgText.text = state.toast.text;
    } else if (state.mode === 'play' && !state.p.launched) {
      msgText.text = lvl.signs ? '' : 'Left click: thrust away from the mouse  ·  Right click: thrust toward it';
    } else if (state.mode === 'dead') {
      msgText.text = '';
    } else if (state.mode === 'won') {
      msgText.text = `Level complete in ${state.levelTime.toFixed(1)}s!  ◆ ${state.coins}/${state.world.coins.length}\nClick for the next level`;
    } else if (state.mode === 'done') {
      msgText.text = lvl.practice
        ? `Reached the goal in ${state.levelTime.toFixed(1)}s!\nClick for level select`
        : `Campaign complete! (${state.levelTime.toFixed(1)}s)\nClick for level select`;
    } else {
      msgText.text = '';
    }
  }

  // ---------- Screens + URL routing ----------
  const screens = {
    menu: document.getElementById('menu'),
    levels: document.getElementById('levels'),
    options: document.getElementById('options'),
  };

  function navigate(hash) {
    if (location.hash === hash) route();
    else location.hash = hash; // new history entry, so Back/Forward work
  }

  function showScreen(name) {
    state.screen = name;
    for (const [key, el] of Object.entries(screens)) el.classList.toggle('active', key === name);
    const inGame = name === 'game';
    document.body.classList.toggle('in-game', inGame);
    hud.visible = inGame;
    reticle.visible = inGame;
    staminaG.visible = inGame;
  }

  function buildMenu() {
    document.getElementById('lastLevelKey').textContent = Math.min(9, LEVELS.length);
    const resume = document.getElementById('resumeBtn');
    resume.hidden = !state.paused;
    if (state.paused) {
      resume.href = Core.levelHash(state.levelIndex);
      resume.textContent = `Resume: ${LEVELS[state.levelIndex].name}`;
    }
    const best = loadBest();
    const next = Core.firstUnbeaten(LEVELS, best);
    const anyBeaten = Object.keys(best).length > 0;
    const playBtn = document.getElementById('playBtn');
    playBtn.textContent = !anyBeaten ? 'Play' : next == null ? 'Play Again' : `Continue: ${LEVELS[next].name}`;
    playBtn.href = Core.levelHash(next == null ? 0 : next);
    const tutorial = LEVELS.findIndex((l) => l.name === 'Tutorial');
    document.getElementById('tutorialBtn').href = Core.levelHash(Math.max(0, tutorial));
    const test = LEVELS.findIndex((l) => l.practice);
    const testBtn = document.getElementById('testBtn');
    testBtn.hidden = test < 0;
    if (test >= 0) testBtn.href = Core.levelHash(test);
  }

  // Level select: levels grouped by act, progress in the header, the next level highlighted
  // and scrolled into view. Only the panel body scrolls.
  function buildLevelGrid() {
    const best = loadBest();
    const body = document.getElementById('levelGrid');
    body.innerHTML = '';
    const campaign = LEVELS.filter((l) => !l.practice);
    const beaten = campaign.filter((l) => best[l.name] != null).length;
    const bestCoins = readJSON(COINS_KEY) || {};
    const coinsGot = LEVELS.reduce((n, l) => n + (bestCoins[l.name] || 0), 0);
    const coinsAll = LEVELS.reduce((n, l) => n + (l.coins ? l.coins.length : 0), 0);
    document.getElementById('levelsProgress').textContent =
      `${beaten} of ${campaign.length} levels beaten  ·  ◆ ${coinsGot} / ${coinsAll} coins`;
    document.getElementById('levelsProgressBar').style.width = `${(beaten / campaign.length) * 100}%`;
    const next = Core.firstUnbeaten(LEVELS, best);
    const acts = LEVELS.acts || [{ title: 'Levels', about: '', levels: LEVELS.map((_, i) => i) }];
    let actNumber = 0, nextCard = null;

    for (const act of acts) {
      const section = document.createElement('section');
      section.className = 'act';
      const head = document.createElement('div');
      head.className = 'act-head';
      const done = act.levels.filter((i) => best[LEVELS[i].name] != null).length;
      head.innerHTML = '<h3><span class="act-num"></span> <span class="title"></span></h3>' +
        '<span class="about"></span><span class="count"></span>';
      head.querySelector('.act-num').textContent = act.practice ? '★' : `Act ${++actNumber}`;
      head.querySelector('.title').textContent = act.title;
      head.querySelector('.about').textContent = act.about;
      const count = head.querySelector('.count');
      if (!act.practice) {
        count.textContent = `${done}/${act.levels.length}`;
        count.classList.toggle('complete', done === act.levels.length);
      }
      const grid = document.createElement('div');
      grid.className = 'act-grid';
      act.levels.forEach((i, k) => {
        const l = LEVELS[i];
        const t = best[l.name];
        const a = document.createElement('a');
        a.href = Core.levelHash(i);
        a.className = 'level-card' + (t != null ? ' done' : '') + (l.practice ? ' practice' : '') + (i === next ? ' next' : '');
        a.innerHTML = '<span class="num"></span><span class="name"></span><span class="best"></span>';
        a.querySelector('.num').textContent = l.practice ? '★' : i + 1;
        a.querySelector('.name').textContent = l.name;
        a.title = l.name;
        const got = bestCoins[l.name], total = l.coins ? l.coins.length : 0;
        a.querySelector('.best').textContent = (t != null ? `Best ${t.toFixed(1)}s` : l.practice ? 'Practice' : i === next ? 'Up next' : '') +
          (got != null ? `  ◆ ${got}/${total}` : '');
        if (t != null) a.insertAdjacentHTML('beforeend', '<span class="check">✓</span>');
        else if (!l.practice && k === act.levels.length - 1) a.insertAdjacentHTML('beforeend', '<span class="tag-peak">PEAK</span>');
        if (i === next) nextCard = a;
        grid.appendChild(a);
      });
      section.append(head, grid);
      body.appendChild(section);
    }
    body.scrollTop = 0;
    if (nextCard && next > 4) requestAnimationFrame(() => nextCard.scrollIntoView({ block: 'center' }));
  }

  function buildOptions() {
    document.getElementById('optVolume').value = Math.round(settings.volume * 100);
    document.getElementById('optVolumeVal').textContent = `${Math.round(settings.volume * 100)}%`;
    document.getElementById('optMuted').checked = settings.muted;
    document.getElementById('optShake').checked = settings.screenShake;
    document.getElementById('optAim').checked = settings.aimLine;
    document.getElementById('optSkin').value = settings.playerSkin;
    document.getElementById('optBlood').checked = settings.bloodEffects;
    document.getElementById('optHeading').checked = settings.headingMarker;
    document.getElementById('optFullscreen').checked = isFullscreen();
    document.getElementById('optStartFullscreen').checked = settings.startFullscreen;
  }

  function saveSettings(patch) {
    settings = Core.sanitizeSettings(Object.assign({}, settings, patch));
    writeJSON(SETTINGS_KEY, settings);
    applySettings();
    buildOptions();
  }

  document.getElementById('optVolume').addEventListener('input', (e) => saveSettings({ volume: e.target.value / 100 }));
  document.getElementById('optVolume').addEventListener('change', () => Sfx.thrust(false)); // preview
  document.getElementById('optMuted').addEventListener('change', (e) => saveSettings({ muted: e.target.checked }));
  document.getElementById('optShake').addEventListener('change', (e) => saveSettings({ screenShake: e.target.checked }));
  document.getElementById('optAim').addEventListener('change', (e) => saveSettings({ aimLine: e.target.checked }));
  document.getElementById('optHeading').addEventListener('change', (e) => saveSettings({ headingMarker: e.target.checked }));
  document.getElementById('optFullscreen').addEventListener('change', (e) => setFullscreen(e.target.checked));
  document.getElementById('optStartFullscreen').addEventListener('change', (e) => saveSettings({ startFullscreen: e.target.checked }));
  document.getElementById('optSkin').addEventListener('change', (e) => { saveSettings({ playerSkin: e.target.value }); applySkin(); });
  document.getElementById('optBlood').addEventListener('change', (e) => saveSettings({ bloodEffects: e.target.checked }));
  document.getElementById('versionTag').innerHTML = `v${Core.VERSION} <b>${Core.STAGE}</b>`;
  document.getElementById('quitBtn').addEventListener('click', (e) => {
    e.preventDefault();
    if (typeof nw !== 'undefined') nw.App.quit();
  });
  document.getElementById('optReset').addEventListener('click', () => {
    if (confirm('Reset all best times and progress?')) {
      try { localStorage.removeItem(PROGRESS_KEY); } catch { /* ignore */ }
      Sfx.uiClick();
    }
  });

  // UI sounds for every menu button and card
  document.addEventListener('pointerover', (e) => {
    if (e.target.closest && e.target.closest('.btn, .level-card') && !e.target.closest('.btn, .level-card').contains(e.relatedTarget)) Sfx.uiHover();
  });
  document.addEventListener('click', (e) => {
    if (e.target.closest && e.target.closest('.btn, .level-card')) Sfx.uiClick();
  });

  function route() {
    const r = Core.parseRoute(location.hash, LEVELS.length);
    if (r.redirect) history.replaceState(null, '', r.redirect);
    if (r.screen === 'game') {
      if (state.paused && r.level === state.levelIndex && !state.forceRestart) state.paused = false; // resume
      else loadLevel(r.level);
      state.forceRestart = false;
    } else {
      // menus show the paused level behind them, or a calm backdrop
      if (!state.paused && (state.screen === 'game' || !state.world)) loadLevel(0);
      if (r.screen === 'menu') buildMenu();
      if (r.screen === 'levels') buildLevelGrid();
      if (r.screen === 'options') buildOptions();
    }
    showScreen(r.screen);
  }

  // Picking a level (Play, Level Select, Tutorial, Test Ground) always starts it fresh;
  // only Resume (or browser Back) continues a paused level.
  document.addEventListener('click', (e) => {
    const a = e.target.closest && e.target.closest('a[href^="#/level/"]');
    if (a && a.id !== 'resumeBtn') state.forceRestart = true;
  }, true);

  window.addEventListener('hashchange', route);
  route();

  // Handy for debugging from the console
  window.__jetpack = { state, Core, CFG, loadLevel, resetPlayer, mouse, world, app };

  // Desktop smoke test (used by `npm run test:desktop` and `npm run shot`):
  //   JetpackMan.exe --smoke-test=<file> [--smoke-level=<n | menu | levels | options>]
  // opens level n (default 1) or a menu screen, writes <file>.json + <file>.png and quits.
  // Levels are captured zoomed out to show the whole map.
  if (nwWin) {
    const argv = [...(nw.App.argv || []), ...(nw.App.fullArgv || [])];
    const opt = (name) => {
      const a = argv.find((x) => x.startsWith(`--${name}=`));
      return a && a.slice(name.length + 3);
    };
    if (opt('smoke-size')) {
      const [w, h] = opt('smoke-size').split('x').map(Number);
      nwWin.resizeTo(w, h);
    }
    if (opt('smoke-test')) runSmokeTest(opt('smoke-test'), opt('smoke-level') || '1');
  }

  // Grabs the window as it is on screen. (PIXI's extract mangles semi-transparent lines, so the
  // real window is captured instead, with the camera zoomed out to show the whole level.)
  // Levels: read the freshly drawn canvas (reliable even when the window is in the background).
  // Menus are HTML, so those need a real window capture (focused first so it's up to date).
  async function captureWindow(menu) {
    if (!menu) {
      // Hidden windows get no animation frames, so run a few game frames by hand first
      for (let i = 0; i < 3; i++) app.ticker.update(performance.now() + i * 16);
      updateCamera(0);
      app.renderer.render(app.stage);
      return Buffer.from(app.view.toDataURL('image/png').split(',')[1], 'base64');
    }
    nwWin.show();
    nwWin.focus();
    await new Promise((r) => setTimeout(r, 600));
    return new Promise((resolve) => nwWin.capturePage((buf) => resolve(buf), { format: 'png', datatype: 'buffer' }));
  }

  async function runSmokeTest(file, target) {
    const menuScreen = ['menu', 'levels', 'options'].includes(target) ? target : null;
    const levelNumber = Math.min(LEVELS.length, Math.max(1, Number(target) || 1));
    const fs = require('fs');
    const report = { ok: false, errors: [] };
    window.addEventListener('error', (e) => report.errors.push(String(e.message)));
    try {
      await new Promise((r) => setTimeout(r, 1000));
      navigate(menuScreen ? `#/${menuScreen}` : Core.levelHash(levelNumber - 1));
      await new Promise((r) => setTimeout(r, 1500));
      Object.assign(report, {
        pixi: PIXI.VERSION,
        levels: LEVELS.length,
        screen: state.screen,
        level: LEVELS[state.levelIndex].name,
        desktopClass: document.body.classList.contains('desktop'),
        fullscreen: isFullscreen(),
        window: { width: window.innerWidth, height: window.innerHeight },
        audio: typeof Sfx.thrust === 'function',
      });
      if (!menuScreen) {
        photoMode = true;
        hud.visible = false;
        reticle.visible = false;
      }
      await new Promise((r) => setTimeout(r, 300));
      // A background window may skip frames, so draw this one explicitly before capturing
      updateCamera(0);
      app.renderer.render(app.stage);
      fs.writeFileSync(`${file}.png`, await captureWindow(!!menuScreen));
      report.ok = report.errors.length === 0 && state.screen === (menuScreen || 'game');
    } catch (e) {
      report.errors.push(String(e && e.stack || e));
    }
    fs.writeFileSync(`${file}.json`, JSON.stringify(report, null, 2));
    nw.App.quit();
  }
})();
