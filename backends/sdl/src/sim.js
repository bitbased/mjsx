/*
 * Device simulator: examples in a native 240x240 rounded-corner window —
 * the "what would this look like on a real panel" one-liner.
 *
 *   bun run sim                  the example picker menu
 *   bun run sim counter          straight into one example
 *   bun run sim -- --circle      round display (GC9A01-style)
 *   bun run sim counter 320 240 2 --radius=16
 *
 * Esc returns to the menu, q quits. Same optional-SDL2 rules as run.js —
 * this is the only mjsx backend with a native dependency.
 */
var fs = require('fs');
var path = require('path');

var flagArgs = process.argv.slice(2).filter(function (a) { return a.slice(0, 2) === '--'; });
var numArgs = process.argv.slice(2).filter(function (a) { return a.slice(0, 2) !== '--'; });

var exampleName = numArgs[0] && !/^\d+$/.test(numArgs[0]) ? numArgs.shift() : null;
var pxW = parseInt(numArgs[0] || '240', 10);
var pxH = parseInt(numArgs[1] || '240', 10);
var scale = parseInt(numArgs[2] || '3', 10);

/* Rounded corners BY DEFAULT — that's what the simulated hardware looks
   like. --square turns it off, --circle previews a round display,
   --radius=N picks a different corner. */
var mask = 24;
for (var fi = 0; fi < flagArgs.length; fi++) {
  if (flagArgs[fi] === '--circle') mask = 'circle';
  else if (flagArgs[fi] === '--square') mask = undefined;
  else if (flagArgs[fi].slice(0, 9) === '--radius=') mask = parseInt(flagArgs[fi].slice(9), 10);
}
var snapScale = flagArgs.indexOf('--free') === -1;

var win;
try {
  win = require('./window.js').createSdlWindow(pxW, pxH, {
    scale: scale, snapScale: snapScale, mask: mask,
    title: 'mjsx sim ' + pxW + 'x' + pxH
  });
} catch (e) {
  console.error('Could not open an SDL2 window: ' + e.message);
  console.error('  macOS:        brew install sdl2');
  console.error('  Debian/Pi:    sudo apt install libsdl2-2.0-0');
  console.error('  Windows:      put SDL2.dll next to the binary');
  process.exit(1);
}

var backend = require('../../pure-js/src/backend.js').createPureJsBackend(pxW, pxH);
globalThis.gfx = backend.gfx;
globalThis.sys = backend.sys;

var core = require('../../../packages/core/src/mjsx.js');
globalThis.h = core.h;
globalThis.UI = core.UI;
globalThis.Button = core.Button;
globalThis.Swatch = core.Swatch;
globalThis.em = core.em;

var EXAMPLES_DIR = path.resolve(__dirname, '../../../examples');
var examples = fs.readdirSync(EXAMPLES_DIR).filter(function (name) {
  return fs.existsSync(path.join(EXAMPLES_DIR, name, 'app.jsx'));
}).sort();

/* Same fresh-require trick as the terminal launcher: repeat picks must
   re-run the example's top-level UI.mount. */
function loadExample(name) {
  var file = path.join(EXAMPLES_DIR, name, 'app.jsx');
  delete require.cache[require.resolve(file)];
  require(file);
}

function Menu() {
  var kids = [
    h('text', { text: 'MJSX SIM', size: 2, align: 'center', color: UI.theme.accent }),
    h('spacer', { h: em(0.5) })
  ];
  for (var i = 0; i < examples.length; i++) {
    kids.push(h(Button, {
      label: examples[i], size: 1, pad: em(0.75),
      onTap: (function (name) { return function () { loadExample(name); }; })(examples[i])
    }));
  }
  kids.push(h('spacer', { h: em(0.5) }));
  kids.push(h('text', { text: 'esc: menu   q: quit', size: 1, color: UI.theme.muted, align: 'center' }));
  return h('box', { pad: em(2), gap: em(0.75), h: gfx.height(), scroll: 'menu' }, kids);
}

function showMenu() { UI.mount(Menu); }
if (exampleName) {
  if (examples.indexOf(exampleName) === -1) {
    console.error('no example "' + exampleName + '" — have: ' + examples.join(', '));
    win.destroy();
    process.exit(1);
  }
  loadExample(exampleName);
} else {
  showMenu();
}

var MOUSE = 'mouse';
var lastX = pxW >> 1, lastY = pxH >> 1;

function pixels() {
  var ppm = backend.toPPM();
  var idx = 0, newlines = 0;
  while (newlines < 3) { if (ppm[idx++] === 10) newlines++; }
  return ppm.subarray(idx);
}

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
    else if (ev.type === 'keydown') {
      if (ev.key === 'escape') { showMenu(); }
      else if (ev.key === 'q') { win.destroy(); process.exit(0); }
      else { if (!ev.repeat) UI.key('down', ev.key); UI.key('press', ev.key); }
    }
    else if (ev.type === 'keyup') { if (ev.key !== 'escape' && ev.key !== 'q') UI.key('up', ev.key); }
    if (ev.x !== undefined) { lastX = ev.x; lastY = ev.y; }
  }
  if (UI.ticker() || UI.dirty()) {
    UI.render();
    win.present(pixels());
  }
}

UI.render();
win.present(pixels());
setInterval(frame, 33);
