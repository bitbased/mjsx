/* mjsx ota — firmware update over HTTP, the transfer step only. */
var fs = require('fs');
var path = require('path');
var U = require('./util.js');

var HELP = 'usage: mjsx ota <ip> <firmware.bin>\n' +
  '\n' +
  'POSTs the image as multipart field "f" to http://<ip>/update?size=N —\n' +
  'the same request the kit repo\'s ota-s3.sh sends with curl. The image\n' +
  'lands in the inactive OTA slot and is verified before the board\n' +
  'switches to it, so a failed upload leaves the running firmware alone.\n' +
  '\n' +
  'Building the image is not wrapped here (that is arduino-cli\'s job),\n' +
  'and neither is the espota.py fallback for firmware that predates the\n' +
  '/update endpoint.';

async function otaOne(ip, file) {
  var buf = fs.readFileSync(file);
  var form = new FormData();
  form.append('f', new Blob([buf]), path.basename(file));
  var res;
  try {
    res = await fetch('http://' + ip + '/update?size=' + buf.length, {
      method: 'POST', body: form, signal: AbortSignal.timeout(180000)
    });
  } catch (e) {
    throw new Error(ip + ': upload failed: ' + (e && e.message ? e.message : e));
  }
  if (!res.ok) throw new Error(ip + ': board rejected the update (HTTP ' + res.status + ')');
  console.log(ip + ': sent ' + buf.length + ' bytes, updated over the air');
}

async function main(args) {
  var a = U.parseArgs(args, []);
  if (a.opts.help || a._.length < 2) {
    console.log(HELP);
    process.exit(a.opts.help ? 0 : 1);
  }
  var file = path.resolve(a._[1]);
  if (!fs.existsSync(file)) U.die('no such file: ' + file);
  await otaOne(a._[0], file);
}

module.exports = { main: main, otaOne: otaOne };
