/*
 * Run one mjsx example under the pure-js backend and write a PPM snapshot.
 *
 *   bun run.js <example.jsx> <out.ppm> [width] [height]
 *
 * Wires gfx/sys/h/UI onto the global object before loading the example,
 * exactly the way a real device hands them to a flat script — an example
 * written against this contract needs no changes to also run unmodified
 * under MicroQuickJS on a chip. That equivalence is the point of this
 * runner existing at all, not just producing a picture.
 */
var fs = require('fs');
var path = require('path');

var exampleFile = process.argv[2];
var outFile = process.argv[3] || 'out.ppm';
var W = parseInt(process.argv[4] || '240', 10);
var H = parseInt(process.argv[5] || '280', 10);

if (!exampleFile) {
  console.error('usage: bun run.js <example.jsx> <out.ppm> [width] [height]');
  process.exit(1);
}

var backend = require('./backend.js').createPureJsBackend(W, H);
globalThis.gfx = backend.gfx;
globalThis.sys = backend.sys;

var core = require('../../../packages/core/src/mjsx.js');
globalThis.h = core.h;
globalThis.UI = core.UI;
globalThis.Button = core.Button;
globalThis.Swatch = core.Swatch;
globalThis.em = core.em;
globalThis.Modal = core.Modal;

require(path.resolve(exampleFile)); // runs the example's top-level UI.mount(...)

UI.render();
fs.writeFileSync(outFile, backend.toPPM());
console.log('rendered ' + W + 'x' + H + ' -> ' + outFile);

/* If the example wants a scripted interaction (proving state -> re-render
   actually works, not just static layout), it can export one via
   module.exports.demo = function(UI, backend) { ... } and this runner will
   drive it and write a second frame next to the first. */
var mod = require.cache[require.resolve(path.resolve(exampleFile))];
if (mod && mod.exports && typeof mod.exports.demo === 'function') {
  mod.exports.demo(UI, backend);
  if (UI.dirty()) UI.render();
  var afterFile = outFile.replace(/\.ppm$/, '.after.ppm');
  fs.writeFileSync(afterFile, backend.toPPM());
  console.log('demo interaction -> ' + afterFile);
}
