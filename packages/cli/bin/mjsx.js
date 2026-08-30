#!/usr/bin/env bun
/*
 * mjsx — one command over what already exists: the runners in backends/,
 * the ESP32 bundle-push tooling, and the bridge firmware's HTTP and
 * serial protocols. Plain JS, no dependencies; `mjsx device wifi` alone
 * asks for the serialport package and says so when it is missing.
 *
 * Two guarantees this file enforces for every command:
 *   - it exits. main() resolving is the end of the process, whatever
 *     sockets, watchers or pooled connections are still open underneath.
 *     Waiting for the event loop to drain is what made `fleet ls` hang
 *     after it had already printed its results.
 *   - it fails in one line. Anything thrown reaches one handler that
 *     prints a sentence; --debug adds the stack.
 */
var U = require('../src/util.js');

var HELP = 'usage: mjsx <command> ...\n' +
  '\n' +
  '  dev [example]                    device sim in a window + browser mirror\n' +
  '  run <app.jsx> [--ppm out.ppm]    render an app once (terminal or PPM)\n' +
  '  push <ip> <app.jsx|--examples>   bundle mjsx-core + app, push to a board\n' +
  '  ota <ip> <firmware.bin>          firmware update over HTTP\n' +
  '  device wifi <port|auto> ...      provision WiFi over USB serial\n' +
  '  fleet ls|push|ota ...            the same, across every board on the LAN\n' +
  '  clock ls|set ...                 read or set the boards\' time and timezone\n' +
  '  lint [path...]                   check code stays in the subset its target parses\n' +
  '\n' +
  'Every command runs to a deadline and exits; network steps take --timeout\n' +
  '(and discovery --wait) as seconds, or with an ms/s suffix.\n' +
  '\n' +
  '  --debug   print the stack behind a failure, not just the message\n' +
  '\n' +
  'mjsx <command> --help shows each command\'s details.';

var COMMANDS = ['dev', 'run', 'push', 'ota', 'device', 'fleet', 'clock', 'lint'];

/* --debug is global: strip it here so no command forwards it onward
   (mjsx dev passes its flags straight through to the sim). */
var argv = [];
var raw = process.argv.slice(2);
for (var i = 0; i < raw.length; i++) {
  if (raw[i] === '--debug') U.setDebug(true);
  else argv.push(raw[i]);
}

var cmd = argv.shift();

if (cmd === 'help' || cmd === '--help' || cmd === '-h') {
  console.log(HELP);
  process.exit(0);
}
if (!cmd) {
  console.error('mjsx: no command given — try one of: ' + COMMANDS.join(', ') + ' (mjsx --help)');
  process.exit(1);
}
if (COMMANDS.indexOf(cmd) === -1) {
  console.error('mjsx: unknown command "' + cmd + '" — try one of: ' + COMMANDS.join(', ') + ' (mjsx --help)');
  process.exit(1);
}

function crash(e) {
  U.report(e, cmd);
  process.exit(1);
}
process.on('unhandledRejection', crash);
process.on('uncaughtException', crash);

Promise.resolve(require('../src/' + cmd + '.js').main(argv)).then(function () {
  /* Explicit: the work is done, so the process is done. */
  process.exit(0);
}, crash);
