/*
 * Terminal-backend smoke suite: every examples/<name>/app.jsx, run through
 * backends/terminal/src/run.js in all three render modes, headlessly.
 *
 * Why a spawn per example rather than one in-process loop: mjsx-core is a
 * singleton (one UI, one FONT, module-level keyboard state) and examples
 * are flat scripts that mount at require time. A fresh process is the only
 * way to be sure example N+1 is not passing because of state example N left
 * behind — and it makes the pass/fail signal the thing a user actually
 * cares about, the process's exit code.
 *
 * The sweep is driven by run.js's headless flags (--frames=N --no-tty):
 * N frames rasterized and ANSI-encoded with the ticker drained between
 * them, no tty required, a real exit code at the end. Anything an example
 * throws — at mount, in a render, or in a timer callback — leaves the
 * process non-zero and fails the test here.
 */
import { test, expect } from 'bun:test';
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const RUN = path.join(ROOT, 'backends', 'terminal', 'src', 'run.js');
const EXAMPLES_DIR = path.join(ROOT, 'examples');
const BUN = process.execPath; // the bun running these tests, not whatever is on PATH

const examples = fs.readdirSync(EXAMPLES_DIR).filter(function (name) {
  return fs.existsSync(path.join(EXAMPLES_DIR, name, 'app.jsx'));
}).sort();

function run(args, env) {
  const r = Bun.spawnSync({
    cmd: [BUN, RUN].concat(args),
    cwd: ROOT,
    stdout: 'pipe',
    stderr: 'pipe',
    env: Object.assign({}, process.env, env || {})
  });
  return { code: r.exitCode, out: r.stdout.toString(), err: r.stderr.toString() };
}

function runExample(name, args, env) {
  return run([path.join(EXAMPLES_DIR, name, 'app.jsx')].concat(args), env);
}

/* Assert on a string rather than the number so a failure prints the child's
   stderr — an exit code alone tells you nothing about which line threw. */
function expectClean(r) {
  expect(r.code === 0 ? '' : 'exit ' + r.code + '\n' + r.err.slice(0, 1200)).toBe('');
}

/* Distinct SGR colour codes in a frame, either palette (24-bit 38;2;r;g;b
   when COLORTERM says truecolor, xterm-256 38;5;n otherwise). One colour
   means the terminal was painted a single flat rectangle — i.e. the app
   laid out to nothing. Two or more means something was actually drawn. */
function paletteSize(ansi) {
  const seen = {};
  const re = /\x1b\[[34]8;(?:2;\d+;\d+;\d+|5;\d+)m/g;
  let m;
  while ((m = re.exec(ansi))) seen[m[0]] = 1;
  return Object.keys(seen).length;
}

test('the sweep sees every examples/*/app.jsx', () => {
  expect(examples.length).toBeGreaterThan(0);
  // Two the repo has always had — a zero-length or mis-rooted listing would
  // otherwise make every sweep below pass by sweeping nothing.
  expect(examples).toContain('hello');
  expect(examples).toContain('counter');
});

/* pixel mode — the default: two vertical sub-pixels per cell, text
   rasterized through the bitmap font. Run WITHOUT --no-tty so the frames
   land on stdout and the same spawn can prove the app drew something, not
   just that it survived. */
for (const name of examples) {
  test('examples/' + name + ': renders on the terminal backend (pixel)', () => {
    const r = runExample(name, ['80', '24', '--frames=3']);
    expectClean(r);
    expect(r.out.indexOf('\x1b[H')).toBeGreaterThanOrEqual(0); // a frame, cursor-homed
    expect(paletteSize(r.out)).toBeGreaterThan(1);
  });
}

/* char mode: one pixel per cell, labels stamped as real terminal characters
   over the grid — a completely different text path (FONT.advance 1,
   FONT.lineH 1, the clip-aware stamp loop in toAnsi). */
for (const name of examples) {
  test('examples/' + name + ': renders on the terminal backend (char)', () => {
    const r = runExample(name, ['80', '24', '--frames=3', '--no-tty', '--char']);
    expectClean(r);
    expect(r.out).toContain('rendered 3 frames 80x24 (char)');
  });
}

/* block mode: one pixel drawn as two cells wide, no half-block glyph at
   all. Widened to 120 columns because the horizontal halving leaves an
   80-column terminal a 40-pixel-wide device — see the counter caveat. */
for (const name of examples) {
  test('examples/' + name + ': renders on the terminal backend (block)', () => {
    const r = runExample(name, ['120', '24', '--frames=3', '--no-tty', '--block']);
    expectClean(r);
    expect(r.out).toContain('rendered 3 frames 60x24 (block)');
  });
}

/* The bitmap-font ladder is a backend option (pixel/block rasterize text
   themselves); a font whose metrics disagree with what FONT.advance told
   the layout is exactly the kind of thing that only shows up at render. */
for (const font of ['4x6', '6x8', '12x16']) {
  test('font ' + font + ': every example still renders', () => {
    for (const name of examples) {
      const r = runExample(name, ['120', '40', '--frames=2', '--no-tty', '--font=' + font]);
      expect(r.code === 0 ? '' : name + ' exit ' + r.code + '\n' + r.err.slice(0, 800)).toBe('');
    }
  }, 30000);
}

test('headless mode needs no tty and still builds every ANSI frame', () => {
  const r = runExample('hello', ['60', '20', '--frames=5', '--no-tty']);
  expectClean(r);
  expect(r.out).toContain('rendered 5 frames 60x20 (pixel)');
  // The encoder ran even though nothing was written to stdout: the byte
  // count is the sum of the frames it built.
  const bytes = parseInt(/(\d+) bytes/.exec(r.out)[1], 10);
  expect(bytes).toBeGreaterThan(1000);
  expect(r.out.indexOf('\x1b[H')).toBe(-1); // ...and no escape soup escaped
});

test('--frames takes its count as a separate argument too, without eating cols/rows', () => {
  const r = runExample('hello', ['--frames', '4', '--no-tty', '60', '20']);
  expectClean(r);
  expect(r.out).toContain('rendered 4 frames 60x20 (pixel)');
});

test('a bare run still writes one frame to stdout, exactly as before', () => {
  const r = runExample('hello', ['60', '20']);
  expectClean(r);
  expect(r.out.slice(0, 3)).toBe('\x1b[H');
  expect(r.out).toContain('\x1b[0m');
  expect(paletteSize(r.out)).toBeGreaterThan(1);
});

test('both colour paths emit a full frame (COLORTERM decides which)', () => {
  const t = runExample('shapes', ['60', '20'], { COLORTERM: 'truecolor' });
  expectClean(t);
  expect(/\x1b\[[34]8;2;\d+;\d+;\d+m/.test(t.out)).toBe(true);
  const p = runExample('shapes', ['60', '20'], { COLORTERM: '' });
  expectClean(p);
  expect(/\x1b\[[34]8;5;\d+m/.test(p.out)).toBe(true);
});

test('an example exporting demo() gets driven headlessly', () => {
  const r = runExample('counter', ['80', '24', '--frames=3', '--no-tty']);
  expectClean(r);
  /* stdERR: stdout is the frame here, so an APP's console (the demo hook
     included) is routed to stderr by the runner -- a greeting printed
     into stdout lands in the middle of the picture. See run.js. */
  expect(r.err).toContain('count is now 1'); // counter's demo taps its own Button
});

test('no example argument: usage on stderr, non-zero exit', () => {
  const r = run([]);
  expect(r.code).not.toBe(0);
  expect(r.err).toContain('usage:');
});

/* Runner wiring, end to end: configStorage is a bare global under a flat
   MicroQuickJS eval, so the CommonJS runner has to hoist it — and it is
   only useful if the backend's sys.store/sys.fetch actually round-trip.
   A stub pair (store swallows, fetch answers '') reads back as "never set",
   which looks like an app bug rather than a missing native. */
test('an example may use configStorage: the global is wired and settings round-trip', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mjsx-term-'));
  const app = path.join(dir, 'app.js');
  fs.writeFileSync(app,
    'if (typeof configStorage === "undefined") throw new Error("configStorage is not a global");\n' +
    'configStorage.set("probe.key", "kept");\n' +
    'if (configStorage.get("probe.key", "") !== "kept") throw new Error("settings did not round-trip");\n' +
    'if (configStorage.get("probe.missing", "dflt") !== "dflt") throw new Error("unset key lost its default");\n' +
    'UI.mount(function () { return h("text", { text: configStorage.get("probe.key", "?") }); });\n');
  try {
    const r = run([app, '60', '20', '--frames=2', '--no-tty']);
    expectClean(r);
    expect(r.out).toContain('rendered 2 frames');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

/* Backend surface, in process — the ten-call gfx contract mjsx-core is
   allowed to assume, plus the geometry each mode reports. */
const { createTerminalBackend } = require(path.join(ROOT, 'backends', 'terminal', 'src', 'backend.js'));

test('the ten-call gfx contract is complete in every mode', () => {
  const TEN = ['clear', 'rect', 'frect', 'circle', 'line', 'text', 'clip', 'unclip', 'width', 'height'];
  for (const mode of ['pixel', 'char', 'block']) {
    const b = createTerminalBackend(40, 10, { mode: mode });
    for (const call of TEN) {
      expect(mode + '.' + call + ':' + typeof b.gfx[call]).toBe(mode + '.' + call + ':function');
    }
    // and every one of them survives being called, clipped and unclipped
    b.gfx.clear(0x101010);
    b.gfx.clip(1, 1, 20, 6);
    b.gfx.frect(0, 0, 12, 4, 0x224466, 2);
    b.gfx.rect(2, 2, 10, 5, 0xffcc00, 1);
    b.gfx.circle(8, 4, 3, 0x44dd88, true);
    b.gfx.line(0, 0, 39, 9, 0xff0000);
    b.gfx.text(1, 1, 1, 0xffffff, 'hi 123');
    b.gfx.unclip();
    expect(typeof b.toAnsi()).toBe('string');
  }
});

test('each mode reports the geometry it actually draws in', () => {
  const px = createTerminalBackend(80, 24, { mode: 'pixel' });
  expect([px.gfx.width(), px.gfx.height(), px.xSub, px.ySub]).toEqual([80, 48, 1, 2]);
  const ch = createTerminalBackend(80, 24, { mode: 'char' });
  expect([ch.gfx.width(), ch.gfx.height(), ch.xSub, ch.ySub]).toEqual([80, 24, 1, 1]);
  const bl = createTerminalBackend(80, 24, { mode: 'block' });
  expect([bl.gfx.width(), bl.gfx.height(), bl.xSub, bl.ySub]).toEqual([40, 24, 2, 1]);
  // character rows out, whatever the sub-pixel height: one \r\n per row
  for (const b of [px, ch, bl]) {
    b.gfx.clear(0x000000);
    expect(b.toAnsi().split('\r\n').length - 1).toBe(24);
  }
});

test('sys.store / sys.fetch round-trip within a session', () => {
  const b = createTerminalBackend(40, 10);
  expect(b.sys.fetch('nothing.here')).toBe('');
  b.sys.store('k', 'v');
  expect(b.sys.fetch('k')).toBe('v');
  b.sys.store('k', 7); // strings on the wire, like every other host
  expect(b.sys.fetch('k')).toBe('7');
});
