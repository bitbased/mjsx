/*
 * mjsx logs — read a board's console over the network.
 *
 * The console on a device has three sinks (docs/logging.md); this reads the
 * one that costs nothing when nobody is watching: a bounded ring inside the
 * running bundle, drained through the firmware's eval path.
 *
 * --follow polls by SEQUENCE NUMBER, not by count, so a line logged between
 * two polls is delivered exactly once and a burst that overflows the ring is
 * reported as a gap rather than silently losing the middle.
 */
var U = require('./util.js');
var link = require('./bridge-link.js');

var HELP = 'usage: mjsx logs <ip> [--follow] [--clear] [--sinks buffer,serial,ops]\n' +
  '\n' +
  'Reads the console ring out of the app running on the board.\n' +
  '\n' +
  '  --follow            keep polling and print new lines as they arrive\n' +
  '  --clear             empty the ring first\n' +
  '  --sinks <set>       set where console output goes, and remember it:\n' +
  '                        buffer  the ring this command reads (default)\n' +
  '                        serial  the USB console\n' +
  '                        ops     the frame stream, so a mirror shows it\n' +
  '                      combine with commas, or "none" / "all"\n' +
  '  --timeout <dur>     per-request budget (default 8s)\n';

/* One expression, evaluated on the board. The firmware starts an eval and
   reports it later, so every call is a start-then-poll pair. */
async function evalOn(l, js, budgetMs) {
  await l.send({ c: 'eval', js: js });
  var waited = 0;
  while (waited < budgetMs) {
    await U.sleep(200);
    waited += 200;
    var r = await l.send({ c: 'jsresult' });
    if (r && r.ready) {
      if (!r.success) throw new Error(String(r.value || 'eval failed').split('\n')[0]);
      var v = r.value;
      /* the firmware hands back a JS literal; strings arrive quoted */
      if (typeof v === 'string' && v.charAt(0) === '"') {
        try { v = JSON.parse(v); } catch (e) { /* leave it as-is */ }
      }
      return v;
    }
  }
  throw new Error('the board did not finish the request in ' + budgetMs + 'ms');
}

function paint(line) {
  var lv = line.level;
  var tag = lv === 'log' ? '' : lv + ': ';
  return tag + line.text;
}

async function main(argv) {
  if (!argv.length || argv.indexOf('--help') !== -1 || argv.indexOf('-h') !== -1) {
    console.log(HELP);
    if (!argv.length) process.exitCode = 1;
    return;
  }
  var a = U.parseArgs(argv, ['timeout', 'sinks'], 'logs');
  var ip = a._[0];
  if (!ip) U.die('mjsx logs: which board? give an address, like mjsx logs 192.168.1.144');
  var budget = U.parseDuration(a.opts.timeout, 'logs --timeout', 8000);

  var l = await link.openLink(ip, {});
  try {
    var have = await evalOn(l, 'typeof mjsxLog', budget);
    if (have !== 'function' && have !== 'object') {
      U.die('mjsx logs: no console on ' + ip + ' — the running bundle predates it, ' +
            'so push again with `mjsx push ' + ip + ' --examples`');
    }

    if (a.opts.sinks !== undefined) {
      var set = await evalOn(l,
        'configStorage.set("log",' + JSON.stringify(String(a.opts.sinks)) + '),' +
        'mjsxLog.setSinks(' + JSON.stringify(String(a.opts.sinks)) + ')', budget);
      console.log('sinks: ' + (set || 'none') + '  (kept across restarts)');
    }
    if (a.opts.clear !== undefined) {
      await evalOn(l, 'mjsxLog.clear(), "cleared"', budget);
      console.log('ring cleared');
    }

    var seen = 0;
    async function drain() {
      var raw = await evalOn(l, 'JSON.stringify(mjsxLog.since(' + seen + '))', budget);
      var lines = [];
      try { lines = JSON.parse(raw || '[]'); } catch (e) { lines = []; }
      for (var i = 0; i < lines.length; i++) {
        /* a jump in the sequence means the ring wrapped between polls: say
           so rather than pretending the output was continuous */
        if (seen && lines[i].n > seen + 1) {
          console.log('... ' + (lines[i].n - seen - 1) + ' line(s) dropped (ring wrapped)');
        }
        console.log(paint(lines[i]));
        seen = lines[i].n;
      }
      return lines.length;
    }

    var n = await drain();
    if (a.opts.follow === undefined) {
      if (!n) console.log('(nothing logged — the app has not called console.log)');
      return;
    }
    console.log('following ' + ip + ' — ctrl-c to stop');
    for (;;) {
      await U.sleep(700);
      await drain();
    }
  } finally {
    if (l && l.close) l.close();
  }
}

module.exports = { main: main };
