/*
 * mjsx clock — read and set the boards' time and timezone over the network.
 *
 * THIS MACHINE IS THE TIME SOURCE. A board can fetch its own time with
 * net.fetch and a Date header, but that needs the fetch allowlist opened, an
 * internet route, and it lands a second or so late. The laptop pushing the
 * command already knows the time exactly, so `mjsx clock set` is both more
 * accurate and works on a network with no way out.
 *
 * Two places hold the answer, and this writes BOTH, because neither is
 * enough alone:
 *
 *   - the RTC at 0x51 (a PCF85063) via the firmware's `reg` command. It is
 *     battery-backed and survives a reboot, and writing the seconds register
 *     with bit 7 clear also clears the oscillator-stop flag, which is what
 *     starts a chip that has never been set. Only the 1.69" and 3.5" boards
 *     carry one.
 *   - configStorage (`clock_utc`, `clock_tz`), which every board has and
 *     examples/clock reads at boot. This is the only time source on the
 *     1.47" and the round 1.28".
 *
 * The RTC write goes through `reg` rather than JS so it works whatever app
 * is running — or none.
 */
var U = require('./util.js');
var link = require('./bridge-link.js');
var mdns = require('./mdns.js');

var SERVICE = '_filament-rfid._tcp.local';
var RTC_ADDR = 0x51;
var R_SEC = 0x04, R_MIN = 0x05, R_HOUR = 0x06;

var HELP = 'usage: mjsx clock ls [--ips a,b,c] [--wait 5s]\n' +
  '       mjsx clock set [--time now|HH:MM[:SS]] [--tz ±MIN|±H:MM] [--ips a,b,c]\n' +
  '\n' +
  'ls    reads each board\'s stored offset and its RTC, and says which of\n' +
  '      the two the clock example would actually use.\n' +
  '\n' +
  'set   writes THIS MACHINE\'s time (or --time HH:MM:SS, always UTC) to the\n' +
  '      RTC where there is one and to configStorage everywhere. No internet\n' +
  '      is needed on the board: the laptop is the time source.\n' +
  '\n' +
  '  --time  now (default), or an explicit UTC HH:MM[:SS]\n' +
  '  --tz    display offset in minutes (-300) or hours:minutes (-5:00).\n' +
  '          Omitted, the offset is left alone.\n' +
  '  --ips   skip discovery and name the boards\n';

function bcd(b) { return ((b >> 4) & 15) * 10 + (b & 15); }
function unbcd(n) { return (((n / 10) | 0) << 4) | (n % 10); }
function two(n) { return (n < 10 ? '0' : '') + n; }
function hms(sec) {
  sec = ((sec % 86400) + 86400) % 86400;
  return two((sec / 3600) | 0) + ':' + two(((sec % 3600) / 60) | 0) + ':' + two(sec % 60);
}

/* --tz accepts minutes (-300) or hours:minutes (-5:00, +05:30) */
function parseTz(v) {
  var s = String(v).trim();
  var m = /^([+-]?)(\d{1,2}):(\d{2})$/.exec(s);
  if (m) {
    var mins = parseInt(m[2], 10) * 60 + parseInt(m[3], 10);
    return m[1] === '-' ? -mins : mins;
  }
  if (!/^[+-]?\d+$/.test(s)) {
    U.die('mjsx clock: --tz wants minutes (-300) or hours:minutes (-5:00), not "' + v + '"');
  }
  return parseInt(s, 10);
}

/* --time is always UTC: a wall-clock string with no zone is ambiguous, and
   guessing the caller's zone is how clocks end up an hour out twice a year. */
function parseTime(v) {
  if (v === undefined || v === true || v === 'now') {
    var d = new Date();
    return d.getUTCHours() * 3600 + d.getUTCMinutes() * 60 + d.getUTCSeconds();
  }
  var m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(String(v).trim());
  if (!m) U.die('mjsx clock: --time wants now or HH:MM[:SS] in UTC, not "' + v + '"');
  return parseInt(m[1], 10) * 3600 + parseInt(m[2], 10) * 60 + parseInt(m[3] || '0', 10);
}

async function findBoards(opts, waitMs) {
  if (opts.ips !== undefined) {
    if (opts.ips === true) U.die('mjsx clock: --ips wants a comma-separated list');
    var listed = String(opts.ips).split(',').map(function (s) { return s.trim(); })
      .filter(function (s) { return s; }).map(function (ip) { return { ip: ip, name: '' }; });
    if (!listed.length) U.die('mjsx clock: --ips is empty — name at least one address');
    return listed;
  }
  var boards = await mdns.discover(SERVICE, waitMs);
  boards.sort(function (x, y) { return x.ip < y.ip ? -1 : 1; });
  return boards;
}

/* One byte of the RTC. Returns -1 when the chip is not there. */
async function reg(l, addr, r, val) {
  var q = { c: 'reg', addr: addr, reg: r };
  if (val !== undefined) q.val = val;
  var res = await l.send(q);
  if (!res || !res.ok) return -1;
  return val === undefined ? res.val : 1;
}

/* configStorage lives in the JS engine, so this needs an app loaded. It is
   attempted and reported, never fatal: a board with no bundle running still
   gets its RTC set, which is the part that survives a reboot anyway. */
async function setStore(l, key, value) {
  try {
    await l.send({ c: 'eval', js: 'configStorage.set(' + JSON.stringify(key) + ',' +
                                   JSON.stringify(String(value)) + ')' });
    for (var i = 0; i < 12; i++) {
      await U.sleep(250);
      var res = await l.send({ c: 'jsresult' });
      if (res && res.ready) return !!res.success;
    }
  } catch (e) { /* reported by the caller as "store: no" */ }
  return false;
}

async function readStore(l, key) {
  try {
    await l.send({ c: 'eval', js: 'configStorage.get(' + JSON.stringify(key) + ',"")' });
    for (var i = 0; i < 12; i++) {
      await U.sleep(250);
      var res = await l.send({ c: 'jsresult' });
      if (res && res.ready) {
        if (!res.success) return null;
        var v = res.value;
        if (typeof v === 'string' && v.charAt(0) === '"') { try { v = JSON.parse(v); } catch (e) {} }
        return v;
      }
    }
  } catch (e) { /* same */ }
  return null;
}

async function readClock(l) {
  var s = await reg(l, RTC_ADDR, R_SEC);
  var out = { rtc: 'none', rtcSec: -1 };
  if (s >= 0) {
    out.rtc = (s & 0x80) ? 'stopped' : 'running';
    if (!(s & 0x80)) {
      var m = await reg(l, RTC_ADDR, R_MIN);
      var h = await reg(l, RTC_ADDR, R_HOUR);
      if (m >= 0 && h >= 0) out.rtcSec = bcd(h & 0x3f) * 3600 + bcd(m & 0x7f) * 60 + bcd(s & 0x7f);
    }
  }
  out.storedUtc = await readStore(l, 'clock_utc');
  out.tz = await readStore(l, 'clock_tz');
  return out;
}

async function writeClock(l, utcSec, tzMin) {
  var wrote = { rtc: false, store: false };
  /* seconds LAST would be wrong: writing it clears the oscillator-stop flag
     and starts the count, so hours and minutes go down first. */
  var h = (utcSec / 3600) | 0, m = ((utcSec % 3600) / 60) | 0, s = utcSec % 60;
  if (await reg(l, RTC_ADDR, R_SEC) >= 0) {
    await reg(l, RTC_ADDR, R_HOUR, unbcd(h));
    await reg(l, RTC_ADDR, R_MIN, unbcd(m));
    await reg(l, RTC_ADDR, R_SEC, unbcd(s) & 0x7f);
    wrote.rtc = true;
  }
  wrote.store = await setStore(l, 'clock_utc', Math.floor(utcSec));
  if (tzMin !== null) {
    var okTz = await setStore(l, 'clock_tz', tzMin);
    wrote.store = wrote.store && okTz;
  }
  return wrote;
}

function pad(s, n) { s = String(s); while (s.length < n) s += ' '; return s; }

async function main(argv) {
  if (argv.indexOf('--help') !== -1 || argv.indexOf('-h') !== -1) {
    console.log(HELP);
    return;
  }
  var sub = argv[0] === 'ls' || argv[0] === 'set' ? argv.shift() : 'ls';
  var opts = U.parseArgs(argv, ['ips', 'wait', 'tz', 'time'], 'clock').opts;
  var waitMs = U.parseDuration(opts.wait, 'clock --wait', 5000);
  var boards = await findBoards(opts, waitMs);
  if (!boards.length) U.die('mjsx clock: no boards found (try --ips 192.168.1.20,...)');

  var tzMin = opts.tz === undefined ? null : parseTz(opts.tz);
  var utcSec = sub === 'set' ? parseTime(opts.time) : 0;
  if (sub === 'set') {
    console.log('setting ' + hms(utcSec) + ' UTC' +
                (tzMin === null ? '' : ', offset ' + (tzMin < 0 ? '-' : '+') +
                  two(Math.abs((tzMin / 60) | 0)) + ':' + two(Math.abs(tzMin % 60))) +
                ' on ' + boards.length + ' board(s)');
  }

  var failed = 0;
  for (var i = 0; i < boards.length; i++) {
    var b = boards[i];
    var l = null;
    try {
      l = await link.openLink(b.ip, {});
      if (sub === 'ls') {
        var st = await readClock(l);
        var uses = st.rtc === 'running' ? 'RTC'
                 : (st.storedUtc ? 'stored (drifts)' : 'nothing set');
        console.log('  ' + pad(b.ip, 16) + pad('rtc:' + st.rtc, 14) +
          pad(st.rtcSec >= 0 ? hms(st.rtcSec) + ' UTC' : '-', 14) +
          pad('tz:' + (st.tz === null || st.tz === '' ? '0' : st.tz), 9) +
          'uses ' + uses);
      } else {
        var w = await writeClock(l, utcSec, tzMin);
        console.log('  ' + pad(b.ip, 16) +
          'rtc: ' + (w.rtc ? 'set' : 'none') + '   store: ' + (w.store ? 'set' : 'no app running'));
      }
    } catch (e) {
      failed++;
      console.log('  ' + pad(b.ip, 16) + 'failed: ' + (e && e.message ? e.message : e));
    } finally {
      if (l && l.close) l.close();
    }
  }
  if (failed) U.die(failed + ' board(s) failed');
}

module.exports = { main: main };
