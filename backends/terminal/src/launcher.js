/*
 * An example picker: a menu in the terminal, pick one, it runs live —
 * keyboard AND real mouse clicks both work. Esc returns to the menu, q
 * quits either way.
 *
 * Mouse support here is SGR mouse tracking (`\x1b[?1000h\x1b[?1002h\x1b[?1006h`)
 * — a core VT/xterm terminal-emulation feature every full terminal
 * implements, not a graphics protocol like Sixel/Kitty. Different thing
 * entirely from "can this terminal show pixels": this is standard, and a
 * real click sends its own escape sequence the same way an arrow key does.
 *
 *   bun launcher.js [cols] [rows]
 */
var fs = require('fs');
var path = require('path');

/* Flags and sizes mix freely on the command line: `--char` renders text as
   real terminal characters on 1-pixel-per-cell density; the default 'pixel'
   mode rasterizes EVERYTHING — text included — into half-block sub-pixels,
   a true preview of a pixel panel. Bare numbers are cols then rows. */
var flagArgs = process.argv.slice(2).filter(function (a) { return a.slice(0, 2) === '--'; });
var numArgs = process.argv.slice(2).filter(function (a) { return a.slice(0, 2) !== '--'; });
var fontName = 'auto';
for (var ffl = 0; ffl < flagArgs.length; ffl++) {
  if (flagArgs[ffl].slice(0, 7) === '--font=') fontName = flagArgs[ffl].slice(7);
}
var pxMode = (flagArgs.indexOf('--char') !== -1 || flagArgs.indexOf('--cell') !== -1) ? 'char'
           : (flagArgs.indexOf('--block') !== -1 ? 'block' : 'pixel');
var MODE_CYCLE = ['pixel', 'block', 'char']; // half-block detail -> font-proof blocks -> terminal text
var cols = parseInt(numArgs[0] || String(process.stdout.columns || 80), 10);
var rows = parseInt(numArgs[1] || String((process.stdout.rows || 24) - 1), 10);

var backend = require('./backend.js').createTerminalBackend(cols, rows, { mode: pxMode, font: fontName === 'auto' ? undefined : fontName });
globalThis.gfx = backend.gfx;
globalThis.sys = backend.sys;

/* Fresh core per example — a brand-new UI singleton so nothing (state,
   scroll offsets, handlers, timers) crosses between examples. Font metrics
   are re-applied each time since they live on the new module's FONT. */
var CORE = require.resolve('../../../packages/core/src/mjsx.js');
var core;
function freshCore() {
  delete require.cache[CORE];
  core = require(CORE);
  globalThis.h = core.h;
  globalThis.UI = core.UI;
  globalThis.Button = core.Button;
  globalThis.Swatch = core.Swatch;
  globalThis.em = core.em;
  applyFont();
}
freshCore();
function applyFont() {
  /* The backend knows its own text metrics — pixel mode has real glyph
     dimensions, char mode is one cell per char, one row per line. */
  core.FONT.advance = backend.font.advance;
  core.FONT.lineH = backend.font.lineH;
  core.FONT.quantum = backend.font.quantum;
  core.FONT.pick = backend.font.pick || null;
  UI.scrollQuantum = backend.ySub;
}

var EXAMPLES_DIR = path.resolve(__dirname, '../../../examples');
var examples = fs.readdirSync(EXAMPLES_DIR).filter(function (name) {
  return fs.existsSync(path.join(EXAMPLES_DIR, name, 'app.jsx'));
}).sort();

/**
 * Load an example fresh, every time — including the second time the same
 * one is picked. require() caches by resolved path, so without clearing
 * that entry a repeat pick would return the already-evaluated module and
 * its top-level UI.mount(App) would simply not run again, leaving the menu
 * on screen. Everything else about "swap the running app" is just
 * UI.mount() doing what it already does — the requested example's own
 * top-level code calls it, exactly as it does run standalone.
 */
function loadExample(name) {
  freshCore();
  var file = path.join(EXAMPLES_DIR, name, 'app.jsx');
  var resolved = require.resolve(file);
  delete require.cache[resolved];
  require(file);
}

function Menu() {
  /* All spacing in em — text-relative — so the menu tightens itself on the
     terminal's small font instead of keeping panel-sized gutters. Buttons
     size to their label + padding rather than a fixed pixel height. */
  var kids = [
    h('text', { text: 'PICK AN EXAMPLE', size: 2, align: 'center', color: UI.theme.accent }),
    h('spacer', { h: em(0.5) })
  ];
  for (var i = 0; i < examples.length; i++) {
    kids.push(h(Button, {
      label: examples[i], size: 1, pad: em(0.5),
      onTap: (function (name) { return function () { loadExample(name); }; })(examples[i])
    }));
  }
  kids.push(h('spacer', { h: em(0.5) }));
  kids.push(h(Button, {
    label: 'render: ' + pxMode,
    size: 1, pad: em(0.5), bg: UI.theme.panel,
    onTap: function () { setMode(MODE_CYCLE[(MODE_CYCLE.indexOf(pxMode) + 1) % MODE_CYCLE.length]); }
  }));
  kids.push(h('spacer', { h: em(0.5) }));
  kids.push(h('text', { text: 'esc: menu   q: quit', size: 1, color: UI.theme.muted, align: 'center' }));
  /* A scroll viewport pinned to the canvas height — more examples than fit
     just scroll (wheel, drag, or arrow keys at the edge) instead of being
     unreachable below the fold. */
  return h('box', { pad: em(1), gap: em(0.5), h: gfx.height(), scroll: 'menu' }, kids);
}

function showMenu() { freshCore(); UI.mount(Menu); }
showMenu();

/* Swap pixel density live: a fresh backend at the same cols/rows, the font
   metric following it, and the next render re-lays everything out. sys is
   kept — a new one would restart the millis() epoch under pending timers. */
function setMode(m) {
  pxMode = m;
  backend = require('./backend.js').createTerminalBackend(cols, rows, { mode: pxMode, font: fontName === 'auto' ? undefined : fontName });
  globalThis.gfx = backend.gfx;
  applyFont();
  cx = Math.min(cx, gfx.width() - 1);
  cy = Math.min(cy, gfx.height() - 1);
  UI._dirty = true;
}

/* A fake cursor for keyboard control — invisible until an arrow key moves
   it, since the terminal's own mouse pointer is what a real click uses and
   drawing a second indicator over it would just be confusing. */
var cx = Math.floor(gfx.width() / 2), cy = Math.floor(gfx.height() / 2);
var kbCursorUsed = false;
var STEP = 4;
var KB_ID = 0, MOUSE_ID = 'mouse';

function redraw() {
  UI.render();
  var frame = backend.toAnsi();
  if (kbCursorUsed) {
    frame += '\x1b[' + (Math.round(cy / backend.ySub) + 1) + ';' + (cx * backend.xSub + 1) + 'H\x1b[93m+\x1b[0m';
  }
  process.stdout.write('\x1b[2J' + frame);
  /* Absolutely positioned on the row below the canvas — the frame ends with
     absolutely-positioned text stamps, so a relative newline here would put
     the footer wherever the last label happened to be. */
  process.stdout.write('\x1b[' + (backend.height + 1) + ';1H\x1b[90marrows/mouse+wheel, enter/space/click taps, esc: menu, q: quit\x1b[0m');
}

/* Fit the canvas to the terminal, live: recreate the backend at the new
   size and let the next render lay everything out again. Only when the size
   came from the terminal in the first place — explicit cols/rows arguments
   stay exactly what was asked for. */
var sizeFromTty = !numArgs[0];
process.stdout.on('resize', function () {
  if (!sizeFromTty) return;
  cols = process.stdout.columns || cols;
  rows = (process.stdout.rows || rows + 1) - 1;
  backend = require('./backend.js').createTerminalBackend(cols, rows, { mode: pxMode, font: fontName === 'auto' ? undefined : fontName });
  globalThis.gfx = backend.gfx;
  /* sys stays the original: a fresh backend restarts its millis() epoch,
     which would push every pending UI.setTimer deadline into the far
     future. The clock has nothing to do with canvas size — keep it. */
  cx = Math.min(cx, gfx.width() - 1);
  cy = Math.min(cy, gfx.height() - 1);
  UI._dirty = true;
  redraw();
});

if (!process.stdin.isTTY) {
  console.error('launcher.js needs a real terminal (stdin is not a tty).');
  process.exit(1);
}
process.stdin.setRawMode(true);
process.stdin.resume();
process.stdin.setEncoding('utf8');
process.stdout.write('\x1b[?25l');       // hide the real text cursor
process.stdout.write('\x1b[?1000h\x1b[?1002h\x1b[?1006h'); // enable SGR mouse tracking

function cleanup() {
  process.stdout.write('\x1b[?1000l\x1b[?1002l\x1b[?1006l'); // mouse tracking OFF —
  // left enabled, every future click in this terminal keeps sending escape
  // junk into whatever runs next, including the shell prompt itself.
  process.stdout.write('\x1b[?25h\n');
  process.exit(0);
}
process.on('SIGINT', cleanup);

var ARROW_UP = '\x1b[A', ARROW_DOWN = '\x1b[B', ARROW_RIGHT = '\x1b[C', ARROW_LEFT = '\x1b[D';
var CTRL_C = '\x03', ESC = '\x1b';
var SGR_MOUSE = /^\x1b\[<(\d+);(\d+);(\d+)([Mm])$/;

process.stdin.on('data', function (chunk) {
  if (chunk === 'q' || chunk === CTRL_C) { cleanup(); return; }
  if (chunk === ESC) { showMenu(); redraw(); return; } // bare Esc, not the
  // start of a longer sequence — those are matched first, below.

  var m = chunk.match(SGR_MOUSE);
  if (m) {
    var cb = parseInt(m[1], 10), mx = Math.floor((parseInt(m[2], 10) - 1) / backend.xSub), my = (parseInt(m[3], 10) - 1) * backend.ySub;
    if (cb & 64) {
      /* Wheel: Cb 64 = up, 65 = down (the low bit), reported as a lone 'M'
         with no release. A small exact delta — two character rows a notch —
         instead of swipe()'s zone-sized jump, so wheeling feels like
         scrolling rather than paging. */
      UI.scrollBy(mx, my, ((cb & 1) ? 1 : -1) * backend.ySub);
      redraw();
      return;
    }
    var isMotion = (cb & 32) !== 0;
    var phase = m[4] === 'm' ? 2 : (isMotion ? 1 : 0);
    UI.pointer(MOUSE_ID, phase, mx, my);
    redraw();
    return;
  }

  /* Up/down move the caret; once it is pinned at an edge, the same key
     scrolls whatever zone is under it instead — that is how the keyboard
     reaches items below the fold. */
  if (chunk === ARROW_UP) {
    kbCursorUsed = true;
    var nyU = Math.max(0, cy - STEP);
    if (nyU === cy) UI.scrollBy(cx, cy, -backend.ySub * 2); else cy = nyU;
    redraw(); return;
  }
  if (chunk === ARROW_DOWN) {
    kbCursorUsed = true;
    var nyD = Math.min(gfx.height() - 1, cy + STEP);
    if (nyD === cy) UI.scrollBy(cx, cy, backend.ySub * 2); else cy = nyD;
    redraw(); return;
  }
  if (chunk === ARROW_LEFT) { kbCursorUsed = true; cx = Math.max(0, cx - STEP); redraw(); return; }
  if (chunk === ARROW_RIGHT) { kbCursorUsed = true; cx = Math.min(gfx.width() - 1, cx + STEP); redraw(); return; }

  if (chunk === '\r' || chunk === ' ') {
    UI.pointer(KB_ID, 0, cx, cy);
    UI.pointer(KB_ID, 2, cx, cy);
    redraw();
    return;
  }

  UI.key('down', chunk); UI.key('press', chunk); UI.key('up', chunk);
  if (UI.dirty()) redraw();
});

setInterval(function () { if (UI.ticker()) redraw(); }, 33);

redraw();
