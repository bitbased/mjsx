/*
 * A clock with four faces, and three ways to know the time.
 *
 * WHERE THE TIME COMES FROM, best first:
 *
 *   1. net.fetch -- an HTTP HEAD, and the response's Date: header. No NTP
 *      client, no body: RFC 9110 says every response carries a Date, so a
 *      HEAD is a timestamp for the price of the headers. That matters on the
 *      2MB round board, where a JSON body would be the expensive part of
 *      asking what time it is.
 *   2. the RTC -- a PCF85063 at 0x51 on the shared I2C bus, read a byte at a
 *      time through sys.i2c. Battery-backed, so it survives a reboot, and
 *      SYNC writes the fetched time back into it.
 *   3. failing both -- sys.millis() from whatever was last set, kept in
 *      configStorage. It drifts and it resets, and the face says so rather
 *      than pretending otherwise.
 *
 * Internally the clock keeps UTC and `tz` shifts it for display, which is
 * what makes the offset control mean anything: change the zone and the hands
 * move, the stored time does not.
 *
 * GESTURES. The core already owns one -- an inward swipe from either rim is
 * Escape, which is the way back to the menu on round glass (docs/round.md).
 * So a stroke that STARTS within 14px of an edge is left alone here; taking
 * it would strand you on the clock. The rest:
 *
 *   swipe up / down    previous / next face
 *   swipe right        12-hour / 24-hour
 *   long press         set the time, the zone, and sync
 */

var HAVE_I2C = typeof sys !== 'undefined' && typeof sys.i2c === 'function';
var HAVE_FETCH = typeof net !== 'undefined' && typeof net.fetch === 'function';
var RTC_ADDR = 0x51;                  /* PCF85063 */
var R_SEC = 0x04, R_MIN = 0x05, R_HOUR = 0x06;
var DAY = 86400;

/* Any plain-HTTP server will do: RFC 9110 requires a Date on every response,
   so the STATUS does not even matter -- a 301 or a 403 carries the time just
   as well as a 200, and the body is never read. example.com is used because
   it is IANA-reserved, stable and answers over http; worldtimeapi.org was the
   first choice and turned out to be HTTPS-only, which the board reported as
   "connection lost". */
var TIME_URL = 'http://example.com/';

/* ---- the clock chip -------------------------------------------------
   BCD registers. Seconds bit 7 is the oscillator-stop flag: set means the
   chip lost power and its reading is meaningless, so it is treated as
   "no RTC" rather than as midnight. */
function bcd(b) { return ((b >> 4) & 15) * 10 + (b & 15); }
function unbcd(n) { return (((n / 10) | 0) << 4) | (n % 10); }

/* Three states, not two. A chip that answers but has bit 7 of the seconds
   register set (the oscillator-stop flag) is PRESENT and merely unset -- it
   lost power and never had the time written. Reporting that as "no clock
   chip" is wrong and hides the fix, which is simply to set the time: writing
   seconds with bit 7 clear starts the oscillator.
   Measured across the fleet: the 1.69" and 3.5" boards carry a PCF85063 at
   0x51, the 1.47" and the round 1.28" do not. */
var RTC_NONE = 0, RTC_UNSET = 1, RTC_OK = 2;

function rtcProbe() {
  if (!HAVE_I2C) return RTC_NONE;
  var s = sys.i2c(RTC_ADDR, R_SEC);
  if (s < 0) return RTC_NONE;
  return (s & 0x80) ? RTC_UNSET : RTC_OK;
}

function rtcRead() {
  if (rtcProbe() !== RTC_OK) return -1;
  var s = sys.i2c(RTC_ADDR, R_SEC);
  var m = sys.i2c(RTC_ADDR, R_MIN);
  var hh = sys.i2c(RTC_ADDR, R_HOUR);
  if (s < 0 || m < 0 || hh < 0) return -1;
  return bcd(hh & 0x3f) * 3600 + bcd(m & 0x7f) * 60 + bcd(s & 0x7f);
}

function rtcWrite(sec) {
  if (!HAVE_I2C || rtcState === RTC_NONE) return false;
  sec = ((sec % DAY) + DAY) % DAY;
  var hh = (sec / 3600) | 0, m = ((sec % 3600) / 60) | 0, s = sec % 60;
  return sys.i2c(RTC_ADDR, R_SEC, unbcd(s) & 0x7f) === 1 &&
         sys.i2c(RTC_ADDR, R_MIN, unbcd(m)) === 1 &&
         sys.i2c(RTC_ADDR, R_HOUR, unbcd(hh)) === 1;
}

/* ---- the soft clock -------------------------------------------------- */
var anchorUtc = 0, anchorMs = 0, rtcState = RTC_NONE;

function loadNum(key, dflt) {
  var v = configStorage.get(key, '');
  if (v === '' || v === null || v === undefined) return dflt;
  var n = parseInt('' + v, 10);
  return isNaN(n) ? dflt : n;
}

function anchor(utcSec) {
  anchorUtc = ((utcSec % DAY) + DAY) % DAY;
  anchorMs = sys.millis();
  configStorage.set('clock_utc', '' + Math.floor(anchorUtc));
}

(function boot() {
  rtcState = rtcProbe();
  var r = rtcRead();
  if (r >= 0) anchor(r);
  else anchor(loadNum('clock_utc', 10 * 3600));
})();

function utcNow() { return (anchorUtc + (sys.millis() - anchorMs) / 1000) % DAY; }
function localNow() {
  var t = utcNow() + UI.state.tz * 60;
  return ((t % DAY) + DAY) % DAY;
}

/* ---- network time ----------------------------------------------------
   Started here, collected in the ticker: net.fetch returns immediately and
   net.fetchState() is '' until the request lands, the same shape as
   net.scan/net.results. Nothing blocks the frame. */
function syncStart() {
  if (!HAVE_FETCH) return;
  var r = net.fetch(TIME_URL, { head: 1 });      /* HEAD: no body, ever */
  UI.set({ sync: r === 1 ? 'asking' : (r === 0 ? 'busy' : 'refused') });
}

/* "Sun, 30 Aug 2026 05:12:33 GMT" -> seconds of day, UTC. -1 if unparsable. */
function dateHeaderSec(d) {
  if (!d) return -1;
  var i = d.indexOf(':');
  if (i < 3) return -1;
  /* substring, not substr: MicroQuickJS does not implement substr (nor
     padStart/includes/startsWith, nor Array find/includes). It is an Annex B
     method that every desktop engine has, so this parsed fine everywhere and
     threw "TypeError: not a function" on the board -- taking UI.onTick down
     with it, which looked like a crash on SYNC. */
  var hh = parseInt(d.substring(i - 2, i), 10);
  var mm = parseInt(d.substring(i + 1, i + 3), 10);
  var ss = parseInt(d.substring(i + 4, i + 6), 10);
  if (isNaN(hh) || isNaN(mm) || isNaN(ss)) return -1;
  return hh * 3600 + mm * 60 + ss;
}

function syncPoll() {
  if (!HAVE_FETCH || UI.state.sync !== 'asking') return;
  var raw = net.fetchState();
  if (!raw) return;                               /* still in flight */
  var st = null;
  try { st = JSON.parse('' + raw); } catch (e) { st = null; }
  if (!st || st.status <= 0) { UI.set({ sync: 'failed' }); return; }
  var sec = dateHeaderSec(st.date);
  if (sec < 0) { UI.set({ sync: 'no date' }); return; }
  anchor(sec);
  if (rtcWrite(sec)) rtcState = RTC_OK;
  UI.set({ sync: 'ok' });
}

function two(n) { return (n < 10 ? '0' : '') + n; }
function parts(sec) {
  var h24 = (sec / 3600) | 0;
  var m = ((sec % 3600) / 60) | 0;
  var s = (sec % 60) | 0;
  return { h24: h24, m: m, s: s, pm: h24 >= 12,
           h: UI.state.h24 ? h24 : (h24 % 12 === 0 ? 12 : h24 % 12) };
}

/* ---- faces ----------------------------------------------------------- */

/* Hands are the one place arbitrary geometry beats the layout engine: a hand
   is an angle, not a box, so they are drawn as lines in one abs. */
function Analog(t, cx, cy, rad) {
  var kids = [], i, a;
  for (i = 0; i < 12; i++) {
    a = i * Math.PI / 6 - Math.PI / 2;
    var inner = rad - (i % 3 === 0 ? 12 : 6);
    kids.push(h('line', {
      x1: cx + Math.cos(a) * inner, y1: cy + Math.sin(a) * inner,
      x2: cx + Math.cos(a) * (rad - 2), y2: cy + Math.sin(a) * (rad - 2),
      color: i % 3 === 0 ? UI.theme.text : UI.theme.muted,
      w: i % 3 === 0 ? 2 : 1
    }));
  }
  function hand(frac, len, w, color) {
    var an = frac * Math.PI * 2 - Math.PI / 2;
    kids.push(h('line', {
      x1: cx - Math.cos(an) * (len * 0.18), y1: cy - Math.sin(an) * (len * 0.18),
      x2: cx + Math.cos(an) * len, y2: cy + Math.sin(an) * len,
      color: color, w: w
    }));
  }
  var mins = t.m + t.s / 60;
  hand(((t.h24 % 12) + mins / 60) / 12, rad * 0.52, 3, UI.theme.text);
  hand(mins / 60, rad * 0.74, 2, UI.theme.text);
  hand(t.s / 60, rad * 0.82, 1, UI.theme.accent);
  return h('abs', { x: 0, y: 0 }, kids);
}

function Digital(t) {
  return h('box', { gap: em(0.2) }, [
    h('text', { text: two(t.h) + ':' + two(t.m), size: 4, align: 'center' }),
    h('text', { text: two(t.s) + (UI.state.h24 ? '' : (t.pm ? ' PM' : ' AM')),
                size: 1, align: 'center', color: UI.theme.accent })
  ]);
}

var UNITS = ['TWELVE', 'ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX',
             'SEVEN', 'EIGHT', 'NINE', 'TEN', 'ELEVEN'];
var PAST = ['', 'FIVE PAST', 'TEN PAST', 'QUARTER PAST', 'TWENTY PAST',
            'TWENTY-FIVE PAST', 'HALF PAST'];
var TO = ['', 'TWENTY-FIVE TO', 'TWENTY TO', 'QUARTER TO', 'TEN TO', 'FIVE TO'];

function words(t) {
  var step = Math.round(t.m / 5) % 12;
  var hour = t.h24 % 12;
  if (step === 0) return UNITS[hour] + " O'CLOCK";
  if (step <= 6) return PAST[step] + ' ' + UNITS[hour];
  return TO[step - 6] + ' ' + UNITS[(hour + 1) % 12];
}

function Words(t) {
  return h('box', { gap: em(0.4), pad: em(0.5) }, [
    h('text', { text: words(t), size: 2, align: 'center', wrap: true }),
    h('text', { text: two(t.h) + ':' + two(t.m) + ':' + two(t.s),
                size: 1, align: 'center', color: UI.theme.muted })
  ]);
}

/* one column per digit, read bottom-up -- a binary clock as it presents */
function Binary(t) {
  var digits = [(t.h / 10) | 0, t.h % 10, (t.m / 10) | 0, t.m % 10,
                (t.s / 10) | 0, t.s % 10];
  var cols = [];
  for (var c = 0; c < digits.length; c++) {
    var dots = [];
    for (var b = 3; b >= 0; b--) {
      var on = (digits[c] >> b) & 1;
      dots.push(h('circle', { r: 5, filled: !!on,
        color: on ? (c < 2 ? UI.theme.accent : UI.theme.text) : UI.theme.muted }));
    }
    cols.push(h('box', { gap: em(0.3), align: 'center' }, dots));
  }
  return h('box', { gap: em(0.3), align: 'center' }, [
    h('row', { gap: em(0.55), align: 'center' }, cols),
    h('text', { text: two(t.h) + two(t.m) + two(t.s), size: 1,
                align: 'center', color: UI.theme.muted })
  ]);
}

var FACES = ['ANALOG', 'DIGITAL', 'WORDS', 'BINARY'];

/* ---- gestures ---------------------------------------------------------
   onDraw OWNS the whole stroke: the core hands a control every position from
   press to release and, in exchange, gives it no tap, no scroll and -- the
   part that caught this app out -- no long press. `holdFn` is explicitly
   nulled for an onDraw control (mjsx.js, the phase-0 branch of pointer()),
   so putting onLongPress on the same box did nothing at all.

   A hold is therefore counted here. It cannot be counted from the stroke
   handler alone: a finger held perfectly still sends no move events, so the
   only thing that reliably advances is the frame, and holdCheck() runs from
   the ticker. */
var HOLD_MS = 550, SLOP = 12;
var g = null;

function onStroke(phase, x, y) {
  if (phase === 0) {
    /* the rim belongs to the core's edge-back gesture, which is the way out */
    g = (x < 14 || x > gfx.width() - 14)
      ? null : { x: x, y: y, t: sys.millis(), moved: 0, fired: 0 };
    return;
  }
  if (!g) return;
  var dx = x - g.x, dy = y - g.y;
  var ax = dx < 0 ? -dx : dx, ay = dy < 0 ? -dy : dy;

  if (phase === 1) {
    if (ax > SLOP || ay > SLOP) g.moved = 1;   /* a drag is not a hold */
    return;
  }

  var wasHold = g.fired;
  g = null;
  if (wasHold) return;                          /* the hold already acted */
  if (ay > 40 && ay > ax) {
    UI.set({ face: (UI.state.face + (dy > 0 ? 1 : FACES.length - 1)) % FACES.length });
    configStorage.set('clock_face', '' + UI.state.face);
  } else if (dx > 40 && ay < 40) {
    UI.set({ h24: UI.state.h24 ? 0 : 1 });
    configStorage.set('clock_h24', '' + UI.state.h24);
  }
}

/* called every frame: the only clock a still finger has */
function holdCheck() {
  if (!g || g.fired || g.moved || UI.modal) return;
  if (sys.millis() - g.t < HOLD_MS) return;
  g.fired = 1;
  UI.openModal(Settings);
}

/* ---- setting it by hand ------------------------------------------------ */
/* em(2) looked like room for one character and was not: a Button's own
   padding eats it, fitText then truncates the label to nothing, and the row
   renders as two blank slabs. Sized for the glyph plus the padding. */
function Row(label, value, minus, plus) {
  return h('row', { gap: em(0.35), align: 'center' }, [
    h('text', { text: label, size: 1, color: UI.theme.muted, w: em(3) }),
    h(Button, { label: '-', size: 2, w: em(2.8), pad: em(0.2), onTap: minus }),
    h('box', { flex: 1 }, h('text', { text: value, size: 2, align: 'center' })),
    h(Button, { label: '+', size: 2, w: em(2.8), pad: em(0.2), onTap: plus })
  ]);
}

function Settings() {
  var t = parts(localNow());
  function bump(sec) {
    anchor(utcNow() + sec);
    if (rtcWrite(utcNow())) rtcState = RTC_OK;   /* the write clears OS */
    UI.set({ tick: UI.state.tick + 1 });
  }
  function tzBump(min) {
    UI.set({ tz: UI.state.tz + min });
    configStorage.set('clock_tz', '' + UI.state.tz);
  }
  var tz = UI.state.tz;
  return h(Modal, {
    header: h('text', { text: 'SET CLOCK', size: 1, align: 'center',
                        color: UI.theme.accent }),
    footer: h(Button, { label: 'DONE', size: 2,
                        onTap: function () { UI.closeModal(); } })
  }, [
      Row('HOUR', two(t.h24), function () { bump(-3600); }, function () { bump(3600); }),
      Row('MIN', two(t.m), function () { bump(-60); }, function () { bump(60); }),
      Row('ZONE', (tz < 0 ? '-' : '+') + two(Math.abs((tz / 60) | 0)) + ':' +
                  two(Math.abs(tz % 60)),
          function () { tzBump(-30); }, function () { tzBump(30); }),
      HAVE_FETCH
        ? h(Button, { label: 'SYNC OVER WIFI', size: 1, onTap: syncStart })
        : h('text', { size: 1, align: 'center', wrap: true, color: UI.theme.muted,
                      text: 'no net.fetch on this host' }),
      h('text', {
        size: 1, align: 'center', wrap: true, color: UI.theme.muted,
        text: UI.state.sync ? ('sync: ' + UI.state.sync)
             : (rtcState === RTC_OK ? 'kept in the RTC at 0x51'
               : rtcState === RTC_UNSET
                 ? 'RTC at 0x51 is stopped - set the time to start it'
                 : 'no clock chip here: this resets when the app does')
      })
  ]);
}

function App() {
  var t = parts(localNow());
  var W = gfx.width(), H = gfx.height();
  var face = UI.state.face;
  var body;
  if (face === 0) {
    var rad = (W < H ? W : H) / 2 - (UI.isRound() ? 10 : 6);
    body = h('box', { h: H }, Analog(t, W / 2, H / 2, rad));
  } else {
    var inner = face === 1 ? Digital(t) : (face === 2 ? Words(t) : Binary(t));
    body = h('box', { h: H, pad: em(0.6), gap: em(0.5), vcenter: true }, inner);
  }

  return (
    <box h={H} onDraw={onStroke}>
      {body}
      <abs x={0} y={UI.isRound() ? 20 : 4}>
        <text text={FACES[face]} size={1} align="center" w={W}
              color={UI.theme.muted} />
      </abs>
    </box>
  );
}

/* UI.mount takes the root and nothing else -- state is seeded through
   UI.set. Passing it as a second argument left UI.state empty, which read
   back as NaN everywhere and rendered a clock stuck at 12:00:00. */
UI.set({
  face: loadNum('clock_face', 0) % FACES.length,
  tz: loadNum('clock_tz', 0),
  h24: loadNum('clock_h24', 1),
  tick: 0, sync: ''
});
UI.mount(App);

/* A clock has to move on its own. UI.onTick is a hook the host calls every
   frame, so the redraw is throttled here rather than there -- a second hand
   needs four ticks a second, not sixty. */
var lastTick = 0;
UI.onTick = function () {
  holdCheck();                      /* a hold is only visible frame to frame */
  syncPoll();                       /* cheap: does nothing unless a sync is out */
  var now = sys.millis();
  if (now - lastTick < 250) return;
  lastTick = now;
  UI.set({ tick: UI.state.tick + 1 });
};
