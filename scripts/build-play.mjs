#!/usr/bin/env bun
/*
 * Bundle the engine for the browser simulator, and collect the examples
 * it can load.
 *
 *   bun scripts/build-play.mjs
 *     -> site/public/mjsx-sim.js     rasterizer + JSX transpiler + engine
 *     -> site/public/examples.json   every examples/<name>/app.jsx, verbatim
 *
 * The core is appended as a STRING rather than bundled as a module, because
 * the simulator needs a fresh engine per run and a browser has no
 * require.cache to drop. See backends/http/src/client-sim.js.
 *
 * The example sources are shipped as data for the same reason the figures
 * carry their ops: the page should serve the real file, not a copy someone
 * pasted into the HTML and forgot to update.
 */
import { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, statSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ENTRY = join(ROOT, 'backends/http/src/client-sim.js');
const CORE = join(ROOT, 'packages/core/src/mjsx.js');
const EXAMPLES = join(ROOT, 'examples');
const OUT = join(ROOT, 'site/public/mjsx-sim.js');
const EX_OUT = join(ROOT, 'site/public/examples.json');

/* ---- the bundle ---- */
const built = await Bun.build({
  entrypoints: [ENTRY],
  target: 'browser',
  format: 'iife',
  minify: true
});
if (!built.success) {
  for (const log of built.logs) console.error(log);
  process.exit(1);
}

const coreSrc = readFileSync(CORE, 'utf8');
const text = await built.outputs[0].text();
/* the assignment goes FIRST: mjsxFreshCore reads MJSX_CORE_SRC when it
   runs, but a page that calls it immediately on load should not have to
   care about statement order */
const out = 'globalThis.MJSX_CORE_SRC = ' + JSON.stringify(coreSrc) + ';\n' + text;
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, out);

/* ---- the examples ---- */
const HEADLINE = {
  /* one line each, for the picker — the file's own opening comment is
     usually a design essay, which is too long for a menu */
  hello: 'The smallest thing that draws.',
  counter: 'State, a button, and a re-render.',
  input: 'Text fields, focus and the keyboard.',
  canvas: 'Drawing with a palette and an arc footer.',
  draw: 'Strokes, fills and slot chips.',
  layers: 'Stacking, absolute positioning and clipping.',
  shapes: 'Every primitive the contract provides.',
  fonts: 'The bitmap faces and their metrics.',
  sensors: 'Motion as a level, a trace and numbers.',
  screen: 'Panel settings and rotation.',
  wifi: 'Network scan, join and status.',
  camera: 'A frame source, where one exists.',
  gpio: 'Pins in and out.',
  i2c: 'Bus scan and register peek.',
  layout: 'Rows, columns, flex and scroll.'
};

const examples = [];
if (existsSync(EXAMPLES)) {
  for (const name of readdirSync(EXAMPLES).sort()) {
    const dir = join(EXAMPLES, name);
    if (!statSync(dir).isDirectory()) continue;
    const app = join(dir, 'app.jsx');
    if (!existsSync(app)) continue;
    const src = readFileSync(app, 'utf8');
    examples.push({
      name: name,
      source: src,
      lines: src.split('\n').length,
      blurb: HEADLINE[name] || '',
      /* which examples need a native the browser does not have. They still
         run — each draws its own labelled fallback — but the picker should
         say so rather than let it look broken. */
      needsHardware: /sys\.(imu|gpio|i2c|camera|wifi)\b/.test(src)
    });
  }
}
/* ---- the launcher ----------------------------------------------------
 * The same shape that ships to a demo board. packages/cli/src/bundle.js
 * builds a device bundle as: the core and shim, then one
 * `EXAMPLES.push([name, function () { ...app... }])` per example, then
 * backends/esp32/tools/device-menu.js — which mounts a list, and on a tap
 * calls UI.reset() and runs that example's function, with a floating dot
 * and Escape to come back.
 *
 * No dynamic import anywhere, on a device or here: every example is
 * already in the bundle as a lazy function, and picking one calls it.
 * MicroQuickJS has no module loader, which is exactly why the device does
 * it this way.
 *
 * device-menu.js is included VERBATIM rather than reimplemented, so the
 * launcher in the browser cannot drift from the one on the glass. The
 * example bodies are spliced in by the page from the sources it already
 * has, so this carries the menu only and nothing is stored twice.
 */
const MENU = join(ROOT, 'backends/esp32/tools/device-menu.js');
if (existsSync(MENU)) {
  const head =
    '/*\n' +
    ' * Every example, in one app — the launcher a demo board runs.\n' +
    ' *\n' +
    ' * This is generated the way packages/cli/src/bundle.js generates a\n' +
    ' * device bundle: each example becomes a lazy function in EXAMPLES, and\n' +
    ' * the menu below (backends/esp32/tools/device-menu.js, verbatim) calls\n' +
    ' * one when you tap it. Tap the dot, press Escape, or swipe in from the\n' +
    ' * edge to come back. No dynamic import: MicroQuickJS has no module\n' +
    ' * loader, so nothing is fetched — it is all already here.\n' +
    ' *\n' +
    ' * Editable like any other example. _deviceSafe() below reserves the\n' +
    ' * demo board\'s bezel; set those to 0 to use the whole panel.\n' +
    ' */\n' +
    '/* the one device native the menu calls that a browser has no use for */\n' +
    'var __replayFeed = function () {};\n\n' +
    'var EXAMPLES = [];\n';
  examples.push({
    name: 'menu',
    /* spliced by the page: EXAMPLES.push(...) for each example goes here */
    source: head + '/*__EXAMPLES__*/\n\n' + readFileSync(MENU, 'utf8'),
    lines: 0,
    blurb: 'Every example in one app — the launcher a demo board runs.',
    needsHardware: false,
    synthetic: true
  });
}

writeFileSync(EX_OUT, JSON.stringify(examples));

console.log('wrote ' + OUT + '  ' + Math.round(out.length / 1024) + ' kB' +
            '  (engine ' + Math.round(coreSrc.length / 1024) + ' kB as source)');
console.log('wrote ' + EX_OUT + '  ' + examples.length + ' example(s)');
