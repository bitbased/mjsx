/*
 * Run one mjsx example straight to this terminal.
 *   bun run.js <example.jsx> [cols] [rows]
 * Ctrl-C to exit; renders once and (if the example ticks) again on a timer.
 */
var path = require('path');
var exampleFile = process.argv[2];
var cols = parseInt(process.argv[3] || String(process.stdout.columns || 60), 10);
var rows = parseInt(process.argv[4] || String((process.stdout.rows || 24) - 1), 10);

if (!exampleFile) {
  console.error('usage: bun run.js <example.jsx> [cols] [rows]');
  process.exit(1);
}

var backend = require('./backend.js').createTerminalBackend(cols, rows);
globalThis.gfx = backend.gfx;
globalThis.sys = backend.sys;

var core = require('../../../packages/core/src/mjsx.js');
globalThis.h = core.h;
globalThis.UI = core.UI;
globalThis.Button = core.Button;
globalThis.Swatch = core.Swatch;
globalThis.em = core.em;

// Text is real characters in the terminal's own font, not sub-pixel art —
// one character wide, two sub-pixel rows tall (a character cell holds two
// vertical half-blocks). mjsx-core's default FONT assumes a 6px bitmap
// glyph; this is the override point it was built for.
core.FONT.advance = backend.font.advance;
core.FONT.lineH = backend.font.lineH;
core.FONT.quantum = backend.font.quantum;
core.UI.scrollQuantum = backend.ySub;

require(path.resolve(exampleFile));

UI.render();
process.stdout.write(backend.toAnsi());

var mod = require.cache[require.resolve(path.resolve(exampleFile))];
if (mod && mod.exports && typeof mod.exports.demo === 'function') {
  setTimeout(function () {
    mod.exports.demo(UI, backend);
    if (UI.dirty()) UI.render();
    process.stdout.write(backend.toAnsi());
    process.stdout.write('\n');
  }, 600);
} else {
  process.stdout.write('\n');
}
