/* mjsx device — talk to a board over USB serial. */
var U = require('./util.js');

var REPLY_MS = 10000;

var HELP = 'usage: mjsx device wifi <port|auto> --ssid NAME [--pass SECRET]\n' +
  '       mjsx device wifi <port|auto> --clone-from <port> [--timeout 10s]\n' +
  '\n' +
  'Provisions a board over the firmware\'s serial JSON line protocol\n' +
  '({"c":"wifi",...}, 115200 baud); the board saves the credentials and\n' +
  'reboots into them. --clone-from first reads another board\'s stored\n' +
  'credentials with {"c":"wifiget"} — the firmware answers that over\n' +
  'physical USB only, never the network, so one board can hand its\n' +
  'network to the next without a passphrase crossing a keyboard.\n' +
  '\n' +
  '"auto" uses the single USB serial device present; with several, they\n' +
  'are listed to pick from. --timeout (default 10s) bounds the wait for a\n' +
  'reply, so a port that is not a board fails instead of sitting open.\n' +
  '\n' +
  'Needs the serialport package: bun add serialport';

function loadSerialport() {
  try { return require('serialport').SerialPort; }
  catch (e) { U.die('mjsx device wifi: needs the serialport package — run `bun add serialport`'); }
}

async function pickPort(SerialPort, want) {
  if (want !== 'auto') return want;
  var all;
  try { all = await SerialPort.list(); }
  catch (e) { U.die('mjsx device wifi: could not list serial ports (' + U.message(e) + ')'); }
  var usb = all.filter(function (p) { return /usbmodem|usbserial|SLAB|wchusb|ttyUSB|ttyACM/i.test(p.path); });
  if (usb.length === 1) return usb[0].path;
  if (!usb.length) U.die('mjsx device wifi: no USB serial device found — plug the board in, or name its port');
  U.die('mjsx device wifi: several USB serial devices — name one of: ' +
        usb.map(function (p) { return p.path; }).join(', '));
}

/* One command, one reply: write a JSON line, resolve on the first line
   that parses as JSON with an "ok" field (the console logs other lines;
   they are skipped). Settles exactly once, and always closes the port —
   an open serial handle is a process that never exits. */
function request(SerialPort, portPath, cmd, timeoutMs) {
  return new Promise(function (resolve, reject) {
    var buf = '', done = false, port = null;
    var timer = setTimeout(function () {
      finish(new Error(portPath + ': no reply to "' + cmd.c + '" in ' + timeoutMs + 'ms — is this the board\'s USB port?'));
    }, timeoutMs || REPLY_MS);

    function finish(err, val) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try { if (port) port.close(function () {}); } catch (e2) {}
      if (err) reject(err); else resolve(val);
    }

    try {
      port = new SerialPort({ path: portPath, baudRate: 115200 }, function (e) {
        if (e) finish(new Error(portPath + ': ' + U.message(e)));
      });
    } catch (e) {
      return finish(new Error(portPath + ': ' + U.message(e)));
    }
    port.on('error', function (e) { finish(new Error(portPath + ': ' + U.message(e))); });
    port.on('close', function () { finish(new Error(portPath + ': the port closed before a reply')); });
    port.on('open', function () { port.write(JSON.stringify(Object.assign({ i: 1 }, cmd)) + '\n'); });
    port.on('data', function (d) {
      buf += d.toString('utf8');
      var nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        var line = buf.slice(0, nl); buf = buf.slice(nl + 1);
        var m; try { m = JSON.parse(line); } catch (e) { continue; }
        if (m && m.ok !== undefined) { finish(null, m); return; }
      }
    });
  });
}

async function wifi(args) {
  var a = U.parseArgs(args, ['ssid', 'pass', 'clone-from', 'timeout'], 'device wifi');
  if (a.opts.help) {
    console.log(HELP);
    return;
  }
  if (!a._[0]) U.usage('device wifi', 'missing <port|auto>');
  var replyMs = U.parseDuration(a.opts.timeout, 'device wifi --timeout', REPLY_MS);

  var SerialPort = loadSerialport();
  var target = await pickPort(SerialPort, a._[0]);

  var ssid, pass;
  if (a.opts['clone-from']) {
    if (a.opts['clone-from'] === true) U.usage('device wifi', '--clone-from needs the other board\'s port');
    var srcPort = await pickPort(SerialPort, String(a.opts['clone-from']));
    var src = await request(SerialPort, srcPort, { c: 'wifiget' }, replyMs);
    if (!src.ok) U.die('mjsx device wifi: ' + srcPort + ': wifiget failed: ' + src.err);
    if (!src.ssid) U.die('mjsx device wifi: ' + srcPort + ' has no stored credentials to clone');
    ssid = src.ssid; pass = src.pass || '';
    console.log('cloned "' + ssid + '" from ' + srcPort);
  } else if (typeof a.opts.ssid === 'string' && a.opts.ssid) {
    ssid = a.opts.ssid; pass = typeof a.opts.pass === 'string' ? a.opts.pass : '';
  } else {
    U.usage('device wifi', 'missing --ssid NAME (or --clone-from <port>)');
  }

  var r = await request(SerialPort, target, { c: 'wifi', ssid: ssid, pass: pass }, replyMs);
  if (!r.ok) U.die('mjsx device wifi: ' + target + ': wifi failed: ' + r.err);
  console.log(target + ': credentials saved, rebooting into "' + ssid + '"');
}

async function main(args) {
  var sub = args[0];
  if (sub === 'wifi') return wifi(args.slice(1));
  if (sub === '--help' || sub === '-h' || sub === 'help' || sub === undefined) {
    if (sub === undefined) U.usage('device', 'missing subcommand (wifi)');
    console.log(HELP);
    return;
  }
  U.die('mjsx device: unknown subcommand "' + sub + '" — the only one is wifi (mjsx device --help)');
}

module.exports = { main: main };
