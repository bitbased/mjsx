/*
 * Test loader. Wires a pure-js backend and a FRESH copy of mjsx-core onto
 * the globals, the same way backends/pure-js/src/run.js does for a device
 * script. Fresh matters: the core is a singleton (UI, module-level keyboard
 * state), and one test's taps and focus must not leak into the next, so the
 * core's require-cache entry is dropped and the file re-evaluated per call.
 */
'use strict';
var path = require('path');

var ROOT = path.resolve(__dirname, '..');
var CORE = path.join(ROOT, 'packages', 'core', 'src', 'mjsx.js');
var BACKEND = path.join(ROOT, 'backends', 'pure-js', 'src', 'backend.js');

/* A fresh backend + fresh core, globals wired. opts passes through to
   createPureJsBackend (e.g. { textMode: 'capture' } to read text ops). */
function fresh(w, h, opts) {
  var backend = require(BACKEND).createPureJsBackend(w, h, opts);
  globalThis.gfx = backend.gfx;
  globalThis.sys = backend.sys;
  delete require.cache[require.resolve(CORE)];
  var core = require(CORE);
  globalThis.h = core.h;
  globalThis.UI = core.UI;
  globalThis.Button = core.Button;
  globalThis.Swatch = core.Swatch;
  globalThis.em = core.em;
  globalThis.Modal = core.Modal;
  globalThis.Keyboard = core.Keyboard;
  globalThis.ArcFooter = core.ArcFooter;
  return { backend: backend, core: core, UI: core.UI, h: core.h };
}

/* Load one example the way run.js does and render its first frame. */
function renderExample(file, w, hh) {
  var t = fresh(w, hh);
  var abs = path.resolve(ROOT, file);
  delete require.cache[require.resolve(abs)];
  require(abs);
  t.UI.render();
  return t;
}

function sha256(bytes) {
  return require('crypto').createHash('sha256').update(bytes).digest('hex');
}

module.exports = { fresh: fresh, renderExample: renderExample, sha256: sha256, ROOT: ROOT };
