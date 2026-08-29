/*
 * Asteroids — the engine under load.
 *
 * Everything a counter does not: sixty frames a second of geometry, a
 * physics step, held input, and a few hundred draw calls per frame, all
 * through the same ten native calls a chip provides. If this runs on the
 * glass, the engine is not a toy.
 *
 * ROUND GLASS WRAPS ON A DISC, NOT A BOX. On a rectangle, leaving the
 * right edge puts you on the left. On a circle the corners do not exist,
 * so a box-wrapped object vanishes into a region that is not there and
 * reappears somewhere the player was not looking. Here the boundary is
 * the rim: cross it and you come back diametrically opposite, still on the
 * glass. `wrap()` is the only place in this file that asks UI.isRound().
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

/* ---- wrapping ---------------------------------------------------------
 * The whole shape-awareness of this example. On a rectangle, a torus. On
 * a circle, cross the rim and reappear opposite it — the disc equivalent,
 * and the only version that keeps an object on glass that exists.
 */
function wrap(o) {
  if (ROUND) {
    var dx = o.x - CX, dy = o.y - CY;
    var d = Math.sqrt(dx * dx + dy * dy);
    if (d > RAD) {
      var k = (RAD - 2) / d;
      o.x = CX - dx * k;
      o.y = CY - dy * k;
    }
    return;
  }
  if (o.x < 0) o.x += W; else if (o.x > W) o.x -= W;
  if (o.y < 0) o.y += H; else if (o.y > H) o.y -= H;
}

/* ---- the world -------------------------------------------------------- */
/* Rocks arrive AWAY FROM THE SHIP, not away from the centre of the glass.
   Measuring from the centre is only the same thing at the start: once the
   ship has flown somewhere, a new wave placed "half the field from the
   middle" can land in its lap. Every candidate is now checked against
   where the ship actually is, and pushed out along its own bearing until
   it clears — so a wave always comes from further out, wherever you are. */
var SAFE_R = 58;         /* nothing spawns closer to the ship than this */

function makeRocks(n, sx, sy) {
  if (sx === undefined) { sx = CX; sy = CY; }
  var out = [];
  for (var i = 0; i < n; i++) {
    var a = rnd(Math.PI * 2);
    var d = RAD * 0.5 + rnd(RAD * 0.45);
    var x = CX + Math.cos(a) * d, y = CY + Math.sin(a) * d;
    /* walk it outward along its bearing until it is clear of the ship */
    for (var guard = 0; guard < 12; guard++) {
      var dx = x - sx, dy = y - sy;
      if (dx * dx + dy * dy >= SAFE_R * SAFE_R) break;
      d += SAFE_R * 0.5;
      if (d > RAD * 0.95) { a += 2.1; d = RAD * 0.5; }   /* try another bearing */
      x = CX + Math.cos(a) * d;
      y = CY + Math.sin(a) * d;
      if (!ROUND) { if (x < 0) x += W; if (x > W) x -= W;
                    if (y < 0) y += H; if (y > H) y -= H; }
    }
    out.push({
      x: x, y: y,
      vx: rnd(0.5) - 0.25, vy: rnd(0.5) - 0.25,
      r: 8 + rnd(9), spin: rnd(0.02) - 0.01, ang: rnd(6.28),
      shape: makeShape()
    });
  }
  return out;
}

/* A rock is an OUTLINE, not a disc: eight vertices at jittered radii,
   closed with lines. That is what an asteroid looks like, and it is also
   the honest demonstration — a filled circle is one native call, whereas
   eight lines per rock is the engine actually drawing geometry. */
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
  var ox = G.cam === 'centred' ? CX : s.x;
  var oy = G.cam === 'centred' ? CY : s.y;
  var dx = x - ox, dy = y - oy;
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
    if (G.dead === 0) { s.x = CX; s.y = CY; s.vx = 0; s.vy = 0; s.ang = -Math.PI / 2; }
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
  s.x += s.vx; s.y += s.vy;
  wrap(s);

  for (i = G.rocks.length - 1; i >= 0; i--) {
    var r = G.rocks[i];
    r.x += r.vx; r.y += r.vy; r.ang += r.spin;
    wrap(r);
    var ddx = r.x - s.x, ddy = r.y - s.y;
    if (ddx * ddx + ddy * ddy < (r.r + SHIP_R - 2) * (r.r + SHIP_R - 2)) {
      G.lives--;
      G.dead = 45;
      if (G.lives <= 0) { G = fresh(); return; }
    }
  }

  for (i = G.bullets.length - 1; i >= 0; i--) {
    var b = G.bullets[i];
    b.x += b.vx; b.y += b.vy; b.life--;
    wrap(b);
    if (b.life <= 0) { G.bullets.splice(i, 1); continue; }
    for (j = G.rocks.length - 1; j >= 0; j--) {
      var k = G.rocks[j];
      var bx = b.x - k.x, by = b.y - k.y;
      if (bx * bx + by * by < k.r * k.r) {
        G.bullets.splice(i, 1);
        G.score += 10;
        if (k.r > 11) {
          /* one rock becomes two smaller ones, which is the whole game */
          var na = rnd(6.28);
          k.r = k.r * 0.58;
          k.vx = Math.cos(na) * 0.45; k.vy = Math.sin(na) * 0.45;
          G.rocks.push({ x: k.x, y: k.y, vx: -k.vx, vy: -k.vy,
                         r: k.r, spin: rnd(0.02) - 0.01, ang: rnd(6.28),
                         shape: makeShape() });
        } else {
          G.rocks.splice(j, 1);
        }
        break;
      }
    }
  }

  if (!G.rocks.length) G.rocks = makeRocks(3, s.x, s.y);

  /* the starfield only exists in CENTRED mode, and it drifts against the
     ship's motion — it IS the motion cue */
  if (G.cam === 'centred') {
    for (i = 0; i < G.stars.length; i++) {
      var st = G.stars[i];
      st.x -= s.vx; st.y -= s.vy;
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
  /* CENTRED moves the world instead of the ship, so everything is drawn
     through one offset and the ship is always at the middle. */
  var ox = G.cam === 'centred' ? CX - s.x : 0;
  var oy = G.cam === 'centred' ? CY - s.y : 0;

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
    if ((G.hasAim ? G.throttle : (G.thrusting ? 1 : 0)) > 0.05) {
      var fx = Math.cos(a + Math.PI) * (SHIP_R + 5);
      var fy = Math.sin(a + Math.PI) * (SHIP_R + 5);
      kids.push(h('abs', { x: 0, y: 0 },
        h('line', { x1: (sx + lx * 0.5) | 0, y1: (sy + ly * 0.5) | 0,
                    x2: (sx + fx) | 0, y2: (sy + fy) | 0, color: 0xf87171 })));
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
