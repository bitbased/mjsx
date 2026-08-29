/* mjsx device — talk to a board over USB serial. */
var U = require('./util.js');

var HELP = 'usage: mjsx device wifi <port|auto> --ssid NAME [--pass SECRET]\n' +
  '       mjsx device wifi <port|auto> --clone-from <port>\n' +
  '\n' +
  'Provisions a board over the firmware\'s serial JSON line protocol\n' +
  '({"c":"wifi",...}, 115200 baud); the board saves the credentials and\n' +
  'reboots into them. --clone-from first reads another board\'s stored\n' +
  'credentials with {"c":"wifiget"} — the firmware answers that over\n' +
  'physical USB only, never the network, so one board can hand its\n' +
  'network to the next without a passphrase crossing a keyboard.\n' +
  '\n' +
  '"auto" uses the single USB serial device present; with several, they\n' +
  'are listed to pick from.\n' +
  '\n' +
  'Needs the serialport package: bun add serialport';

function loadSerialport() {
  try { return require('serialport').SerialPort; }
  catch (e) { U.die('mjsx device wifi needs the serialport package: bun add serialport'); }
}

async function pickPort(SerialPort, want) {
  if (want !== 'auto') return want;
  var all = await SerialPort.list();
  var usb = all.filter(function (p) { return /usbmodem|usbserial|SLAB|wchusb|ttyUSB|ttyACM/i.test(p.path); });
  if (usb.length === 1) return usb[0].path;
  if (!usb.length) U.die('no USB serial device found');
  U.die('several USB serial devices — pick one:\n' + usb.map(function (p) { return '  ' + p.path; }).join('\n'));
}

/* One command, one reply: write a JSON line, resolve on the first line
   that parses as JSON with an "ok" field (the console logs other lines;
   they are skipped). */
function request(SerialPort, portPath, cmd, timeoutMs) {
  return new Promise(function (resolve, reject) {
    var port = new SerialPort({ path: portPath, baudRate: 115200 }, function (e) {
      if (e) reject(new Error(portPath + ': ' + e.message));
    });
    var buf = '', done = false;
    function finish(err, val) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try { port.close(function () {}); } catch (e2) {}
      if (err) reject(err); else resolve(val);
    }
    var timer = setTimeout(function () {
      finish(new Error(portPath + ': no reply to "' + cmd.c + '" (is this the board\'s USB port?)'));
    }, timeoutMs || 10000);
    port.on('error', function (e) { finish(new Error(portPath + ': ' + e.message)); });
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
  var a = U.parseArgs(args, ['ssid', 'pass', 'clone-from']);
  if (a.opts.help || !a._[0]) {
    console.log(HELP);
    process.exit(a.opts.help ? 0 : 1);
  }
  var SerialPort = loadSerialport();
  var target = await pickPort(SerialPort, a._[0]);

  var ssid, pass;
  if (a.opts['clone-from']) {
    var srcPort = await pickPort(SerialPort, String(a.opts['clone-from']));
    var src = await request(SerialPort, srcPort, { c: 'wifiget' });
    if (!src.ok) U.die(srcPort + ': wifiget failed: ' + src.err);
    if (!src.ssid) U.die(srcPort + ': board has no stored credentials');
    ssid = src.ssid; pass = src.pass || '';
    console.log('cloned "' + ssid + '" from ' + srcPort);
  } else if (typeof a.opts.ssid === 'string' && a.opts.ssid) {
    ssid = a.opts.ssid; pass = typeof a.opts.pass === 'string' ? a.opts.pass : '';
  } else {
    U.die(HELP);
  }

  var r = await request(SerialPort, target, { c: 'wifi', ssid: ssid, pass: pass });
  if (!r.ok) U.die(target + ': wifi failed: ' + r.err);
  console.log(target + ': credentials saved, rebooting into "' + ssid + '"');
}

async function main(args) {
  var sub = args[0];
  if (sub === 'wifi') return wifi(args.slice(1));
  console.log(HELP);
  process.exit(sub === '--help' || sub === '-h' ? 0 : 1);
}

module.exports = { main: main };
