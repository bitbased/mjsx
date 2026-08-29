/*
 * Shared bits for the mjsx CLI.
 *
 * Two rules everything here exists to serve:
 *   - a command finishes. Every socket, timer and probe carries a bound,
 *     and bin/mjsx.js exits the process explicitly once main() resolves,
 *     so a lingering handle can never turn "done" into "hung".
 *   - a failure is one actionable line on stderr. Stack traces are for
 *     --debug; users get a sentence that says what to do next.
 */
var net = require('net');
var path = require('path');
var { spawnSync } = require('child_process');

var REPO = path.resolve(__dirname, '../../..');
/* The filament-rfid kit repo, when checked out as a sibling of this one.
   It is where the ESP32 push path's tsc build and MicroQuickJS harness
   live; both are optional conveniences, checked before use. */
var KIT = path.resolve(REPO, '../kit/projects/filament-rfid');

/* --debug, set once by bin/mjsx.js and read from every module (one
   require cache, one flag). */
var DEBUG = { on: false };
function setDebug(v) { DEBUG.on = !!v; }

/* The first line only: a user-facing error is a sentence, not a dump. */
function firstLine(msg) {
  var s = String(msg == null ? 'failed' : msg);
  var nl = s.indexOf('\n');
  return nl === -1 ? s : s.slice(0, nl);
}

function message(e) {
  if (e && e.message) return String(e.message);
  return String(e);
}

/* Print one actionable line and stop. Under --debug the raise site
   follows it, so `die` is as traceable as a thrown error. */
function die(msg) {
  console.error(firstLine(msg));
  if (DEBUG.on) console.error(new Error('--debug: raised at').stack);
  process.exit(1);
}

/* Missing or wrong arguments: say what is missing and where the full
   usage lives, on one line. */
function usage(cmd, msg) {
  die('mjsx ' + cmd + ': ' + msg + ' — see `mjsx ' + cmd + ' --help`');
}

/* The top-level handler for anything thrown out of a command: one line,
   plus any diagnostic the thrower deliberately attached (e.detail — a
   tool's own verdict, never a stack). --debug adds the stack. */
function report(e, cmd) {
  console.error('mjsx' + (cmd ? ' ' + cmd : '') + ': ' + firstLine(message(e)));
  if (e && e.detail) console.error(String(e.detail));
  if (DEBUG.on && e && e.stack) console.error(e.stack);
}

/* bun runs the .jsx-requiring runners; node cannot (no JSX transform). */
function bunBin() {
  if (path.basename(process.execPath).indexOf('bun') === 0) return process.execPath;
  var r = spawnSync('bun', ['--version'], { encoding: 'utf8' });
  if (!r.error) return 'bun';
  die('mjsx: this command needs bun (the runners rely on its JSX transform) — install it from https://bun.sh');
}

/* --k, --k=v, and --k v (for keys listed in `valued`); the rest
   positional. A valued flag left dangling — last on the line, or followed
   by the next flag — is an error here rather than a flag silently eaten
   as a value further down. */
function parseArgs(args, valued, cmd) {
  valued = valued || [];
  var out = { _: [], opts: {} };
  for (var i = 0; i < args.length; i++) {
    var a = args[i];
    if (a.slice(0, 2) === '--') {
      var eq = a.indexOf('=');
      if (eq !== -1) out.opts[a.slice(2, eq)] = a.slice(eq + 1);
      else if (valued.indexOf(a.slice(2)) !== -1) {
        var v = args[i + 1];
        if (v === undefined || v.slice(0, 2) === '--') {
          die('mjsx' + (cmd ? ' ' + cmd : '') + ': ' + a + ' needs a value');
        }
        out.opts[a.slice(2)] = v;
        i++;
      } else out.opts[a.slice(2)] = true;
    } else if (a === '-h') {
      out.opts.help = true;
    } else {
      out._.push(a);
    }
  }
  return out;
}

/* Durations are seconds by default — `--wait 5`, `--wait 5s`, `--wait
   500ms`. A bare number large enough to be a stray millisecond value is
   rejected rather than silently waited out, which is how an unbounded
   command feels like a hang. */
var MAX_WAIT_MS = 600000;
function parseDuration(v, name, dflt) {
  if (v === undefined || v === true || v === '') return dflt;
  var s = String(v).trim().toLowerCase();
  var m = /^(\d+(?:\.\d+)?)(ms|s)?$/.exec(s);
  if (!m) die('mjsx: ' + name + ' wants a duration like 5, 5s or 500ms (got "' + v + '")');
  var n = parseFloat(m[1]);
  var ms = m[2] === 'ms' ? n : n * 1000;
  if (!(ms > 0)) die('mjsx: ' + name + ' must be greater than zero (got "' + v + '")');
  if (ms > MAX_WAIT_MS) {
    die('mjsx: ' + name + ' ' + v + ' is ' + Math.round(ms / 1000) + 's, over the ' +
        (MAX_WAIT_MS / 1000) + 's cap — write it as ' + m[1] + 'ms if you meant milliseconds');
  }
  return Math.round(ms);
}

/* A host, not a path: catches `mjsx push app.jsx` (argument order) before
   it becomes a DNS lookup that stalls. */
function checkHost(v, cmd) {
  var s = String(v || '');
  if (!s) usage(cmd, 'missing <ip>');
  if (s.indexOf('/') !== -1 || /\.(jsx|js|bin|ppm)$/i.test(s)) {
    usage(cmd, '"' + s + '" is a file, not a board address; the address comes first');
  }
  return s;
}

/* Why a network attempt ended, in words a user can act on. */
function reason(e, ms) {
  var m = message(e);
  if (e && (e.name === 'TimeoutError' || e.name === 'AbortError')) return 'timed out after ' + ms + 'ms';
  if (/timed out|ETIMEDOUT/i.test(m)) return 'timed out after ' + ms + 'ms';
  if (/ECONNREFUSED/.test(m)) return 'connection refused';
  if (/EHOSTUNREACH|ENETUNREACH/.test(m)) return 'no route to that address';
  if (/ENOTFOUND|EAI_AGAIN|getaddrinfo/i.test(m)) return 'name does not resolve';
  return firstLine(m);
}

/* A bounded TCP connect. Node's own connect timeout is the OS's (over a
   minute against a black hole), so the deadline is ours. */
function tcpProbe(host, port, ms) {
  return new Promise(function (resolve, reject) {
    var done = false, s;
    var timer = setTimeout(function () { settle(new Error('timed out after ' + ms + 'ms')); }, ms);
    function settle(err) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try { if (s) s.destroy(); } catch (e) {}
      if (err) reject(err); else resolve(true);
    }
    try { s = net.connect({ host: host, port: port }); }
    catch (e) { return settle(e); }
    s.on('connect', function () { settle(null); });
    s.on('error', function (e) { settle(e); });
  });
}

/* Fail fast and legibly when the board is not there, before a command
   spends a minute transpiling or streaming a firmware image at it. Throws
   so the caller's name lands on the front of the line. */
async function requireReachable(host, port, ms, what) {
  try {
    await tcpProbe(host, port, ms);
  } catch (e) {
    throw new Error(host + ':' + port + ' is not answering (' + reason(e, ms) + ') — ' +
      (what || 'check the address and that the board is on this network'));
  }
}

async function fetchJson(url, ms) {
  ms = ms || 3000;
  var res;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(ms) });
  } catch (e) {
    throw new Error('no answer from ' + url + ' (' + reason(e, ms) + ')');
  }
  if (!res.ok) throw new Error(url + ' answered HTTP ' + res.status);
  try { return await res.json(); }
  catch (e) { throw new Error(url + ' did not answer JSON'); }
}

/* Run tasks with a cap on how many are in flight; results keep input
   order. Used so a fleet-wide probe is one wait, not N in a row. */
async function mapLimit(items, limit, fn) {
  var out = new Array(items.length), next = 0;
  async function worker() {
    while (next < items.length) {
      var i = next++;
      out[i] = await fn(items[i], i);
    }
  }
  var pool = [];
  for (var w = 0; w < Math.min(limit, items.length); w++) pool.push(worker());
  await Promise.all(pool);
  return out;
}

function sleep(ms) {
  return new Promise(function (res) { setTimeout(res, ms); });
}

module.exports = {
  REPO: REPO,
  KIT: KIT,
  die: die,
  usage: usage,
  report: report,
  message: message,
  firstLine: firstLine,
  reason: reason,
  setDebug: setDebug,
  bunBin: bunBin,
  parseArgs: parseArgs,
  parseDuration: parseDuration,
  checkHost: checkHost,
  tcpProbe: tcpProbe,
  requireReachable: requireReachable,
  fetchJson: fetchJson,
  mapLimit: mapLimit,
  sleep: sleep
};
