/* The browser simulator's engine bundle.
 *
 * The bundle is the whole risk here. It is built, not written, and it
 * failed silently once already: Bun's iife build DEFINES a CommonJS entry
 * without invoking it, so every `globalThis.x = …` in the entry never ran.
 * The file loaded, nothing threw, and every global was undefined. Only a
 * browser would have noticed, and only by not working.
 *
 * So these tests load the built bundle the way a page does and drive it
 * the way the page does. They are not a substitute for opening it — that
 * catches layout and event bugs these cannot — but they hold the line that
 * matters most: the engine is in there, it runs an app, and each run gets
 * a clean one.
 */
var test = require('bun:test');
var describe = test.describe, it = test.it, expect = test.expect;
var beforeAll = test.beforeAll;
var fs = require('fs');
var path = require('path');

var ROOT = path.resolve(__dirname, '..');
var BUNDLE = path.join(ROOT, 'site/public/mjsx-sim.js');
var EXAMPLES_JSON = path.join(ROOT, 'site/public/examples.json');

/* Built by `bun run docs:sync`; a fresh clone has not run it yet, so these
   self-skip rather than fail, the same way the wasm parity suite does. */
var HAVE = fs.existsSync(BUNDLE) && fs.existsSync(EXAMPLES_JSON);
if (!HAVE) {
  console.warn('\nplay: SKIPPED — no simulator bundle. Run `bun run docs:sync`.\n');
}
var maybe = HAVE ? it : it.skip;

describe('simulator bundle', function () {
  beforeAll(function () {
    if (!HAVE) return;
    /* a page has a window; the bundle should not care, but say so anyway */
    globalThis.window = globalThis;
    require(BUNDLE);
  });

  maybe('exposes what the page calls', function () {
    ['createPureJsBackend', 'mjsxTranspile', 'mjsxRun', 'mjsxFreshCore',
     'mjsxRecord', 'mjsxReplay', 'mjsxBoxes'].forEach(function (k) {
      expect(typeof globalThis[k]).toBe('function');
    });
    expect(typeof globalThis.MJSX_CORE_SRC).toBe('string');
    expect(globalThis.MJSX_CORE_SRC.length).toBeGreaterThan(10000);
  });

  maybe('runs an app and draws it', function () {
    var be = createPureJsBackend(240, 280, {});
    mjsxRun("UI.mount(function () { return h('box', { pad: 8 }, " +
            "[h('text', { text: 'HELLO', size: 2 })]); });", be, {});
    UI.render();
    var rec = mjsxRecord(be.gfx);
    var real = globalThis.gfx;
    globalThis.gfx = rec.gfx;
    UI.render();
    globalThis.gfx = real;
    var ops = rec.take();
    var texts = ops.filter(function (o) { return o[0] === 't'; })
                   .map(function (o) { return o[5]; });
    expect(texts).toContain('HELLO');
  });

  maybe('transpiles JSX, since a browser has no build step', function () {
    var be = createPureJsBackend(240, 280, {});
    mjsxRun('UI.mount(function () { return <text text="JSX" size={2} />; });', be, {});
    UI.render();
    var rec = mjsxRecord(be.gfx);
    var real = globalThis.gfx;
    globalThis.gfx = rec.gfx; UI.render(); globalThis.gfx = real;
    expect(rec.take().filter(function (o) { return o[0] === 't'; })
              .map(function (o) { return o[5]; })).toContain('JSX');
  });

  maybe('gives every run a FRESH engine', function () {
    /* the whole reason the core ships as source: UI is a singleton, so a
       second app on the same instance would inherit the first's state */
    var a = createPureJsBackend(240, 280, {});
    mjsxRun("UI.mount(function () { return h('text', { text: 'A' }); }); UI.set({ mark: 1 });", a, {});
    expect(UI.state.mark).toBe(1);

    var b = createPureJsBackend(240, 280, {});
    mjsxRun("UI.mount(function () { return h('text', { text: 'B' }); });", b, {});
    expect(UI.state.mark).toBeUndefined();
  });

  maybe('seeds round glass the way a firmware does', function () {
    var be = createPureJsBackend(240, 240, {});
    mjsxRun("UI.mount(function () { return h('text', { text: 'R' }); });", be, { round: true });
    expect(UI.isRound()).toBe(true);

    var sq = createPureJsBackend(240, 280, {});
    mjsxRun("UI.mount(function () { return h('text', { text: 'S' }); });", sq, {});
    expect(UI.isRound()).toBe(false);
  });

  maybe('gives an app the CommonJS shape other hosts give it', function () {
    /* examples/counter ends with `module.exports.demo = ...`; without a
       module object it is a ReferenceError in the browser and nowhere else */
    var be = createPureJsBackend(240, 280, {});
    expect(function () {
      mjsxRun("module.exports.demo = function () {}; " +
              "UI.mount(function () { return h('text', { text: 'M' }); });", be, {});
    }).not.toThrow();
  });

  maybe('reports a JSX error as a JSX error', function () {
    var be = createPureJsBackend(240, 280, {});
    var caught = null;
    try { mjsxRun('UI.mount(function () { return <box unclosed; });', be, {}); }
    catch (e) { caught = e; }
    expect(caught).not.toBeNull();
    expect(caught.mjsxPhase).toBe('jsx');
  });

  maybe('every example in examples.json runs and draws something', function () {
    var list = JSON.parse(fs.readFileSync(EXAMPLES_JSON, 'utf8'));
    expect(list.length).toBeGreaterThan(5);

    var failed = [];
    list.forEach(function (ex) {
      try {
        var be = createPureJsBackend(240, 280, {});
        mjsxRun(ex.source, be, {});
        UI.render();
        var rec = mjsxRecord(be.gfx);
        var real = globalThis.gfx;
        globalThis.gfx = rec.gfx; UI.render(); globalThis.gfx = real;
        var n = rec.take().length;
        /* one clear() alone means the app drew nothing at all */
        if (n < 2) failed.push(ex.name + ': only ' + n + ' draw call(s)');
      } catch (e) {
        failed.push(ex.name + ': ' + e.message);
      }
    });
    expect(failed).toEqual([]);
  });

  maybe('example sources match the files on disk', function () {
    /* the page must serve the real example, not a copy that drifted */
    var list = JSON.parse(fs.readFileSync(EXAMPLES_JSON, 'utf8'));
    var stale = [];
    list.forEach(function (ex) {
      var f = path.join(ROOT, 'examples', ex.name, 'app.jsx');
      if (!fs.existsSync(f)) { stale.push(ex.name + ': no such example'); return; }
      if (fs.readFileSync(f, 'utf8') !== ex.source) stale.push(ex.name + ': source differs');
    });
    expect(stale).toEqual([]);
  });
});
