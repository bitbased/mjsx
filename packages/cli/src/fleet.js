/* mjsx fleet — the single-device commands, across every board on the LAN. */
var fs = require('fs');
var net = require('net');
var path = require('path');
var U = require('./util.js');
var mdns = require('./mdns.js');

var SERVICE = '_filament-rfid._tcp.local';

var HELP = 'usage: mjsx fleet ls [--subnet 192.168.1] [--wait ms]\n' +
  '       mjsx fleet push <app.jsx|--examples [name ...]> [--ips a,b,c]\n' +
  '       mjsx fleet ota <firmware.bin> [--ips a,b,c]\n' +
  '\n' +
  'ls finds every bridge board on the LAN — an mDNS query for\n' +
  SERVICE.slice(0, -6) + ' (hand-rolled, no dependency), with a TCP probe\n' +
  'of --subnet port 8765 as the fallback when multicast is filtered —\n' +
  'and prints what each board\'s /info reports.\n' +
  '\n' +
  'push and ota run the single-device command against --ips, or against\n' +
  'whatever discovery finds, one board at a time with a result line per\n' +
  'board. push and ota also take --subnet and --wait.';

async function probeSubnet(subnet) {
  var prefix = String(subnet).replace(/\/24$/, '').replace(/\.0$/, '').replace(/\.$/, '') + '.';
  var ips = [];
  for (var i = 1; i < 255; i++) ips.push(prefix + i);
  var found = [];
  var BATCH = 64;
  for (var b = 0; b < ips.length; b += BATCH) {
    await Promise.all(ips.slice(b, b + BATCH).map(function (ip) {
      return new Promise(function (res) {
        var s = net.connect({ host: ip, port: 8765 });
        function done(hit) { s.destroy(); if (hit) found.push({ ip: ip, name: '' }); res(); }
        s.setTimeout(400, function () { done(false); });
        s.on('connect', function () { done(true); });
        s.on('error', function () { done(false); });
      });
    }));
  }
  return found;
}

async function findBoards(opts) {
  if (opts.ips) {
    return String(opts.ips).split(',').map(function (s) { return { ip: s.trim(), name: '' }; })
      .filter(function (b) { return b.ip; });
  }
  var boards = await mdns.discover(SERVICE, opts.wait ? parseInt(opts.wait, 10) : 2500);
  if (!boards.length && opts.subnet) boards = await probeSubnet(opts.subnet);
  if (!boards.length) {
    U.die('no boards found' + (opts.subnet ? '' : ' (multicast filtered? try --subnet 192.168.1)'));
  }
  boards.sort(function (x, y) { return x.ip < y.ip ? -1 : 1; });
  return boards;
}

function pad(s, n) { s = String(s); while (s.length < n) s += ' '; return s; }

async function ls(opts) {
  var boards = await findBoards(opts);
  for (var i = 0; i < boards.length; i++) {
    var b = boards[i];
    try {
      var info = await U.fetchJson('http://' + b.ip + '/info', 3000);
      var screen = info.w ? info.w + 'x' + info.h : 'headless';
      console.log(pad(b.name || '-', 14) + pad(b.ip, 16) + pad('fw ' + info.fw, 12) +
                  pad(screen, 10) + 'readers ' + info.readers + (info.sim ? ' (sim)' : ''));
    } catch (e) {
      console.log(pad(b.name || '-', 14) + pad(b.ip, 16) + 'no /info: ' + e.message);
    }
  }
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
      console.error(boards[i].ip + ': FAILED — ' + (e && e.message ? e.message : e));
    }
  }
  if (failed) U.die(failed + ' of ' + boards.length + ' board(s) failed');
  console.log(boards.length + ' board(s) done');
}

async function main(args) {
  var sub = args.shift();
  var a = U.parseArgs(args, ['ips', 'subnet', 'wait']);
  if (!sub || sub === '--help' || sub === '-h' || a.opts.help) {
    console.log(HELP);
    process.exit(sub ? 0 : 1);
  }
  if (sub === 'ls') return ls(a.opts);

  if (sub === 'push') {
    var pushCmd = require('./push.js');
    var bundleMod = require('./bundle.js');
    var link = require('./bridge-link.js');
    if (!a.opts.examples && !a._[0]) U.die(HELP);
    var b = pushCmd.build(a.opts, a._);
    bundleMod.validate(b);
    var boards = await findBoards(a.opts);
    return each(boards, function (ip) { return link.pushBundle(ip, b); });
  }

  if (sub === 'ota') {
    var otaCmd = require('./ota.js');
    if (!a._[0]) U.die(HELP);
    var file = path.resolve(a._[0]);
    if (!fs.existsSync(file)) U.die('no such file: ' + file);
    var boards2 = await findBoards(a.opts);
    return each(boards2, function (ip) { return otaCmd.otaOne(ip, file); });
  }

  U.die('unknown fleet subcommand: ' + sub + '\n\n' + HELP);
}

module.exports = { main: main };
