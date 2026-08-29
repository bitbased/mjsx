/*
 * shoot.mjs — the documentation screenshot harness.
 *
 *   bun scripts/shoot.mjs <name> <profile> <snippet.jsx|-e "code"> [options]
 *   bun scripts/shoot.mjs --all [--only SUBSTRING]     # the whole doc set
 *   bun scripts/shoot.mjs --list                       # paths + captions
 *
 * Renders an arbitrary mjsx SNIPPET — a .jsx file, or JSX/JS passed
 * inline with -e — headlessly to a PNG at a named device profile, and can
 * inject touches and keystrokes between renders so a shot can capture an
 * INTERACTIVE state: a focused field with its caret, a raised keyboard, a
 * shifted QWERTY, a scrolled list. Static frames cannot document any of
 * that, which is why this exists next to scripts/render-examples.mjs
 * rather than inside it.
 *
 * The render path is the same one the gallery uses: the pure-js backend
 * (backends/pure-js/src/backend.js) draws into an RGB buffer and this file
 * deflates that buffer into a PNG with node's zlib and nothing else — no
 * image library, matching the backend's own no-native-deps stance.
 *
 * What a snippet sees is what a device hands a flat script: h, UI, gfx,
 * sys, Button, Swatch, Modal, Keyboard, ArcFooter, configStorage, em, as
 * globals (backends/pure-js/src/run.js wires exactly these). Two things
 * this harness does that run.js does not:
 *
 *   - FONT metrics are synced from the backend the way the sdl and
 *     terminal entry points do (docs/consistency.md D2: the unsynced
 *     runners lay out 12px/char where the glyph is 7px, which mis-centres
 *     every centred label in the committed gallery). Documentation images
 *     must not show that bug.
 *   - sys.millis() is frozen and advanced only by --advance, so a shot is
 *     byte-identical run to run: the caret blink, the T9 multi-tap window
 *     and the long-press timer are all clock reads.
 *
 * ROUND PROFILES. configStorage's 'round' key is seeded '1' BEFORE the
 * core loads (the same order test/golden/matrix.js uses, because
 * UI.isRound() caches its answer on first read), and the finished PNG is
 * masked to the glass: outside the circle is DIMMED rather than blacked,
 * so content that falls off the rim is still visible as a mistake, and the
 * rim itself is stroked. A round panel drawn as a square rectangle
 * misrepresents the device.
 */
import { readdirSync, statSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { deflateSync } from 'zlib';
import { createRequire } from 'module';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'docs', 'img');
const CORE = join(ROOT, 'packages', 'core', 'src', 'mjsx.js');
const BACKEND = join(ROOT, 'backends', 'pure-js', 'src', 'backend.js');
const EXAMPLES = join(ROOT, 'examples');
const req = createRequire(import.meta.url);

/* ---- device profiles -------------------------------------------------
 * Every panel in the fleet (docs/devices.md's board table), plus a desktop
 * size. Dimensions are LOGICAL pixels — what gfx.width()/height() report
 * and what the layout code branches on.
 */
const PROFILES = {
  round128: { w: 240, h: 240, round: true,
              note: 'ESP32-S3-Touch-LCD-1.28, 240x240 GC9A01 round glass' },
  lcd147:   { w: 172, h: 320,
              note: 'ESP32-S3-Touch-LCD-1.47, 172x320 JD9853' },
  lcd169:   { w: 280, h: 240,
              note: 'ESP32-S3-Touch-LCD-1.69, 240x280 ST7789V2, landscape' },
  lcd35:    { w: 320, h: 480,
              note: 'ESP32-S3-Touch-LCD-3.5, 320x480 ST7796' },
  wide:     { w: 480, h: 320,
              note: 'desktop window / sim default' },
  /* the 1.69" panel in its native portrait orientation — the shape the
     examples were drawn for and the golden matrix's first row */
  lcd169p:  { w: 240, h: 280,
              note: 'ESP32-S3-Touch-LCD-1.69, 240x280 ST7789V2, portrait' }
};

/* ---- RGB -> PNG, pure JS (same technique as render-examples.mjs) ---- */

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return ~c >>> 0;
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/* Truecolour 8-bit PNG: one filter-0 scanline per row, one deflated IDAT. */
function rgbToPng(px, w, h) {
  const stride = w * 3;
  const raw = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (stride + 1)] = 0;
    Buffer.from(px.buffer, px.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 2;  // colour type: truecolour RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0))
  ]);
}

/* Integer nearest-neighbour zoom: pixel-exact, no interpolation, so a
   scaled shot still shows the panel's real pixel grid. */
function upscale(px, w, h, n) {
  if (n <= 1) return { px: px, w: w, h: h };
  const out = new Uint8Array(w * n * h * n * 3);
  for (let y = 0; y < h * n; y++) {
    const sy = (y / n) | 0;
    for (let x = 0; x < w * n; x++) {
      const si = (sy * w + ((x / n) | 0)) * 3, di = (y * w * n + x) * 3;
      out[di] = px[si]; out[di + 1] = px[si + 1]; out[di + 2] = px[si + 2];
    }
  }
  return { px: out, w: w * n, h: h * n };
}

/* ---- round framing ---------------------------------------------------
 * The glass is a circle inscribed in the buffer. Everything outside it is
 * dimmed, not blacked: a label that runs off the rim stays legible in the
 * shot, which is the whole point of looking at a round screenshot. The rim
 * is then stroked so the boundary is unmistakable.
 */
function maskRound(px, w, h, weight) {
  const cx = (w - 1) / 2, cy = (h - 1) / 2;
  const R = Math.min(w, h) / 2;
  const DIM = 0.26;                 /* how much of the outside survives */
  const RIM = [0x98, 0xa1, 0xae];   /* UI.theme.muted — reads as bezel */
  const band = Math.max(1, weight || 1);
  const rr = R - 1 - (band - 1) / 2;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = x - cx, dy = y - cy;
      const d = Math.sqrt(dx * dx + dy * dy);
      let inside = R - d;
      inside = inside < 0 ? 0 : (inside > 1 ? 1 : inside);
      const k = DIM + (1 - DIM) * inside;
      const i = (y * w + x) * 3;
      let r = px[i] * k, g = px[i + 1] * k, b = px[i + 2] * k;
      let a = 1 - Math.abs(d - rr) / (band * 0.9 + 0.6);
      a = a < 0 ? 0 : (a > 1 ? 1 : a) * 0.9;
      if (a > 0) {
        r += (RIM[0] - r) * a; g += (RIM[1] - g) * a; b += (RIM[2] - b) * a;
      }
      px[i] = r < 0 ? 0 : (r > 255 ? 255 : r);
      px[i + 1] = g < 0 ? 0 : (g > 255 ? 255 : g);
      px[i + 2] = b < 0 ? 0 : (b > 255 ? 255 : b);
    }
  }
}

/* ---- is this frame worth committing? ---------------------------------
 * A blank render is the failure mode that looks like success on disk, so
 * every shot reports how much of it is not background and how many colours
 * it carries. Measured BEFORE the round mask, which would otherwise count
 * its own gradient.
 */
function inkStats(px, w, h) {
  const counts = new Map();
  const n = w * h;
  for (let i = 0; i < n; i++) {
    const k = (px[i * 3] << 16) | (px[i * 3 + 1] << 8) | px[i * 3 + 2];
    counts.set(k, (counts.get(k) || 0) + 1);
  }
  let top = 0;
  for (const v of counts.values()) if (v > top) top = v;
  return { colours: counts.size, ink: (n - top) / n };
}

/* ---- one shot --------------------------------------------------------- */

function jsxToJs(code) {
  const t = new Bun.Transpiler({
    loader: 'jsx',
    /* the repo's own tsconfig.json, stated rather than looked up: an
       inline snippet has no directory to inherit it from */
    tsconfig: JSON.stringify({ compilerOptions: { jsx: 'react', jsxFactory: 'h' } })
  });
  return t.transformSync(code);
}

/* Fresh backend + fresh core wired onto the globals, exactly as a device
   hands them to a flat script. Fresh matters: the core is a singleton
   (UI state, module-level keyboard state, the cached isRound answer), so
   one shot's taps must not leak into the next. */
function boot(prof, opts) {
  const backend = req(BACKEND).createPureJsBackend(prof.w, prof.h, {
    font: opts.font || undefined,
    dpr: opts.dpr || 1
  });
  const clock = { t: 0 };
  backend.sys.millis = function () { return clock.t; };
  globalThis.gfx = backend.gfx;
  globalThis.sys = backend.sys;
  /* BEFORE the core loads: UI.isRound() reads configStorage once and
     caches, and a firmware seeds this key at boot for the same reason. */
  if (prof.round) backend.sys.store('round', '1');
  delete req.cache[req.resolve(CORE)];
  const core = req(CORE);
  globalThis.h = core.h;
  globalThis.UI = core.UI;
  globalThis.Button = core.Button;
  globalThis.Swatch = core.Swatch;
  globalThis.em = core.em;
  globalThis.Modal = core.Modal;
  globalThis.Keyboard = core.Keyboard;
  globalThis.ArcFooter = core.ArcFooter;
  globalThis.configStorage = core.configStorage;
  /* what sdl/run.js and the terminal backends do, and what pure-js
     run.js does not — see docs/consistency.md D2 */
  core.FONT.advance = backend.font.advance;
  core.FONT.lineH = backend.font.lineH;
  core.FONT.pick = backend.font.pick || null;

  /* Every drawn string, so --tap-label can find a key by what is written
     on it instead of by a coordinate that moves with the profile. The
     text op stream itself is a capture-mode feature; this wrapper keeps
     the pixels AND records the labels. */
  const labels = [];
  const realText = backend.gfx.text, realClear = backend.gfx.clear;
  backend.gfx.text = function (x, y, size, color, str) {
    labels.push({ x: x, y: y, size: size, str: '' + str });
    return realText.call(backend.gfx, x, y, size, color, str);
  };
  backend.gfx.clear = function (c) { labels.length = 0; return realClear.call(backend.gfx, c); };
  return { backend: backend, core: core, UI: core.UI, clock: clock, labels: labels };
}

/* The control under a drawn label — the key that carries this word.
   The last drawn match wins (the topmost thing, as with taps); a
   trailing "#N" asks for the Nth match in draw order instead, which is
   how the two keys both reading "abc" on a T9 pad are told apart. */
function hitForLabel(t, label) {
  let want = -1;
  const m = /^(.*)#(\d+)$/.exec(label);
  if (m) { label = m[1]; want = parseInt(m[2], 10); }
  const at = [];
  for (let i = 0; i < t.labels.length; i++) if (t.labels[i].str === label) at.push(t.labels[i]);
  const order = want > 0 ? [at[want - 1]] : at.slice().reverse();
  for (let i = 0; i < order.length; i++) {
    if (!order[i]) continue;
    const hit = t.UI._hitAt(order[i].x + 1, order[i].y + 1);
    if (hit) return hit;
  }
  return null;
}

function centreOf(hit) {
  return { x: Math.round(hit.x + hit.w / 2), y: Math.round(hit.y + hit.h / 2) };
}

function tapAt(t, x, y) {
  t.UI.pointer(0, 0, x, y);
  t.UI.pointer(0, 2, x, y);
}

/* A long press, done by the clock rather than by calling the handler: the
   press arms it, 600ms of frozen time pass, one ticker() fires it. */
function holdAt(t, x, y) {
  t.UI.pointer(0, 0, x, y);
  t.clock.t += 600;
  t.UI.ticker();
  t.UI.pointer(0, 2, x, y);
}

function runShot(spec) {
  const prof = PROFILES[spec.profile];
  if (!prof) throw new Error('unknown profile: ' + spec.profile);
  const t = boot(prof, spec);
  const UI = t.UI;

  if (spec.file) {
    const abs = resolve(ROOT, spec.file);
    delete req.cache[req.resolve(abs)];
    req(abs);                       /* runs the snippet's top-level UI.mount */
  } else {
    (0, eval)(jsxToJs(spec.code));
  }
  UI.render();

  for (let i = 0; i < (spec.actions || []).length; i++) {
    const a = spec.actions[i];
    if (a.op === 'focus') UI.focus(a.id);
    else if (a.op === 'blur') UI.blur();
    else if (a.op === 'tap') tapAt(t, a.x, a.y);
    else if (a.op === 'hold') holdAt(t, a.x, a.y);
    else if (a.op === 'tapLabel' || a.op === 'holdLabel') {
      const hit = hitForLabel(t, a.label);
      if (!hit) throw new Error('no control under label ' + JSON.stringify(a.label));
      const c = centreOf(hit);
      (a.op === 'tapLabel' ? tapAt : holdAt)(t, c.x, c.y);
    } else if (a.op === 'key') { UI.key('down', a.key); UI.key('press', a.key); UI.key('up', a.key); }
    else if (a.op === 'type') UI.type(a.text);
    else if (a.op === 'scroll') UI.scrollBy(a.x, a.y, a.dy);
    else if (a.op === 'advance') t.clock.t += a.ms;
    UI.render();
  }

  /* extra ticker+render passes: momentum, timers, anything that settles */
  for (let f = 1; f < (spec.frames || 1); f++) { UI.ticker(); UI.render(); }

  /* The caret is on for half of every 530ms; a still has to choose. The
     default is ON (a focused field should look focused) by putting the
     blink phase back at its start. */
  const fid = UI.focused();
  if (fid && UI._inputs[fid]) {
    UI._inputs[fid].bt = spec.caret === 'off' ? t.clock.t - 530 : t.clock.t;
    UI.render();
  }

  const dpr = spec.dpr || 1;
  const stats = inkStats(t.backend.raw, prof.w * dpr, prof.h * dpr);
  const up = upscale(t.backend.raw, prof.w * dpr, prof.h * dpr, spec.scale || 1);
  const round = spec.round === undefined ? !!prof.round : spec.round;
  if (round) maskRound(up.px, up.w, up.h, dpr * (spec.scale || 1));
  const png = rgbToPng(up.px, up.w, up.h);
  mkdirSync(dirname(spec.out), { recursive: true });
  writeFileSync(spec.out, png);
  return { bytes: png.length, w: up.w, h: up.h, colours: stats.colours, ink: stats.ink };
}

/* ---- CLI -------------------------------------------------------------- */

function parseArgs(argv) {
  const spec = { actions: [], frames: 1, scale: 1, dpr: 1 };
  const pos = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '-e') spec.code = next();
    else if (a === '--topic') spec.topic = next();
    else if (a === '--out') spec.out = next();
    else if (a === '--font') spec.font = next();
    else if (a === '--dpr') spec.dpr = parseInt(next(), 10);
    else if (a === '--scale') spec.scale = parseInt(next(), 10);
    else if (a === '--frames') spec.frames = parseInt(next(), 10);
    else if (a === '--caret') spec.caret = next();
    else if (a === '--round') spec.round = true;
    else if (a === '--square') spec.round = false;
    else if (a === '--allow-blank') spec.allowBlank = true;
    else if (a === '--focus') spec.actions.push({ op: 'focus', id: next() });
    else if (a === '--blur') spec.actions.push({ op: 'blur' });
    else if (a === '--key') spec.actions.push({ op: 'key', key: next() });
    else if (a === '--type') spec.actions.push({ op: 'type', text: next() });
    else if (a === '--advance') spec.actions.push({ op: 'advance', ms: parseInt(next(), 10) });
    else if (a === '--tap-label') spec.actions.push({ op: 'tapLabel', label: next() });
    else if (a === '--hold-label') spec.actions.push({ op: 'holdLabel', label: next() });
    else if (a === '--tap' || a === '--hold') {
      const xy = next().split(',');
      spec.actions.push({ op: a === '--tap' ? 'tap' : 'hold',
                          x: parseInt(xy[0], 10), y: parseInt(xy[1], 10) });
    } else if (a === '--scroll') {
      const s = next().split(',');
      spec.actions.push({ op: 'scroll', x: parseInt(s[0], 10), y: parseInt(s[1], 10),
                          dy: parseInt(s[2], 10) });
    } else pos.push(a);
  }
  spec.name = pos[0];
  spec.profile = pos[1];
  if (pos[2]) spec.file = pos[2];
  return spec;
}

function outPath(spec) {
  if (spec.out) return spec.out;
  const stem = (spec.topic ? spec.topic + '-' : '') + spec.name + '-' + spec.profile;
  return join(OUT, stem + '.png');
}

function report(spec, r) {
  const rel = spec.out.slice(ROOT.length + 1);
  return rel + '  ' + r.w + 'x' + r.h + '  ' + (r.bytes / 1024).toFixed(1) + ' kB' +
         '  colours ' + r.colours + '  ink ' + (r.ink * 100).toFixed(1) + '%';
}

/* ---- the documentation shot list -------------------------------------
 * Every image the docs embed, so `bun scripts/shoot.mjs --all` reproduces
 * docs/img/ from source on a fresh clone. Each entry is exactly what the
 * CLI takes, plus the caption the doc writer gets.
 */

/* A field plus a keyboard, the page every keyboard shot starts from.
   `kh` is the key height wanted; the height PROP is a hint for the whole
   keyboard, so it is derived from the layout's row count. */
function kbPage(layout, kh, pos) {
  const rows = layout === 'strip' ? 2 : 4;
  return "var LAYOUT = '" + layout + "';\n" +
    "UI.mount(function () {\n" +
    "  return h('box', { h: gfx.height(), pad: 6, gap: 6 }, [\n" +
    "    h('text', { text: LAYOUT.toUpperCase(), size: 1, align: 'center', color: UI.theme.muted }),\n" +
    "    h('input', { id: 'f', size: 2, placeholder: 'tap to type' }),\n" +
    "    h('text', { text: 'position \"" + pos + "\": the panel overlays the page, so the ' +\n" +
    "                      'page keeps its full height and a revealed field is kept ' +\n" +
    "                      'out from under it.', size: 1, color: UI.theme.muted, wrap: true })\n" +
    "  , h(Keyboard, { layout: LAYOUT, position: '" + pos + "', height: " +
      (kh * rows + 8 + (rows - 1) * 2) + " })\n" +
    "  ]);\n" +
    "});";
}

/* The same page, with the keyboard left to auto-size from a fraction of
   the display — which is where the auto-exclusive rule bites. */
function kbAutoPage(layout) {
  return "var LAYOUT = '" + layout + "';\n" +
    "UI.mount(function () {\n" +
    "  return h('box', { h: gfx.height(), pad: 6, gap: 6 }, [\n" +
    "    h('text', { text: LAYOUT.toUpperCase(), size: 1, align: 'center', color: UI.theme.muted }),\n" +
    "    h('input', { id: 'f', size: 2, placeholder: 'tap to type' }),\n" +
    "    h(Keyboard, { layout: LAYOUT, position: 'bottom',\n" +
    "                  height: Math.floor(gfx.height() / 2.6) })\n" +
    "  ]);\n" +
    "});";
}

const FIELD_PAGE =
  "UI.mount(function () {\n" +
  "  return h('box', { h: gfx.height(), pad: em(1), gap: em(0.75) }, [\n" +
  "    h('text', { text: 'PROFILE', size: 2, align: 'center', color: UI.theme.accent }),\n" +
  "    h('text', { text: 'NAME', size: 1, color: UI.theme.muted }),\n" +
  "    h('input', { id: 'name', size: 2, placeholder: 'tap to type' }),\n" +
  "    h('text', { text: 'PIN (password, maxLen 6)', size: 1, color: UI.theme.muted }),\n" +
  "    h('input', { id: 'pin', size: 2, password: true, maxLen: 6, placeholder: '******' }),\n" +
  "    h('text', { text: 'NOTE (long text scrolls in the field)', size: 1, color: UI.theme.muted }),\n" +
  "    h('input', { id: 'note', size: 2, placeholder: 'anything' })\n" +
  "  ]);\n" +
  "});";

const FIELD_KB_PAGE =
  "UI.mount(function () {\n" +
  "  var kids = [\n" +
  "    h('text', { text: 'DOCKED ' + (UI.state.pos || 'bottom').toUpperCase(), size: 1,\n" +
  "                align: 'center', color: UI.theme.muted }),\n" +
  "    h('input', { id: 'name', size: 2, placeholder: 'tap to type' }),\n" +
  "    h('text', { text: 'the page keeps its full height under a docked keyboard;\\n' +\n" +
  "                      'an inline one flows like any other child', size: 1,\n" +
  "                color: UI.theme.muted, wrap: true })\n" +
  "  ];\n" +
  "  kids.push(h(Keyboard, { layout: 'qwerty', position: UI.state.pos || 'bottom',\n" +
  "                          height: 4 * 34 + 14 }));\n" +
  "  return h('box', { h: gfx.height(), pad: 6, gap: 6 }, kids);\n" +
  "});";

const BUTTON_PAGE =
  "UI.mount(function () {\n" +
  "  return h('box', { h: gfx.height(), pad: em(1), gap: em(0.75) }, [\n" +
  "    h('text', { text: 'BUTTON', size: 2, align: 'center', color: UI.theme.accent }),\n" +
  "    h(Button, { label: 'DEFAULT', size: 2, onTap: function () {} }),\n" +
  "    h('row', { gap: 6 }, [\n" +
  "      h(Button, { label: 'OK', size: 2, bg: UI.theme.ok, color: 0x0b1220, onTap: function () {} }),\n" +
  "      h(Button, { label: 'WARN', size: 2, bg: UI.theme.warn, color: 0x0b1220, onTap: function () {} }),\n" +
  "      h(Button, { label: 'ERR', size: 2, bg: UI.theme.err, onTap: function () {} })\n" +
  "    ]),\n" +
  "    h(Button, { label: 'ACCENT', size: 2, bg: UI.theme.accent, onTap: function () {} }),\n" +
  "    h('text', { text: 'hitPad 12: the dashed box is the TOUCH target,', size: 1,\n" +
  "                color: UI.theme.muted, wrap: true }),\n" +
  "    h('box', { border: UI.theme.muted, radius: 6, pad: 12 },\n" +
  "      h(Button, { label: 'SMALL', size: 1, pad: 4, hitPad: 12, onTap: function () {} })),\n" +
  "    h('text', { text: 'the filled one is the paint. A fingertip is wider than a cursor.',\n" +
  "                size: 1, color: UI.theme.muted, wrap: true })\n" +
  "  ]);\n" +
  "});";

const ARC_PAGE =
  "UI.mount(function () {\n" +
  "  var items = [];\n" +
  "  var labels = ['<', 'A', 'B', 'C', '>'];\n" +
  "  for (var i = 0; i < labels.length; i++) {\n" +
  "    items.push({ w: 40, h: 32, node: h(Button, { label: labels[i], size: 1, w: 40, h: 32,\n" +
  "                                                 onTap: function () {} }) });\n" +
  "  }\n" +
  "  return h('box', { h: gfx.height(), pad: em(1), gap: em(0.5) }, [\n" +
  "    h('text', { text: 'ARCFOOTER', size: 2, align: 'center', color: UI.theme.accent }),\n" +
  "    h('text', { text: 'one call, both shapes: items sit where the ray from centre meets the boundary',\n" +
  "                size: 1, align: 'center', color: UI.theme.muted, wrap: true }),\n" +
  "    h(ArcFooter, { items: items, at: 90, spread: 120 })\n" +
  "  ]);\n" +
  "});";

const MODAL_PAGE =
  "UI.mount(function () {\n" +
  "  return h('box', { h: gfx.height(), pad: em(1), gap: em(0.5) }, [\n" +
  "    h('text', { text: 'SETTINGS', size: 2, align: 'center', color: UI.theme.accent }),\n" +
  "    h('text', { text: 'the page behind stays on screen: a modal is a component drawn last',\n" +
  "                size: 1, color: UI.theme.muted, wrap: true }),\n" +
  "    h(Button, { label: 'ERASE', size: 2, bg: UI.theme.err, onTap: function () {} })\n" +
  "  ]);\n" +
  "});\n" +
  "UI.openModal(function () {\n" +
  "  return h(Modal, {\n" +
  "    header: h('text', { text: 'ERASE ALL?', size: 2, align: 'center' }),\n" +
  "    footer: h('row', { gap: 6 }, [\n" +
  "      h(Button, { label: 'CANCEL', size: 1, onTap: function () { UI.closeModal(); } }),\n" +
  "      h(Button, { label: 'ERASE', size: 1, bg: UI.theme.err, onTap: function () {} })\n" +
  "    ])\n" +
  "  }, [h('text', { text: 'This clears every stored tag and cannot be undone.',\n" +
  "                  size: 1, color: UI.theme.muted, wrap: true })]);\n" +
  "});";

const SWATCH_PAGE =
  "UI.mount(function () {\n" +
  "  var cols = [UI.theme.accent, UI.theme.ok, UI.theme.warn, UI.theme.err,\n" +
  "              UI.theme.muted, UI.theme.key, UI.theme.panel, UI.theme.text];\n" +
  "  var names = ['accent', 'ok', 'warn', 'err', 'muted', 'key', 'panel', 'text'];\n" +
  "  var rows = [];\n" +
  "  for (var i = 0; i < cols.length; i++) {\n" +
  "    rows.push(h('row', { gap: 8, h: 30 }, [\n" +
  "      h(Swatch, { color: cols[i], size: 24, w: 24 }),\n" +
  "      h('text', { text: names[i], size: 1, middle: true })\n" +
  "    ]));\n" +
  "  }\n" +
  "  return h('box', { h: gfx.height(), pad: em(1), gap: 4 }, [\n" +
  "    h('text', { text: 'SWATCH / THEME', size: 2, align: 'center', color: UI.theme.accent })\n" +
  "  ].concat(rows));\n" +
  "});";

const FLEX_ROW_PAGE =
  "UI.mount(function () {\n" +
  "  function cell(t, p) { return h('box', p, h('text', { text: t, size: 1, align: 'center' })); }\n" +
  "  return h('box', { h: gfx.height(), pad: em(1), gap: em(0.75) }, [\n" +
  "    h('text', { text: 'ROW', size: 2, align: 'center', color: UI.theme.accent }),\n" +
  "    h('text', { text: 'no w: even split', size: 1, color: UI.theme.muted }),\n" +
  "    h('row', { gap: 4 }, [\n" +
  "      cell('A', { bg: UI.theme.key, pad: 8, radius: 4 }),\n" +
  "      cell('B', { bg: UI.theme.key, pad: 8, radius: 4 }),\n" +
  "      cell('C', { bg: UI.theme.key, pad: 8, radius: 4 })\n" +
  "    ]),\n" +
  "    h('text', { text: 'w:56 fixed, rest split the remainder', size: 1, color: UI.theme.muted }),\n" +
  "    h('row', { gap: 4 }, [\n" +
  "      cell('56', { w: 56, bg: UI.theme.accent, pad: 8, radius: 4 }),\n" +
  "      cell('REST', { bg: UI.theme.key, pad: 8, radius: 4 }),\n" +
  "      cell('REST', { bg: UI.theme.key, pad: 8, radius: 4 })\n" +
  "    ]),\n" +
  "    h('text', { text: 'h:56 pinned row: boxes stretch, text centres', size: 1, color: UI.theme.muted }),\n" +
  "    h('row', { gap: 4, h: 56 }, [\n" +
  "      cell('BOX', { bg: UI.theme.key, pad: 8, radius: 4, vcenter: true }),\n" +
  "      h('text', { text: 'MIDDLE', size: 1, align: 'center', middle: true }),\n" +
  "      cell('BOX', { bg: UI.theme.key, pad: 8, radius: 4, vcenter: true })\n" +
  "    ])\n" +
  "  ]);\n" +
  "});";

const FLEX_COL_PAGE =
  "UI.mount(function () {\n" +
  "  return h('box', { h: gfx.height(), pad: em(1), gap: em(0.5) }, [\n" +
  "    h('text', { text: 'FLEX COLUMN', size: 2, align: 'center', color: UI.theme.accent }),\n" +
  "    h('text', { text: 'h pinned: children with flex split the leftover height',\n" +
  "                size: 1, color: UI.theme.muted, wrap: true }),\n" +
  "    h('box', { flex: 1, bg: UI.theme.key, radius: 6, vcenter: true },\n" +
  "      h('text', { text: 'flex 1', size: 2, align: 'center' })),\n" +
  "    h('box', { flex: 2, bg: UI.theme.accent, radius: 6, vcenter: true },\n" +
  "      h('text', { text: 'flex 2', size: 2, align: 'center' })),\n" +
  "    h('box', { h: 40, bg: UI.theme.panel, radius: 6, vcenter: true },\n" +
  "      h('text', { text: 'h 40 (fixed)', size: 1, align: 'center' }))\n" +
  "  ]);\n" +
  "});";

const SCROLL_PAGE =
  "UI.mount(function () {\n" +
  "  var rows = [];\n" +
  "  for (var i = 1; i <= 24; i++) {\n" +
  "    rows.push(h('box', { bg: i % 2 ? UI.theme.panel : UI.theme.key, radius: 4, pad: 8 },\n" +
  "      h('text', { text: 'ROW ' + (i < 10 ? '0' : '') + i, size: 2 })));\n" +
  "  }\n" +
  "  return h('box', { h: gfx.height(), pad: em(1), gap: em(0.5) }, [\n" +
  "    h('text', { text: 'SCROLL ZONE', size: 2, align: 'center', color: UI.theme.accent }),\n" +
  "    h('box', { flex: 1, scroll: 'list', gap: 4 }, rows)\n" +
  "  ]);\n" +
  "});";

const ABS_PAGE =
  "UI.mount(function () {\n" +
  "  var rows = [];\n" +
  "  for (var i = 1; i <= 12; i++) rows.push(h('text', { text: 'page line ' + i, size: 1 }));\n" +
  "  return h('box', { h: gfx.height(), pad: em(1), gap: 4 }, [\n" +
  "    h('text', { text: 'ABS OVERLAY', size: 2, align: 'center', color: UI.theme.accent })\n" +
  "  ].concat(rows).concat([\n" +
  "    h('abs', { x: 0, y: Math.floor(gfx.height() * 0.55), w: gfx.width() },\n" +
  "      h('box', { bg: UI.theme.accent, pad: em(0.75), shield: true },\n" +
  "        h('text', { text: 'abs: absolute screen coords, no flow space, drawn over',\n" +
  "                    size: 1, wrap: true })))\n" +
  "  ]));\n" +
  "});";

const CLIP_PAGE =
  "UI.mount(function () {\n" +
  "  var long = 'this line is far wider than the box that holds it';\n" +
  "  return h('box', { h: gfx.height(), pad: em(1), gap: em(0.75) }, [\n" +
  "    h('text', { text: 'CLIP', size: 2, align: 'center', color: UI.theme.accent }),\n" +
  "    h('text', { text: 'clip: children draw only inside the box', size: 1, color: UI.theme.muted }),\n" +
  "    h('box', { h: 64, clip: true, bg: UI.theme.panel, radius: 6, pad: 6 },\n" +
  "      h('text', { text: long, size: 2, nowrap: true })),\n" +
  "    h('text', { text: 'offX + contentW: the same box as a horizontal scroller',\n" +
  "                size: 1, color: UI.theme.muted, wrap: true }),\n" +
  "    h('box', { h: 64, clip: true, offX: 90, contentW: 900, bg: UI.theme.panel, radius: 6, pad: 6 },\n" +
  "      h('text', { text: long, size: 2, nowrap: true })),\n" +
  "    h('text', { text: 'no clip: the same text truncates to an ellipsis instead',\n" +
  "                size: 1, color: UI.theme.muted, wrap: true }),\n" +
  "    h('box', { h: 64, bg: UI.theme.panel, radius: 6, pad: 6 },\n" +
  "      h('text', { text: long, size: 2 }))\n" +
  "  ]);\n" +
  "});";

/* One page, two shapes. Nothing here asks what the glass is: the safe
   inset and the ArcFooter do it. */
const SHAPE_PAGE =
  "UI.safe = { top: 0, left: 0, bottom: 0, right: 0, inset: UI.isRound() };\n" +
  "UI.mount(function () {\n" +
  "  var rows = [];\n" +
  "  var names = ['PLA MATTE', 'PETG BLACK', 'ABS RED', 'TPU CLEAR', 'PLA SILK'];\n" +
  "  for (var i = 0; i < names.length; i++) {\n" +
  "    rows.push(h('row', { bg: UI.theme.panel, radius: 6, pad: 8, gap: 8, h: 34 }, [\n" +
  "      h(Swatch, { color: [0x4ade80, 0x98a1ae, 0xf87171, 0x4b8bf5, 0xfbbf24][i], size: 18, w: 18 }),\n" +
  "      h('text', { text: names[i], size: 1, middle: true })\n" +
  "    ]));\n" +
  "  }\n" +
  "  return h('box', { h: gfx.height(), pad: em(1), gap: em(0.5) }, [\n" +
  "    h('text', { text: 'SPOOLS', size: 2, align: 'center', color: UI.theme.accent }),\n" +
  "    h('box', { flex: 1, scroll: 'spools', gap: 4 }, rows),\n" +
  "    h(ArcFooter, { items: [\n" +
  "      { w: 44, h: 30, node: h(Button, { label: 'ADD', size: 1, w: 44, h: 30, onTap: function () {} }) },\n" +
  "      { w: 44, h: 30, node: h(Button, { label: 'SCAN', size: 1, w: 44, h: 30,\n" +
  "                                        bg: UI.theme.accent, onTap: function () {} }) },\n" +
  "      { w: 44, h: 30, node: h(Button, { label: 'CFG', size: 1, w: 44, h: 30, onTap: function () {} }) }\n" +
  "    ], at: 90, spread: 100 })\n" +
  "  ]);\n" +
  "});";

const KB_LAYOUTS = ['auto', 'qwerty', 't9', 'numbers', 'strip'];
/* key height per profile: big enough to stay DOCKED (under 30px the
   engine takes the whole display instead, which is its own shot) */
const KB_KH = { lcd35: 42, lcd147: 34, wide: 40, lcd169: 34, lcd169p: 34 };

function shotList() {
  const S = [];
  const add = (topic, name, profile, code, caption, opts) => {
    S.push(Object.assign({ topic: topic, name: name, profile: profile, code: code,
                           caption: caption }, opts || {}));
  };

  /* ---- keyboards ---- */
  for (const p of ['lcd35', 'lcd147']) {
    for (const l of KB_LAYOUTS) {
      add('kb', l, p, kbPage(l, KB_KH[p], 'bottom'),
          'The ' + l.toUpperCase() + ' layout docked at the bottom of ' + p +
          ', field focused; ' + (l === 'auto' ? 'auto picks by the width the keys actually get' :
            'a named layout is honoured exactly'),
          { actions: [{ op: 'focus', id: 'f' }] });
    }
  }
  for (const l of KB_LAYOUTS) {
    add('kb', l, 'round128', kbAutoPage(l),
        'The ' + l.toUpperCase() + ' layout on round glass: the keys come out under a ' +
        'finger height, so the keyboard takes the whole display and insets every row to ' +
        'the chord it actually has — the trapezoid',
        { actions: [{ op: 'focus', id: 'f' }] });
  }
  add('kb', 'qwerty-sym1', 'lcd35', kbPage('qwerty', 42, 'bottom'),
      'QWERTY symbol page 1: the 123 key swaps digits and the common punctuation in',
      { actions: [{ op: 'focus', id: 'f' }, { op: 'tapLabel', label: '123' }] });
  add('kb', 'qwerty-sym2', 'lcd35', kbPage('qwerty', 42, 'bottom'),
      'QWERTY symbol page 2, one #+= further: brackets, backslash, pipe, tilde, backtick — ' +
      'every glyph the face carries is typeable',
      { actions: [{ op: 'focus', id: 'f' }, { op: 'tapLabel', label: '123' },
                  { op: 'tapLabel', label: '#+=' }] });
  add('kb', 'qwerty-shift', 'lcd35', kbPage('qwerty', 42, 'bottom'),
      'QWERTY with shift active: the key lights accent, reads ABC, and every letter ' +
      'uppercases (shift-once, phone style)',
      { actions: [{ op: 'focus', id: 'f' }, { op: 'tapLabel', label: 'abc' }] });
  add('kb', 'qwerty-typed', 'lcd35', kbPage('qwerty', 42, 'bottom'),
      'Keys reaching the field: taps on the glass arrive as UI.key presses, same road ' +
      'as a physical board',
      { actions: [{ op: 'focus', id: 'f' }, { op: 'tapLabel', label: 'm' },
                  { op: 'tapLabel', label: 'j' }, { op: 'tapLabel', label: 's' },
                  { op: 'tapLabel', label: 'x' }] });
  add('kb', 't9-multitap', 'lcd35', kbPage('t9', 42, 'bottom'),
      'T9 mid-cycle: two taps on the same key inside the 900ms window replace a with b, ' +
      'and the key holds the accent while the window is open',
      { actions: [{ op: 'focus', id: 'f' }, { op: 'tapLabel', label: 'abc#1' },
                  { op: 'tapLabel', label: 'abc#1' }] });
  add('kb', 't9-symbols', 'lcd35', kbPage('t9', 42, 'bottom'),
      'The T9 symbol pad, a long press of abc away: each key multi-taps a themed set, ' +
      'so the whole face is reachable from nine keys',
      { actions: [{ op: 'focus', id: 'f' }, { op: 'holdLabel', label: 'abc' }] });
  add('kb', 'strip-symbols', 'lcd35', kbPage('strip', 42, 'bottom'),
      'The STRIP symbol row, also a long press of abc: one scrolling row of characters, ' +
      'drag to scroll, tap to type',
      { actions: [{ op: 'focus', id: 'f' }, { op: 'holdLabel', label: 'abc' }] });
  add('kb', 'exclusive', 'lcd147', kbAutoPage('auto'),
      'The auto-exclusive state: on a 172x320 panel a docked keyboard\'s keys land under ' +
      '30px, so the keyboard takes the whole display and mirrors the focused field above ' +
      'the keys (the x key closes it)',
      { actions: [{ op: 'focus', id: 'f' }] });
  add('kb', 'exclusive-typed', 'lcd147', kbAutoPage('auto'),
      'The same full-display keyboard with text in the mirror: the mirror shares the ' +
      'original field\'s id, so it IS the field — same text, same caret',
      { actions: [{ op: 'focus', id: 'f' }, { op: 'type', text: 'hello' }] });
  add('kb', 'exclusive', 'lcd35',
      "UI.mount(function () {\n" +
      "  return h('box', { h: gfx.height(), pad: em(1), gap: em(0.75) }, [\n" +
      "    h('text', { text: 'EXCLUSIVE', size: 2, align: 'center', color: UI.theme.accent }),\n" +
      "    h('input', { id: 'f', size: 2, placeholder: 'tap to type', label: 'SSID',\n" +
      "                 exclusive: true }),\n" +
      "    h(Keyboard, { layout: 'qwerty', position: 'bottom', height: 4 * 42 + 14 })\n" +
      "  ]);\n" +
      "});",
      'exclusive={true} asks for the same takeover on a panel that had room to dock: ' +
      'the field is mirrored above the keys and the page behind is gone',
      { actions: [{ op: 'focus', id: 'f' }, { op: 'type', text: 'garage-2g' }] });

  /* ---- inputs ---- */
  add('input', 'empty', 'lcd35', FIELD_PAGE,
      'Fields at rest: muted border, placeholder text, no caret — nothing is focused');
  add('input', 'focused', 'lcd35', FIELD_PAGE,
      'The focused field: accent border, caret at the insertion point, placeholder gone',
      { actions: [{ op: 'focus', id: 'name' }] });
  add('input', 'caret-mid', 'lcd35', FIELD_PAGE,
      'The caret placed inside existing text — five ArrowLefts back from the end; ' +
      'typing inserts there',
      { actions: [{ op: 'focus', id: 'name' }, { op: 'type', text: 'HELLO WORLD' },
                  { op: 'key', key: 'ArrowLeft' }, { op: 'key', key: 'ArrowLeft' },
                  { op: 'key', key: 'ArrowLeft' }, { op: 'key', key: 'ArrowLeft' },
                  { op: 'key', key: 'ArrowLeft' }] });
  add('input', 'password', 'lcd35', FIELD_PAGE,
      'password={true}: every character masked with * as it is typed, caret still ' +
      'tracking the real length',
      { actions: [{ op: 'focus', id: 'pin' }, { op: 'type', text: '1234' }] });
  add('input', 'maxlen', 'lcd35', FIELD_PAGE,
      'maxLen reached: the field holds six characters and the next eight keystrokes ' +
      'change nothing',
      { actions: [{ op: 'focus', id: 'pin' }, { op: 'type', text: '1234567890abcd' }] });
  add('input', 'overflow', 'lcd35', FIELD_PAGE,
      'Text longer than the field: the view follows the caret, so the end is shown and ' +
      'the start has scrolled out to the left',
      { actions: [{ op: 'focus', id: 'note' },
                  { op: 'type', text: 'the quick brown fox jumps over the lazy dog' }] });
  add('input', 'kb-bottom', 'lcd35', FIELD_KB_PAGE,
      'position="bottom": the keyboard is an overlay pinned to the screen edge, the page ' +
      'keeps its full height, and the inset keeps a revealed field out from under it',
      { actions: [{ op: 'focus', id: 'name' }] });
  add('input', 'kb-inline', 'lcd35',
      FIELD_KB_PAGE.replace("UI.state.pos || 'bottom'", "'inline'"),
      'position="inline": the same keyboard as an ordinary child in the flow — it takes ' +
      'layout space instead of covering the page',
      { actions: [{ op: 'focus', id: 'name' }] });
  add('input', 'empty', 'round128', FIELD_PAGE,
      'The same field page on round glass, unfocused: the corners the layout cannot use');
  add('input', 'focused', 'lcd147', FIELD_PAGE,
      'A focused field on the 172x320 panel — the narrowest glass in the fleet',
      { actions: [{ op: 'focus', id: 'name' }] });

  /* ---- fonts ---- */
  const FONT_FACES = ['auto', '4x6', '6x8', '12x16'];
  for (const f of FONT_FACES) {
    add('font', f, 'lcd35', null,
        f === 'auto'
          ? 'The AUTO ladder (the default): every text size picks the sharpest native ' +
            'font that fits it — 4x6 at size 1, 6x8 at size 2, 12x16 at size 3'
          : 'The ' + f + ' face pinned for every size (--font=' + f + '): sizes 1, 2 and 3 ' +
            'are the same glyphs scaled 1x, 2x, 3x',
        { file: 'examples/fonts/app.jsx', font: f === 'auto' ? undefined : f });
    add('font', f + '-charset', 'lcd35', null,
        (f === 'auto' ? 'The AUTO ladder' : 'The ' + f + ' face') +
        ', scrolled to the glyph repertoire: the full uppercase, lowercase, digit and ' +
        'punctuation set the face carries',
        { file: 'examples/fonts/app.jsx', font: f === 'auto' ? undefined : f,
          actions: [{ op: 'scroll', x: 160, y: 240, dy: 300 }] });
  }
  add('font', 'auto', 'round128', null,
      'The font page on round glass: em() spacing follows the picked face, so the same ' +
      'source lays out for the smaller panel without a size in it changing',
      { file: 'examples/fonts/app.jsx' });

  /* ---- components ---- */
  add('comp', 'button', 'lcd35', BUTTON_PAGE,
      'Button: the default key colour, the theme colours passed as bg, and a small ' +
      'button whose hitPad grows the touch target past the paint (the outlined box)');
  add('comp', 'button', 'round128', BUTTON_PAGE,
      'The same button page on round glass');
  add('comp', 'arcfooter', 'round128', ARC_PAGE,
      'ArcFooter on round glass: five items on the bottom arc, each pulled in from the ' +
      'rim by its own size, all upright');
  add('comp', 'arcfooter', 'lcd35', ARC_PAGE,
      'The identical ArcFooter call on a rectangle: the boundary is the perimeter, so ' +
      'the arc becomes the bottom edge and a wide spread walks the corners');
  add('comp', 'arcfooter', 'wide', ARC_PAGE,
      'The same call again on a 480x320 desktop window');
  add('comp', 'modal', 'lcd35', MODAL_PAGE,
      'Modal: a centred panel over the page it interrupts, with sticky header and footer ' +
      'rows. Everything under it stops listening');
  add('comp', 'modal', 'round128', MODAL_PAGE,
      'The same modal on round glass — margins are minimums, so the panel keeps clear ' +
      'of the rim');
  add('comp', 'swatch', 'lcd35', SWATCH_PAGE,
      'Swatch, and with it the whole of UI.theme: the eight colours every built-in ' +
      'component reads');

  /* ---- layout ---- */
  add('layout', 'row', 'lcd35', FLEX_ROW_PAGE,
      'row: children side by side — even split, a fixed w with the rest sharing the ' +
      'remainder, and a pinned-height row where boxes stretch and text centres');
  add('layout', 'column', 'lcd35', FLEX_COL_PAGE,
      'box with a pinned h as a flex column: flex weights split the leftover height, a ' +
      'fixed h takes its own');
  add('layout', 'scroll-top', 'lcd35', SCROLL_PAGE,
      'A scroll zone at the top of its content: 24 rows in a viewport, clipped to the box');
  add('layout', 'scroll-mid', 'lcd35', SCROLL_PAGE,
      'The same zone scrolled 220px down — drawing and hit areas both move, and the ' +
      'offset persists across renders',
      { actions: [{ op: 'scroll', x: 160, y: 300, dy: 220 }] });
  add('layout', 'abs', 'lcd35', ABS_PAGE,
      'abs: an overlay at absolute screen coordinates that takes no flow space, so the ' +
      'page under it is laid out as though it were not there');
  add('layout', 'clip', 'lcd35', CLIP_PAGE,
      'clip, offX/contentW, and no clip at all: the same over-wide line confined, ' +
      'slid sideways, and truncated with the ellipsis glyph');
  add('layout', 'scroll-end', 'round128', SCROLL_PAGE,
      'The round end-margin: every scroll zone on round glass gets a quarter-screen of ' +
      'extra range at the end, so the last rows can be lifted out of the narrow bottom ' +
      'arc into the wide middle',
      { actions: [{ op: 'scroll', x: 120, y: 150, dy: 4000 }] });
  add('layout', 'scroll-end', 'lcd35', SCROLL_PAGE,
      'The same zone scrolled to its end on square glass, for comparison: the last row ' +
      'stops at the bottom edge with no extra margin',
      { actions: [{ op: 'scroll', x: 160, y: 300, dy: 4000 }] });

  /* ---- round design: one page, two shapes ---- */
  add('round', 'page', 'lcd35', SHAPE_PAGE,
      'One page, square glass: full-bleed rows, the ArcFooter riding the bottom edge');
  add('round', 'page', 'round128', SHAPE_PAGE,
      'The identical source on round glass: UI.safe.inset holds the rows inside the ' +
      'chord, the footer follows the rim, and the corners stay empty because they do ' +
      'not exist');
  add('round', 'page-scrolled', 'round128', SHAPE_PAGE,
      'The same round page scrolled to the end of its list, showing the end margin that ' +
      'lifts the last row out of the bottom arc',
      { actions: [{ op: 'scroll', x: 120, y: 140, dy: 4000 }] });

  /* ---- the examples, per profile ---- */
  const exNames = readdirSync(EXAMPLES).filter((n) =>
    statSync(join(EXAMPLES, n)).isDirectory() && existsSync(join(EXAMPLES, n, 'app.jsx'))).sort();
  for (const n of exNames) {
    const cap = exampleCaption(n);
    for (const p of ['lcd35', 'lcd147', 'round128']) {
      add('ex', n, p, null, cap, { file: 'examples/' + n + '/app.jsx' });
    }
  }

  for (const s of S) {
    s.out = join(OUT, s.topic + '-' + s.name + '-' + s.profile + '.png');
  }
  return S;
}

/* The example's own one-line description, from the header comment: the
   caption should say what the source says. */
function exampleCaption(name) {
  const src = readFileSync(join(EXAMPLES, name, 'app.jsx'), 'utf8').split('\n');
  let line = '';
  for (let i = 1; i < src.length && i < 6; i++) {
    const s = src[i].replace(/^\s*\*\s?/, '').trim();
    if (s && s !== '/*') { line = s; break; }
  }
  line = line.replace(/[:\-—]$/, '').trim();
  return 'examples/' + name + ': ' + line;
}

/* ---- main ------------------------------------------------------------- */

const argv = process.argv.slice(2);

if (argv[0] === '--list' || argv[0] === '--all') {
  const only = argv.indexOf('--only') >= 0 ? argv[argv.indexOf('--only') + 1] : null;
  const shots = shotList().filter((s) => !only || s.out.indexOf(only) >= 0);
  if (argv[0] === '--list') {
    for (const s of shots) {
      console.log(s.out.slice(ROOT.length + 1) + '\t' + s.topic + '\t' + s.caption);
    }
    process.exit(0);
  }
  mkdirSync(OUT, { recursive: true });
  const failed = [];
  const thin = [];
  for (const s of shots) {
    let r = null, err = null;
    try { r = runShot(s); } catch (e) { err = e; }
    if (err) {
      failed.push(s.out + ': ' + err.message);
      console.log('FAIL ' + s.out.slice(ROOT.length + 1) + '  ' + err.message);
      continue;
    }
    if (r.ink < 0.005 || r.colours < 3) thin.push(s.out + ' (ink ' + (r.ink * 100).toFixed(2) + '%)');
    console.log('ok   ' + report(s, r));
  }
  console.log('\n' + (shots.length - failed.length) + '/' + shots.length + ' shots -> ' + OUT);
  if (thin.length) console.log('SUSPECT (blank or near-blank):\n  ' + thin.join('\n  '));
  if (failed.length) { console.log('FAILED:\n  ' + failed.join('\n  ')); process.exit(1); }
  process.exit(0);
}

const spec = parseArgs(argv);
if (!spec.name || !spec.profile || (!spec.file && !spec.code)) {
  console.error('usage: bun scripts/shoot.mjs <name> <profile> <snippet.jsx|-e "code"> [options]');
  console.error('       bun scripts/shoot.mjs --all [--only SUBSTRING]');
  console.error('       bun scripts/shoot.mjs --list');
  console.error('profiles: ' + Object.keys(PROFILES).map(
    (k) => k + ' ' + PROFILES[k].w + 'x' + PROFILES[k].h + (PROFILES[k].round ? ' round' : '')
  ).join(', '));
  console.error('options : --topic T --out PATH --font 4x6|5x7|6x8|12x16 --dpr N --scale N');
  console.error('          --frames N --caret on|off --round|--square --allow-blank');
  console.error('actions : --focus ID --tap X,Y --tap-label TEXT --hold X,Y --hold-label TEXT');
  console.error('          --key NAME --type TEXT --scroll X,Y,DY --advance MS --blur');
  console.error('          (applied in the order given, with a render after each)');
  process.exit(1);
}
spec.out = outPath(spec);
const r = runShot(spec);
console.log(report(spec, r));
if (!spec.allowBlank && (r.ink < 0.005 || r.colours < 3)) {
  console.error('SUSPECT: that frame is blank or near-blank');
  process.exit(2);
}
