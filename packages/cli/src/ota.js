/* mjsx ota — firmware update over HTTP, the transfer step only. */
var fs = require('fs');
var path = require('path');
var U = require('./util.js');

var CONNECT_MS = 5000;
var UPLOAD_MS = 180000;

var HELP = 'usage: mjsx ota <ip> <firmware.bin> [--timeout 5s]\n' +
  '\n' +
  'POSTs the image as multipart field "f" to http://<ip>/update?size=N —\n' +
  'the same request the kit repo\'s ota-s3.sh sends with curl. The image\n' +
  'lands in the inactive OTA slot and is verified before the board\n' +
  'switches to it, so a failed upload leaves the running firmware alone.\n' +
  '\n' +
  'Two clocks: --timeout (default 5s) bounds reaching port 80 at all, and\n' +
  'the upload itself then gets 3 minutes. An unreachable address fails in\n' +
  'seconds instead of holding the whole upload window open.\n' +
  '\n' +
  'Building the image is not wrapped here (that is arduino-cli\'s job),\n' +
  'and neither is the espota.py fallback for firmware that predates the\n' +
  '/update endpoint.';

async function otaOne(ip, file, opts) {
  opts = opts || {};
  var connectMs = opts.connectMs || CONNECT_MS;
  try {
    await U.tcpProbe(ip, 80, connectMs);
  } catch (e) {
    throw new Error(ip + ':80 is not answering (' + U.reason(e, connectMs) + ') — is the board on this network?');
  }
  var buf = fs.readFileSync(file);
  var form = new FormData();
  form.append('f', new Blob([buf]), path.basename(file));
  var res;
  try {
    res = await fetch('http://' + ip + '/update?size=' + buf.length, {
      method: 'POST', body: form, signal: AbortSignal.timeout(opts.uploadMs || UPLOAD_MS)
    });
  } catch (e) {
    throw new Error(ip + ': upload failed (' + U.reason(e, opts.uploadMs || UPLOAD_MS) + ')');
  }
  if (!res.ok) throw new Error(ip + ': board rejected the update (HTTP ' + res.status + ')');
  console.log(ip + ': sent ' + buf.length + ' bytes, updated over the air');
}

async function main(args) {
  var a = U.parseArgs(args, ['timeout'], 'ota');
  if (a.opts.help) {
    console.log(HELP);
    return;
  }
  if (a._.length < 2) U.usage('ota', 'missing <ip> <firmware.bin>');
  var ip = U.checkHost(a._[0], 'ota');
  var file = path.resolve(a._[1]);
  if (!fs.existsSync(file)) U.die('mjsx ota: no such file: ' + file);
  if (!fs.statSync(file).size) U.die('mjsx ota: firmware image is empty: ' + file);
  var connectMs = U.parseDuration(a.opts.timeout, 'ota --timeout', CONNECT_MS);
  await otaOne(ip, file, { connectMs: connectMs });
}

module.exports = { main: main, otaOne: otaOne, CONNECT_MS: CONNECT_MS };
