// Small synthesized sound effects (WebAudio, no files). Kept soft on purpose:
// everything runs through a quiet master gain and a compressor.
(function (root) {
  const MASTER_LEVEL = 0.35; // loudness at 100% volume

  let ctx = null, master = null, noiseBuf = null;
  let volume = 0.6, muted = false;

  function ensure() {
    if (ctx) return ctx.state !== 'closed';
    const AC = root.AudioContext || root.webkitAudioContext;
    if (!AC) return false;
    ctx = new AC();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.ratio.value = 4;
    master = ctx.createGain();
    master.connect(comp).connect(ctx.destination);
    applyVolume();
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return true;
  }

  function applyVolume() {
    if (master) master.gain.value = muted ? 0 : volume * MASTER_LEVEL;
  }

  // Browsers only allow audio after a user gesture.
  function unlock() {
    if (ensure() && ctx.state === 'suspended') ctx.resume();
  }

  const ready = () => ctx && ctx.state === 'running' && !muted && volume > 0;

  function envelope(t, dur, peak, attack = 0.01) {
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    g.connect(master);
    return g;
  }

  function tone({ type = 'sine', from, to, dur, peak = 0.3, delay = 0, attack }) {
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(from, t);
    if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
    o.connect(envelope(t, dur, peak, attack));
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  function noise({ dur, peak = 0.3, type = 'bandpass', from, to, q = 1, delay = 0, attack }) {
    const t = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.Q.value = q;
    f.frequency.setValueAtTime(from, t);
    if (to) f.frequency.exponentialRampToValueAtTime(to, t + dur);
    src.connect(f).connect(envelope(t, dur, peak, attack));
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.05);
  }

  const play = (fn) => (...args) => { if (ready()) fn(...args); };

  const Sfx = {
    unlock,
    setVolume(v) { volume = Math.min(1, Math.max(0, v)); applyVolume(); },
    setMuted(m) { muted = !!m; applyVolume(); },

    // Soft "fwoomp". Right-click thrust is pitched a touch higher.
    thrust: play((toward) => {
      const k = toward ? 1.25 : 1;
      noise({ dur: 0.28, peak: 0.55, from: 1100 * k, to: 280 * k, q: 0.8 });
      tone({ type: 'sine', from: 150 * k, to: 70 * k, dur: 0.18, peak: 0.25 });
    }),
    // Out of stamina: a dry little puff
    empty: play(() => {
      noise({ dur: 0.1, peak: 0.15, type: 'highpass', from: 2500, q: 0.5 });
      tone({ type: 'triangle', from: 180, to: 140, dur: 0.08, peak: 0.08 });
    }),
    refilled: play(() => {
      tone({ type: 'sine', from: 660, dur: 0.12, peak: 0.08 });
      tone({ type: 'sine', from: 990, dur: 0.16, peak: 0.07, delay: 0.07 });
    }),
    // Landing on a pad: a quick rising "fill up" shimmer
    refill: play(() => {
      tone({ type: 'sine', from: 330, to: 990, dur: 0.38, peak: 0.07, attack: 0.05 });
      [392, 523.25, 659.25, 783.99].forEach((f, i) =>
        tone({ type: 'triangle', from: f, dur: 0.16, peak: 0.07, delay: 0.05 + i * 0.07 }));
    }),
    // Drone notices you: a quick two-tone warning
    enemyAlert: play(() => {
      tone({ type: 'square', from: 520, dur: 0.07, peak: 0.035 });
      tone({ type: 'square', from: 780, dur: 0.09, peak: 0.035, delay: 0.09 });
    }),
    // Drone dashes: a low swoosh
    enemyDash: play(() => {
      noise({ dur: 0.32, peak: 0.16, from: 250, to: 900, q: 1.2 });
      tone({ type: 'sawtooth', from: 110, to: 70, dur: 0.25, peak: 0.04 });
    }),
    // Drone destroyed: crunch and a falling chirp
    enemyKilled: play(() => {
      noise({ dur: 0.25, peak: 0.25, type: 'lowpass', from: 2200, to: 300 });
      tone({ type: 'triangle', from: 880, to: 220, dur: 0.3, peak: 0.1 });
    }),
    // Saw shot apart: a metallic clang and a grinding crunch
    sawBreak: play(() => {
      [1180, 1730, 2410].forEach((f) => tone({ type: 'square', from: f, to: f * 0.7, dur: 0.35, peak: 0.025 }));
      noise({ dur: 0.35, peak: 0.3, type: 'bandpass', from: 3000, to: 800, q: 2 });
      noise({ dur: 0.25, peak: 0.2, type: 'lowpass', from: 1200, to: 200, delay: 0.05 });
    }),
    // Shield picked up: bright rising sparkle
    shieldGet: play(() => {
      [659.25, 880, 1174.66].forEach((f, i) =>
        tone({ type: 'sine', from: f, dur: 0.22, peak: 0.09, delay: i * 0.06 }));
      noise({ dur: 0.25, peak: 0.04, type: 'highpass', from: 5000 });
    }),
    // Shield broken by a drone: glassy crack and a falling tone
    shieldLost: play(() => {
      noise({ dur: 0.2, peak: 0.2, type: 'highpass', from: 3500, q: 0.7 });
      tone({ type: 'triangle', from: 990, to: 330, dur: 0.35, peak: 0.1 });
    }),
    // Shield bounce off rock or a saw: springy boing (the shield is used up)
    bounce: play(() => {
      tone({ type: 'sine', from: 160, to: 520, dur: 0.18, peak: 0.2 });
      tone({ type: 'triangle', from: 520, to: 260, dur: 0.25, peak: 0.07, delay: 0.12 });
    }),
    // Starting to hover: a soft airy lift
    hover: play(() => {
      noise({ dur: 0.3, peak: 0.08, from: 500, to: 1400, q: 2, attack: 0.08 });
      tone({ type: 'sine', from: 220, to: 330, dur: 0.3, peak: 0.06, attack: 0.08 });
    }),
    // Reaching a checkpoint: two bright bell notes
    checkpoint: play(() => {
      tone({ type: 'triangle', from: 783.99, dur: 0.25, peak: 0.1 });
      tone({ type: 'triangle', from: 1174.66, dur: 0.4, peak: 0.09, delay: 0.1 });
    }),
    pusher: play(() => {
      tone({ type: 'triangle', from: 260, to: 820, dur: 0.24, peak: 0.18 });
      noise({ dur: 0.2, peak: 0.12, from: 600, to: 2400, q: 1.5 });
    }),
    // Landing on a pad: a soft, soothing two-note bell over a gentle hush
    land: play(() => {
      tone({ type: 'sine', from: 140, to: 80, dur: 0.12, peak: 0.12 });
      tone({ type: 'sine', from: 523.25, dur: 0.9, peak: 0.05, attack: 0.02 });
      tone({ type: 'sine', from: 783.99, dur: 1.1, peak: 0.035, delay: 0.06, attack: 0.03 });
      noise({ dur: 0.35, peak: 0.03, type: 'lowpass', from: 700, to: 300, attack: 0.05 });
    }),
    // Coin: the classic two-step "ding-ding"; chained coins climb in pitch
    coin: play((combo = 0) => {
      const k = Math.pow(2, Math.min(combo, 12) / 12); // up a semitone per chained coin
      tone({ type: 'square', from: 987.77 * k, dur: 0.07, peak: 0.045 });
      tone({ type: 'square', from: 1318.51 * k, dur: 0.22, peak: 0.045, delay: 0.06 });
      tone({ type: 'sine', from: 2637 * k, dur: 0.15, peak: 0.02, delay: 0.06 });
    }),
    // Fuel cell: a rising power-up whoosh
    fuelGet: play(() => {
      tone({ type: 'sawtooth', from: 180, to: 720, dur: 0.45, peak: 0.05, attack: 0.03 });
      tone({ type: 'sine', from: 360, to: 1440, dur: 0.45, peak: 0.08, attack: 0.03 });
      noise({ dur: 0.4, peak: 0.08, from: 600, to: 3000, q: 1.5 });
    }),
    // Fuel running low: soft ticks; empty: a power-down
    fuelTick: play(() => tone({ type: 'square', from: 1200, dur: 0.04, peak: 0.03 })),
    fuelOut: play(() => {
      tone({ type: 'sawtooth', from: 600, to: 120, dur: 0.5, peak: 0.05 });
      tone({ type: 'sine', from: 800, to: 200, dur: 0.5, peak: 0.06 });
    }),
    // Pistol pickup: a mechanical rack
    gunGet: play(() => {
      noise({ dur: 0.06, peak: 0.25, type: 'highpass', from: 2000 });
      noise({ dur: 0.07, peak: 0.25, type: 'bandpass', from: 1200, q: 3, delay: 0.12 });
      tone({ type: 'square', from: 220, to: 180, dur: 0.05, peak: 0.04, delay: 0.12 });
    }),
    // Shot: a sharp crack with a little low body
    shoot: play(() => {
      noise({ dur: 0.14, peak: 0.45, type: 'highpass', from: 1800, to: 600, q: 0.7 });
      noise({ dur: 0.2, peak: 0.25, type: 'lowpass', from: 900, to: 150 });
      tone({ type: 'triangle', from: 260, to: 70, dur: 0.15, peak: 0.12 });
    }),
    // Trigger on an empty pistol: a dry click
    gunEmpty: play(() => noise({ dur: 0.03, peak: 0.2, type: 'highpass', from: 3000 })),
    // Bullet hits rock: a small ping
    bulletHit: play(() => {
      tone({ type: 'triangle', from: 1800, to: 900, dur: 0.08, peak: 0.04 });
      noise({ dur: 0.06, peak: 0.08, type: 'highpass', from: 2500 });
    }),
    // CRASHED appears: a low, ominous swell
    deathSting: play(() => {
      tone({ type: 'sine', from: 98, to: 82, dur: 1.8, peak: 0.16, attack: 0.25 });
      tone({ type: 'triangle', from: 196, to: 164, dur: 1.4, peak: 0.05, attack: 0.3 });
      noise({ dur: 1.2, peak: 0.04, type: 'lowpass', from: 300, to: 120, attack: 0.3 });
    }),
    // Saw death: a grinding buzz and a wet splat
    deathSaw: play(() => {
      tone({ type: 'sawtooth', from: 220, to: 90, dur: 0.35, peak: 0.08 });
      noise({ dur: 0.3, peak: 0.35, type: 'bandpass', from: 1800, to: 400, q: 2 });
      noise({ dur: 0.25, peak: 0.25, type: 'lowpass', from: 500, to: 120, delay: 0.08 });
    }),
    // Crusher death: a heavy crunch
    deathCrush: play(() => {
      tone({ type: 'sine', from: 90, to: 40, dur: 0.4, peak: 0.35 });
      noise({ dur: 0.18, peak: 0.4, type: 'lowpass', from: 1500, to: 200 });
    }),
    // Drone death: an electric zap
    deathZap: play(() => {
      tone({ type: 'square', from: 1400, to: 120, dur: 0.3, peak: 0.06 });
      noise({ dur: 0.35, peak: 0.25, type: 'highpass', from: 2500, to: 800, q: 1 });
    }),
    death: play(() => {
      noise({ dur: 0.55, peak: 0.45, type: 'lowpass', from: 1400, to: 90, q: 0.7 });
      tone({ type: 'triangle', from: 240, to: 55, dur: 0.5, peak: 0.18 });
    }),
    win: play(() => {
      [523.25, 659.25, 783.99, 1046.5].forEach((f, i) =>
        tone({ type: 'triangle', from: f, dur: 0.35, peak: 0.14, delay: i * 0.09 }));
    }),
    uiHover: play(() => tone({ type: 'sine', from: 720, dur: 0.05, peak: 0.04 })),
    uiClick: play(() => tone({ type: 'triangle', from: 520, to: 880, dur: 0.09, peak: 0.1 })),
  };

  root.Sfx = Sfx;
})(typeof self !== 'undefined' ? self : this);
