/*
 * Every motion sensor the host has, three ways to look at it.
 *
 *   LEVEL  gravity as a bubble drifting in rings, with a horizon line
 *          tilting by roll — the one view a round display renders better
 *          than a rectangle, because a circle is already the frame
 *   TRACE  the last few seconds of each axis as a sparkline, so a tap or
 *          a shake reads as a SHAPE instead of three twitching numbers
 *   DATA   the numbers, and what is absent, stated plainly
 *
 * The module pushes STATE PATCHES on its own schedule and only when a
 * reading actually moved, so this view never polls: it renders
 * UI.state.accel / .gyro / .temp / .mag and is redrawn when they change.
 * That is the whole subscription — sys.modCtl('imu','start') and then
 * ordinary state.
 *
 * On a host with no motion hardware (a browser, the terminal, the 1.47"
 * board, which genuinely has no IMU) the simulator below drives the same
 * state, so the example is developable anywhere and says plainly which
 * of the two you are looking at.
 */
var HAVE_IMU = typeof sys !== 'undefined' && typeof sys.modCtl === 'function' &&
               sys.modCtl('imu', 'start') === 1;

/* What the module found, so the page can name the part rather than
   guessing: {"addr":107,"imu":"QMI8658","mag":"none",...} */
var INFO = {};
if (HAVE_IMU && typeof sys.mods === 'function') {
  var raw = sys.mods();
  if (raw && raw.indexOf('QMI8658') >= 0) INFO.imu = 'QMI8658';
  var MAGS = ['QMC5883L', 'HMC5883L', 'LIS3MDL', 'MLX90393'];
  for (var mi = 0; mi < MAGS.length; mi++) {
    if (raw && raw.indexOf(MAGS[mi]) >= 0) { INFO.mag = MAGS[mi]; break; }
  }
}

var VIEWS = ['LEVEL', 'TRACE', 'DATA'];

/* Rolling history, kept OUTSIDE UI.state: it changes every sample and
   would otherwise be a fresh object per patch for no benefit. The views
   read it at draw time. */
var HIST_N = 48;
var hist = { x: [], y: [], z: [], last: null };
function pushSample(a) {
  /* Fed from the RENDER rather than a timer: a render is exactly when new
     data arrived (the module patches state only when a reading moved), so
     the trace advances with the signal and never depends on a second
     clock agreeing with the first. */
  if (!a || a === hist.last) return;
  hist.last = a;
  hist.x.push(a.x); hist.y.push(a.y); hist.z.push(a.z);
  if (hist.x.length > HIST_N) { hist.x.shift(); hist.y.shift(); hist.z.shift(); }
}

function fmt(v, d) {
  return (v === undefined || v === null) ? '--' : v.toFixed(d);
}

/* ---- LEVEL -----------------------------------------------------------
 * Gravity as a bubble, rings for reference, and a horizon line tilting by
 * roll -- the one view a round display renders better than a rectangle.
 *
 * TWO things this had to learn the hard way. First, `abs` is PAGE
 * absolute, not parent relative: a dial drawn at box coordinates and
 * "centred" by flex spacers lands wherever the page origin is, which is
 * not the middle of anything. Every coordinate here is therefore
 * computed against gfx.width()/height() directly.
 *
 * Second, the IMU's axes are not the display's. Which way the chip is
 * rotated against the glass differs per board (and again per display
 * rotation), so there is no single correct mapping to hardcode -- TAP
 * THE DIAL to cycle the eight, and the choice is remembered per host in
 * configStorage. The bubble rolls to the LOW side, like a marble.
 */
var MAPS = [
  { n: 'x,y',   f: function (a) { return { x:  a.x, y:  a.y }; } },
  { n: 'x,-y',  f: function (a) { return { x:  a.x, y: -a.y }; } },
  { n: '-x,y',  f: function (a) { return { x: -a.x, y:  a.y }; } },
  { n: '-x,-y', f: function (a) { return { x: -a.x, y: -a.y }; } },
  { n: 'y,x',   f: function (a) { return { x:  a.y, y:  a.x }; } },
  { n: 'y,-x',  f: function (a) { return { x:  a.y, y: -a.x }; } },
  { n: '-y,x',  f: function (a) { return { x: -a.y, y:  a.x }; } },
  { n: '-y,-x', f: function (a) { return { x: -a.y, y: -a.x }; } }
];
/* Default derived rather than guessed: a flat board reads z = -1g, so the
   chip's +Z points INTO the glass. Right-handed with +X screen-right then
   puts +Y screen-down, and an accelerometer reads +1g along whichever axis
   points UP -- so tilting the right edge down gives NEGATIVE x, and a
   marble that rolls to the low side needs both axes inverted. Boards whose
   chip sits rotated differently are one tap away. */
var MAP_DEFAULT = 3;   /* '-x,-y' */
function mapIdx() {
  var v = parseInt(configStorage.get('lvl.map', '' + MAP_DEFAULT), 10);
  return (isNaN(v) || v < 0 || v > 7) ? MAP_DEFAULT : v;
}

/* Returns the abs-positioned dial, drawn in PAGE coordinates. */
function tiltDeg(a) {
  if (!a) return null;
  var m = MAPS[mapIdx()].f(a);
  var mag = Math.sqrt(m.x * m.x + m.y * m.y);
  return Math.round(Math.asin(mag > 1 ? 1 : mag) * 180 / Math.PI);
}

function levelNodes(a, cx, cy, R) {
  var kids = [];
  var ring = UI.theme.panel;
  kids.push(h('abs', { x: cx - R, y: cy - R },
    h('circle', { r: R, color: ring, filled: false })));
  kids.push(h('abs', { x: cx - (R >> 1), y: cy - (R >> 1) },
    h('circle', { r: R >> 1, color: ring, filled: false })));
  kids.push(h('abs', { x: 0, y: 0 },
    h('line', { x1: cx - R, y1: cy, x2: cx + R, y2: cy, color: ring })));
  kids.push(h('abs', { x: 0, y: 0 },
    h('line', { x1: cx, y1: cy - R, x2: cx, y2: cy + R, color: ring })));
  if (!a) return kids;

  var m = MAPS[mapIdx()].f(a);
  /* horizon: the roll implied by the mapped lateral pull */
  var roll = Math.atan2(m.x, 1);
  var hx = Math.cos(roll) * R, hy = Math.sin(roll) * R;
  kids.push(h('abs', { x: 0, y: 0 },
    h('line', { x1: Math.round(cx - hx), y1: Math.round(cy - hy),
                x2: Math.round(cx + hx), y2: Math.round(cy + hy),
                color: UI.theme.accent, w: 2 })));

  var bx = m.x, by = m.y;
  var mag = Math.sqrt(bx * bx + by * by);
  if (mag > 1) { bx /= mag; by /= mag; }
  var br = Math.max(4, R >> 3);
  var lvl = mag < 0.05;
  kids.push(h('abs', { x: Math.round(cx + bx * (R - br) - br),
                       y: Math.round(cy + by * (R - br) - br) },
    h('circle', { r: br, color: lvl ? UI.theme.ok : UI.theme.warn, filled: true })));

  return kids;
}

/* ---- TRACE -----------------------------------------------------------
 * One sparkline per axis over the same vertical span, so their shapes
 * are comparable at a glance.
 */
function Trace(p) {
  var w = p.w, hgt = p.h, span = p.span;
  var kids = [];
  var mid = Math.floor(hgt / 2);
  /* NO abs here: abs is PAGE absolute and painted this graph over the
     header. `line` and `path` measure zero height, so as ordinary flow
     children they draw from THIS box's origin and stack correctly. */
  kids.push(h('line', { x1: 0, y1: mid, x2: w, y2: mid, color: UI.theme.panel }));
  var series = [
    { a: hist.x, c: 0xff6b6b }, { a: hist.y, c: 0x4a9dff }, { a: hist.z, c: 0x44dd88 }
  ];
  for (var s = 0; s < series.length; s++) {
    var arr = series[s].a;
    if (arr.length < 2) continue;
    var pts = [];
    for (var i = 0; i < arr.length; i++) {
      var v = arr[i] / span;
      if (v > 1) v = 1;
      if (v < -1) v = -1;
      pts.push({ x: Math.round(i * (w - 1) / (HIST_N - 1)),
                 y: Math.round(mid - v * (mid - 2)) });
    }
    kids.push(h('path', { pts: pts, color: series[s].c, w: 1 }));
  }
  return h('box', { w: w, h: hgt }, kids);
}

/* One sensor, one panel. A missing magnetometer is a normal answer, not
   an error, so it is stated rather than hidden. */
function Axes(p) {
  var v = p.v;
  /* Three signed numbers share one row. At size 2 a value like "x-0.02"
     is 72px, so three overrun anything narrower than a 3.5" panel and
     ellipse away to nothing useful. The axis letter joins its number
     (lowercase, no space) and the size steps down where the row is
     tight -- a readable number beats a big one. */
  var sz = gfx.width() >= 320 ? 2 : 1;
  return (
    <box bg={UI.theme.panel} radius={8} pad={em(0.9)} gap={em(0.35)}>
      <row>
        <text text={p.label} size={1} color={UI.theme.muted} />
        <box flex={1} />
        <text text={p.unit} size={1} color={UI.theme.muted} />
      </row>
      {v
        ? <row gap={em(0.5)}>
            <text text={'x' + fmt(v.x, p.d)} size={sz} color={UI.theme.text} />
            <text text={'y' + fmt(v.y, p.d)} size={sz} color={UI.theme.text} />
            <text text={'z' + fmt(v.z, p.d)} size={sz} color={UI.theme.text} />
          </row>
        : <text text={p.absent || 'not present'} size={1} color={UI.theme.warn} />}
    </box>
  );
}

function App() {
  /* Round glass gets a uniform inset that keeps every panel inside the
     circle. The SHORT labels are a question of width, not shape: the
     1.47" is a perfectly square 172px panel and truncates
     "acceleration" just as readily as the circle does. */
  var round = UI.isRound();
  var narrow = round || gfx.width() < 200;
  var view = UI.state.view || 'LEVEL';
  var a = UI.state.accel || null;
  var g = UI.state.gyro || null;
  var m = UI.state.mag || null;
  var t = UI.state.temp;
  var amag = a ? Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z) : null;
  pushSample(a);

  var chips = [];
  for (var i = 0; i < VIEWS.length; i++) {
    chips.push(h(Button, {
      label: VIEWS[i], size: 1, pad: em(0.4),
      bg: view === VIEWS[i] ? UI.theme.accent : UI.theme.panel,
      onTap: (function (v) { return function () { UI.set({ view: v }); }; })(VIEWS[i])
    }));
  }

  var kids = [
    h('text', { text: 'MOTION', size: 2, align: 'center', color: UI.theme.accent }),
    h('text', { size: 1, align: 'center', color: UI.theme.muted,
      text: HAVE_IMU ? (INFO.imu || 'sensor') + ' + ' + (INFO.mag || 'no mag')
                     : (narrow ? 'simulated - no hardware'
                               : 'simulated - no motion hardware here') }),
    h('row', { gap: 4 }, chips)
  ];

  if (view === 'LEVEL') {
    /* Page coordinates, because that is the space abs actually uses. The
       dial is centred on the display and sits under the chrome; a flow
       spacer of the same height keeps the caption below it. */
    var top = narrow ? 84 : 92;
    var dial = Math.min(gfx.width() - (narrow ? 40 : 56),
                        gfx.height() - top - (narrow ? 26 : 34));
    if (dial < 50) dial = 50;
    var R = dial >> 1;
    var cx = gfx.width() >> 1, cy = top + R;
    kids.push(h('box', {
      h: dial, onTap: function () {
        configStorage.set('lvl.map', '' + ((mapIdx() + 1) % MAPS.length));
        UI._dirty = true;
      }
    }, levelNodes(a, cx, cy, R)));
    kids.push(h('text', { size: 1, align: 'center', color: UI.theme.muted,
      text: (amag === null ? 'waiting for a reading'
                           : tiltDeg(a) + ' deg   ' + amag.toFixed(2) + ' g') +
            '   tap:' + MAPS[mapIdx()].n }));
  } else if (view === 'TRACE') {
    var tw = gfx.width() - (narrow ? 30 : 46);
    kids.push(h('box', { bg: UI.theme.panel, radius: 8, pad: 4, gap: 2 }, [
      h('text', { text: narrow ? 'x red  y blue  z green'
                                : 'accel   x red   y blue   z green',
                  size: 1, color: UI.theme.muted }),
      h(Trace, { w: tw, h: Math.max(40, Math.floor(gfx.height() / 4)), span: 2 })
    ]));
    kids.push(h('text', { size: 1, align: 'center', color: UI.theme.muted,
      text: hist.x.length < 2 ? 'move the board to draw'
                              : hist.x.length + ' samples, +-2 g' }));
  } else {
    kids.push(h(Axes, { label: narrow ? 'accel' : 'acceleration', unit: 'g', v: a, d: 2 }));
    kids.push(h(Axes, { label: narrow ? 'gyro' : 'rotation', unit: 'deg/s', v: g, d: 1,
                        absent: 'no gyroscope' }));
    kids.push(h(Axes, { label: narrow ? 'mag' : 'magnetic field', unit: 'uT', v: m, d: 1,
                        absent: narrow ? 'none wired' : 'no magnetometer wired' }));
    kids.push(h('box', { bg: UI.theme.panel, radius: 8, pad: em(0.9), gap: em(0.35) }, [
      h('row', {}, [
        h('text', { text: 'derived', size: 1, color: UI.theme.muted }),
        h('box', { flex: 1 }),
        h('text', { text: t === undefined ? '' : fmt(t, 1) + ' C',
                    size: 1, color: UI.theme.muted })
      ]),
      h('text', { size: narrow ? 1 : 2,
                  color: amag === null ? UI.theme.muted : UI.theme.ok,
                  text: amag === null ? 'waiting for a reading'
                                      : 'total ' + amag.toFixed(2) + ' g' })
    ]));
  }

  return h('box', { h: gfx.height(), scroll: 'sensors',
                    pad: round ? em(2.4) : em(1), gap: em(0.6) }, kids);
}

UI.mount(App);

UI.onCleanup(function () {
  if (HAVE_IMU) sys.modCtl('imu', 'stop');
});

/* No hardware: drive the same state so the page is developable anywhere.
   Deliberately NOT started when the module is live -- a simulated needle
   next to a real one would be a lie. */
if (!HAVE_IMU) {
  (function tick() {
    var ms = sys.millis();
    UI.set({
      accel: { x: Math.sin(ms / 900) * 0.5, y: Math.cos(ms / 1300) * 0.5, z: -0.86 },
      gyro: { x: Math.sin(ms / 300) * 40, y: Math.cos(ms / 400) * 40, z: 0 },
      temp: 24.5
    });
    UI.setTimer(tick, 200);   /* a real driver re-arms exactly this way */
  })();
}
