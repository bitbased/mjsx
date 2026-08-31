/*
 * Run one mjsx example straight to this terminal.
 *   bun run.js <example.jsx> [cols] [rows]
 * Ctrl-C to exit; renders once and (if the example ticks) again on a timer.
 *
 * Flags (all optional, all off by default — bare invocation behaves exactly
 * as it always did):
 *   --char | --block | --font=NAME   pick the backend render mode / bitmap font
 *   --frames=N                       render N frames, draining UI.ticker()
 *                                    between them, then exit 0
 *   --interval=MS                    ms between those frames (default 33, the
 *                                    same cadence interactive.js ticks at) —
 *                                    real elapsed time, so sys.millis() moves
 *                                    and timers actually come due
 *   --no-tty                         headless: still rasterize and still build
 *                                    every ANSI frame (that path is half the
 *                                    backend), but keep the escape soup off
 *                                    stdout and print one summary line instead
 *
 * --frames + --no-tty together are the sweep mode the example smoke test
 * drives: no terminal required, a real exit code, and every gfx op plus the
 * ANSI encoder actually executed.
 */
var path = require('path');

/* Flags may carry their value attached (--frames=5) or as the next argv
   entry (--frames 5); either way it must not fall through to the bare
   [cols] [rows] positionals, so argv is walked in order rather than
   partitioned. Unvalued flags (--no-tty, --char) never eat the next arg. */
var VALUED = { frames: 1, interval: 1, font: 1 };
var argv = process.argv.slice(2);
var flagVals = {}, positional = [];
for (var ai = 0; ai < argv.length; ai++) {
  var a = argv[ai];
  if (a.slice(0, 2) !== '--') { positional.push(a); continue; }
  var eq = a.indexOf('=');
  var name = eq === -1 ? a.slice(2) : a.slice(2, eq);
  if (eq !== -1) flagVals[name] = a.slice(eq + 1);
  else if (VALUED[name] && ai + 1 < argv.length) flagVals[name] = argv[++ai];
  else flagVals[name] = true;
}
function flagValue(name, dflt) {
  return flagVals[name] === undefined || flagVals[name] === true ? dflt : flagVals[name];
}
function hasFlag(name) { return flagVals[name] !== undefined; }

var exampleFile = positional[0];
var framesRaw = flagValue('frames', null);
var headless = hasFlag('no-tty') || hasFlag('headless');
var frames = framesRaw === null ? 1 : Math.max(1, parseInt(framesRaw, 10) || 1);
var interval = parseInt(flagValue('interval', '33'), 10) || 33;
var fontName = flagValue('font', 'auto');
var pxMode = (hasFlag('char') || hasFlag('cell')) ? 'char' : (hasFlag('block') ? 'block' : 'pixel');

/* positional[0] is the example; [1] and [2] are cols/rows. Without a tty
   process.stdout.columns is undefined, so the fallbacks have to be real
   numbers rather than NaN — a NaN width silently makes a zero-pixel canvas. */
var cols = parseInt(positional[1] || String(process.stdout.columns || 60), 10);
var rows = parseInt(positional[2] || String((process.stdout.rows || 24) - 1), 10);

if (!exampleFile) {
  console.error('usage: bun run.js <example.jsx> [cols] [rows] [--frames=N] [--no-tty] [--char|--block] [--font=NAME]');
  process.exit(1);
}

var backend = require('./backend.js').createTerminalBackend(cols, rows, {
  mode: pxMode, font: fontName === 'auto' ? undefined : fontName
});
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
globalThis.ArcFooter = core.ArcFooter;
/* Flat-eval parity: under MicroQuickJS the core is eval'd whole, so
   configStorage is simply a global an example can name (docs/contract.md).
   Under CommonJS it is a module export, and a runner that forgets to hoist
   it turns any `configStorage.get(...)` in an example into a
   ReferenceError — on the host where the example was supposed to be
   developable. */
globalThis.configStorage = core.configStorage;

/* The RUNNER's own status line still goes to the real console (and so to
   stdout, after the frame, which is where the tests read it). Only the
   APP's console is redirected below -- taking the global away from the
   runner too is a mistake worth naming: it silently swallowed every
   `rendered N frames` line. */
var hostLog = console.log.bind(console);

/* An app's console goes to STDERR here, because stdout is the frame.
   The terminal backend paints by writing escape sequences to stdout, so a
   console.log from the example lands in the middle of the picture — the
   frame starts with a cursor-home and an app that greeted on open pushed
   it down a line. stderr keeps `bun run.js ... > frame.txt` clean while
   the message is still right there in the terminal.

   Same createLog every other host uses, so a line formats identically
   wherever it is read (docs/logging.md). */
var appLog = require('../../../packages/core/src/log.js').createLog({
  sinks: 'serial',
  write: function (t) { process.stderr.write(t); }
});
globalThis.console = appLog.console;
globalThis.mjsxLog = appLog;

// Text is real characters in the terminal's own font, not sub-pixel art —
// one character wide, two sub-pixel rows tall (a character cell holds two
// vertical half-blocks). mjsx-core's default FONT assumes a 6px bitmap
// glyph; this is the override point it was built for.
core.FONT.advance = backend.font.advance;
core.FONT.lineH = backend.font.lineH;
core.FONT.quantum = backend.font.quantum;
core.FONT.pick = backend.font.pick || null;
core.UI.scrollQuantum = backend.ySub;

require(path.resolve(exampleFile));

var mod = require.cache[require.resolve(path.resolve(exampleFile))];
var demo = mod && mod.exports && typeof mod.exports.demo === 'function' ? mod.exports.demo : null;

function emit() {
  var frame = backend.toAnsi(); // built either way: the encoder is under test too
  if (!headless) process.stdout.write(frame);
  return frame.length;
}

UI.render();
var bytes = emit();

if (frames > 1) {
  /* Headless sweep: N frames on a real timer, so sys.millis() actually
     advances and anything animating (UI.setTimer, flings, sensor polls)
     runs its callbacks instead of sitting frozen at t=0. Errors thrown in
     those callbacks stay uncaught on purpose — a non-zero exit is the whole
     signal this mode exists to produce. */
  var drawn = 1;
  if (demo) { demo(UI, backend); UI.dirty(); }
  var timer = setInterval(function () {
    if (UI.ticker() || UI.dirty()) UI.render();
    bytes += emit();
    drawn++;
    if (drawn >= frames) {
      clearInterval(timer);
      if (headless) {
        hostLog('rendered ' + drawn + ' frame' + (drawn === 1 ? '' : 's') + ' ' +
          backend.width + 'x' + backend.height + ' (' + backend.mode + ') ' + bytes + ' bytes');
      } else {
        process.stdout.write('\n');
      }
    }
  }, interval);
} else if (headless) {
  if (demo) { demo(UI, backend); if (UI.dirty()) UI.render(); bytes += emit(); }
  hostLog('rendered 1 frame ' + backend.width + 'x' + backend.height +
    ' (' + backend.mode + ') ' + bytes + ' bytes');
} else if (demo) {
  setTimeout(function () {
    demo(UI, backend);
    if (UI.dirty()) UI.render();
    emit();
    process.stdout.write('\n');
  }, 600);
} else {
  process.stdout.write('\n');
}
