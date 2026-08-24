/*
 * Run an mjsx example in a native pixel window — the pixel preview with no
 * browser and no terminal tricks. Rendering is the pure-js backend's RGB
 * buffer, blitted into an SDL2 window; input is SDL's real mouse, wheel and
 * keyboard relayed through the exact same UI.pointer/UI.key/UI.scrollBy
 * calls every other host uses.
 *
 *   bun run.js <example.jsx> [pxW] [pxH] [scale] [--circle | --radius=N] [--free]
 *
 * This backend is OPTIONAL. It is the only part of mjsx that touches a
 * system library (SDL2, loaded at runtime via bun:ffi — no compile step, no
 * npm native modules), and nothing else imports it: skip it and mjsx has no
 * native dependencies at all. A `bun build --compile` of this file is still
 * a single self-contained binary — it just expects libSDL2 on the machine
 * it runs on (brew install sdl2 / apt install libsdl2-2.0-0).
 */
var path = require('path');
var flagArgs = process.argv.slice(2).filter(function (a) { return a.slice(0, 2) === '--'; });
var numArgs = process.argv.slice(2).filter(function (a) { return a.slice(0, 2) !== '--'; });
var exampleFile = numArgs[0];
var pxW = parseInt(numArgs[1] || '240', 10);
var pxH = parseInt(numArgs[2] || '240', 10);
var scale = parseInt(numArgs[3] || '3', 10);
/* --circle previews a round display; --radius=N rounded corners; --free
   disables integer scale snapping when the window is resized. */
var mask, fontName = '4x6';
for (var fi = 0; fi < flagArgs.length; fi++) {
  if (flagArgs[fi] === '--circle') mask = 'circle';
  else if (flagArgs[fi].slice(0, 9) === '--radius=') mask = parseInt(flagArgs[fi].slice(9), 10);
  else if (flagArgs[fi].slice(0, 7) === '--font=') fontName = flagArgs[fi].slice(7);
}
var snapScale = flagArgs.indexOf('--free') === -1;

if (!exampleFile) {
  console.error('usage: bun run.js <example.jsx> [pxW] [pxH] [scale]');
  process.exit(1);
}

var win;
try {
  win = require('./window.js').createSdlWindow(pxW, pxH, { scale: scale, snapScale: snapScale, mask: mask, title: 'mjsx — ' + path.basename(path.dirname(path.resolve(exampleFile))) });
} catch (e) {
  console.error('Could not open an SDL2 window: ' + e.message);
  console.error('');
  console.error('This backend needs the SDL2 system library (the only optional');
  console.error('native dependency in mjsx — every other backend runs without it):');
  console.error('  macOS:        brew install sdl2');
  console.error('  Debian/Pi:    sudo apt install libsdl2-2.0-0');
  console.error('  Windows:      put SDL2.dll next to the binary');
  process.exit(1);
}

var backend = require('../../pure-js/src/backend.js').createPureJsBackend(pxW, pxH, { font: fontName });
globalThis.gfx = backend.gfx;
globalThis.sys = backend.sys;

var core = require('../../../packages/core/src/mjsx.js');
globalThis.h = core.h;
globalThis.UI = core.UI;
globalThis.Button = core.Button;
globalThis.Swatch = core.Swatch;
globalThis.em = core.em;
core.FONT.advance = backend.font.advance;
core.FONT.lineH = backend.font.lineH;

require(path.resolve(exampleFile));

var MOUSE = 'mouse';

function frame() {
  var events = win.poll();
  for (var i = 0; i < events.length; i++) {
    var ev = events[i];
    if (ev.type === 'quit') { win.destroy(); process.exit(0); }
    else if (ev.type === 'redraw') UI._dirty = true;
    else if (ev.type === 'down') UI.pointer(MOUSE, 0, ev.x, ev.y);
    else if (ev.type === 'drag') UI.pointer(MOUSE, 1, ev.x, ev.y);
    else if (ev.type === 'up') UI.pointer(MOUSE, 2, ev.x, ev.y);
    else if (ev.type === 'wheel') UI.scrollBy(lastX, lastY, -ev.dy * 8);
    else if (ev.type === 'keydown') { if (!ev.repeat) UI.key('down', ev.key); UI.key('press', ev.key); }
    else if (ev.type === 'keyup') UI.key('up', ev.key);
    if (ev.x !== undefined) { lastX = ev.x; lastY = ev.y; }
  }
  if (UI.ticker() || UI.dirty()) {
    UI.render();
    win.present(backend.px || backendPixels());
  }
}
var lastX = pxW >> 1, lastY = pxH >> 1;

/* The pure-js backend exposes its buffer through toPPM(); strip the ASCII
   header once per frame rather than teaching it a second accessor. */
function backendPixels() {
  var ppm = backend.toPPM();
  var idx = 0, newlines = 0;
  while (newlines < 3) { if (ppm[idx++] === 10) newlines++; }
  return ppm.subarray(idx);
}

UI.render();
win.present(backendPixels());
setInterval(frame, 33);
