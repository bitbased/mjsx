/*
 * A real interactive CLI app — the thing "something like Ink" actually
 * means. Not a scripted demo(): raw stdin, real keypresses, a redraw after
 * every one. Arrow keys move a fake cursor and enter/space taps wherever
 * it is (pointer id 0 — see mjsx-core's pointer() for what the id is for);
 * every other key is relayed through UI.key() so an app can react to real
 * keyboard input directly, not just a simulated tap.
 *
 * One honest limitation: a plain tty in raw mode hands over bytes per
 * keystroke, not separate hardware press/release timing the way a browser's
 * keydown/keyup do. So each keystroke here fires 'down' then 'press' then
 * 'up' back to back, as the closest honest approximation — there is no
 * "held key" state to report because the terminal never tells us one.
 *
 *   bun interactive.js <example.jsx> [cols] [rows]
 */
var path = require('path');
/* `--char` renders text as real terminal characters on cell density; the
   default 'pixel' mode rasterizes everything, text included, into
   half-block sub-pixels. Bare args are <example.jsx> [cols] [rows]. */
var flagArgs = process.argv.slice(2).filter(function (a) { return a.slice(0, 2) === '--'; });
var numArgs = process.argv.slice(2).filter(function (a) { return a.slice(0, 2) !== '--'; });
var fontName = 'auto';
for (var ffl = 0; ffl < flagArgs.length; ffl++) {
  if (flagArgs[ffl].slice(0, 7) === '--font=') fontName = flagArgs[ffl].slice(7);
}
var pxMode = (flagArgs.indexOf('--char') !== -1 || flagArgs.indexOf('--cell') !== -1) ? 'char'
           : (flagArgs.indexOf('--block') !== -1 ? 'block' : 'pixel');
var exampleFile = numArgs[0];
var cols = parseInt(numArgs[1] || String(process.stdout.columns || 80), 10);
var rows = parseInt(numArgs[2] || String((process.stdout.rows || 24) - 1), 10);

if (!exampleFile) {
  console.error('usage: bun interactive.js <example.jsx> [cols] [rows]');
  process.exit(1);
}

var backend = require('./backend.js').createTerminalBackend(cols, rows, { mode: pxMode, font: fontName === 'auto' ? undefined : fontName });
globalThis.gfx = backend.gfx;
globalThis.sys = backend.sys;

var core = require('../../../packages/core/src/mjsx.js');
globalThis.h = core.h;
globalThis.UI = core.UI;
globalThis.Button = core.Button;
globalThis.Swatch = core.Swatch;
globalThis.em = core.em;
globalThis.Modal = core.Modal;
globalThis.Keyboard = core.Keyboard;
core.FONT.advance = backend.font.advance;
core.FONT.lineH = backend.font.lineH;
core.FONT.quantum = backend.font.quantum;
core.FONT.pick = backend.font.pick || null;
UI.scrollQuantum = backend.ySub;

require(path.resolve(exampleFile));

/* A fake cursor: arrow keys move it, enter/space taps wherever it is. This
   is deliberately not a real pointing device — it is what lets a keyboard
   drive the exact same UI.pointer(id, phase, x, y) path a finger or a
   mouse would, without mjsx-core knowing keyboards exist at all. */
var cx = Math.floor(gfx.width() / 2), cy = Math.floor(gfx.height() / 2);
var STEP = 4;
var PTR_ID = 0;

function redraw() {
  UI.render();
  var frame = backend.toAnsi();
  // A crosshair over whatever the redraw just painted, so the cursor is
  // visible without mjsx-core drawing anything cursor-shaped itself.
  frame += '\x1b[' + (Math.round(cy / backend.ySub) + 1) + ';' + (cx * backend.xSub + 1) + 'H\x1b[93m+\x1b[0m';
  process.stdout.write('\x1b[2J' + frame);
  /* Absolutely positioned on the row below the canvas — the frame ends with
     absolutely-positioned text stamps, so a relative newline would land the
     footer wherever the last label happened to be. */
  process.stdout.write('\x1b[' + (backend.height + 1) + ';1H\x1b[90marrows move, enter/space taps, q quits\x1b[0m');
}

/* Fit the canvas to the terminal, live — only when the size came from the
   terminal in the first place; explicit cols/rows stay what was asked. The
   original sys is kept: a fresh backend would restart its millis() epoch and
   push every pending UI.setTimer deadline into the far future. */
var sizeFromTty = !numArgs[1];
process.stdout.on('resize', function () {
  if (!sizeFromTty) return;
  cols = process.stdout.columns || cols;
  rows = (process.stdout.rows || rows + 1) - 1;
  backend = require('./backend.js').createTerminalBackend(cols, rows, { mode: pxMode, font: fontName === 'auto' ? undefined : fontName });
  globalThis.gfx = backend.gfx;
  cx = Math.min(cx, gfx.width() - 1);
  cy = Math.min(cy, gfx.height() - 1);
  UI._dirty = true;
  redraw();
});

if (!process.stdin.isTTY) {
  console.error('interactive.js needs a real terminal (stdin is not a tty — piped input or a non-interactive shell won\'t work). Use run.js for a one-shot render instead.');
  process.exit(1);
}
process.stdin.setRawMode(true);
process.stdin.resume();
process.stdin.setEncoding('utf8');
process.stdout.write('\x1b[?25l'); // hide the real cursor; the crosshair is the cursor

function cleanup() {
  process.stdout.write('\x1b[?25h\n');
  process.exit(0);
}
process.on('SIGINT', cleanup);

var ARROW_UP = '\x1b[A', ARROW_DOWN = '\x1b[B', ARROW_RIGHT = '\x1b[C', ARROW_LEFT = '\x1b[D';
var CTRL_C = '\x03';

process.stdin.on('data', function (chunk) {
  if (chunk === 'q' || chunk === CTRL_C) { cleanup(); return; }

  /* A focused input owns the keyboard: raw control bytes become the named
     keys mjsx-core's editor understands; printable chars fall through. */
  if (UI.focused && UI.focused()) {
    var named = chunk === '\x7f' || chunk === '\b' ? 'Backspace'
              : chunk === '\r' ? 'Enter'
              : chunk === '\t' ? 'Tab'
              : chunk === '\x1b' ? 'Escape'
              : chunk === ARROW_LEFT ? 'ArrowLeft'
              : chunk === ARROW_RIGHT ? 'ArrowRight'
              : null;
    if (named) { UI.key('press', named); redraw(); return; }
  }

  if (chunk === ARROW_UP) { cy = Math.max(0, cy - STEP); redraw(); return; }
  if (chunk === ARROW_DOWN) { cy = Math.min(gfx.height() - 1, cy + STEP); redraw(); return; }
  if (chunk === ARROW_LEFT) { cx = Math.max(0, cx - STEP); redraw(); return; }
  if (chunk === ARROW_RIGHT) { cx = Math.min(gfx.width() - 1, cx + STEP); redraw(); return; }

  if (chunk === '\r' || chunk === ' ') {
    UI.pointer(PTR_ID, 0, cx, cy); // press
    UI.pointer(PTR_ID, 2, cx, cy); // release -> tap -> onTap
    redraw();
    return;
  }

  // Anything else: a real key, relayed as-is rather than turned into a
  // simulated tap. An app that wants to type into a field, or bind
  // shortcuts, hooks UI.onKey — mjsx-core itself does not interpret this.
  UI.key('down', chunk);
  UI.key('press', chunk);
  UI.key('up', chunk);
  if (UI.dirty()) redraw();
});

/* Timers and flings drain in ticker(), not render() — without something
   calling it periodically, UI.setTimer's queue would sit unchecked between
   keystrokes and nothing async (a simulated sensor, a real one) would ever
   redraw on its own. Same 33ms cadence the http backend uses. */
setInterval(function () {
  if (UI.ticker()) redraw();
}, 33);

redraw();
