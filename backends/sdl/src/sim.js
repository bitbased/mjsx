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
if (process.argv.indexOf('--landscape') !== -1 && pxH > pxW) { var _t = pxW; pxW = pxH; pxH = _t; }

/* Rounded corners BY DEFAULT — that's what the simulated hardware looks
   like. --square turns it off, --circle previews a round display,
   --radius=N picks a different corner. The toolbar's SHAPE button cycles
   the same three live. */
var SHAPES = [
  { name: 'RND', mask: 24 },
  { name: 'CIR', mask: 'circle' },
  { name: 'SQR', mask: undefined }
];
var shapeIdx = 0;
for (var fi = 0; fi < flagArgs.length; fi++) {
  if (flagArgs[fi] === '--circle') shapeIdx = 1;
  else if (flagArgs[fi] === '--square') shapeIdx = 2;
  else if (flagArgs[fi].slice(0, 9) === '--radius=') SHAPES[0].mask = parseInt(flagArgs[fi].slice(9), 10);
}
var SIZES = [[240, 240], [240, 320], [172, 320], [128, 128], [320, 480]];
var snapScale = flagArgs.indexOf('--free') === -1;
/* HD: precise rendering — same virtual panel, backing buffer at the window
   scale, so shapes rasterize with real sub-pixel geometry instead of
   blown-up pixels. Toggled from the toolbar; --hd starts on. */
var hd = flagArgs.indexOf('--hd') !== -1;
/* Host-font text: captured text ops composited with a real system
   monospace via SDL2_ttf, fitted to the mjsx grid. --hostfont starts on;
   the TXT toolbar button toggles live; --fontfile=path picks the face. */
var hostText = flagArgs.indexOf('--hostfont') !== -1;
var fontFile;
for (var hfi = 0; hfi < flagArgs.length; hfi++) {
  if (flagArgs[hfi].slice(0, 11) === '--fontfile=') fontFile = flagArgs[hfi].slice(11);
}
var ttfMod = require('./ttf.js');
var ttfFaces = null, faceIdx = 0;
var ttf = null;
function ttfReady() {
  if (ttf === null) {
    if (!ttfFaces) {
      ttfFaces = ttfMod.availableFaces(flagArgs.indexOf('--systemfonts') !== -1);
      /* --fontface=NAME picks the starting face; --fontfile beats both */
      for (var tfi = 0; tfi < flagArgs.length; tfi++) {
        if (flagArgs[tfi].slice(0, 11) === '--fontface=') {
          var want = flagArgs[tfi].slice(11).toUpperCase();
          for (var wj = 0; wj < ttfFaces.length; wj++) if (ttfFaces[wj].name === want) faceIdx = wj;
        }
      }
    }
    ttf = ttfMod.createTtfText(fontFile || (ttfFaces[faceIdx] && ttfFaces[faceIdx].file));
    if (!ttf.ok) console.error('host font unavailable: ' + ttf.err);
  }
  return ttf.ok;
}
var fontScale = 'vector';
for (var fsi = 0; fsi < flagArgs.length; fsi++) {
  if (flagArgs[fsi].slice(0, 12) === '--fontscale=') fontScale = flagArgs[fsi].slice(12);
}
/* HD dpr = the window scale. Full device-pixel HD (x the display's retina
   factor) quadruples the pixels to rasterize and blows the frame budget
   once a drawing has a few dozen strokes (measured 70ms/frame at dpr 6);
   at dpr = scale the GPU's linear upscale covers the last 2x with no
   visible cost. --hd2 opts into true device-pixel HD anyway. */
var hd2 = flagArgs.indexOf('--hd2') !== -1;

/* --http[=port]: serve the SAME running sim to browsers -- a live mirror
   of the panel (frames out, touches/keys in), phone-testable over the
   LAN, mobile OSK included. Default port 8080. */
var httpPort = 0;
for (var hpi = 0; hpi < flagArgs.length; hpi++) {
  if (flagArgs[hpi] === '--http') httpPort = 8080;
  else if (flagArgs[hpi].slice(0, 7) === '--http=') httpPort = parseInt(flagArgs[hpi].slice(7), 10) || 8080;
}
var mirror = null;
if (httpPort) {
  mirror = require('../../http/src/mirror.js').createMirror({
    port: httpPort,
    /* route through globalThis.UI at CALL time -- freshCore swaps the
       core identity under us on every example load. Web pointer ids get
       their own namespace so a browser drag and a window drag can run
       at once without fighting over one stroke. */
    pointer: function (id, phase, x, y) {
      UI.pointer('web:' + id, phase, x, y);
      if (UI.dirty()) render();
    },
    key: function (type, key) { UI.key(type, key); if (UI.dirty()) render(); },
    wheel: function (x, y, dy) { UI.scrollBy(x, y, dy > 0 ? 24 : -24); if (UI.dirty()) render(); },
    connect: function () { render(); }
  });
  console.log('mirror: http://localhost:' + httpPort + '  (--http=PORT to change)');
}
function dprNow() {
  if (!hd) return 1;
  var ds = hd2 && typeof win !== 'undefined' && win ? win.drawableScale() : 1;
  return scale * ds;
}

/* Three font sizes, cycled by the toolbar's FONT button: tiny hand-drawn
   4x6, clear 6x8, large Scale2x-smoothed 12x16. --font=NAME picks the
   start. */
var FONT_CYCLE = ['auto', '4x6', '6x8', '12x16'];
var fontName = 'auto';
for (var ffi = 0; ffi < flagArgs.length; ffi++) {
  if (flagArgs[ffi].slice(0, 7) === '--font=' && FONT_CYCLE.indexOf(flagArgs[ffi].slice(7)) !== -1) {
    fontName = flagArgs[ffi].slice(7);
  }
}

var TB_H = 12, TB_SCALE = 2;
var createSdlWindow = require('./window.js').createSdlWindow;
var createPureJsBackend = require('../../pure-js/src/backend.js').createPureJsBackend;

function openWindow() {
  return createSdlWindow(pxW, pxH, {
    scale: scale, snapScale: snapScale, mask: SHAPES[shapeIdx].mask,
    toolbarH: TB_H, toolbarScale: TB_SCALE, texScale: dprNow(),
    title: 'mjsx sim ' + pxW + 'x' + pxH
  });
}

var win;
try {
  win = openWindow();
} catch (e) {
  console.error('Could not open an SDL2 window: ' + e.message);
  console.error('  macOS:        brew install sdl2');
  console.error('  Debian/Pi:    sudo apt install libsdl2-2.0-0');
  console.error('  Windows:      put SDL2.dll next to the binary');
  process.exit(1);
}

/* The window exists now, so dprNow() includes the real drawable scale —
   retune the texture before the first present. */
if (hd) win.setScreenSize(pxW, pxH, dprNow());
function backendOpts() {
  return { font: fontName === 'auto' ? undefined : fontName, dpr: dprNow(), fontScale: fontScale,
           textMode: hostText ? 'capture' : undefined };
}
var backend = createPureJsBackend(pxW, pxH, backendOpts());
globalThis.gfx = backend.gfx;
globalThis.sys = backend.sys;

/* Each example gets a FRESH core module — a brand-new UI singleton, so no
   JS state (UI.state, scroll offsets, onTick/onKey handlers, timers) can
   cross from one example to the next. The only remaining shared surface is
   globalThis itself, exactly like flashing a new script to a device. On
   MicroQuickJS hosts the same two levels exist: UI.reset() within one
   persistent context (cheap), or tearing the context down and calling
   JS_NewContext on a fresh arena (hard isolation — the engine supports it,
   and even several arenas at once; RAM is the only real budget). */
/* --safe=8 or --safe=top,left,bottom,right: edge bands where the panel
   being simulated has unreliable touch. Applied to every fresh core so
   layout, overlays and touch clamping all honour it, exactly as they
   would on the device. */
var safeBands = null;
for (var sfi = 0; sfi < flagArgs.length; sfi++) {
  if (flagArgs[sfi].slice(0, 7) === '--safe=') {
    var sfp = flagArgs[sfi].slice(7).split(',').map(function (n) { return parseInt(n, 10) || 0; });
    safeBands = sfp.length === 1
      ? { top: sfp[0], left: sfp[0], bottom: sfp[0], right: sfp[0] }
      : { top: sfp[0] || 0, left: sfp[1] || 0, bottom: sfp[2] || 0, right: sfp[3] || 0 };
  }
}

var CORE = require.resolve('../../../packages/core/src/mjsx.js');
var curCore = null;
function freshCore() {
  delete require.cache[CORE];
  var core = curCore = require(CORE);
  globalThis.h = core.h;
  globalThis.UI = core.UI;
  globalThis.Button = core.Button;
  globalThis.Swatch = core.Swatch;
  globalThis.em = core.em;
  globalThis.Modal = core.Modal;
globalThis.Keyboard = core.Keyboard;
  /* Every fresh core learns the current font's metrics, so em() spacing and
     fitText widths always match what the backend actually rasterizes. */
  if (safeBands) core.UI.safe = safeBands;
  if (mirror) core.UI.onFocusChange = function (id) { mirror.focus(!!id); };
  if (typeof backend !== 'undefined' && backend.font) {
    core.FONT.advance = backend.font.advance;
    core.FONT.lineH = backend.font.lineH;
    core.FONT.pick = backend.font.pick || null;
  }
  return core;
}
freshCore();

var EXAMPLES_DIR = path.resolve(__dirname, '../../../examples');
var examples = fs.readdirSync(EXAMPLES_DIR).filter(function (name) {
  return fs.existsSync(path.join(EXAMPLES_DIR, name, 'app.jsx'));
}).sort();

/* Same fresh-require trick as the terminal launcher: repeat picks must
   re-run the example's top-level UI.mount. */
function loadExample(name) {
  freshCore();
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
      onTap: (function (name) { return function () { current = name; loadExample(name); }; })(examples[i])
    }));
  }
  kids.push(h('spacer', { h: em(0.5) }));
  kids.push(h('text', { text: 'esc: menu   q: quit', size: 1, color: UI.theme.muted, align: 'center' }));
  return h('box', { pad: em(2), gap: em(0.75), h: gfx.height(), scroll: 'menu' }, kids);
}

function showMenu() { current = null; freshCore(); UI.mount(Menu); }
var current = null;
if (exampleName) {
  if (examples.indexOf(exampleName) === -1) {
    console.error('no example "' + exampleName + '" — have: ' + examples.join(', '));
    win.destroy();
    process.exit(1);
  }
  current = exampleName;
  loadExample(exampleName);
} else {
  showMenu();
}

/* ---- toolbar: its own little pixel strip, drawn with the shared bitmap
   font through a second (instance-scoped) pure-js backend. Buttons carry
   their hit ranges out of the draw — same drawn-box-is-hit-box rule the
   main framework lives by. ---- */
var tb = null, tbW = 0, tbHits = [];
function toolbarFrame() {
  var w = win.toolbarWidth();
  if (!tb || tbW !== w) { tb = createPureJsBackend(w, TB_H); tbW = w; }
  tb.gfx.clear(0x14161b);
  tbHits = [];
  var x = 2;
  function btn(label, fn) {
    var bw = label.length * 5 + 5;
    tb.gfx.frect(x, 1, bw, TB_H - 2, 0x2a2d36);
    tb.gfx.text(x + 3, 3, 1, 0xd8dce4, label);
    tbHits.push({ x: x, w: bw, fn: fn });
    x += bw + 4;
  }
  btn('RESTART', function () {
    if (current) loadExample(current); else showMenu();
  });
  btn('MENU', showMenu);
  btn('SHAPE:' + SHAPES[shapeIdx].name, function () {
    shapeIdx = (shapeIdx + 1) % SHAPES.length;
    rebuild();
  });
  btn(pxW + 'X' + pxH, function () {
    /* Advance through the presets, carrying the current orientation with
       us — a preset matches whichever way round it is being shown. */
    var landscape = pxW > pxH;
    var idx = 0;
    for (var si = 0; si < SIZES.length; si++) {
      if ((SIZES[si][0] === pxW && SIZES[si][1] === pxH) ||
          (SIZES[si][0] === pxH && SIZES[si][1] === pxW)) idx = si;
    }
    var next = SIZES[(idx + 1) % SIZES.length];
    pxW = landscape ? Math.max(next[0], next[1]) : Math.min(next[0], next[1]);
    pxH = landscape ? Math.min(next[0], next[1]) : Math.max(next[0], next[1]);
    rebuild();
  });
  btn('ROT', function () {
    /* Portrait <-> landscape: the same panel turned 90 degrees. */
    var t = pxW; pxW = pxH; pxH = t;
    rebuild();
  });
  btn('FONT:' + fontName.toUpperCase(), function () {
    fontName = FONT_CYCLE[(FONT_CYCLE.indexOf(fontName) + 1) % FONT_CYCLE.length];
    rebuild();
  });
  btn('HD:' + (hd ? 'ON' : 'OFF'), function () {
    hd = !hd;
    rebuild();
  });
  btn('TXT:' + (hostText ? 'TTF' : 'BMP'), function () {
    if (!hostText && !ttfReady()) return; /* stay on bitmap if SDL2_ttf is missing */
    hostText = !hostText;
    rebuild();
  });
  if (hostText && ttfFaces && ttfFaces.length > 1 && !fontFile) {
    btn('FACE:' + ttfFaces[faceIdx].name, function () {
      faceIdx = (faceIdx + 1) % ttfFaces.length;
      ttf = ttfMod.createTtfText(ttfFaces[faceIdx].file);
      if (!ttf.ok) console.error('host font unavailable: ' + ttf.err);
      UI._dirty = true;
    });
  }
  var ppm = tb.toPPM(), idx = 0, nl = 0;
  while (nl < 3) { if (ppm[idx++] === 10) nl++; }
  return ppm.subarray(idx);
}

/* Swap the simulated panel INSIDE the same OS window — the window keeps
   its size and position and simply letterboxes the new screen. sys
   deliberately survives too — a fresh epoch would strand every pending
   UI.setTimer. The current example (or menu) is re-run at the new
   dimensions, exactly as it would boot on that panel. */
function rebuild() {
  win.setMask(SHAPES[shapeIdx].mask);
  win.setScreenSize(pxW, pxH, dprNow());
  backend = createPureJsBackend(pxW, pxH, backendOpts());
  globalThis.gfx = backend.gfx;
  /* The RUNNING app is kept, not re-run: immediate mode means the next
     render simply lays out on the new surface, and everything the user
     had -- state, scroll positions, half-typed inputs, drawn strokes --
     survives an HD toggle, a font change, even a resize or rotation.
     The only real coupling is font metrics, re-taught to the live core;
     RESTART is there for an actual reboot. */
  if (!UI.root) {
    if (current) loadExample(current); else showMenu();
  } else if (curCore && backend.font) {
    curCore.FONT.advance = backend.font.advance;
    curCore.FONT.lineH = backend.font.lineH;
    curCore.FONT.pick = backend.font.pick || null;
  }
  UI._dirty = true;
}

var MOUSE = 'mouse';
var lastX = pxW >> 1, lastY = pxH >> 1;
var shiftHeld = false;

function pixels() {
  /* the live framebuffer, in place - no per-frame copy. The TTF composite
     draws into it too; the next render repaints from scratch anyway. */
  var frame = backend.raw;
  if (hostText && ttfReady()) {
    ttf.composite(frame, pxW * dprNow(), pxH * dprNow(), backend.textOps, dprNow());
  }
  return frame;
}

function frame() {
  var events = win.poll();
  for (var i = 0; i < events.length; i++) {
    var ev = events[i];
    if (ev.type === 'quit') { win.destroy(); process.exit(0); }
    else if (ev.type === 'redraw') UI._dirty = true;
    else if (ev.target === 'toolbar') {
      if (ev.type === 'down') {
        for (var bi = 0; bi < tbHits.length; bi++) {
          if (ev.x >= tbHits[bi].x && ev.x < tbHits[bi].x + tbHits[bi].w) { tbHits[bi].fn(); break; }
        }
        UI._dirty = true;
      }
    }
    else if (ev.type === 'down') UI.pointer(MOUSE, 0, ev.x, ev.y);
    else if (ev.type === 'drag') UI.pointer(MOUSE, 1, ev.x, ev.y);
    else if (ev.type === 'up') UI.pointer(MOUSE, 2, ev.x, ev.y);
    else if (ev.type === 'wheel') UI.scrollBy(lastX, lastY, -ev.dy * 8);
    else if (ev.type === 'keydown') {
      if (ev.key === 'Shift') shiftHeld = true;
      /* While an input is focused, typing belongs to it: Escape blurs
         (mjsx-core does that) instead of jumping to the menu, and 'q'
         is a letter, not the quit key. Printable characters arrive via
         SDL's TEXTINPUT (shift and layout applied) -- keydown relays
         only the named keys, so nothing is delivered twice. */
      var typing = UI.focused && UI.focused();
      if (ev.key === 'Escape' && !typing) { showMenu(); }
      else if (ev.key === 'q' && !typing) { win.destroy(); process.exit(0); }
      else if (ev.key.length > 1) {
        /* SDL reports no modifier on the Tab event itself -- the tracked
           shift state composes the ShiftTab the core's focus nav reads */
        var kk = ev.key === 'Tab' && shiftHeld ? 'ShiftTab' : ev.key;
        if (!ev.repeat) UI.key('down', kk);
        UI.key('press', kk);
      }
      else if (!typing) { if (!ev.repeat) UI.key('down', ev.key); UI.key('press', ev.key); }
    }
    else if (ev.type === 'text') {
      if (UI.focused && UI.focused()) {
        for (var tci = 0; tci < ev.text.length; tci++) UI.key('press', ev.text.charAt(tci));
      }
    }
    else if (ev.type === 'keyup') {
      if (ev.key === 'Shift') shiftHeld = false;
      if (ev.key !== 'Escape' && ev.key !== 'q') UI.key('up', ev.key);
    }
    if (ev.x !== undefined) { lastX = ev.x; lastY = ev.y; }
  }
  if (UI.ticker() || UI.dirty()) render();
}

/* One render, both displays: the OS window and every connected browser
   get the same frame. */
function render() {
  UI.render();
  win.present(pixels(), toolbarFrame());
  if (mirror) {
    var d = backend.dpr || 1;
    mirror.frame(backend.raw, pxW * d, pxH * d, pxW, pxH);
  }
}

render();
setInterval(frame, 33);
