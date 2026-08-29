/*
 * Every motion sensor the host has, live: acceleration in g, rotation in
 * degrees per second, die temperature, and a magnetometer's field in
 * microtesla when one is wired up.
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
  if (raw && raw.indexOf('QMC5883L') >= 0) INFO.mag = 'QMC5883L';
  else if (raw && raw.indexOf('HMC5883L') >= 0) INFO.mag = 'HMC5883L';
  else if (raw && raw.indexOf('LIS3MDL') >= 0) INFO.mag = 'LIS3MDL';
  else if (raw && raw.indexOf('MLX90393') >= 0) INFO.mag = 'MLX90393';
}

function fmt3(v, d) {
  return (v === undefined || v === null) ? '--' : v.toFixed(d);
}

/* One sensor, one panel. `axes` is the reading or null when the host has
   nothing to say about it -- a missing magnetometer is a normal answer,
   not an error, so it is stated rather than hidden. */
function Axes(p) {
  var v = p.v;
  /* Three signed numbers have to share one row. At size 2 a value like
     "x-0.02" is 72px, so three of them overrun anything narrower than a
     3.5" panel and the text ellipses away to nothing useful. The axis
     letter joins its number (lowercase, no space) and the size steps
     down where the row is tight -- a readable number beats a big one. */
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
            <text text={'x' + fmt3(v.x, p.d)} size={sz} color={UI.theme.text} />
            <text text={'y' + fmt3(v.y, p.d)} size={sz} color={UI.theme.text} />
            <text text={'z' + fmt3(v.z, p.d)} size={sz} color={UI.theme.text} />
          </row>
        : <text text={p.absent || 'not present'} size={1} color={UI.theme.warn} />}
    </box>
  );
}

function App() {
  /* Round glass gets a uniform inset that keeps every panel inside the
     circle. The SHORT labels are a question of width, not shape: the
     1.47" is a perfectly square 172px panel and truncates "acceleration"
     just as readily as the circle does. */
  var round = UI.isRound();
  var narrow = round || gfx.width() < 200;
  var a = UI.state.accel || null;
  var g = UI.state.gyro || null;
  var m = UI.state.mag || null;
  var t = UI.state.temp;

  /* magnitude is the honest check that a reading is real: at rest an
     accelerometer reads 1g in some direction, whatever the orientation */
  var amag = a ? Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z) : null;

  return (
    <box h={gfx.height()} scroll="sensors" pad={round ? em(2.4) : em(1)}
         gap={em(0.7)}>
      <text text="MOTION" size={2} align="center" color={UI.theme.accent} />
      <text size={1} align="center" color={UI.theme.muted}
            text={HAVE_IMU ? (INFO.imu || 'sensor') + ' + ' + (INFO.mag || 'no mag')
                           : (narrow ? 'simulated - no hardware'
                                     : 'simulated - no motion hardware here')} />

      <Axes label={narrow ? 'accel' : 'acceleration'} unit="g" v={a} d={2} />
      <Axes label={narrow ? 'gyro' : 'rotation'} unit="deg/s" v={g} d={1}
            absent="no gyroscope" />
      <Axes label={narrow ? 'mag' : 'magnetic field'} unit="uT" v={m} d={1}
            absent={narrow ? 'none wired' : 'no magnetometer wired'} />

      <box bg={UI.theme.panel} radius={8} pad={em(0.9)} gap={em(0.35)}>
        <row>
          <text text="derived" size={1} color={UI.theme.muted} />
          <box flex={1} />
          <text text={t === undefined ? '' : fmt3(t, 1) + ' C'}
                size={1} color={UI.theme.muted} />
        </row>
        <text size={narrow ? 1 : 2} color={amag === null ? UI.theme.muted : UI.theme.ok}
              text={amag === null ? 'waiting for a reading'
                                  : 'total ' + amag.toFixed(2) + ' g'} />
      </box>
    </box>
  );
}

UI.mount(App);

UI.onCleanup(function () {
  if (HAVE_IMU) sys.modCtl('imu', 'stop');
});

/* No hardware: drive the same state so the page is developable anywhere.
   Deliberately NOT started when the module is live -- a simulated needle
   next to a real one would be a lie. */
if (!HAVE_IMU) {
  UI.on('accel', function (d) { UI.set({ accel: d }); });
  (function tick() {
    var ms = sys.millis();
    UI.set({
      accel: { x: Math.sin(ms / 500), y: Math.cos(ms / 700), z: 0.98 },
      gyro: { x: Math.sin(ms / 300) * 40, y: Math.cos(ms / 400) * 40, z: 0 },
      temp: 24.5
    });
    UI.setTimer(tick, 200);   /* a real driver re-arms exactly this way */
  })();
}
