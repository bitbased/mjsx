/*
 * Asteroids — the engine under load.
 *
 * Everything a counter does not: sixty frames a second of geometry, a
 * physics step, held input, and a few hundred draw calls per frame, all
 * through the same ten native calls a chip provides. If this runs on the
 * glass, the engine is not a toy.
 *
 * THE WORLD IS A TORUS, and that is the whole of the geometry: x and y
 * wrap modulo the panel, in both shapes. On round glass the corners of
 * that box are off-glass, so a rock crossing one is briefly behind the
 * bezel — which is what flying past the edge of a round window looks
 * like. Every attempt to be cleverer than this (disc antipodes, re-entry
 * "away from the ship") produced rocks appearing in the player's lap.
 *
 * TWO CAMERAS, because they answer different questions. WORLD keeps the
 * field still and flies the ship around it — the classic. CENTRED pins
 * the ship to the middle and moves the world past it, which on a 240px
 * circle is the only way to see where you are going. Motion you cannot
 * see is motion you cannot fly, so CENTRED draws a 1px starfield: with
 * the ship fixed and the rocks sparse, the stars are the only thing that
 * tells you the world is moving at all.
 *
 * CONTROLS, touch or keys, and no on-screen chrome — on a 240px display
 * every pixel spent on a button is a pixel not spent on the game:
 *
 *   touch   HOLD AND DRAG. The ship steers toward your finger and how far
 *           out you drag is the throttle. A quick tap fires.
 *   keys    left/right arrows turn, up thrusts, space fires.
 *
 * Hold-and-drag is here because of the round board. Screen thirds and
 * on-screen arrows are rectangle thinking: they assume corners to put
 * controls in and edges to divide. A circle has an angle everywhere, so
 * pointing IS the natural gesture — and the same handler happens to be
 * the nicest one on a rectangle too. One control scheme, every shape,
 * which is the whole argument of this project in miniature.
 *
 * ES5 only: this is example code, so it has to survive MicroQuickJS.
 */

var W = gfx.width(), H = gfx.height();
var CX = W / 2, CY = H / 2;
var ROUND = UI.isRound();
/* the playfield radius on round glass: the rim, less a hair for the bezel */
var RAD = (W < H ? W : H) / 2 - 2;

var SHIP_R = 7;          /* ship half-length, in pixels */
var TURN = 0.075;        /* radians per step */
var THRUST = 0.075;      /* pixels per step per step */
var DRAG = 0.985;        /* velocity retained per step */
var MAX_V = 2.2;         /* and a ceiling, so a long burn cannot outrun the eye */
var BULLET_V = 2.6;
var BULLET_LIFE = 70;    /* steps */
var TAP_MS = 220;        /* a press shorter than this, that barely moved, fires */

/* A FIXED STEP, because onTick is the host's frame and hosts differ wildly:
   a 120Hz browser calls it twice as often as a 60Hz one and eight times as
   often as a chip managing 15. Tying the physics to the call would make the
   same file play at eight different speeds. Real elapsed time is banked and
   spent in 16ms steps instead, so the ship flies the same everywhere.

   When the clock does not move at all -- the screenshot harness freezes
   sys.millis() so a figure is reproducible -- it falls back to one step per
   tick, which is what makes the goldens deterministic. */
var STEP_MS = 16;
var MAX_STEPS = 4;       /* a backgrounded tab must not fast-forward on return */

/* A SEEDED generator, not Math.random(). The field has to be the same
   field every time: the screenshot harness must regenerate this example's
   figures byte-identically, and the golden hashes must mean something. A
   game that starts differently on every run cannot be a fixture.
   Plain LCG — ES5, no library, and identical on every engine. */
var _seed = 20260829;
function rnd(n) {
  _seed = (_seed * 1103515245 + 12345) & 0x7fffffff;
  return (_seed / 0x7fffffff) * n;
}

/* ---- the world is a TORUS, in both shapes -----------------------------
 *
 * One rule, and only one: x and y wrap modulo the panel. Leave the right,
 * arrive on the left, at the same height. Nothing teleports across the
 * middle, nothing is placed "opposite" anything, and there are no cases.
 *
 * This replaced a pile of special handling that kept producing the same
 * complaint — rocks appearing next to the ship — for three different
 * reasons, all of them consequences of trying to be clever:
 *
 *   - a "re-enter away from the ship" rule that degenerates in CENTRED
 *     mode, where the ship sits at the middle: atan2(0, 0) is 0, so every
 *     rock came back through the left rim. On a rectangle all four edge
 *     distances tie there too, so it also always picked left.
 *   - a disc wrap that put a rock at the diametrically opposite point,
 *     which on a 240px circle is only ~200px away and can be exactly where
 *     a ship near the rim is.
 *   - waves spawned at "half the field from the centre", which in CENTRED
 *     mode is half the field from the ship.
 *
 * On round glass the corners of the box are off-glass, so a rock crossing
 * one is briefly hidden behind the bezel and comes back. That is honest —
 * it is what flying past the edge of a round window looks like — and it
 * costs nothing, where every attempt to be cleverer cost a bug.
 */
function wrapT(o) {
  if (o.x < 0) o.x += W; else if (o.x >= W) o.x -= W;
  if (o.y < 0) o.y += H; else if (o.y >= H) o.y -= H;
}

/* Distance ON THE TORUS: the short way round, which is the only distance
   that means anything once things wrap. A rock 4px off the left edge is
   4px from a ship on the right edge, not a screen away. */
function torusD(ax, ay, bx, by) {
  var dx = ax - bx; if (dx < 0) dx = -dx; if (dx > W / 2) dx = W - dx;
  var dy = ay - by; if (dy < 0) dy = -dy; if (dy > H / 2) dy = H - dy;
  return Math.sqrt(dx * dx + dy * dy);
}

/* ---- the world -------------------------------------------------------- */

/* How much room a new rock must give the ship. A share of the panel, not a
   pixel count: 58px is a polite distance on a 480px window and a third of
   the way across a 172px one. */
var SAFE_R = (W < H ? W : H) * 0.42;

/* A wave ARRIVES FROM THE EDGE. Not from mid-field — that is what put
   rocks in your face — and not from a computed "far side", which has no
   meaning once the world wraps. It picks an edge position at random and
   keeps picking until the spot is far enough from the ship on the torus,
   which on any panel this project ships is nearly always the first try. */
function edgeSpawn(sx, sy) {
  /* ON ROUND GLASS THE EDGE IS THE RIM. Spawning on the bounding box puts
     rocks in the corners, which are not on the display at all — so they
     arrive out of nowhere instead of in from the edge. In CENTRED mode,
     which is what round glass runs, the ship is ALWAYS the middle, so the
     rim is always maximally far from it and there is nothing to search
     for: pick an angle. */
  if (ROUND) {
    var a = rnd(Math.PI * 2);
    return { x: CX + Math.cos(a) * (RAD - 3), y: CY + Math.sin(a) * (RAD - 3) };
  }
  return boxEdgeSpawn(sx, sy);
}

function boxEdgeSpawn(sx, sy) {
  /* Take the FARTHEST of a handful of candidates, not the first one that
     passes and not — as the first version did — whatever the last try
     happened to be when none passed. That fallback is what let a rock
     arrive 34px away: on a small panel with the ship near an edge, plenty
     of edge positions fail the test, and returning the last failure hands
     the player the worst one instead of the best. Sampling and keeping the
     maximum always gives whatever clearance the panel can offer. */
  var bx = 0, by = 0, best = -1;
  for (var k = 0; k < 32; k++) {
    var x, y;
    if (rnd(1) < 0.5) { x = rnd(1) < 0.5 ? 1 : W - 1; y = rnd(H); }
    else              { y = rnd(1) < 0.5 ? 1 : H - 1; x = rnd(W); }
    var d = torusD(x, y, sx, sy);
    if (d > best) { best = d; bx = x; by = y; }
    if (d >= SAFE_R) break;
  }
  return { x: bx, y: by };
}

function makeRocks(n, sx, sy) {
  if (sx === undefined) { sx = CX; sy = CY; }
  var out = [];
  for (var i = 0; i < n; i++) {
    var p = edgeSpawn(sx, sy);
    /* heading roughly across the field, so a wave crosses rather than
       skimming the edge it came in on */
    var toward = Math.atan2(CY - p.y, CX - p.x) + (rnd(1.0) - 0.5);
    var sp = 0.25 + rnd(0.3);
    out.push({
      x: p.x, y: p.y,
      vx: Math.cos(toward) * sp, vy: Math.sin(toward) * sp,
      r: 8 + rnd(9), spin: rnd(0.02) - 0.01, ang: rnd(6.28),
      shape: makeShape(), born: 'edge'
    });
  }
  return out;
}


var ROCK_V = 8;
function makeShape() {
  var out = [];
  for (var i = 0; i < ROCK_V; i++) out.push(0.72 + rnd(0.45));
  return out;
}

function makeStars(n) {
  var out = [];
  for (var i = 0; i < n; i++) out.push({ x: rnd(W), y: rnd(H) });
  return out;
}

function fresh() {
  return {
    ship: { x: CX, y: CY, vx: 0, vy: 0, ang: -Math.PI / 2 },
    rocks: makeRocks(3),
    bullets: [],
    stars: makeStars(48),
    score: 0, lives: 3, dead: 0,
    turn: 0, thrusting: 0, last: undefined, bank: 0,
    hasAim: 0, aimAng: 0, throttle: 0,
    /* Round glass defaults to CENTRED: on a 240px circle a moving ship
       spends most of its time near the rim, which is where the bezel eats
       it. A host can override through configStorage, and `c` toggles. */
    cam: configStorage.get('cam', ROUND ? 'centred' : 'world')
  };
}

var G = fresh();

/* ---- input ------------------------------------------------------------
 * ONE whole-stroke handler over the entire screen. Returning true from
 * UI.onPointer takes the stroke before hit-testing, so there is nothing to
 * lay out, nothing to hit, and no chrome.
 *
 * The finger is a heading and a throttle at once: the ship turns toward
 * where you are holding, and the further out you hold, the harder it
 * burns. Inside DEAD_R it only steers, so you can line a shot up without
 * drifting. Let go and the drag settles it.
 */
var DEAD_R = 14;         /* hold this close to the ship and it only turns */
var FULL_R = 70;         /* and this far out is full throttle */

function aim(x, y) {
  /* steer toward the finger from wherever the ship is. In CENTRED mode
     the ship is the middle of the screen, so this is also the angle from
     centre — the two readings agree and neither needs a special case. */
  var s = G.ship;
  var dx = x - s.x, dy = y - s.y;
  var d = Math.sqrt(dx * dx + dy * dy);
  if (d < 1) return;                       /* on top of the ship: no heading */
  G.aimAng = Math.atan2(dy, dx);
  G.hasAim = 1;
  var t = (d - DEAD_R) / (FULL_R - DEAD_R);
  G.throttle = t < 0 ? 0 : (t > 1 ? 1 : t);
}

UI.onPointer = function (id, phase, x, y) {
  if (phase === 0) {
    G.t0 = sys.millis(); G.px = x; G.py = y;
    aim(x, y);
    return true;
  }
  if (phase === 1) { aim(x, y); return true; }
  if (phase === 2) {
    var dx = x - G.px, dy = y - G.py;
    var moved = dx * dx + dy * dy > 64;
    if (!moved && sys.millis() - G.t0 < TAP_MS) fire();
    G.hasAim = 0; G.throttle = 0;
    return true;
  }
};

UI.onKey = function (type, key) {
  var down = type === 'down' || type === 'press';
  if (key === 'ArrowLeft')  { G.turn = down ? -1 : 0; return true; }
  if (key === 'ArrowRight') { G.turn = down ? 1 : 0;  return true; }
  if (key === 'ArrowUp')    { G.thrusting = down ? 1 : 0; return true; }
  if (key === ' ' || key === 'Space' || key === 'Enter') {
    if (type === 'press') fire();
    return true;
  }
  if ((key === 'c' || key === 'C') && type === 'press') {
    G.cam = G.cam === 'world' ? 'centred' : 'world';
    configStorage.set('cam', G.cam);
    UI._dirty = true;
    return true;
  }
  return false;
};

function fire() {
  if (G.dead > 0 || G.bullets.length >= 5) return;
  G.bullets.push({
    x: G.ship.x + Math.cos(G.ship.ang) * SHIP_R,
    y: G.ship.y + Math.sin(G.ship.ang) * SHIP_R,
    vx: G.ship.vx + Math.cos(G.ship.ang) * BULLET_V,
    vy: G.ship.vy + Math.sin(G.ship.ang) * BULLET_V,
    life: BULLET_LIFE
  });
}

/* ---- the step ---------------------------------------------------------
 * onTick is the host's frame. Nothing here reads a wall clock: the host
 * decides how often the world advances, which is what makes the same
 * source behave the same on a 60fps window and on a chip that manages 25.
 */
function step() {
  var s = G.ship, i, j;

  if (G.dead > 0) {
    G.dead--;
    if (G.dead === 0) {
      /* CLEAR THE SPOT, do not wait for it to clear.
       *
       * You die where the rock is, and the ship respawns at the centre —
       * so in CENTRED mode you respawn straight back into the rock that
       * just killed you, over and over. Waiting for it to drift away was
       * the first attempt and is worse: in that mode the world only moves
       * when the SHIP moves, and a dead ship moves nothing, so the wait
       * never ends. Nothing can resolve it but this.
       *
       * So anything sitting on the spawn point is sent back out to the
       * boundary, the same way a wrapping rock re-enters. You always get
       * a clean start, and you never get a free kill for it. */
      s.x = CX; s.y = CY; s.vx = 0; s.vy = 0; s.ang = -Math.PI / 2;
      for (var q = 0; q < G.rocks.length; q++) {
        var rq = G.rocks[q];
        var qx = rq.x - CX, qy = rq.y - CY;
        var need = SAFE_R + rq.r;
        if (qx * qx + qy * qy < need * need) {
          var np = edgeSpawn(CX, CY);
          rq.x = np.x; rq.y = np.y;
        }
      }
    }
    return;
  }

  if (G.hasAim) {
    /* POINT WHERE THE FINGER IS, immediately. Easing toward the held angle
       reads as lag, because a finger is an absolute input: you are not
       asking the ship to turn, you are saying where it should face. Keys
       are the relative input, and those still turn at a rate. */
    s.ang = G.aimAng;
  } else {
    s.ang += G.turn * TURN;
  }
  var burn = G.hasAim ? G.throttle : (G.thrusting ? 1 : 0);
  if (burn > 0) {
    s.vx += Math.cos(s.ang) * THRUST * burn;
    s.vy += Math.sin(s.ang) * THRUST * burn;
  }
  s.vx *= DRAG; s.vy *= DRAG;
  var sp = Math.sqrt(s.vx * s.vx + s.vy * s.vy);
  if (sp > MAX_V) { s.vx = s.vx / sp * MAX_V; s.vy = s.vy / sp * MAX_V; }
  /* TWO CAMERAS, TWO KINDS OF MOTION.
   *
   * CENTRED is INFINITE SCROLL. The ship does not move at all — it is
   * pinned to the middle of the glass and the WORLD streams past it, so
   * everything else carries the ship's velocity in reverse. Nothing
   * teleports, because nothing has an edge to cross: rocks and stars just
   * wrap around the field as they drift by. That also kills the bug this
   * mode kept producing, where the SHIP wrapped into whatever was parked
   * on the far side and it looked like a rock had appeared on top of you.
   *
   * WORLD is the classic: the field is still and the ship flies around it,
   * wrapping at the edges like everything else.
   */
  var scrollX = 0, scrollY = 0;
  if (G.cam === 'centred') {
    s.x = CX; s.y = CY;
    scrollX = -s.vx; scrollY = -s.vy;
  } else {
    s.x += s.vx; s.y += s.vy;
    wrapT(s);
  }

  for (i = G.rocks.length - 1; i >= 0; i--) {
    var r = G.rocks[i];
    r.x += r.vx + scrollX; r.y += r.vy + scrollY; r.ang += r.spin;
    wrapT(r);
    var ddx = r.x - s.x, ddy = r.y - s.y;
    if (ddx * ddx + ddy * ddy < (r.r + SHIP_R - 2) * (r.r + SHIP_R - 2)) {
      G.lives--;
      G.dead = 45;
      if (G.lives <= 0) { G = fresh(); return; }
      /* ONE death per step. Without this break the loop keeps testing the
         remaining rocks against a ship that is already dead, so two
         overlapping rocks cost two lives in a single frame and a cluster
         can end a whole game instantly — which from the seat is
         indistinguishable from an unbreakable crash loop. */
      break;
    }
  }

  for (i = G.bullets.length - 1; i >= 0; i--) {
    var b = G.bullets[i];
    /* a bullet is in the world, so it scrolls with it — otherwise shots
       would hang in front of a ship that is supposedly moving */
    b.x += b.vx + scrollX; b.y += b.vy + scrollY; b.life--;
    wrapT(b);
    if (b.life <= 0) { G.bullets.splice(i, 1); continue; }
    for (j = G.rocks.length - 1; j >= 0; j--) {
      var k = G.rocks[j];
      var bx = b.x - k.x, by = b.y - k.y;
      if (bx * bx + by * by < k.r * k.r) {
        G.bullets.splice(i, 1);
        G.score += 10;
        if (k.r > 11) {
          /* One rock becomes two at the impact point, which is where you
             shot it. That is the game, and it stays exactly as it is. */
          var na = rnd(6.28);
          k.r = k.r * 0.58;
          k.vx = Math.cos(na) * 0.45; k.vy = Math.sin(na) * 0.45;
          /* a fragment is born where you shot it, on purpose: that is the
             consequence of your own shot, not something arriving at you */
          G.rocks.push({ x: k.x, y: k.y, vx: -k.vx, vy: -k.vy,
                         r: k.r, spin: rnd(0.02) - 0.01, ang: rnd(6.28),
                         shape: makeShape(), born: 'split' });
        } else {
          G.rocks.splice(j, 1);
        }
        break;
      }
    }
  }

  if (!G.rocks.length) G.rocks = makeRocks(3, s.x, s.y);

  /* The starfield exists only in CENTRED mode, and it is the whole reason
     that mode is legible: with the ship pinned and the rocks sparse, the
     stars are the only thing that says the world is moving. They wrap on
     the bounding box rather than the disc — they are a texture, and a
     texture wants even coverage, not a circle's worth. */
  if (G.cam === 'centred') {
    for (i = 0; i < G.stars.length; i++) {
      var st = G.stars[i];
      st.x += scrollX; st.y += scrollY;
      if (st.x < 0) st.x += W; else if (st.x > W) st.x -= W;
      if (st.y < 0) st.y += H; else if (st.y > H) st.y -= H;
    }
  }

  UI._dirty = true;
}

UI.onTick = function () {
  var now = sys.millis();
  if (G.last === undefined) { G.last = now; step(); UI._dirty = true; return true; }
  var dt = now - G.last;
  if (dt <= 0) {                 /* frozen clock: the screenshot harness */
    step();
    UI._dirty = true;
    return true;
  }
  G.last = now;
  G.bank = (G.bank || 0) + dt;
  var n = 0;
  while (G.bank >= STEP_MS && n < MAX_STEPS) { G.bank -= STEP_MS; step(); n++; }
  if (G.bank > STEP_MS * MAX_STEPS) G.bank = 0;   /* came back from a background tab */
  UI._dirty = true;
  return true;
};

/* ---- drawing ----------------------------------------------------------
 * Every shape here is `line` and `frect` and `circle`: the primitives the
 * contract guarantees. No poly, no blit, nothing optional.
 */
function View() {
  var s = G.ship;
  /* No camera offset any more. In CENTRED the ship is literally at the
     middle and the world has already been scrolled past it, so every
     object is in screen coordinates in both modes. */
  var ox = 0, oy = 0;

  var kids = [];

  if (G.cam === 'centred') {
    for (var i = 0; i < G.stars.length; i++) {
      kids.push(h('abs', { x: G.stars[i].x | 0, y: G.stars[i].y | 0 },
        h('box', { w: 1, h: 1, bg: 0x445066 })));
    }
  }

  for (var j = 0; j < G.rocks.length; j++) {
    var r = G.rocks[j];
    var rx = r.x + ox, ry = r.y + oy, segs = [];
    for (var v = 0; v < ROCK_V; v++) {
      var a1 = r.ang + v * (Math.PI * 2 / ROCK_V);
      var a2 = r.ang + (v + 1) * (Math.PI * 2 / ROCK_V);
      var r1 = r.r * r.shape[v], r2 = r.r * r.shape[(v + 1) % ROCK_V];
      segs.push(h('line', {
        x1: (rx + Math.cos(a1) * r1) | 0, y1: (ry + Math.sin(a1) * r1) | 0,
        x2: (rx + Math.cos(a2) * r2) | 0, y2: (ry + Math.sin(a2) * r2) | 0,
        color: 0x98a1ae
      }));
    }
    kids.push(h('abs', { x: 0, y: 0 }, h('box', {}, segs)));
  }

  for (var b = 0; b < G.bullets.length; b++) {
    var u = G.bullets[b];
    kids.push(h('abs', { x: (u.x + ox) | 0, y: (u.y + oy) | 0 },
      h('box', { w: 2, h: 2, bg: 0xfbbf24 })));
  }

  if (G.dead === 0 || (G.dead >> 2) % 2 === 0) {
    var sx = s.x + ox, sy = s.y + oy, a = s.ang;
    var nx = Math.cos(a) * SHIP_R, ny = Math.sin(a) * SHIP_R;
    var lx = Math.cos(a + 2.5) * SHIP_R, ly = Math.sin(a + 2.5) * SHIP_R;
    var rx = Math.cos(a - 2.5) * SHIP_R, ry = Math.sin(a - 2.5) * SHIP_R;
    var col = 0x4ade80;
    kids.push(h('abs', { x: 0, y: 0 }, h('box', {}, [
      h('line', { x1: (sx + nx) | 0, y1: (sy + ny) | 0,
                  x2: (sx + lx) | 0, y2: (sy + ly) | 0, color: col }),
      h('line', { x1: (sx + nx) | 0, y1: (sy + ny) | 0,
                  x2: (sx + rx) | 0, y2: (sy + ry) | 0, color: col }),
      h('line', { x1: (sx + lx) | 0, y1: (sy + ly) | 0,
                  x2: (sx + rx) | 0, y2: (sy + ry) | 0, color: col })
    ])));
    var burn = G.hasAim ? G.throttle : (G.thrusting ? 1 : 0);
    if (burn > 0.05) {
      /* ON THE SHIP'S AXIS. The flame used to start at half the LEFT rear
         vertex, which drew it as a line skewed off one side. It belongs at
         the middle of the rear edge, pointing straight back — and its
         length is the throttle, so the exhaust says how hard you are
         burning. */
      var mx = sx + (lx + rx) / 2, my = sy + (ly + ry) / 2;
      var len = 4 + burn * 7;
      kids.push(h('abs', { x: 0, y: 0 },
        h('line', { x1: mx | 0, y1: my | 0,
                    x2: (mx - Math.cos(a) * len) | 0,
                    y2: (my - Math.sin(a) * len) | 0, color: 0xf87171 })));
    }
  }

  /* HUD: on round glass the top arc is narrow, so the readout sits a
     tenth of the way down where the chord is wide enough for it. */
  /* HUD ON THE TOP CENTRE LINE. Corners are the natural place for a score
     on a rectangle and the worst place on a circle: the rim cuts them.
     The vertical centre line is the one column that is full width on every
     shape, so one placement serves all of them and nothing is clipped. */
  var hudY = ROUND ? (H * 0.13) | 0 : 3;
  var line1 = 'SCORE ' + G.score + '   SHIPS ' + G.lives;
  var line2 = G.cam === 'centred' ? 'CENTRED' : 'WORLD';
  kids.push(h('abs', { x: (CX - line1.length * 3) | 0, y: hudY },
    h('text', { text: line1, size: 1, color: 0x4b8bf5 })));
  kids.push(h('abs', { x: (CX - line2.length * 3) | 0, y: hudY + 9 },
    h('text', { text: line2, size: 1, color: 0x3a4351 })));

  return h('box', { w: W, h: H, bg: 0x000000 }, kids);
}

UI.mount(View);
