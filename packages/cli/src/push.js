/* mjsx push — bundle mjsx-core + app code and swap it onto a bridge board. */
var fs = require('fs');
var path = require('path');
var U = require('./util.js');
var bundle = require('./bundle.js');
var link = require('./bridge-link.js');

var HELP = 'usage: mjsx push <ip> <app.jsx> [--timeout 5s]\n' +
  '       mjsx push <ip> --examples [name ...] [--timeout 5s]\n' +
  '\n' +
  'The bridge firmware swaps /app.js over TCP without reflashing, so a\n' +
  'push is a bundle, not a firmware: mjsx-core, the device shim, and\n' +
  'either one app (its own UI.mount runs at boot) or every example plus\n' +
  'the on-device picker menu. The bundle is validated in the kit repo\'s\n' +
  'MicroQuickJS harness first when that harness is built.\n' +
  '\n' +
  'The board is checked for a pulse on :8765 before anything is built —\n' +
  '--timeout bounds that check (default 5s) so an address that is off or\n' +
  'wrong costs seconds, not a transpile and a stalled socket.\n' +
  '\n' +
  'Needs tsc for the JSX transform (Bun\'s transpiler modernises ES5 into\n' +
  'syntax MicroQuickJS rejects): repo node_modules, PATH, or MJSX_TSC=.';

/* opts + the positionals after the ip: one app path, or (with
   --examples) an optional list of example names. Shared with fleet push. */
function build(opts, rest) {
  if (opts.examples) {
    var b = bundle.buildExamplesBundle(rest);
    console.log('bundle: ' + b.bundle.length + ' bytes, examples: ' + b.names.join(', '));
    return b.bundle;
  }
  var app = rest[0];
  if (!app) U.usage('push', 'missing <app.jsx> (or --examples)');
  app = path.resolve(app);
  if (!fs.existsSync(app)) U.die('mjsx push: no such file: ' + app);
  var out = bundle.buildAppBundle(app);
  console.log('bundle: ' + out.length + ' bytes');
  return out;
}

async function main(args) {
  var a = U.parseArgs(args, ['timeout'], 'push');
  if (a.opts.help) {
    console.log(HELP);
    return;
  }
  if (!a._[0]) U.usage('push', 'missing <ip> <app.jsx>');
  var ip = U.checkHost(a._[0], 'push');
  if (!a.opts.examples && !a._[1]) U.usage('push', 'missing <app.jsx> (or --examples)');

  var connectMs = U.parseDuration(a.opts.timeout, 'push --timeout', link.CONNECT_MS);
  await U.requireReachable(ip, 8765, connectMs,
    'is the board powered on and on this network? (mjsx fleet ls lists what is)');

  var b = build(a.opts, a._.slice(1));
  bundle.validate(b);
  await link.pushBundle(ip, b, null, { connectMs: connectMs });
}

module.exports = { main: main, build: build };
