/*
 * The bridge board's TCP line protocol on :8765 — JSON lines, one command
 * in flight, replies matched by the presence of the echoed `i` field.
 *
 * Extracted from backends/esp32/tools/push-examples.mjs so `mjsx push`
 * and `mjsx fleet push` speak it through one implementation instead of
 * each carrying a copy.
 *
 * Two clocks, because they measure different things: connectMs bounds
 * getting a socket at all (the OS would spend over a minute on an address
 * that black-holes), and timeoutMs bounds the transfer once the board is
 * talking.
 */
var net = require('net');
var U = require('./util.js');

var CONNECT_MS = 5000;
var TRANSFER_MS = 180000;

function openLink(ip, opts) {
  opts = opts || {};
  var connectMs = opts.connectMs || CONNECT_MS;
  return new Promise(function (resolve, reject) {
    var port = opts.port || 8765;
    var s;
    try { s = net.connect(port, ip); }
    catch (e) { return reject(new Error(ip + ': ' + U.reason(e, connectMs))); }
    var buf = '', queue = [], inFlight = null, up = false, dead = false;
    var connectTimer = setTimeout(function () {
      fail(new Error(ip + ':' + port + ' is not answering (timed out after ' + connectMs +
                     'ms) — check the address and that the board is on this network'));
    }, connectMs);
    var timer = null;

    function fail(e) {
      if (dead) return;
      dead = true;
      clearTimeout(connectTimer);
      if (timer) clearTimeout(timer);
      if (inFlight) { inFlight.rej(e); inFlight = null; }
      while (queue.length) queue.shift().rej(e);
      try { s.destroy(); } catch (e2) {}
      if (!up) reject(e);
    }
    function pump() {
      if (inFlight || !queue.length) return;
      inFlight = queue.shift();
      s.write(JSON.stringify(Object.assign({ i: 1 }, inFlight.obj)) + '\n');
    }
    function send(obj) {
      if (dead) return Promise.reject(new Error(ip + ': link is closed'));
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
    s.on('error', function (e) {
      fail(new Error(ip + ':' + port + ': ' + U.reason(e, connectMs)));
    });
    s.on('close', function () {
      if (up) fail(new Error(ip + ': the board closed the link'));
    });
    s.on('connect', function () {
      up = true;
      clearTimeout(connectTimer);
      timer = setTimeout(function () { fail(new Error(ip + ': link timed out')); }, opts.timeoutMs || TRANSFER_MS);
      resolve({
        send: send,
        close: function () {
          dead = true;
          clearTimeout(connectTimer);
          if (timer) clearTimeout(timer);
          try { s.destroy(); } catch (e) {}
        }
      });
    });
  });
}

/* fput the bundle to /app.js in chunks, then reboot and wait for the
 * board to answer /state again. Reboot rather than frun: the firmware's
 * run marker evals into the existing context, so a re-push loads the new
 * bundle on top of the old app — enough, with a ~115KB bundle, to
 * exhaust the heap. A boot runs /app.js in a fresh arena.
 *
 * The wait for the board to come back is a fixed 20 tries, so a board
 * that never returns costs about 45s and then says so. */
async function pushBundle(ip, bundle, log, opts) {
  opts = opts || {};
  log = log || function (s) { process.stdout.write(s); };
  var link = await openLink(ip, opts);
  var bytes = Buffer.from(bundle, 'utf8');
  log('pushing ' + bytes.length + ' bytes to ' + ip + ' ...\n');
  var CHUNK = 3072;
  try {
    for (var off = 0, first = true; off < bytes.length; off += CHUNK, first = false) {
      var r = await link.send({ c: 'fput', name: '/app.js', first: first, b64: bytes.subarray(off, off + CHUNK).toString('base64') });
      if (!r.ok) throw new Error(ip + ': fput failed: ' + r.err);
      log('.');
    }
    log('\nrebooting into the new bundle ...\n');
    link.send({ c: 'reboot' }).catch(function () {});
  } finally {
    link.close();
  }
  await U.sleep(15000);
  for (var i = 0; i < 20; i++) {
    try {
      var t = await fetch('http://' + ip + '/state', { signal: AbortSignal.timeout(3000) });
      if (t.ok) { log('OK: rebooted, bundle running\n'); return; }
    } catch (e) {}
    await U.sleep(1500);
  }
  throw new Error(ip + ': board did not come back after reboot (waited 45s)');
}

module.exports = { openLink: openLink, pushBundle: pushBundle, CONNECT_MS: CONNECT_MS };
