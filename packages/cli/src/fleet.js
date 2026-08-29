/* mjsx fleet — the single-device commands, across every board on the LAN. */
var fs = require('fs');
var path = require('path');
var U = require('./util.js');
var mdns = require('./mdns.js');

var SERVICE = '_filament-rfid._tcp.local';
var PORT = 8765;
var DEFAULT_WAIT_MS = 5000;

var HELP = 'usage: mjsx fleet ls [--subnet 192.168.1] [--wait 5s] [--ips a,b,c]\n' +
  '       mjsx fleet push <app.jsx|--examples [name ...]> [--ips a,b,c]\n' +
  '       mjsx fleet ota <firmware.bin> [--ips a,b,c]\n' +
  '\n' +
  'ls finds every bridge board on the LAN — an mDNS query for\n' +
  SERVICE.slice(0, -6) + ' (hand-rolled, no dependency), with a TCP probe\n' +
  'of --subnet port ' + PORT + ' as the fallback when multicast is filtered —\n' +
  'and prints what each board\'s /info reports.\n' +
  '\n' +
  'Discovery is a fixed window, not a wait for quiet: --wait (default 5s,\n' +
  'or 5000ms) bounds it, and it also bounds each board\'s /info probe, so\n' +
  '`fleet ls --wait 1` is done inside a couple of seconds however many\n' +
  'boards answer. ls reports; it exits 0 once the window closes, marking\n' +
  'boards that did not answer rather than failing on them.\n' +
  '\n' +
  'push and ota run the single-device command against --ips, or against\n' +
  'whatever discovery finds, one board at a time with a result line per\n' +
  'board, and exit non-zero if any board failed. Both also take --subnet\n' +
  'and --wait.';

/* The /info probe rides the same budget as discovery: a short --wait is a
   request for a quick answer from the whole command, not just its first
   half. */
function infoBudget(waitMs) {
  return Math.max(500, Math.min(2000, waitMs));
}

/* The first three octets, however the user wrote them. Checked before
   discovery starts, so a typo fails now instead of after the window. */
function subnetPrefix(subnet) {
  if (subnet === undefined) return null;
  if (subnet === true) U.die('mjsx fleet: --subnet wants the first three octets, like --subnet 192.168.1');
  var prefix = String(subnet).replace(/\/24$/, '').replace(/\.0$/, '').replace(/\.$/, '') + '.';
  if (!/^(\d{1,3}\.){3}$/.test(prefix)) {
    U.die('mjsx fleet: --subnet wants the first three octets, like --subnet 192.168.1 (got "' + subnet + '")');
  }
  return prefix;
}

async function probeSubnet(prefix, waitMs) {
  var ips = [];
  for (var i = 1; i < 255; i++) ips.push(prefix + i);
  var per = Math.max(200, Math.min(800, waitMs));
  var hits = await U.mapLimit(ips, 64, async function (ip) {
    try { await U.tcpProbe(ip, PORT, per); return ip; }
    catch (e) { return null; }
  });
  return hits.filter(Boolean).map(function (ip) { return { ip: ip, name: '' }; });
}

function explicitIps(value) {
  return String(value).split(',').map(function (s) { return s.trim(); })
    .filter(function (s) { return s; })
    .map(function (ip) { return { ip: ip, name: '' }; });
}

/* Every path here is bounded: an explicit list costs nothing, mDNS costs
   exactly --wait, and the subnet sweep costs one bounded connect per host
   with 64 in flight. */
async function findBoards(opts, waitMs) {
  if (opts.ips !== undefined) {
    if (opts.ips === true) U.die('mjsx fleet: --ips wants a comma-separated list, like --ips 192.168.1.20,192.168.1.21');
    var listed = explicitIps(opts.ips);
    if (!listed.length) U.die('mjsx fleet: --ips is empty — name at least one address');
    return listed;
  }
  var prefix = subnetPrefix(opts.subnet);
  var boards = await mdns.discover(SERVICE, waitMs);
  if (!boards.length && prefix) boards = await probeSubnet(prefix, waitMs);
  boards.sort(function (x, y) { return x.ip < y.ip ? -1 : 1; });
  return boards;
}

function noBoardsNote(opts) {
  return 'no boards found' + (opts.subnet ? ' on ' + opts.subnet + '.0/24' :
    ' (multicast filtered? try --subnet 192.168.1, or name them with --ips)');
}

function pad(s, n) { s = String(s); while (s.length < n) s += ' '; return s; }

/* ls is a report. It prints what the window turned up, notes the boards
   that did not answer, and exits 0 — a quiet LAN is an answer, not an
   error. */
async function ls(opts, waitMs) {
  var boards = await findBoards(opts, waitMs);
  if (!boards.length) {
    console.error(noBoardsNote(opts));
    return;
  }
  var ms = infoBudget(waitMs);
  var lines = await U.mapLimit(boards, 16, async function (b) {
    try {
      var info = await U.fetchJson('http://' + b.ip + '/info', ms);
      var screen = info.w ? info.w + 'x' + info.h : 'headless';
      return pad(b.name || '-', 14) + pad(b.ip, 16) + pad('fw ' + info.fw, 12) +
             pad(screen, 10) + 'readers ' + info.readers + (info.sim ? ' (sim)' : '');
    } catch (e) {
      return pad(b.name || '-', 14) + pad(b.ip, 16) + 'no /info: ' + U.firstLine(U.message(e));
    }
  });
  for (var i = 0; i < lines.length; i++) console.log(lines[i]);
  console.log(boards.length + ' board(s)');
}

/* Fan a per-board task out sequentially; a line per board, exit 1 if any failed. */
async function each(boards, fn) {
  var failed = 0;
  for (var i = 0; i < boards.length; i++) {
    try {
      await fn(boards[i].ip);
      console.log(boards[i].ip + ': ok');
    } catch (e) {
      failed++;
      console.error(boards[i].ip + ': FAILED — ' + U.firstLine(U.message(e)));
    }
  }
  if (failed) U.die('mjsx fleet: ' + failed + ' of ' + boards.length + ' board(s) failed');
  console.log(boards.length + ' board(s) done');
}

/* push/ota act, so an empty fleet is a failure: there is nothing to act on. */
async function targets(opts, waitMs) {
  var boards = await findBoards(opts, waitMs);
  if (!boards.length) U.die('mjsx fleet: ' + noBoardsNote(opts));
  return boards;
}

async function main(args) {
  var sub = args.shift();
  if (sub === '--help' || sub === '-h' || sub === 'help') {
    console.log(HELP);
    return;
  }
  if (!sub) U.usage('fleet', 'missing subcommand (ls, push, ota)');

  var a = U.parseArgs(args, ['ips', 'subnet', 'wait', 'timeout'], 'fleet');
  if (a.opts.help) {
    console.log(HELP);
    return;
  }
  var waitMs = U.parseDuration(a.opts.wait, 'fleet --wait', DEFAULT_WAIT_MS);
  subnetPrefix(a.opts.subnet); /* a --subnet typo fails now, not after the window */

  if (sub === 'ls') return ls(a.opts, waitMs);

  if (sub === 'push') {
    var pushCmd = require('./push.js');
    var bundleMod = require('./bundle.js');
    var link = require('./bridge-link.js');
    if (!a.opts.examples && !a._[0]) U.usage('fleet', 'missing <app.jsx> (or --examples)');
    var pushMs = U.parseDuration(a.opts.timeout, 'fleet --timeout', link.CONNECT_MS);
    var boards = await targets(a.opts, waitMs);
    var b = pushCmd.build(a.opts, a._);
    bundleMod.validate(b);
    return each(boards, function (ip) { return link.pushBundle(ip, b, null, { connectMs: pushMs }); });
  }

  if (sub === 'ota') {
    var otaCmd = require('./ota.js');
    if (!a._[0]) U.usage('fleet', 'missing <firmware.bin>');
    var otaMs = U.parseDuration(a.opts.timeout, 'fleet --timeout', otaCmd.CONNECT_MS);
    var file = path.resolve(a._[0]);
    if (!fs.existsSync(file)) U.die('mjsx fleet ota: no such file: ' + file);
    if (!fs.statSync(file).size) U.die('mjsx fleet ota: firmware image is empty: ' + file);
    var boards2 = await targets(a.opts, waitMs);
    return each(boards2, function (ip) { return otaCmd.otaOne(ip, file, { connectMs: otaMs }); });
  }

  U.die('mjsx fleet: unknown subcommand "' + sub + '" — try ls, push or ota (mjsx fleet --help)');
}

module.exports = { main: main };
