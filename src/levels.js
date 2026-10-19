// Level data. Loaded as a plain <script> (window.LEVELS) and by the Node tests.
//
// Map characters, one per tile (40px):
//   #  rock: deadly to touch
//   =  landing pad: safe to land on; landing refills stamina
//   C  checkpoint pad: a pad that also becomes your respawn point once you land on it
//   S  player start (stands on the tile below; make that a pad)
//   G  goal
//   .  empty air
// Rows shorter than the widest row are padded with rock.
//
// Everything below uses tile units (fractions allowed).
//
// pushers: small rings that fling the player when touched.
//   { x, y, r, angle, power }
//   angle  fixed push direction in degrees: 0 = right, 90 = down, 180 = left, -90 = up
//   power  speed the player is launched at, px/s (default 480)
//
// movers: deadly moving obstacles. x/y is the obstacle's centre.
//   saw on a path:   { shape: 'saw', r, path: [[x, y], ...], speed (tiles/s), phase }
//   saw on an orbit: { shape: 'saw', r, orbit: { x, y, radius }, speed (deg/s), phase }
//   block:           { shape: 'block', w, h, path: [[x, y], ...], speed, phase }
//   Path movers ping-pong back and forth.
//
// signs: text drawn in the world. { x, y, text }
//
// enemies: drones. { x, y, range, dash, speed, recharge } (all optional except x, y)
//   They wake when you're within `range` tiles (default 6) and in sight, flash red for a moment,
//   dash `dash` tiles (default 6) toward you at `speed` px/s (default 380), then rest `recharge` s.
//
// coins: extra collectibles placed by hand. { x, y }
//   Every level also gets coins automatically (autoCoins below):
//   - one per landing pad (not the start pad), floating ~2 tiles above its middle: a quick hop gets it
//   - 2-3 "challenge" coins out in open air, away from pads and far from the goal, clear of rock,
//     saws, crushers and drones
//
// fuels: fuel cells. { x, y } — 15 s of unlimited thrusting (stamina locked full)
// guns: pistols. { x, y } — 3 bullets (picking up another refills to 3, never more);
//   scroll the mouse wheel to fire one shot from the head; bullets destroy drones
//
// shields: gold shield pickups. { x, y }
//   With a shield: touching any drone destroys it; if it was mid-dash the shield breaks too; touching rock or a saw bounces you off and uses the shield up.
(function (root) {
  // Builds a W x H map with a rock border. draw() gets helpers to place tiles.
  function buildMap(W, H, draw) {
    const g = Array.from({ length: H }, (_, r) =>
      Array.from({ length: W }, (_, c) => (r === 0 || c === 0 || r === H - 1 || c === W - 1 ? '#' : '.')));
    const fill = (ch) => (c, r, w = 1, h = 1) => {
      for (let y = r; y < r + h; y++) for (let x = c; x < c + w; x++) g[y][x] = ch;
    };
    draw({
      rock: fill('#'),
      air: fill('.'),
      pad: (c, r, w = 1) => fill('=')(c, r, w, 1),
      checkpoint: (c, r, w = 1) => fill('C')(c, r, w, 1),
      // pad on top of a rock column reaching down to the floor
      pillar: (c, r, w = 1, ch = '=') => { fill(ch)(c, r, w, 1); fill('#')(c, r + 1, w, H - 2 - r); },
      // pad with a one-tile rock slab under it, floating in the air
      ledge: (c, r, w = 1, ch = '=') => { fill(ch)(c, r, w, 1); fill('#')(c, r + 1, w, 1); },
      set: (c, r, ch) => { g[r][c] = ch; },
    });
    return g.map((row) => row.join(''));
  }

  const DEFS = [
    {
      name: 'Tutorial',
      map: buildMap(64, 14, (b) => {
        b.rock(1, 12, 5); b.pad(1, 11, 5); b.set(3, 10, 'S'); // start
        b.rock(10, 8, 2, 5);                                  // first hop
        b.rock(13, 12, 6); b.pad(13, 11, 6);
        b.rock(24, 9, 5, 4); b.pad(24, 8, 5);                 // raised pad
        b.rock(38, 12, 5); b.checkpoint(38, 11, 5);           // halfway checkpoint
        b.rock(45, 6, 2, 7);                                  // wall: the pusher carries you over
        b.rock(48, 12, 5); b.pad(48, 11, 5);
        b.rock(57, 12, 6); b.pad(57, 11, 6); b.set(60, 9, 'G');
      }),
      signs: [
        { x: 6, y: 3, text: 'Your feet always point at the mouse.\nLEFT CLICK thrusts you away from it.' },
        { x: 16, y: 6.5, text: 'Land on GREEN pads to rest.\nAll other ground is deadly!' },
        { x: 26.5, y: 3.5, text: 'RIGHT CLICK thrusts you toward the mouse.\nHold MIDDLE CLICK to hover, sinking slowly\n(it uses a little stamina, and still works when empty).' },
        { x: 35, y: 6.5, text: 'Each thrust uses a quarter of your stamina.\nRun dry and you must wait for a full refill.' },
        { x: 42, y: 2.3, text: 'Blue PUSHERS fling you\nwhere the arrow points.' },
        { x: 50.5, y: 7, text: 'Dodge saws and\nyellow blocks.' },
        { x: 60, y: 6.3, text: 'Reach the flag!' },
      ],
      pushers: [
        { x: 43, y: 8.5, angle: -65, power: 560 },  // tuned by playing: clears the wall on its own
      ],
      movers: [
        { shape: 'saw', r: 0.6, path: [[55, 2.5], [55, 9.5]], speed: 1.2 },
      ],
    },
    {
      name: 'First Flight',
      map: [
        '####################################',
        '#..................................#',
        '#..................................#',
        '#..................................#',
        '#..................................#',
        '#.............======...............#',
        '#.............######...............#',
        '#..................................#',
        '#..................................#',
        '#.S..........................G.....#',
        '#===.......................#####...#',
        '####.......................#####...#',
        '####...............................#',
        '####################################',
      ],
    },
    {
      name: 'The Shaft',
      map: [
        '##############################',
        '#.........#..................#',
        '#.........#..................#',
        '#.........#.......G..........#',
        '#.........#..................#',
        '#.........#.....=======......#',
        '#............................#',
        '#......................#######',
        '######..............===#######',
        '#...........===.....#........#',
        '#...........###.....#........#',
        '#...................#........#',
        '#.S.................#........#',
        '#=====.......########........#',
        '##############################',
      ],
    },
    {
      name: 'Updraft',
      map: [
        '####################################',
        '#..................................#',
        '#..................................#',
        '#..................................#',
        '#..................................#',
        '#..................................#',
        '#..........=========...............#',
        '#..........#########...............#',
        '#..........#########...............#',
        '#..........#########.........G.....#',
        '#..........#########.......#####...#',
        '#.S........#########.......#####...#',
        '#===.......#########...............#',
        '####...............................#',
        '####...............................#',
        '####################################',
      ],
      pushers: [
        { x: 7.5, y: 8, angle: -80, power: 520 },   // launches you up over the block
        { x: 23, y: 3, angle: 40, power: 360 },     // sends you down toward the goal
        { x: 15.5, y: 14, angle: 180, power: 360 }, // knocks you back if you go under
      ],
    },
    {
      name: 'Serpent Cave',
      map: [
        '########################################',
        '#........#.................#...........#',
        '#........#.................#...........#',
        '#........#.................#...........#',
        '#........#.................#...........#',
        '#........#.................#...........#',
        '#........#........=........#...........#',
        '#.................#....................#',
        '#.................#................G...#',
        '#.................#....................#',
        '#.S...............#....................#',
        '#====.............#....................#',
        '####################======##############',
      ],
      pushers: [
        { x: 13.5, y: 9.5, angle: -70, power: 460 }, // lifts you toward the gap over the middle pillar
      ],
      movers: [
        { shape: 'saw', r: 0.6, path: [[23, 2], [23, 9.5]], speed: 1.5 },
      ],
    },
    {
      name: 'Crosswinds',
      map: [
        '##############################################',
        '#..........#.................#...............#',
        '#..........#.................#...............#',
        '#..........#.................#...............#',
        '#..........#.................#...............#',
        '#..................====......#...............#',
        '#..................####..........=====.......#',
        '#.S................####..........#####...G...#',
        '#===.......#.....................#####.......#',
        '####.......#.................#...............#',
        '####.......#.................#...............#',
        '##############################################',
      ],
      pushers: [
        { x: 7, y: 8, angle: -45, power: 440 },
        { x: 26, y: 8.5, angle: -135, power: 480 }, // flings you back up-left: avoid it
        { x: 31.5, y: 7, angle: 10, power: 400 },
      ],
      movers: [
        { shape: 'saw', r: 0.6, path: [[13, 2.5], [27.5, 2.5]], speed: 3 },
        { shape: 'saw', r: 0.5, orbit: { x: 21, y: 6.5, radius: 2.6 }, speed: -90 },
        { shape: 'block', w: 1, h: 2, path: [[39.5, 2], [39.5, 9.5]], speed: 2.2 },
      ],
    },
    {
      name: 'The Ridge',
      map: buildMap(32, 17, (b) => {
        b.pad(3, 15, 4); b.set(4, 14, 'S');  // start pad, bottom left
        // rock ridge climbing from the bottom middle up to the right
        b.rock(11, 14, 4, 2);
        b.rock(12, 12, 3, 2);
        b.rock(12, 12, 5);
        b.rock(13, 11, 5);
        b.rock(17, 9, 2, 2);
        b.rock(18, 8); b.pad(19, 8, 4); b.rock(23, 8);  // upper step with a pad on top
        b.rock(24, 4, 1, 5);                              // tall pillar: fly over it
        b.set(20, 13, 'G');                               // goal in the lower chamber
      }),
      pushers: [
        { x: 14.5, y: 9.3, angle: -90, power: 520 },     // lifts you up past the lower step
      ],
      movers: [
        { shape: 'saw', r: 0.7, path: [[25.5, 10.5]] },  // guards the way into the chamber
      ],
    },
    {
      name: 'Test Ground',
      practice: true, // open arena for practising; not part of the campaign
      map: buildMap(80, 40, (b) => {
        b.rock(1, 38, 6); b.pad(1, 37, 6); b.set(3, 36, 'S');
        b.rock(20, 29, 6); b.pad(20, 28, 6);
        b.rock(38, 19, 8); b.pad(38, 18, 8);
        b.rock(55, 31, 5, 4); b.pad(55, 30, 5);
        b.rock(30, 8, 4, 4);
        b.rock(62, 13, 6); b.pad(62, 12, 6);
        b.set(75, 5, 'G');
      }),
      pushers: [
        { x: 12, y: 30, angle: -90, power: 480 },
        { x: 45, y: 30, angle: -45, power: 480 },
        { x: 60, y: 22, angle: 180, power: 400 },
        { x: 25, y: 14, angle: 30, power: 440 },
        { x: 70, y: 22, angle: -100, power: 520 },
      ],
      guns: [{ x: 9, y: 33 }, { x: 47, y: 15 }],
      fuels: [{ x: 22, y: 25 }],
      enemies: [{ x: 40, y: 10 }, { x: 58, y: 9 }, { x: 70, y: 30 }],
      movers: [
        { shape: 'saw', r: 0.7, orbit: { x: 32, y: 10, radius: 3.5 }, speed: 60 },
        { shape: 'block', w: 2, h: 1, path: [[48, 36], [72, 36]], speed: 2 },
      ],
    },
    // ===================== New campaign levels (see CAMPAIGN order below) =====================
    {
      // Act 1 · rhythm: short hops pad to pad, refilling on every landing
      name: 'Hop Scotch',
      map: buildMap(44, 14, (b) => {
        b.pillar(1, 11, 4); b.set(2, 10, 'S');
        b.pillar(9, 10, 3);
        b.pillar(16, 9, 3);
        b.pillar(23, 10, 3);
        b.pillar(30, 8, 3);
        b.pillar(37, 10, 6); b.set(40, 8, 'G');
      }),
    },
    {
      // Act 1 peak · stamina budgeting: 8-9 tile gaps, stalactites force a lower line
      name: 'Long Haul',
      map: buildMap(60, 16, (b) => {
        b.pillar(1, 13, 4); b.set(2, 12, 'S');
        b.pillar(13, 12, 3);
        b.rock(20, 1, 3, 6);
        b.pillar(25, 11, 3);
        b.pillar(37, 12, 3);
        b.rock(42, 1, 3, 8);
        b.pillar(49, 11, 3);
        b.pillar(55, 9, 4); b.set(57, 7, 'G');
      }),
    },
    {
      // Act 2 breather · helpful pushers chained like a pinball table, no hazards
      name: 'Bounce House',
      map: buildMap(44, 20, (b) => {
        b.pillar(1, 17, 4); b.set(2, 16, 'S');
        b.pillar(14, 16, 4);
        b.rock(18, 1, 2, 5);
        b.ledge(22, 10, 4);
        b.ledge(36, 5, 7); b.set(40, 3, 'G');
      }),
      pushers: [
        { x: 9, y: 15, angle: -60, power: 480 },
        { x: 28, y: 13, angle: -80, power: 500 },
        { x: 31, y: 7, angle: -30, power: 420 },
      ],
    },
    {
      // Act 2 · hostile pushers guard each opening; a downdraft over a deadly floor, a shove onto a wall
      name: 'Headwind',
      map: buildMap(48, 16, (b) => {
        b.pillar(1, 13, 4); b.set(2, 12, 'S');
        b.rock(12, 1, 2, 8);          // wall with an opening below
        b.pillar(17, 12, 4);
        b.rock(25, 7, 2, 8);          // wall with an opening above
        b.pillar(30, 11, 4);
        b.pillar(43, 10, 4); b.set(45, 8, 'G');
      }),
      pushers: [
        { x: 12.5, y: 12, angle: 90, power: 380 },    // downdraft: stay above it
        { x: 25.5, y: 3.5, angle: 90, power: 380 },   // shoves you down onto the wall
        { x: 38, y: 8, angle: -150, power: 420 },     // throws you back up-left
      ],
    },
    {
      // Act 2 peak · first checkpoint; a long 4-tile canyon with pushers carrying you through
      name: 'Slingshot Canyon',
      map: buildMap(64, 18, (b) => {
        b.pillar(1, 15, 4); b.set(2, 14, 'S');
        b.rock(10, 5, 2, 12);         // wall: the pusher lifts you over
        b.pillar(14, 10, 4, 'C');     // checkpoint before the canyon
        b.rock(20, 1, 24, 6);         // canyon ceiling
        b.rock(20, 11, 24, 6);        // canyon floor
        b.pad(29, 10, 3);             // rest stop inside the canyon
        b.pillar(55, 12, 7); b.set(58, 10, 'G');
      }),
      pushers: [
        { x: 7, y: 12, angle: -75, power: 500 },
        { x: 22, y: 8.5, angle: 0, power: 420 },
        { x: 35, y: 8.5, angle: 0, power: 420 },
      ],
      movers: [
        { shape: 'saw', r: 0.7, path: [[50, 9]] },
      ],
    },
    {
      // Act 3 · twin saws sweep each lane of a low corridor; time each crossing, rest between
      name: 'Sawmill',
      map: buildMap(52, 14, (b) => {
        // Playtested with mouse-like aim and timing error: 6-wide pads, 4-tile gaps, a 9-row corridor,
        // and a checkpoint in the middle (narrow pads / low ceiling made every hop a coin flip)
        b.pillar(1, 11, 6); b.set(2, 10, 'S');
        b.rock(7, 1, 37, 3);          // ceiling over the saw lanes
        b.pillar(11, 10, 6);
        b.pillar(21, 10, 6, 'C');
        b.pillar(31, 10, 6);
        b.pillar(41, 9, 10); b.set(47, 7, 'G');
      }),
      movers: [
        // one saw per lane (twin saws left almost no window for mouse play), r 0.8 -> 0.45
        { shape: 'saw', r: 0.45, path: [[9, 5.8], [9, 11.2]], speed: 1.8 },
        { shape: 'saw', r: 0.45, path: [[19, 5.8], [19, 11.2]], speed: 2.0, phase: 3 },
        { shape: 'saw', r: 0.45, path: [[29, 5.8], [29, 11.2]], speed: 2.2, phase: 1 },
        { shape: 'saw', r: 0.45, path: [[39, 5.8], [39, 11.2]], speed: 2.4, phase: 4 },
      ],
    },
    {
      // Act 3 · floating islands under a low ceiling, each circled by twin slow saws (Orbit Overdrive is the fast one)
      name: 'Orbit Garden',
      map: buildMap(48, 18, (b) => {
        b.pillar(1, 15, 4); b.set(2, 14, 'S');
        b.rock(6, 1, 33, 4);          // ceiling: no flying over the saws
        b.ledge(10, 12, 4);
        b.ledge(20, 8, 4);
        b.ledge(30, 12, 4);
        b.ledge(39, 7, 6); b.set(42, 5, 'G');
      }),
      movers: [
        { shape: 'saw', r: 0.6, orbit: { x: 12, y: 12.5, radius: 3 }, speed: 50 },
        { shape: 'saw', r: 0.6, orbit: { x: 12, y: 12.5, radius: 3 }, speed: 50, phase: 180 },
        { shape: 'saw', r: 0.6, orbit: { x: 22, y: 8.5, radius: 3 }, speed: -55 },
        { shape: 'saw', r: 0.6, orbit: { x: 22, y: 8.5, radius: 3 }, speed: -55, phase: 180 },
        { shape: 'saw', r: 0.6, orbit: { x: 32, y: 12.5, radius: 3 }, speed: 60, phase: 90 },
        { shape: 'saw', r: 0.6, orbit: { x: 32, y: 12.5, radius: 3 }, speed: 60, phase: 270 },
      ],
    },
    {
      // Act 3 · vertical climb between side ledges while crushers slide across the shaft
      name: 'Crusher Hall',
      map: buildMap(24, 32, (b) => {
        b.pillar(1, 29, 5); b.set(3, 28, 'S');
        b.ledge(1, 23, 4);
        b.ledge(18, 17, 5);
        b.ledge(1, 11, 4);
        b.ledge(17, 5, 6); b.set(20, 3, 'G');
      }),
      movers: [
        { shape: 'block', w: 3, h: 1, path: [[7, 26], [17, 26]], speed: 2.5 },
        { shape: 'block', w: 3, h: 1, path: [[6, 20], [16, 20]], speed: 3, phase: 4 },
        { shape: 'block', w: 3, h: 1, path: [[7, 14], [17, 14]], speed: 3.2, phase: 2 },
        { shape: 'block', w: 3, h: 1, path: [[6, 8], [15, 8]], speed: 3.5, phase: 6 },
      ],
    },
    {
      // Act 4 breather · huge open sky, sparse pads, a checkpoint halfway
      name: 'Starlight Drift',
      map: buildMap(70, 24, (b) => {
        b.pillar(1, 21, 4); b.set(2, 20, 'S');
        b.ledge(14, 17, 4);
        b.ledge(27, 13, 4);
        b.ledge(40, 16, 4, 'C');
        b.ledge(52, 11, 4);
        b.pillar(62, 9, 7); b.set(65, 7, 'G');
      }),
      pushers: [
        { x: 8, y: 15, angle: -50, power: 460 },
        { x: 33, y: 8, angle: 20, power: 400 },
      ],
      movers: [
        { shape: 'saw', r: 0.7, path: [[46, 8]] },
      ],
    },
    {
      // Act 4 · precision: narrow zigzag tunnels with saws at the corners
      name: 'The Needle',
      map: buildMap(56, 16, (b) => {
        b.rock(1, 1, 54, 14);         // solid rock, tunnels carved out below
        b.air(1, 8, 6, 6);            // start alcove (headroom for the first hop)
        b.air(1, 10, 21, 4);          // tunnel A
        b.air(18, 3, 4, 11);          // shaft B (up)
        b.air(18, 3, 22, 4);          // tunnel C
        b.air(36, 3, 4, 11);          // shaft D (down)
        b.air(36, 10, 19, 4);         // tunnel E
        b.pad(1, 13, 4); b.set(2, 12, 'S');
        b.pad(18, 13, 4);
        b.checkpoint(27, 6, 4);
        b.pad(50, 13, 5); b.set(52, 11, 'G');
      }),
      movers: [
        { shape: 'saw', r: 0.5, path: [[20.6, 8.5]] },
        { shape: 'saw', r: 0.5, path: [[33, 3.8]] },
        { shape: 'saw', r: 0.5, path: [[37.4, 7.5]] },
      ],
    },
    {
      // Act 4 · going down: brake against gravity through gaps in alternating shelves
      name: 'Freefall',
      map: buildMap(26, 40, (b) => {
        b.ledge(19, 6, 5); b.set(21, 5, 'S');
        b.rock(6, 9, 19); b.pad(12, 9, 4);       // gap on the left
        b.rock(1, 15, 19); b.pad(8, 15, 4);      // gap on the right
        b.rock(6, 21, 19); b.checkpoint(12, 21, 4);
        b.rock(1, 27, 19); b.pad(8, 27, 4);
        b.rock(6, 32, 19); b.pad(12, 32, 4);
        b.ledge(1, 37, 8); b.set(4, 35, 'G');
      }),
      movers: [
        { shape: 'saw', r: 0.6, path: [[3, 12], [18, 12]], speed: 2 },
        { shape: 'block', w: 2, h: 1, path: [[8, 24], [22, 24]], speed: 2.5 },
        { shape: 'saw', r: 0.6, path: [[3, 30], [18, 30]], speed: 2.5 },
      ],
    },
    {
      // Act 4 · timing everything at once: a saw-guarded tunnel, crusher gates, a sweeping saw
      name: 'Clockwork',
      map: buildMap(56, 18, (b) => {
        b.pillar(1, 15, 4); b.set(2, 14, 'S');
        b.rock(6, 1, 9, 4);           // tunnel ceiling
        b.rock(6, 13, 9, 4);          // tunnel floor
        b.ledge(18, 9, 4, 'C');
        b.rock(26, 1, 2, 16); b.air(26, 7, 2, 4);   // wall with a gate opening
        b.rock(32, 1, 2, 16); b.air(32, 7, 2, 4);   // second gate
        b.ledge(36, 12, 4, 'C');
        b.ledge(47, 5, 8); b.set(51, 3, 'G');
      }),
      pushers: [
        { x: 45, y: 13, angle: -90, power: 480 },
      ],
      movers: [
        { shape: 'saw', r: 0.6, orbit: { x: 10, y: 8.5, radius: 2.6 }, speed: 110 },
        { shape: 'saw', r: 0.6, orbit: { x: 10, y: 8.5, radius: 2.6 }, speed: 110, phase: 180 },
        { shape: 'block', w: 2, h: 2, path: [[27, 7.2], [27, 9.8]], speed: 1.5 },
        { shape: 'block', w: 2, h: 2, path: [[33, 7.2], [33, 9.8]], speed: 1.5, phase: 1.3 },
        { shape: 'saw', r: 0.6, path: [[40, 8.5], [52, 8.5]], speed: 3.5 },
      ],
    },
    {
      // Finale · a tall climb using everything, two checkpoints
      name: 'Summit',
      map: buildMap(40, 50, (b) => {
        b.pillar(1, 47, 5); b.set(3, 46, 'S');
        b.ledge(12, 42, 4);
        b.ledge(26, 37, 5);
        b.ledge(33, 32, 5, 'C');
        b.rock(10, 27, 22); b.pad(18, 27, 4);   // shelf with a rest spot on top
        b.ledge(2, 24, 4);
        b.ledge(14, 20, 4);           // rest stop on the way to the second checkpoint
        b.ledge(28, 16, 5, 'C');
        b.ledge(16, 11, 4);
        b.ledge(2, 6, 6); b.set(5, 4, 'G');
      }),
      pushers: [
        { x: 20, y: 44, angle: -80, power: 500 },
        { x: 8, y: 18, angle: -60, power: 480 },
        { x: 11, y: 9, angle: 0, power: 400 },        // shoves you away from the goal ledge
      ],
      movers: [
        { shape: 'saw', r: 0.6, orbit: { x: 19, y: 38, radius: 2.5 }, speed: 80 },
        { shape: 'block', w: 2, h: 1, path: [[12, 29.5], [30, 29.5]], speed: 3 },
        { shape: 'saw', r: 0.6, path: [[22, 13], [22, 22]], speed: 2.2 },
        { shape: 'saw', r: 0.5, path: [[12, 2.2]] },
      ],
    },
    // ===================== Acts 5-8: drones and the shield =====================
    {
      // Act 5 · teach: drones wake up when you get close, dash, then rest
      name: 'Watchers',
      map: buildMap(48, 16, (b) => {
        b.pillar(1, 13, 4); b.set(2, 12, 'S');
        b.pillar(12, 12, 4);
        b.pillar(30, 12, 4);
        b.pillar(42, 10, 5); b.set(44, 8, 'G');
      }),
      signs: [
        { x: 8, y: 4, text: 'Purple DRONES guard the air.\nGet close and they flash red, then dash at you!' },
        { x: 31, y: 5, text: 'After a dash they rest (grey) to recharge.\nThat is your moment to slip past.' },
      ],
      enemies: [{ x: 22, y: 8 }, { x: 38, y: 6 }],
    },
    {
      // Act 5 · teach: the gold shield lets you destroy drones and survives one drone hit
      name: 'Shield Up',
      map: buildMap(48, 16, (b) => {
        b.pillar(1, 13, 4); b.set(2, 12, 'S');
        b.pillar(12, 12, 3);
        b.pillar(28, 11, 4);
        b.pillar(42, 10, 5); b.set(44, 8, 'G');
      }),
      signs: [
        { x: 9, y: 4, text: 'Grab the GOLD SHIELD.\nWith it, ram a resting drone to destroy it.' },
        { x: 35, y: 3.5, text: 'The shield destroys any drone it touches.\nIf one hits you mid-dash, the shield breaks too.' },
      ],
      shields: [{ x: 8, y: 10 }, { x: 30, y: 8 }],
      enemies: [{ x: 18, y: 9 }, { x: 24, y: 6 }, { x: 37, y: 9 }],
    },
    {
      // Act 5 · teach: the shield also bounces you off rock once (a breather with no drones)
      name: 'Ricochet',
      map: buildMap(52, 16, (b) => {
        b.pillar(1, 13, 4); b.set(2, 12, 'S');
        b.rock(10, 1, 30, 5);         // corridor ceiling
        b.rock(10, 11, 30, 5);        // corridor floor
        b.pad(23, 10, 3);             // rest stop inside
        b.pillar(44, 10, 6); b.set(47, 8, 'G');
      }),
      signs: [
        { x: 5, y: 3, text: 'The shield also BOUNCES you off rock,\nonce. It breaks, but you live.' },
      ],
      shields: [{ x: 7, y: 10 }, { x: 18, y: 8 }, { x: 31, y: 8 }],
    },
    {
      // Act 5 · develop: a line of drones; shields to clear a path
      name: 'Patrol Route',
      map: buildMap(56, 16, (b) => {
        b.pillar(1, 13, 4); b.set(2, 12, 'S');
        b.pillar(14, 12, 3);
        b.pillar(24, 11, 3);
        b.pillar(34, 12, 3);
        b.pillar(50, 10, 5); b.set(52, 8, 'G');
      }),
      shields: [{ x: 8, y: 9 }, { x: 27, y: 5 }],
      enemies: [{ x: 20, y: 6 }, { x: 30, y: 10 }, { x: 40, y: 6 }, { x: 45, y: 11 }],
    },
    {
      // Act 5 peak · drones with saws, behind walls, one checkpoint
      name: 'Hunting Grounds',
      map: buildMap(64, 20, (b) => {
        b.pillar(1, 17, 4); b.set(2, 16, 'S');
        b.rock(12, 1, 2, 10);         // wall, opening below
        b.pillar(26, 15, 4, 'C');
        b.rock(42, 8, 2, 11);         // wall, opening above
        b.pillar(57, 12, 6); b.set(60, 10, 'G');
      }),
      shields: [{ x: 7, y: 13 }, { x: 30, y: 10 }],
      enemies: [{ x: 18, y: 14 }, { x: 33, y: 8 }, { x: 38, y: 14 }, { x: 54, y: 5 }],
      movers: [
        { shape: 'saw', r: 0.6, path: [[22, 4], [22, 12]], speed: 2 },
        { shape: 'saw', r: 0.6, orbit: { x: 48, y: 10, radius: 2.5 }, speed: 90 },
      ],
    },
    {
      // Act 6 breather · pushers carry you, one drone, plenty of room
      name: 'Calm Waters',
      map: buildMap(56, 18, (b) => {
        b.pillar(1, 15, 4); b.set(2, 14, 'S');
        b.ledge(18, 8, 4);
        b.ledge(36, 11, 4);
        b.ledge(48, 6, 6); b.set(51, 4, 'G');
      }),
      pushers: [
        { x: 9, y: 13, angle: -55, power: 470 },
        { x: 44, y: 14, angle: -70, power: 480 },
      ],
      shields: [{ x: 24, y: 5 }],
      enemies: [{ x: 31, y: 10 }],
    },
    {
      // Act 6 · a long corridor with drones hiding in alcoves above and below
      name: 'Gauntlet Run',
      map: buildMap(60, 16, (b) => {
        b.pillar(1, 13, 4); b.set(2, 12, 'S');
        b.rock(6, 1, 48, 5);          // corridor ceiling
        b.rock(6, 11, 48, 4);         // corridor floor
        b.air(14, 2, 3, 4);           // alcoves the drones wait in
        b.air(24, 11, 3, 3);
        b.air(34, 2, 3, 4);
        b.air(44, 11, 3, 3);
        b.pad(19, 10, 3);
        b.checkpoint(39, 10, 3);
        b.pillar(55, 10, 4); b.set(57, 8, 'G');
      }),
      shields: [{ x: 9, y: 8 }, { x: 30, y: 8 }],
      enemies: [{ x: 15.5, y: 3.5 }, { x: 25.5, y: 12.5 }, { x: 35.5, y: 3.5 }, { x: 45.5, y: 12.5 }],
    },
    {
      // Act 6 · drones sit inside the openings: destroy them or bait their dash
      name: 'Shield Bearer',
      map: buildMap(56, 18, (b) => {
        b.pillar(1, 15, 4); b.set(2, 14, 'S');
        b.rock(12, 1, 2, 9);          // opening below
        b.pillar(17, 14, 4);
        b.rock(25, 6, 2, 11);         // opening above
        b.pillar(30, 12, 4, 'C');
        b.rock(38, 1, 2, 10);         // opening below
        b.pillar(43, 14, 3);
        b.pillar(50, 10, 5); b.set(52, 8, 'G');
      }),
      shields: [{ x: 7, y: 11 }, { x: 19, y: 10 }, { x: 32, y: 8 }],
      enemies: [{ x: 13, y: 13 }, { x: 26, y: 3 }, { x: 40, y: 14.5 }, { x: 48, y: 7 }],
    },
    {
      // Act 6 · pushers fling you through drone territory
      name: 'Pinball Panic',
      map: buildMap(52, 22, (b) => {
        b.pillar(1, 19, 4); b.set(2, 18, 'S');
        b.ledge(20, 16, 4);
        b.ledge(27, 9, 4, 'C');
        b.ledge(40, 12, 3);
        b.ledge(45, 6, 6); b.set(48, 4, 'G');
      }),
      pushers: [
        { x: 9, y: 17, angle: -70, power: 500 },
        { x: 16, y: 7, angle: 10, power: 430 },
        { x: 30, y: 16, angle: -100, power: 480 },
        { x: 38, y: 6, angle: 20, power: 420 },
      ],
      shields: [{ x: 22, y: 5 }],
      enemies: [{ x: 21.5, y: 12.5 }, { x: 32.5, y: 11 }, { x: 44, y: 15 }],
    },
    {
      // Act 6 peak · a cavern full of drones, shields scattered, two checkpoints
      name: 'The Nest',
      map: buildMap(60, 26, (b) => {
        b.pillar(1, 23, 4); b.set(2, 22, 'S');
        b.rock(17, 1, 3, 7);
        b.rock(39, 1, 3, 6);
        b.rock(29, 19, 2, 6);
        b.ledge(12, 18, 4);
        b.ledge(22, 13, 4, 'C');
        b.ledge(34, 17, 4);
        b.ledge(44, 11, 4, 'C');
        b.pillar(52, 8, 7); b.set(55, 6, 'G');
      }),
      shields: [{ x: 7, y: 19 }, { x: 25, y: 9 }, { x: 38, y: 8 }, { x: 47, y: 6 }],
      enemies: [
        { x: 15, y: 12 }, { x: 20, y: 20 }, { x: 28.5, y: 6 },
        { x: 36, y: 12 }, { x: 41, y: 20 }, { x: 49, y: 14 },
      ],
    },
    {
      // Act 7 breather · a long night flight, sparse pads, two drones
      name: 'Long Night',
      map: buildMap(72, 22, (b) => {
        b.pillar(1, 19, 4); b.set(2, 18, 'S');
        b.ledge(14, 15, 4);
        b.ledge(28, 12, 4, 'C');
        b.ledge(42, 15, 4);
        b.ledge(56, 10, 4);
        b.pillar(66, 8, 5); b.set(68, 6, 'G');
      }),
      pushers: [{ x: 62, y: 15, angle: -60, power: 450 }],
      shields: [{ x: 21, y: 9 }],
      enemies: [{ x: 36, y: 6 }, { x: 50, y: 17 }],
    },
    {
      // Act 7 · drones guarding saw lanes
      name: 'Saw Hunters',
      map: buildMap(60, 18, (b) => {
        b.pillar(1, 15, 4); b.set(2, 14, 'S');
        b.pillar(16, 13, 4);
        b.pillar(30, 12, 4, 'C');
        b.pillar(50, 10, 9); b.set(55, 8, 'G');
      }),
      shields: [{ x: 7, y: 12 }, { x: 33, y: 9 }],
      enemies: [{ x: 20, y: 7 }, { x: 34.5, y: 4.5 }, { x: 46, y: 12 }],
      movers: [
        { shape: 'saw', r: 0.6, path: [[12, 2], [12, 14]], speed: 2.4 },
        { shape: 'saw', r: 0.6, path: [[26, 2], [26, 14]], speed: 2.6, phase: 3 },
        { shape: 'saw', r: 0.6, orbit: { x: 40, y: 9, radius: 3 }, speed: 100 },
      ],
    },
    {
      // Act 7 · climb a shaft past crushers while drones wait on the ledges
      name: 'Crusher Ambush',
      map: buildMap(26, 36, (b) => {
        b.pillar(1, 33, 5); b.set(3, 32, 'S');
        b.ledge(18, 28, 6);
        b.ledge(1, 22, 5, 'C');
        b.ledge(18, 16, 6);
        b.ledge(1, 10, 5);
        b.ledge(17, 5, 7); b.set(20, 3, 'G');
      }),
      shields: [{ x: 4, y: 26 }, { x: 21, y: 12 }],
      enemies: [{ x: 13, y: 24 }, { x: 12, y: 8 }],
      movers: [
        { shape: 'block', w: 3, h: 1, path: [[8, 30], [16, 30]], speed: 2.5 },
        { shape: 'block', w: 3, h: 1, path: [[7, 19], [16, 19]], speed: 3, phase: 3 },
        { shape: 'block', w: 3, h: 1, path: [[8, 13], [16, 13]], speed: 3.2, phase: 1 },
      ],
    },
    {
      // Act 7 · going down while drones dash up at you from below each gap
      name: 'Downdraft',
      map: buildMap(28, 40, (b) => {
        b.ledge(20, 5, 6); b.set(22, 4, 'S');
        b.rock(6, 9, 21); b.pad(14, 9, 4);        // gap on the left
        b.rock(1, 16, 21); b.checkpoint(9, 16, 4); // gap on the right
        b.rock(6, 23, 21); b.pad(14, 23, 4);
        b.rock(1, 30, 21); b.checkpoint(9, 30, 4);
        b.ledge(1, 37, 8); b.set(4, 35, 'G');
      }),
      shields: [{ x: 3, y: 7 }, { x: 20, y: 19 }, { x: 12, y: 33 }],
      enemies: [{ x: 3, y: 12.5 }, { x: 24, y: 20 }, { x: 3, y: 26.5 }, { x: 24, y: 34 }],
      movers: [{ shape: 'saw', r: 0.6, path: [[8, 12], [18, 12]], speed: 2 }],
    },
    {
      // Act 7 peak · gates, drones and twin saws between walls
      name: 'Fortress',
      map: buildMap(64, 24, (b) => {
        b.pillar(1, 21, 4); b.set(2, 20, 'S');
        b.rock(12, 1, 2, 14);         // wall, opening below
        b.ledge(17, 12, 4, 'C');
        b.rock(26, 1, 2, 22); b.air(26, 8, 2, 5);   // gate in the second wall
        b.ledge(36, 10, 4, 'C');
        b.pillar(57, 14, 6); b.set(60, 12, 'G');
      }),
      shields: [{ x: 7, y: 17 }, { x: 30, y: 12 }, { x: 44, y: 4 }],
      enemies: [{ x: 17, y: 18 }, { x: 31, y: 5 }, { x: 34, y: 16 }, { x: 54, y: 6 }],
      movers: [
        { shape: 'block', w: 2, h: 2, path: [[27, 8.2], [27, 11.8]], speed: 1.6 },
        { shape: 'saw', r: 0.6, orbit: { x: 46, y: 12, radius: 3 }, speed: 110 },
        { shape: 'saw', r: 0.6, orbit: { x: 46, y: 12, radius: 3 }, speed: 110, phase: 180 },
      ],
    },
    {
      // Act 8 breather · an easy flight before the finale stretch
      name: 'Quiet Before',
      map: buildMap(48, 18, (b) => {
        b.pillar(1, 15, 4); b.set(2, 14, 'S');
        b.ledge(14, 11, 5);
        b.ledge(27, 7, 5);
        b.ledge(38, 11, 4);
        b.pillar(43, 9, 4); b.set(45, 7, 'G');
      }),
      pushers: [{ x: 22, y: 14, angle: -70, power: 470 }],
      shields: [{ x: 8, y: 11 }],
      enemies: [{ x: 34, y: 13 }],
    },
    {
      // Act 8 · climb around rings of orbiting saws to the goal in the middle
      name: 'Spiral',
      map: buildMap(40, 40, (b) => {
        b.pillar(1, 37, 5); b.set(3, 36, 'S');
        b.ledge(12, 34, 4);
        b.ledge(30, 32, 5);
        b.ledge(32, 22, 5, 'C');
        b.ledge(34, 14, 4);
        b.ledge(28, 7, 5);
        b.ledge(9, 10, 4, 'C');       // kept clear of the outer saw ring
        b.ledge(4, 20, 5);
        b.ledge(18, 22, 5); b.set(20, 20, 'G');
      }),
      shields: [{ x: 24, y: 34 }, { x: 32, y: 4 }],
      enemies: [{ x: 14, y: 30 }, { x: 38.5, y: 14.5 }, { x: 8, y: 15 }],
      movers: [
        { shape: 'saw', r: 0.6, orbit: { x: 20, y: 20, radius: 6 }, speed: 45 },
        { shape: 'saw', r: 0.6, orbit: { x: 20, y: 20, radius: 6 }, speed: 45, phase: 180 },
        { shape: 'saw', r: 0.6, orbit: { x: 20, y: 20, radius: 10 }, speed: -35 },
        { shape: 'saw', r: 0.6, orbit: { x: 20, y: 20, radius: 10 }, speed: -35, phase: 180 },
      ],
    },
    {
      // Act 8 · narrow tunnels with drones waiting at the corners
      name: "Needle's Eye",
      map: buildMap(60, 18, (b) => {
        b.rock(1, 1, 58, 16);         // solid rock, tunnels carved out below
        b.air(1, 9, 8, 8);            // start alcove
        b.air(1, 12, 20, 4);          // tunnel A
        b.air(17, 3, 5, 13);          // shaft B (up)
        b.air(17, 3, 26, 5);          // tunnel C
        b.air(38, 3, 5, 13);          // shaft D (down)
        b.air(38, 11, 21, 5);         // tunnel E
        b.pad(1, 16, 4); b.set(2, 15, 'S');
        b.pad(17, 15, 5);
        b.checkpoint(28, 7, 4);
        b.checkpoint(38, 15, 5);
        b.pad(53, 15, 6); b.set(56, 13, 'G');
      }),
      shields: [{ x: 10, y: 13.5 }, { x: 30, y: 5 }, { x: 44, y: 13 }],
      enemies: [{ x: 19.5, y: 5 }, { x: 40.5, y: 5 }, { x: 49.5, y: 13 }],
    },
    {
      // Act 8 · everything at once
      name: 'Storm',
      map: buildMap(64, 22, (b) => {
        b.pillar(1, 19, 4); b.set(2, 18, 'S');
        b.ledge(15, 9, 4, 'C');
        b.ledge(39, 13, 4, 'C');
        b.pillar(57, 11, 6); b.set(60, 9, 'G');
      }),
      pushers: [
        { x: 11, y: 16, angle: -75, power: 500 },
        { x: 52, y: 6, angle: 150, power: 420 },      // throws you back
      ],
      shields: [{ x: 7, y: 15 }, { x: 41, y: 9 }],
      enemies: [{ x: 25, y: 12 }, { x: 31, y: 5 }, { x: 54, y: 15 }],
      movers: [
        { shape: 'saw', r: 0.6, path: [[20, 3], [20, 18]], speed: 2.6 },
        { shape: 'block', w: 1, h: 3, path: [[36, 3], [36, 18]], speed: 3 },
        { shape: 'saw', r: 0.6, orbit: { x: 48, y: 10, radius: 3 }, speed: 120 },
        { shape: 'saw', r: 0.6, orbit: { x: 48, y: 10, radius: 3 }, speed: 120, phase: 180 },
      ],
    },
    {
      // Grand finale · a tall climb through every hazard, three checkpoints
      name: 'Final Ascent',
      map: buildMap(44, 56, (b) => {
        b.pillar(1, 53, 5); b.set(3, 52, 'S');
        b.ledge(14, 48, 5);
        b.ledge(24, 45, 3);
        b.ledge(34, 41, 6, 'C');
        b.rock(8, 36, 26); b.pad(18, 36, 4);   // shelf with a rest spot
        b.ledge(10, 31, 3);
        b.ledge(3, 27, 5, 'C');
        b.ledge(28, 20, 5);
        b.ledge(24, 14, 3);
        b.ledge(30, 9, 5, 'C');
        b.ledge(14, 8, 3);
        b.ledge(2, 6, 6); b.set(5, 4, 'G');
      }),
      pushers: [
        { x: 12, y: 24, angle: -50, power: 480 },
        { x: 20, y: 5, angle: 0, power: 400 },        // shoves you away from the goal
      ],
      shields: [{ x: 9, y: 49 }, { x: 32, y: 16 }],
      enemies: [{ x: 22, y: 42 }, { x: 13.5, y: 30.5 }, { x: 26, y: 30 }, { x: 37, y: 13 }, { x: 18, y: 12 }],
      movers: [
        { shape: 'saw', r: 0.6, orbit: { x: 30, y: 46, radius: 3 }, speed: 90 },
        { shape: 'block', w: 3, h: 1, path: [[12, 33.5], [30, 33.5]], speed: 3 },
        { shape: 'saw', r: 0.6, path: [[21, 16], [21, 26]], speed: 2.4 },
        { shape: 'saw', r: 0.5, path: [[12, 3]] },
      ],
    },
    // ===================== Act 10 · Fuel =====================
    {
      // Act 10 opener · open sky, short gaps; a fuel cell to feel unlimited thrust
      name: 'Fuel Line',
      map: buildMap(64, 20, (b) => {
        b.pillar(1, 16, 5); b.set(3, 15, 'S');
        b.pillar(15, 15, 4);
        b.pillar(27, 14, 4);
        b.pillar(39, 15, 4);
        b.pillar(51, 14, 4);
        b.pillar(57, 15, 6); b.set(60, 13, 'G');
      }),
      signs: [{ x: 10, y: 6, text: 'Fuel cell: 15 s of free thrust\nThrust as much as you like' }],
      fuels: [{ x: 9, y: 12 }, { x: 33, y: 9 }],
    },
    {
      // Act 10 · a chimney of side ledges; fuel cells let you skip whole flights
      name: 'Chimney',
      map: buildMap(22, 56, (b) => {
        b.pillar(8, 53, 6); b.set(10, 52, 'S');
        b.ledge(1, 48, 6);
        b.ledge(15, 43, 6);
        b.ledge(1, 38, 6, 'C');
        b.ledge(15, 33, 6);
        b.ledge(1, 28, 6);
        b.ledge(15, 23, 6, 'C');
        b.ledge(1, 18, 6);
        b.ledge(15, 13, 6);
        b.ledge(1, 8, 6); b.set(4, 5, 'G');
      }),
      fuels: [{ x: 11, y: 47 }, { x: 11, y: 30 }, { x: 11, y: 16 }],
      movers: [
        { shape: 'saw', r: 0.55, path: [[7, 40.5], [14, 40.5]], speed: 1.5 },
        { shape: 'saw', r: 0.55, path: [[7, 20.5], [14, 20.5]], speed: 1.8, phase: 3 },
      ],
    },
    {
      // Act 10 · gaps far too wide for one stamina bar: every checkpoint has a fuel cell
      name: 'Long Burn',
      map: buildMap(110, 24, (b) => {
        b.pillar(1, 20, 5); b.set(3, 19, 'S');
        b.rock(17, 1, 3, 10);         // hanging rock: go under
        b.pillar(30, 18, 5, 'C');
        b.rock(45, 13, 3, 10);        // rising rock: go over
        b.pillar(60, 19, 5, 'C');
        b.rock(75, 1, 3, 11);
        b.pillar(88, 18, 5, 'C');
        b.pillar(103, 19, 6); b.set(106, 17, 'G');
      }),
      fuels: [{ x: 8, y: 16 }, { x: 32, y: 14 }, { x: 62, y: 15 }, { x: 90, y: 14 }],
    },
    {
      // Act 10 · a low corridor of bobbing saws; fuel lets you dodge freely
      name: 'Saw Sprint',
      map: buildMap(90, 20, (b) => {
        b.pillar(1, 16, 5); b.set(3, 15, 'S');
        b.pillar(27, 16, 4);
        b.pillar(47, 16, 4, 'C');
        b.pillar(67, 16, 4);
        b.pillar(80, 16, 9); b.set(84, 14, 'G');
      }),
      fuels: [{ x: 8, y: 12 }, { x: 29, y: 12 }, { x: 49, y: 12 }, { x: 69, y: 12 }],
      movers: [
        { shape: 'saw', r: 0.55, path: [[14, 3], [14, 14]], speed: 1.8 },
        { shape: 'saw', r: 0.55, path: [[21, 3], [21, 14]], speed: 2, phase: 5 },
        { shape: 'saw', r: 0.55, path: [[35, 3], [35, 14]], speed: 2, phase: 2 },
        { shape: 'saw', r: 0.55, path: [[41, 3], [41, 14]], speed: 2.2, phase: 7 },
        { shape: 'saw', r: 0.55, path: [[55, 3], [55, 14]], speed: 2.2 },
        { shape: 'saw', r: 0.55, path: [[61, 3], [61, 14]], speed: 2.4, phase: 4 },
        { shape: 'saw', r: 0.55, path: [[74, 3], [74, 14]], speed: 2.4, phase: 6 },
      ],
    },
    {
      // Act 10 peak · a 100-row shaft with only three checkpoints and orbiting saws: burn fuel
      name: 'Burnout',
      map: buildMap(30, 100, (b) => {
        b.pillar(12, 97, 6); b.set(14, 96, 'S');
        b.ledge(2, 75, 5, 'C');
        b.ledge(23, 52, 5, 'C');
        b.ledge(2, 29, 5, 'C');
        b.set(15, 5, 'G');
      }),
      fuels: [{ x: 15, y: 92 }, { x: 4, y: 71 }, { x: 25, y: 48 }, { x: 4, y: 25 }],
      movers: [
        { shape: 'saw', r: 0.55, orbit: { x: 15, y: 84, radius: 3 }, speed: 60 },
        { shape: 'saw', r: 0.55, orbit: { x: 15, y: 63, radius: 4 }, speed: -70 },
        { shape: 'saw', r: 0.55, orbit: { x: 15, y: 63, radius: 4 }, speed: -70, phase: 180 },
        { shape: 'saw', r: 0.55, orbit: { x: 15, y: 40, radius: 4 }, speed: 80 },
        { shape: 'saw', r: 0.55, orbit: { x: 15, y: 17, radius: 3 }, speed: 90 },
        { shape: 'saw', r: 0.55, orbit: { x: 15, y: 17, radius: 3 }, speed: 90, phase: 180 },
      ],
    },
    // ===================== Act 11 · Firepower =====================
    {
      // Act 11 opener · a pistol and three drones in open sky
      name: 'Target Practice',
      map: buildMap(60, 20, (b) => {
        b.pillar(1, 16, 5); b.set(3, 15, 'S');
        b.pillar(16, 16, 4);
        b.pillar(28, 17, 4);
        b.pillar(40, 16, 4);
        b.pillar(52, 16, 7); b.set(55, 14, 'G');
      }),
      signs: [{ x: 11, y: 6, text: 'Pistol: scroll to fire\nShots go where your head points' }],
      guns: [{ x: 8, y: 12 }, { x: 42, y: 12 }],
      enemies: [{ x: 23, y: 6 }, { x: 34, y: 8 }, { x: 47, y: 6 }],
    },
    {
      // Act 11 · a low tunnel of fast saws: shoot them or time them
      name: 'Saw Breaker',
      map: buildMap(70, 16, (b) => {
        b.rock(1, 1, 68, 3);          // ceiling
        b.pillar(1, 13, 5); b.set(3, 12, 'S');
        b.pillar(28, 13, 5, 'C');
        b.pillar(60, 13, 9); b.set(65, 11, 'G');
      }),
      guns: [{ x: 9, y: 9 }, { x: 34, y: 9 }],
      movers: [
        { shape: 'saw', r: 0.55, path: [[15, 5], [15, 11]], speed: 2.5 },
        { shape: 'saw', r: 0.55, path: [[22, 5], [22, 11]], speed: 2.5, phase: 3 },
        { shape: 'saw', r: 0.55, path: [[42, 5], [42, 11]], speed: 2.8, phase: 1 },
        { shape: 'saw', r: 0.55, path: [[50, 5], [50, 11]], speed: 2.8, phase: 4 },
      ],
    },
    {
      // Act 11 · a shaft with drones hanging in the middle: clear the way up
      name: 'Drone Wall',
      map: buildMap(26, 60, (b) => {
        b.pillar(9, 57, 8); b.set(13, 56, 'S');
        b.ledge(1, 51, 6);
        b.ledge(19, 45, 6, 'C');
        b.ledge(1, 39, 6);
        b.ledge(19, 33, 6);
        b.ledge(1, 27, 6, 'C');
        b.ledge(19, 21, 6);
        b.ledge(1, 15, 6);
        b.ledge(9, 9, 8); b.set(13, 6, 'G');
      }),
      guns: [{ x: 13, y: 52 }, { x: 4, y: 36 }, { x: 22, y: 18 }],
      shields: [{ x: 22, y: 30 }],
      enemies: [{ x: 13, y: 40 }, { x: 13, y: 30 }, { x: 13, y: 20 }, { x: 13, y: 14 }],
    },
    {
      // Act 11 · a long open flight: refill the pistol along the way
      name: 'Ammo Run',
      map: buildMap(100, 24, (b) => {
        b.pillar(1, 20, 5); b.set(3, 19, 'S');
        b.pillar(18, 20, 4);
        b.ledge(30, 14, 4);
        b.pillar(45, 19, 4, 'C');
        b.ledge(58, 12, 4);
        b.pillar(72, 20, 4);
        b.pillar(92, 19, 7); b.set(95, 17, 'G');
      }),
      guns: [{ x: 9, y: 15 }, { x: 40, y: 10 }, { x: 70, y: 14 }],
      enemies: [{ x: 24, y: 8 }, { x: 37, y: 20 }, { x: 52, y: 5 }, { x: 64, y: 18 }, { x: 82, y: 9 }, { x: 86, y: 16 }],
    },
    {
      // Act 11 peak · zigzag up through drones and saws
      name: 'Firefight',
      map: buildMap(80, 40, (b) => {
        b.pillar(1, 36, 5); b.set(3, 35, 'S');
        b.ledge(14, 31, 4);
        b.ledge(24, 26, 4, 'C');
        b.ledge(36, 30, 4);
        b.ledge(46, 23, 4);
        b.ledge(56, 17, 4, 'C');
        b.ledge(66, 11, 4);
        b.ledge(72, 6, 6); b.set(75, 3, 'G');
      }),
      guns: [{ x: 8, y: 31 }, { x: 38, y: 26 }, { x: 58, y: 13 }],
      shields: [{ x: 16, y: 27 }, { x: 48, y: 19 }],
      enemies: [{ x: 19, y: 20 }, { x: 33, y: 12 }, { x: 42, y: 18 }, { x: 52, y: 30 }, { x: 62, y: 5 }, { x: 72, y: 20 }],
      movers: [
        { shape: 'saw', r: 0.55, orbit: { x: 30, y: 19, radius: 3 }, speed: 70 },
        { shape: 'saw', r: 0.55, path: [[51, 8], [51, 20]], speed: 2 },
      ],
    },
    // ===================== Act 12 · Overdrive =====================
    {
      // Act 12 opener · fast saws sweep the floor and ceiling; stay in the middle band
      name: 'Fast Lane',
      map: buildMap(70, 18, (b) => {
        b.pillar(1, 15, 5); b.set(3, 14, 'S');
        b.ledge(14, 10, 5);
        b.ledge(28, 11, 5);
        b.ledge(42, 9, 5, 'C');
        b.ledge(55, 10, 5);
        b.ledge(62, 8, 6); b.set(65, 6, 'G');
      }),
      guns: [{ x: 9, y: 10 }],
      movers: [
        { shape: 'saw', r: 0.55, path: [[9, 15.5], [60, 15.5]], speed: 4 },
        { shape: 'saw', r: 0.5, path: [[20, 3.5], [52, 3.5]], speed: 3.5 },
      ],
    },
    {
      // Act 12 · fast saws circle the gaps between islands
      name: 'Spin Cycle',
      map: buildMap(70, 22, (b) => {
        b.pillar(1, 19, 5); b.set(3, 18, 'S');
        b.ledge(14, 15, 4);
        b.ledge(26, 11, 4);
        b.ledge(38, 15, 4, 'C');
        b.ledge(50, 11, 4);
        b.ledge(60, 8, 6); b.set(63, 5, 'G');
      }),
      guns: [{ x: 8, y: 14 }, { x: 40, y: 11 }],
      movers: [
        { shape: 'saw', r: 0.55, orbit: { x: 21, y: 12, radius: 3 }, speed: 120 },
        { shape: 'saw', r: 0.55, orbit: { x: 33, y: 12, radius: 3 }, speed: -130 },
        { shape: 'saw', r: 0.55, orbit: { x: 45, y: 12, radius: 3 }, speed: 140 },
        { shape: 'saw', r: 0.55, orbit: { x: 57, y: 9, radius: 2.5 }, speed: -150 },
        { shape: 'saw', r: 0.55, orbit: { x: 57, y: 9, radius: 2.5 }, speed: -150, phase: 180 },
      ],
    },
    {
      // Act 12 · fuel-only gaps crossed by fast vertical saws
      name: 'Fuel Rush',
      map: buildMap(120, 24, (b) => {
        b.pillar(1, 20, 5); b.set(3, 19, 'S');
        b.pillar(40, 20, 5, 'C');
        b.pillar(80, 20, 5, 'C');
        b.pillar(112, 20, 7); b.set(115, 18, 'G');
      }),
      fuels: [{ x: 8, y: 15 }, { x: 42, y: 15 }, { x: 82, y: 15 }],
      guns: [{ x: 10, y: 12 }, { x: 85, y: 12 }],
      movers: [
        { shape: 'saw', r: 0.55, path: [[16, 2], [16, 18]], speed: 4 },
        { shape: 'saw', r: 0.55, path: [[27, 2], [27, 18]], speed: 4, phase: 8 },
        { shape: 'saw', r: 0.55, path: [[53, 2], [53, 18]], speed: 4.5, phase: 4 },
        { shape: 'saw', r: 0.55, path: [[65, 2], [65, 18]], speed: 4.5, phase: 12 },
        { shape: 'saw', r: 0.55, path: [[93, 2], [93, 18]], speed: 5 },
        { shape: 'saw', r: 0.55, path: [[103, 2], [103, 18]], speed: 5, phase: 8 },
      ],
    },
    {
      // Act 12 peak · fast saws, drones, and a long climb to the flag
      name: 'Redline',
      map: buildMap(90, 30, (b) => {
        b.pillar(1, 27, 5); b.set(3, 26, 'S');
        b.ledge(18, 22, 4);
        b.ledge(30, 16, 4, 'C');
        b.ledge(44, 22, 4);
        b.ledge(56, 14, 4, 'C');
        b.ledge(70, 20, 4);
        b.ledge(80, 10, 6); b.set(83, 7, 'G');
      }),
      fuels: [{ x: 8, y: 22 }, { x: 32, y: 12 }, { x: 58, y: 10 }],
      guns: [{ x: 11, y: 20 }, { x: 46, y: 18 }],
      shields: [{ x: 20, y: 18 }],
      enemies: [{ x: 40, y: 7 }, { x: 66, y: 7 }],
      movers: [
        { shape: 'saw', r: 0.55, orbit: { x: 24, y: 17, radius: 3 }, speed: 140 },
        { shape: 'saw', r: 0.55, path: [[37, 5], [37, 25]], speed: 4.5 },
        { shape: 'saw', r: 0.55, orbit: { x: 50, y: 18, radius: 3.5 }, speed: -150 },
        { shape: 'saw', r: 0.55, path: [[63, 4], [63, 24]], speed: 5, phase: 6 },
        { shape: 'saw', r: 0.55, orbit: { x: 76, y: 15, radius: 3 }, speed: 160 },
      ],
    },
    // ===================== Act 13 · Endgame =====================
    {
      // Act 13 opener · shields stack: grab three and ram your way through
      name: 'Long Exhale',
      map: buildMap(80, 26, (b) => {
        b.pillar(1, 22, 5); b.set(3, 21, 'S');
        b.ledge(22, 18, 5);
        b.ledge(36, 14, 5, 'C');
        b.ledge(50, 18, 5);
        b.ledge(64, 13, 5);
        b.pillar(72, 22, 7); b.set(75, 20, 'G');
      }),
      signs: [{ x: 13, y: 8, text: 'Shields stack:\neach one saves you once' }],
      shields: [{ x: 9, y: 17 }, { x: 12, y: 16 }, { x: 15, y: 15 }],
      enemies: [{ x: 30, y: 8 }, { x: 45, y: 23 }, { x: 58, y: 7 }],
    },
    {
      // Act 13 · a drone-filled tunnel with pistols and shields to spare
      name: 'Armory',
      map: buildMap(80, 22, (b) => {
        b.rock(1, 1, 78, 3);          // ceiling
        b.pillar(1, 18, 5); b.set(3, 17, 'S');
        b.pillar(20, 18, 4);
        b.pillar(34, 17, 4, 'C');
        b.pillar(48, 18, 4);
        b.pillar(62, 17, 4, 'C');
        b.pillar(72, 18, 7); b.set(75, 16, 'G');
      }),
      guns: [{ x: 9, y: 14 }, { x: 36, y: 12 }, { x: 64, y: 12 }],
      shields: [{ x: 12, y: 13 }, { x: 50, y: 13 }],
      enemies: [{ x: 16, y: 7 }, { x: 27, y: 9 }, { x: 42, y: 7 }, { x: 55, y: 8 }, { x: 69, y: 7 }],
    },
    {
      // Act 13 · a tall furnace: crushers slide across, fuel cells carry you between checkpoints
      name: 'The Furnace',
      map: buildMap(28, 80, (b) => {
        b.pillar(10, 77, 8); b.set(14, 76, 'S');
        b.ledge(1, 58, 5, 'C');
        b.ledge(22, 38, 5, 'C');
        b.ledge(1, 18, 5, 'C');
        b.set(14, 4, 'G');
      }),
      fuels: [{ x: 14, y: 72 }, { x: 3, y: 54 }, { x: 24, y: 34 }, { x: 3, y: 14 }],
      movers: [
        { shape: 'block', w: 4, h: 1, path: [[4, 66], [23, 66]], speed: 3 },
        { shape: 'block', w: 4, h: 1, path: [[4, 48], [23, 48]], speed: 3.5, phase: 2 },
        { shape: 'block', w: 4, h: 1, path: [[4, 28], [23, 28]], speed: 4 },
        { shape: 'block', w: 4, h: 1, path: [[4, 10], [23, 10]], speed: 4.5, phase: 5 },
      ],
    },
    {
      // Act 13 · a fortress of walls, guarded pads and saws
      name: 'Siege',
      map: buildMap(100, 30, (b) => {
        b.pillar(1, 26, 5); b.set(3, 25, 'S');
        b.ledge(20, 20, 4);
        b.ledge(32, 14, 4, 'C');
        b.rock(40, 1, 2, 12);         // hanging wall
        b.ledge(46, 20, 4);
        b.rock(54, 17, 2, 12);        // standing wall
        b.ledge(60, 12, 4, 'C');
        b.rock(68, 1, 2, 10);
        b.ledge(74, 18, 4);
        b.pillar(88, 26, 11); b.set(93, 24, 'G');
      }),
      guns: [{ x: 9, y: 21 }, { x: 47, y: 16 }, { x: 75, y: 14 }],
      shields: [{ x: 12, y: 20 }, { x: 34, y: 10 }, { x: 62, y: 8 }],
      enemies: [{ x: 26, y: 7 }, { x: 38, y: 24 }, { x: 50, y: 7 }, { x: 66, y: 23 }, { x: 81, y: 8 }, { x: 84, y: 20 }],
      movers: [
        { shape: 'saw', r: 0.55, orbit: { x: 27, y: 17, radius: 2.5 }, speed: 90 },
        { shape: 'saw', r: 0.55, path: [[47, 4], [47, 15]], speed: 3 },
        { shape: 'saw', r: 0.55, orbit: { x: 80, y: 14, radius: 3 }, speed: -110 },
      ],
    },
    {
      // Act 13 peak · up over the walls and down to the flag, through everything
      name: 'Last Light',
      map: buildMap(110, 40, (b) => {
        b.pillar(1, 36, 5); b.set(3, 35, 'S');
        b.ledge(18, 30, 4);
        b.ledge(30, 24, 4, 'C');
        b.rock(38, 22, 2, 17);        // blocks the low route
        b.ledge(44, 18, 4);
        b.ledge(56, 10, 5, 'C');
        b.rock(64, 1, 2, 14);         // hanging wall
        b.ledge(72, 16, 4);
        b.ledge(84, 24, 4, 'C');
        b.rock(90, 1, 2, 20);
        b.ledge(96, 30, 4);
        b.pillar(102, 36, 7); b.set(105, 34, 'G');
      }),
      fuels: [{ x: 8, y: 31 }, { x: 32, y: 20 }, { x: 86, y: 20 }],
      guns: [{ x: 11, y: 29 }, { x: 58, y: 6 }, { x: 82, y: 19 }],
      shields: [{ x: 46, y: 14 }, { x: 74, y: 12 }],
      enemies: [{ x: 36, y: 12 }, { x: 60, y: 26 }, { x: 70, y: 5 }, { x: 98, y: 18 }],
      movers: [
        { shape: 'saw', r: 0.55, orbit: { x: 24, y: 26, radius: 3 }, speed: 120 },
        { shape: 'saw', r: 0.55, path: [[50, 4], [50, 20]], speed: 4 },
        { shape: 'saw', r: 0.55, orbit: { x: 64, y: 22, radius: 3 }, speed: -140 },
        { shape: 'saw', r: 0.55, path: [[78, 8], [78, 30]], speed: 4.5 },
        { shape: 'saw', r: 0.55, orbit: { x: 92, y: 30, radius: 3 }, speed: 150 },
      ],
    },
    {
      // Act 12 · Orbit Garden at full speed: the saws spin almost twice as fast
      name: 'Orbit Overdrive',
      map: buildMap(48, 18, (b) => {
        b.pillar(1, 15, 4); b.set(2, 14, 'S');
        b.rock(6, 1, 33, 4);          // ceiling: no flying over the saws
        b.ledge(10, 12, 4);
        b.ledge(20, 8, 4);
        b.ledge(30, 12, 4);
        b.ledge(39, 7, 6); b.set(42, 5, 'G');
      }),
      movers: [
        { shape: 'saw', r: 0.6, orbit: { x: 12, y: 12.5, radius: 3 }, speed: 80 },
        { shape: 'saw', r: 0.6, orbit: { x: 12, y: 12.5, radius: 3 }, speed: 80, phase: 180 },
        { shape: 'saw', r: 0.6, orbit: { x: 22, y: 8.5, radius: 3 }, speed: -90 },
        { shape: 'saw', r: 0.6, orbit: { x: 22, y: 8.5, radius: 3 }, speed: -90, phase: 180 },
        { shape: 'saw', r: 0.6, orbit: { x: 32, y: 12.5, radius: 3 }, speed: 100, phase: 90 },
        { shape: 'saw', r: 0.6, orbit: { x: 32, y: 12.5, radius: 3 }, speed: 100, phase: 270 },
      ],
    },
    {
      // The big one: five regions, goal at the far bottom-right, lots of open sky
      name: 'Odyssey',
      map: buildMap(150, 50, (b) => {
        // A · rolling hills
        b.pillar(1, 47, 5); b.set(3, 46, 'S');
        b.pillar(10, 44, 4);
        b.pillar(18, 41, 4);
        b.pillar(26, 43, 4, 'C');
        b.pillar(34, 39, 4);
        // B · crusher tower: enter low on the left, climb, leave over the right wall
        b.rock(40, 20, 2, 23);        // left wall, opening at the bottom
        b.rock(52, 12, 2, 37);        // right wall
        b.pillar(42, 47, 10);         // tower floor
        b.ledge(42, 40, 4);
        b.ledge(48, 34, 4, 'C');
        b.ledge(42, 28, 4);
        b.ledge(48, 22, 4);
        b.ledge(44, 16, 4);
        // C · open sky over a deep fall
        b.ledge(58, 16, 5, 'C');
        b.ledge(68, 24, 4);
        b.ledge(76, 14, 4);
        b.ledge(84, 28, 5, 'C');
        b.ledge(90, 18, 4);
        // D · the cave
        b.rock(98, 1, 28, 48);
        b.air(98, 14, 10, 5);         // entrance tunnel
        b.air(104, 14, 4, 22);        // shaft down
        b.air(104, 31, 20, 5);        // lower tunnel
        b.air(119, 8, 5, 28);         // shaft up
        b.air(119, 4, 10, 5);         // exit
        b.checkpoint(104, 35, 4);
        // rest ledges up the exit shaft (27 tiles is far more than one stamina bar)
        b.pad(122, 30, 2);
        b.pad(119, 25, 2);
        b.pad(122, 20, 2);
        b.pad(119, 15, 2);
        b.pad(122, 10, 2);
        // E · the long way down to the goal
        b.ledge(130, 12, 4, 'C');
        b.ledge(135, 24, 4);
        b.ledge(128, 34, 4);
        b.pillar(140, 44, 8); b.set(144, 42, 'G');
      }),
      pushers: [
        { x: 62, y: 32, angle: -70, power: 500 },     // catches you if you drop into the sky pit
        { x: 95, y: 30, angle: -60, power: 480 },
        { x: 134, y: 30, angle: 180, power: 400 },    // pushes you back from the goal
      ],
      shields: [{ x: 60, y: 12 }, { x: 79, y: 22 }, { x: 88, y: 13 }, { x: 100, y: 16 }, { x: 109, y: 33 }, { x: 131, y: 8 }],
      enemies: [
        { x: 67.5, y: 10.5 }, { x: 74, y: 30 }, { x: 82, y: 8 }, { x: 93.5, y: 22.5 },
        { x: 114, y: 31.5 }, { x: 137, y: 18 }, { x: 142, y: 32 },
      ],
      movers: [
        { shape: 'block', w: 3, h: 1, path: [[44, 37], [49, 37]], speed: 2.2 },
        { shape: 'block', w: 3, h: 1, path: [[44, 31], [49, 31]], speed: 2.6, phase: 2 },
        { shape: 'block', w: 3, h: 1, path: [[44, 25], [49, 25]], speed: 3, phase: 1 },
        { shape: 'saw', r: 0.6, path: [[22, 30], [30, 30]], speed: 1.5 },
        { shape: 'saw', r: 0.6, orbit: { x: 72, y: 20, radius: 3 }, speed: 70 },
        { shape: 'saw', r: 0.6, orbit: { x: 86, y: 22, radius: 3 }, speed: -80 },
        { shape: 'saw', r: 0.6, path: [[105.5, 20], [105.5, 29]], speed: 1.5 },
        { shape: 'saw', r: 0.6, orbit: { x: 138, y: 38, radius: 3 }, speed: 90 },
      ],
      coins: [
        // hill arcs
        { x: 7, y: 42 }, { x: 14, y: 38 }, { x: 22, y: 36 }, { x: 30, y: 37 },
        // a long line across the sky
        ...Array.from({ length: 14 }, (_, i) => ({ x: 56 + i * 3, y: 6 })),
        // the lower cave tunnel
        ...Array.from({ length: 6 }, (_, i) => ({ x: 108 + i * 2, y: 33 })),
        // the descent
        { x: 132, y: 18 }, { x: 130, y: 28 }, { x: 136, y: 40 },
      ],
    },
    {
      // Practice: a tall empty shaft to try the fuel cell; the flag is far up
      name: 'Sky Shaft',
      practice: true,
      map: buildMap(28, 90, (b) => {
        b.pillar(10, 87, 8); b.set(13, 86, 'S');
        b.ledge(3, 66, 5);
        b.ledge(19, 46, 5);
        b.ledge(4, 26, 5);
        b.ledge(19, 9, 6);            // last rest stop, off to the side of the climb
        b.set(14, 4, 'G');            // flag in open air straight up the middle
      }),
      fuels: [{ x: 14, y: 82 }, { x: 6, y: 62 }, { x: 21, y: 42 }, { x: 6, y: 22 }],
    },
  ];

  // Campaign order = the difficulty curve. Sawtooth: each act teaches one idea, develops it,
  // peaks, and the next act opens with an easier breather (see docs/LEVEL_DESIGN.md).
  const ACTS = [
    { title: 'Flight School', about: 'Thrust, pads and stamina',
      levels: ['Tutorial', 'First Flight', 'Hop Scotch', 'The Shaft', 'Long Haul'] },
    { title: 'Pushers', about: 'Helpful and hostile pushers, the first checkpoint',
      levels: ['Updraft', 'Bounce House', 'The Ridge', 'Headwind', 'Slingshot Canyon'] },
    { title: 'Moving Hazards', about: 'Saws on paths and orbits, crushers',
      levels: ['Serpent Cave', 'Sawmill', 'Orbit Garden', 'Crusher Hall', 'Crosswinds'] },
    { title: 'Mastery', about: 'Precision, braking and timing',
      levels: ['Starlight Drift', 'The Needle', 'Freefall', 'Clockwork', 'Summit'] },
    { title: 'Drones', about: 'Drones and the gold shield',
      levels: ['Watchers', 'Shield Up', 'Ricochet', 'Patrol Route', 'Hunting Grounds'] },
    { title: 'Combinations', about: 'Drones with pushers, alcoves and gates',
      levels: ['Calm Waters', 'Gauntlet Run', 'Shield Bearer', 'Pinball Panic', 'The Nest'] },
    { title: 'Pressure', about: 'Drones with saws, crushers and descents',
      levels: ['Long Night', 'Saw Hunters', 'Crusher Ambush', 'Downdraft', 'Fortress'] },
    { title: 'Finale', about: 'Everything at once',
      levels: ['Quiet Before', 'Spiral', "Needle's Eye", 'Storm', 'Final Ascent'] },
    { title: 'Fuel', about: 'Fuel cells: 15 s of free thrust',
      levels: ['Fuel Line', 'Chimney', 'Long Burn', 'Saw Sprint', 'Burnout'] },
    { title: 'Firepower', about: 'The pistol: shoot drones and saws',
      levels: ['Target Practice', 'Saw Breaker', 'Drone Wall', 'Ammo Run', 'Firefight'] },
    { title: 'Overdrive', about: 'Fast saws',
      levels: ['Fast Lane', 'Orbit Overdrive', 'Spin Cycle', 'Fuel Rush', 'Redline'] },
    { title: 'Endgame', about: 'Stacked shields and everything at once',
      levels: ['Long Exhale', 'Armory', 'The Furnace', 'Siege', 'Last Light'] },
    { title: 'Odyssey', about: 'One huge journey through everything',
      levels: ['Odyssey'] },
    { title: 'Practice', about: 'Open arena, not part of the campaign', practice: true,
      levels: ['Test Ground', 'Sky Shaft'] },
  ];
  // Campaign order = the difficulty curve. Sawtooth: each act teaches one idea, develops it,
  // peaks on its last level, and the next act opens with an easier breather (docs/LEVEL_DESIGN.md).
  const CAMPAIGN = ACTS.flatMap((a) => a.levels);
  // ---------- Automatic coins ----------
  // You fly, you don't walk, so coins float in the air:
  //  - pad coins: one per pad (not the start pad), ~2 tiles above its middle (one hop reaches it)
  //  - challenge coins: open-air spots far from any pad and far from the goal (a detour that costs
  //    stamina), at least a tile from rock and clear of saws, crushers and drones
  function autoCoins(def) {
    const map = def.map, rows = map.length, cols = map[0].length;
    const tile = (c, r) => (r < 0 || c < 0 || r >= rows || c >= cols ? '#' : map[r][c]);
    const open = (c, r) => '.SG'.includes(tile(c, r));
    const isPad = (c, r) => tile(c, r) === '=' || tile(c, r) === 'C';
    // a coin (radius ~0.4 tile) at (x, y) in tile units must not touch any rock or pad tile
    const clear = (x, y, m = 0.45) => {
      for (let r = Math.floor(y - m); r <= Math.floor(y + m); r++) {
        for (let c = Math.floor(x - m); c <= Math.floor(x + m); c++) if (!open(c, r)) return false;
      }
      return true;
    };

    // Where hazards go: sample saws/crushers over their whole motion, plus drone homes
    const hazards = [];
    for (const m of def.movers || []) {
      const reach = m.shape === 'block' ? Math.max(m.w || 1, m.h || 1) / 2 + 1.2 : (m.r || 0.6) + 1.2;
      if (m.orbit) {
        for (let a = 0; a < 360; a += 10) {
          const t = (a * Math.PI) / 180;
          hazards.push({ x: m.orbit.x + Math.cos(t) * m.orbit.radius, y: m.orbit.y + Math.sin(t) * m.orbit.radius, reach });
        }
      } else {
        const pts = m.path;
        for (let i = 0; i < pts.length; i++) {
          const [x0, y0] = pts[i], [x1, y1] = pts[Math.min(i + 1, pts.length - 1)];
          for (let k = 0; k <= 10; k++) hazards.push({ x: x0 + ((x1 - x0) * k) / 10, y: y0 + ((y1 - y0) * k) / 10, reach });
        }
      }
    }
    for (const e of def.enemies || []) hazards.push({ x: e.x, y: e.y, reach: 3.5 });
    const safe = (x, y) => hazards.every((h) => Math.hypot(x - h.x, y - h.y) > h.reach);

    let start = null, goal = null;
    map.forEach((row, r) => {
      for (let c = 0; c < cols; c++) {
        if (row[c] === 'S') start = { c, r };
        if (row[c] === 'G' && !goal) goal = { c, r };
      }
    });

    const coins = [];
    const padTops = [];
    // pad coins
    map.forEach((row, r) => {
      for (let c = 0; c < cols; c++) {
        if (!isPad(c, r) || isPad(c - 1, r)) continue;
        let end = c;
        while (isPad(end + 1, r)) end++;
        for (let x = c; x <= end; x++) padTops.push({ x: x + 0.5, y: r - 0.5 });
        const isStart = start && start.r === r - 1 && start.c >= c && start.c <= end;
        const x = (c + end + 1) / 2;
        const byGoal = goal && Math.hypot(x - (goal.c + 0.5), r - 1 - (goal.r + 0.5)) < 3; // pointless there
        if (!isStart && !byGoal) {
          for (const lift of [2.2, 1.8, 1.4]) {
            const y = r - lift;
            if (clear(x, y) && safe(x, y)) { coins.push({ x, y }); break; }
          }
        }
        c = end;
      }
    });

    // distance (in steps) from the goal through open tiles: far = a detour
    const dist = new Map();
    const key = (c, r) => r * cols + c;
    if (goal) {
      const q = [[goal.c, goal.r]];
      dist.set(key(goal.c, goal.r), 0);
      while (q.length) {
        const [c, r] = q.shift();
        for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nc = c + dc, nr = r + dr;
          if (!open(nc, nr) || dist.has(key(nc, nr))) continue;
          dist.set(key(nc, nr), dist.get(key(c, r)) + 1);
          q.push([nc, nr]);
        }
      }
    }

    // challenge coins
    const candidates = [];
    for (let r = 1; r < rows - 1; r++) {
      for (let c = 1; c < cols - 1; c++) {
        const x = c + 0.5, y = r + 0.5;
        if (!dist.has(key(c, r)) || !clear(x, y, 1.2) || !safe(x, y)) continue;
        if (!open(c, r + 1) || !open(c, r + 2) || !open(c, r + 3)) continue; // keep well off the floor
        if (start && Math.hypot(c - start.c, r - start.r) < 6) continue;
        if (goal && Math.hypot(c - goal.c, r - goal.r) < 4) continue;
        const toPad = padTops.reduce((m, t) => Math.min(m, Math.hypot(x - t.x, y - t.y)), Infinity);
        if (toPad < 3.5 || toPad > 7) continue; // a real detour, but still within a few thrusts
        candidates.push({ x, y, score: toPad + dist.get(key(c, r)) * 0.15 });
      }
    }
    candidates.sort((a, b) => b.score - a.score);
    const want = rows * cols > 1500 ? 3 : 2;
    const picked = [];
    for (const cand of candidates) {
      if (picked.length >= want) break;
      if ([...picked, ...coins].some((o) => Math.hypot(o.x - cand.x, o.y - cand.y) < 8)) continue;
      picked.push({ x: cand.x, y: cand.y });
    }
    return [...coins, ...picked];
  }
  for (const d of DEFS) d.coins = [...autoCoins(d), ...(d.coins || [])];

  // ---------- Levels from the editor (src/levels-custom.js, see src/custom-io.js) ----------
  // Edited built-in levels replace the originals by name; new levels get a "Custom" act at the end.
  // Drafts (saved while they still had errors) stay in the editor and never reach the game.
  const BUILTIN = JSON.parse(JSON.stringify(DEFS)); // the originals, for the editor's "Revert"
  let CUSTOM = { overrides: {}, levels: [] };
  try {
    CUSTOM = (typeof module === 'object' && module.exports ? require('./levels-custom.js') : root.CUSTOM_LEVELS) || CUSTOM;
  } catch (e) { /* no custom levels file */ }
  for (const [name, def] of Object.entries(CUSTOM.overrides || {})) {
    const i = DEFS.findIndex((d) => d.name === name);
    if (i >= 0 && def && !def.draft) DEFS[i] = { ...def, name };
  }
  const customDefs = (CUSTOM.levels || []).filter((d) => d && !d.draft && !DEFS.some((b) => b.name === d.name))
    .map((d) => ({ ...d, practice: true, custom: true }));

  const byName = new Map(DEFS.map((d) => [d.name, d]));
  const LEVELS = CAMPAIGN.map((name) => {
    if (!byName.has(name)) throw new Error(`Campaign lists unknown level "${name}"`);
    return byName.get(name);
  });
  if (LEVELS.length !== DEFS.length) throw new Error('Every level must appear in CAMPAIGN exactly once');
  LEVELS.push(...customDefs);
  const ORDER = [...CAMPAIGN, ...customDefs.map((d) => d.name)];
  const allActs = customDefs.length
    ? [...ACTS, { title: 'Custom', about: 'Made in the level editor', practice: true, custom: true, levels: customDefs.map((d) => d.name) }]
    : ACTS;
  // Acts for the level select: { title, about, practice, levels: [index into LEVELS] }
  LEVELS.acts = allActs.map((act) => ({ ...act, levels: act.levels.map((name) => ORDER.indexOf(name)) }));
  // For the level editor
  LEVELS.builtin = BUILTIN;
  LEVELS.customData = CUSTOM;
  LEVELS.autoCoins = autoCoins;

  if (typeof module === 'object' && module.exports) module.exports = LEVELS;
  else root.LEVELS = LEVELS;
})(typeof self !== 'undefined' ? self : this);
