/* Shared bits for the mjsx CLI. */
var path = require('path');
var { spawnSync } = require('child_process');

var REPO = path.resolve(__dirname, '../../..');
/* The filament-rfid kit repo, when checked out as a sibling of this one.
   It is where the ESP32 push path's tsc build and MicroQuickJS harness
   live; both are optional conveniences, checked before use. */
var KIT = path.resolve(REPO, '../kit/projects/filament-rfid');

function die(msg) {
  console.error(msg);
  process.exit(1);
}

/* bun runs the .jsx-requiring runners; node cannot (no JSX transform). */
function bunBin() {
  if (path.basename(process.execPath).indexOf('bun') === 0) return process.execPath;
  var r = spawnSync('bun', ['--version'], { encoding: 'utf8' });
  if (!r.error) return 'bun';
  die('this command needs bun (the runners rely on its JSX transform): https://bun.sh');
}

/* --k, --k=v, and --k v (for keys listed in `valued`); the rest positional. */
function parseArgs(args, valued) {
  valued = valued || [];
  var out = { _: [], opts: {} };
  for (var i = 0; i < args.length; i++) {
    var a = args[i];
    if (a.slice(0, 2) === '--') {
      var eq = a.indexOf('=');
      if (eq !== -1) out.opts[a.slice(2, eq)] = a.slice(eq + 1);
      else if (valued.indexOf(a.slice(2)) !== -1) out.opts[a.slice(2)] = args[++i];
      else out.opts[a.slice(2)] = true;
    } else if (a === '-h') {
      out.opts.help = true;
    } else {
      out._.push(a);
    }
  }
  return out;
}

async function fetchJson(url, ms) {
  var res = await fetch(url, { signal: AbortSignal.timeout(ms || 3000) });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res.json();
}

function sleep(ms) {
  return new Promise(function (res) { setTimeout(res, ms); });
}

module.exports = { REPO: REPO, KIT: KIT, die: die, bunBin: bunBin, parseArgs: parseArgs, fetchJson: fetchJson, sleep: sleep };
