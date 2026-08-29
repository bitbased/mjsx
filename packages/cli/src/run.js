/* mjsx run — render an app once through an existing runner. */
var fs = require('fs');
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
  var a = U.parseArgs(args, ['ppm', 'size'], 'run');
  if (a.opts.help) {
    console.log(HELP);
    return;
  }
  if (!a._[0]) U.usage('run', 'missing <app.jsx>');

  var app = path.resolve(a._[0]);
  if (!fs.existsSync(app)) U.die('mjsx run: no such file: ' + app);

  if (a.opts.ppm !== undefined && (a.opts.ppm === true || String(a.opts.ppm).trim() === '')) {
    U.usage('run', '--ppm needs an output path, like --ppm out.ppm');
  }

  var size = [];
  if (a.opts.size !== undefined) {
    if (a.opts.size === true) U.usage('run', '--size needs WxH, like --size 240x280');
    var m = /^(\d+)x(\d+)$/i.exec(String(a.opts.size).trim());
    if (!m) U.usage('run', '--size wants WxH in pixels (got "' + a.opts.size + '")');
    size = [m[1], m[2]];
  }

  var bun = U.bunBin();
  var runner, extra;
  if (a.opts.ppm) {
    runner = path.join(U.REPO, 'backends/pure-js/src/run.js');
    var out = path.resolve(String(a.opts.ppm));
    var dir = path.dirname(out);
    if (!fs.existsSync(dir)) U.die('mjsx run: --ppm directory does not exist: ' + dir);
    extra = [out].concat(size);
  } else {
    runner = path.join(U.REPO, 'backends/terminal/src/run.js');
    extra = size;
  }
  if (!fs.existsSync(runner)) {
    U.die('mjsx run: the backend runner is missing: ' + runner + ' — run mjsx from a full checkout');
  }

  /* spawnSync: the runner renders and exits, so this is bounded by the
     child, and mjsx carries the child's status out. */
  var r = spawnSync(bun, [runner, app].concat(extra), { stdio: 'inherit' });
  if (r.error) U.die('mjsx run: could not start ' + bun + ' (' + U.message(r.error) + ')');
  if (r.signal) U.die('mjsx run: the renderer was killed by ' + r.signal);
  process.exit(r.status === null ? 1 : r.status);
}

module.exports = { main: main };
