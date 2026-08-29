/* mjsx run — render an app once through an existing runner. */
var path = require('path');
var { spawnSync } = require('child_process');
var U = require('./util.js');

var HELP = 'usage: mjsx run <app.jsx> [--terminal] [--ppm out.ppm] [--size WxH]\n' +
  '\n' +
  'Renders the app once and exits (plus a second frame if the app exports\n' +
  'a demo() interaction — see backends/pure-js/src/run.js).\n' +
  '\n' +
  '  --terminal      ANSI half-block cells in this terminal (the default)\n' +
  '  --ppm out.ppm   pixels via the pure-js backend, written as a PPM file\n' +
  '  --size WxH      canvas size (default: the terminal\'s, or 240x280 for PPM)';

async function main(args) {
  var a = U.parseArgs(args, ['ppm', 'size']);
  if (a.opts.help || !a._[0]) {
    console.log(HELP);
    process.exit(a.opts.help ? 0 : 1);
  }
  var app = path.resolve(a._[0]);
  var size = typeof a.opts.size === 'string' ? a.opts.size.toLowerCase().split('x') : [];
  var bun = U.bunBin();
  var runner, extra;
  if (a.opts.ppm) {
    runner = path.join(U.REPO, 'backends/pure-js/src/run.js');
    extra = [String(a.opts.ppm)].concat(size);
  } else {
    runner = path.join(U.REPO, 'backends/terminal/src/run.js');
    extra = size;
  }
  var r = spawnSync(bun, [runner, app].concat(extra), { stdio: 'inherit' });
  process.exit(r.status === null ? 1 : r.status);
}

module.exports = { main: main };
