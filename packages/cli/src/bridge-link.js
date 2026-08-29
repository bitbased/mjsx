/*
 * The bridge board's TCP line protocol on :8765 — JSON lines, one command
 * in flight, replies matched by the presence of the echoed `i` field.
 *
 * Extracted from backends/esp32/tools/push-examples.mjs so `mjsx push`
 * and `mjsx fleet push` speak it through one implementation instead of
 * each carrying a copy.
 */
var net = require('net');
var U = require('./util.js');

function openLink(ip, opts) {
  opts = opts || {};
  return new Promise(function (resolve, reject) {
    var s = net.connect(opts.port || 8765, ip);
    var buf = '', queue = [], inFlight = null, up = false;
    var timer = setTimeout(function () { fail(new Error(ip + ': link timed out')); }, opts.timeoutMs || 180000);

    function fail(e) {
      clearTimeout(timer);
      if (inFlight) { inFlight.rej(e); inFlight = null; }
      while (queue.length) queue.shift().rej(e);
      s.destroy();
      if (!up) reject(e);
    }
    function pump() {
      if (inFlight || !queue.length) return;
      inFlight = queue.shift();
      s.write(JSON.stringify(Object.assign({ i: 1 }, inFlight.obj)) + '\n');
    }
    function send(obj) {
      return new Promise(function (res, rej) { queue.push({ obj: obj, res: res, rej: rej }); pump(); });
    }

    s.on('data', function (d) {
      buf += d.toString('utf8');
      var nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        var line = buf.slice(0, nl); buf = buf.slice(nl + 1);
        var m; try { m = JSON.parse(line); } catch (e) { continue; }
        if (m && m.i !== undefined && inFlight) { var f = inFlight; inFlight = null; f.res(m); pump(); }
      }
    });
    s.on('error', function (e) { fail(new Error(ip + ': ' + e.message)); });
    s.on('connect', function () {
      up = true;
      resolve({ send: send, close: function () { clearTimeout(timer); s.destroy(); } });
    });
  });
}

/* fput the bundle to /app.js in chunks, then reboot and wait for the
 * board to answer /state again. Reboot rather than frun: the firmware's
 * run marker evals into the existing context, so a re-push loads the new
 * bundle on top of the old app — enough, with a ~115KB bundle, to
 * exhaust the heap. A boot runs /app.js in a fresh arena. */
async function pushBundle(ip, bundle, log) {
  log = log || function (s) { process.stdout.write(s); };
  var link = await openLink(ip);
  var bytes = Buffer.from(bundle, 'utf8');
  log('pushing ' + bytes.length + ' bytes to ' + ip + ' ...\n');
  var CHUNK = 3072;
  for (var off = 0, first = true; off < bytes.length; off += CHUNK, first = false) {
    var r = await link.send({ c: 'fput', name: '/app.js', first: first, b64: bytes.subarray(off, off + CHUNK).toString('base64') });
    if (!r.ok) { link.close(); throw new Error(ip + ': fput failed: ' + r.err); }
    log('.');
  }
  log('\nrebooting into the new bundle ...\n');
  link.send({ c: 'reboot' }).catch(function () {});
  link.close();
  await U.sleep(15000);
  for (var i = 0; i < 20; i++) {
    try {
      var t = await fetch('http://' + ip + '/state', { signal: AbortSignal.timeout(3000) });
      if (t.ok) { log('OK: rebooted, bundle running\n'); return; }
    } catch (e) {}
    await U.sleep(1500);
  }
  throw new Error(ip + ': board did not come back after reboot');
}

module.exports = { openLink: openLink, pushBundle: pushBundle };
