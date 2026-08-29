#!/usr/bin/env bun
/*
 * mjsx — one command over what already exists: the runners in backends/,
 * the ESP32 bundle-push tooling, and the bridge firmware's HTTP and
 * serial protocols. Plain JS, no dependencies; `mjsx device wifi` alone
 * asks for the serialport package and says so when it is missing.
 */
var HELP = 'usage: mjsx <command> ...\n' +
  '\n' +
  '  dev [example]                    device sim in a window + browser mirror\n' +
  '  run <app.jsx> [--ppm out.ppm]    render an app once (terminal or PPM)\n' +
  '  push <ip> <app.jsx|--examples>   bundle mjsx-core + app, push to a board\n' +
  '  ota <ip> <firmware.bin>          firmware update over HTTP\n' +
  '  device wifi <port|auto> ...      provision WiFi over USB serial\n' +
  '  fleet ls|push|ota ...            the same, across every board on the LAN\n' +
  '\n' +
  'mjsx <command> --help shows each command\'s details.';

var table = { dev: 1, run: 1, push: 1, ota: 1, device: 1, fleet: 1 };
var argv = process.argv.slice(2);
var cmd = argv.shift();

if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') {
  console.log(HELP);
  process.exit(cmd ? 0 : 1);
}
if (!table[cmd]) {
  console.error('unknown command: ' + cmd + '\n\n' + HELP);
  process.exit(1);
}
Promise.resolve(require('../src/' + cmd + '.js').main(argv)).catch(function (e) {
  console.error(e && e.message ? e.message : String(e));
  process.exit(1);
});
