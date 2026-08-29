/* mjsx dev — the device simulator, mirrored to the browser. */
var fs = require('fs');
var path = require('path');
var { spawnSync } = require('child_process');
var U = require('./util.js');

var HELP = 'usage: mjsx dev [example] [sim flags...]\n' +
  '\n' +
  'Wraps backends/sdl/src/sim.js --http: a native window (needs SDL2 —\n' +
  'the sim prints the install line if it is missing) plus a live browser\n' +
  'mirror at http://localhost:8080. Takes an example name (counter) or a\n' +
  'path inside examples/ (examples/counter/app.jsx); with neither, the\n' +
  'sim opens on its example menu.\n' +
  '\n' +
  'Reload: there is no file watcher. The sim re-requires an example from\n' +
  'disk each time it loads one, so after an edit press RESTART in the\n' +
  'sim toolbar (or Esc, then pick it again). Apps outside examples/ are\n' +
  'not supported — the sim only loads the bundled examples.\n' +
  '\n' +
  '  --http=PORT and every other sim flag pass straight through\n' +
  '  (see backends/sdl/src/sim.js for the full list).';

function exampleName(arg) {
  var exDir = path.join(U.REPO, 'examples');
  if (fs.existsSync(path.join(exDir, arg, 'app.jsx'))) return arg;
  var p = path.resolve(arg);
  if (path.basename(p) === 'app.jsx' && path.dirname(path.dirname(p)) === exDir) {
    return path.basename(path.dirname(p));
  }
  var have = fs.readdirSync(exDir).filter(function (n) {
    return fs.existsSync(path.join(exDir, n, 'app.jsx'));
  }).sort();
  U.die('the sim loads the bundled examples only — pass a name or a path\n' +
        'inside examples/. Have: ' + have.join(', '));
}

async function main(args) {
  var flags = [], positional = [];
  for (var i = 0; i < args.length; i++) {
    (args[i].slice(0, 2) === '--' ? flags : positional).push(args[i]);
  }
  if (flags.indexOf('--help') !== -1 || positional.indexOf('-h') !== -1) {
    console.log(HELP);
    process.exit(0);
  }
  var simArgs = [path.join(U.REPO, 'backends/sdl/src/sim.js')];
  if (positional.length) simArgs.push(exampleName(positional[0]));
  simArgs = simArgs.concat(positional.slice(1)); /* optional W H scale, as the sim takes them */
  var hasHttp = flags.some(function (f) { return f === '--http' || f.slice(0, 7) === '--http='; });
  if (!hasHttp) flags.push('--http');
  var r = spawnSync(U.bunBin(), simArgs.concat(flags), { stdio: 'inherit' });
  process.exit(r.status === null ? 1 : r.status);
}

module.exports = { main: main };
