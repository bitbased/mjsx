/*
 * Engine-parity tests: run mjsx-core and every example through the SAME
 * MicroQuickJS bytecode interpreter a chip runs, compiled to WebAssembly
 * (backends/wasm). The pure-js tests next door prove the core's *logic*;
 * these prove its *dialect* — that the ES5 subset the core and the
 * examples are written in is a subset this engine actually accepts, with
 * the engine itself as the judge rather than a linter's opinion of one.
 *
 * What a green sweep means, precisely: the whole bundle PARSES (MicroQuickJS
 * compiles function bodies eagerly, so every line is syntax-checked, not
 * just the ones that run), its top level EXECUTES, and UI.render() completes
 * without an engine exception. It does not mean the pixels match another
 * backend — rendering fidelity is golden.test.js's job, not this file's.
 *
 * backends/wasm/dist/ is gitignored (it is a Docker/emcc build product), so
 * these tests self-skip when it is absent. Nothing here shells out to Docker.
 */
import { test, expect, afterAll } from 'bun:test';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'backends', 'wasm', 'dist');
const GLUE = path.join(DIST, 'mjsx.js');
const WASM = path.join(DIST, 'mjsx.wasm');
const CORE = path.join(ROOT, 'packages', 'core', 'src', 'mjsx.js');
const EXAMPLES = path.join(ROOT, 'examples');

const HAVE_ENGINE = fs.existsSync(GLUE) && fs.existsSync(WASM);
if (!HAVE_ENGINE) {
  console.warn(
    '\nbackend-wasm: SKIPPED — no engine build at backends/wasm/dist/.\n' +
    '  dist/ is gitignored build output, not a committed artifact, so a fresh\n' +
    '  clone has nothing to run. Produce mjsx.js + mjsx.wasm from\n' +
    '  backends/wasm/Dockerfile (emcc writes them to /out inside the image)\n' +
    '  and these tests turn themselves on. This suite never invokes Docker.\n');
}
const engineTest = HAVE_ENGINE ? test : test.skip;

const exampleNames = fs.existsSync(EXAMPLES)
  ? fs.readdirSync(EXAMPLES).filter(function (n) {
      return fs.existsSync(path.join(EXAMPLES, n, 'app.jsx'));
    }).sort()
  : [];

/* ------------------------------------------------------------------ *
 * JSX -> h(), touching ONLY the JSX
 *
 * Bun's transpiler cannot be used here, and that is not a style
 * preference: it rewrites `{ x: x, y: y }` into `{ x, y }` and
 * `var a = sh.a, b = sh.b` into a destructuring pattern. MicroQuickJS
 * rejects both, so transpiling with Bun manufactures "parity failures"
 * for examples whose authors wrote clean ES5 — a test that lies. tsc is
 * the CLI's answer (packages/cli/src/bundle.js) but it is an optional
 * dev dependency this suite must not require, so instead: copy every
 * non-JSX byte through unchanged, and rewrite nothing but the elements.
 * "Faithful" is asserted, not assumed — see the fidelity test below.
 * ------------------------------------------------------------------ */
const WORD = /[A-Za-z0-9_$]/;
const NAME_START = /[A-Za-z_$]/;
/* punctuators after which '<' opens an element instead of meaning less-than */
const OPENERS = { '(': 1, ',': 1, '=': 1, ':': 1, '[': 1, '{': 1, ';': 1, '?': 1, '&': 1, '|': 1, '!': 1, '+': 1, '-': 1, '*': 1, '%': 1, '^': 1, '~': 1, '>': 1, '<': 1 };
const KEYWORDS = { 'return': 1, 'typeof': 1, 'instanceof': 1, 'in': 1, 'of': 1, 'new': 1, 'do': 1, 'else': 1, 'case': 1, 'void': 1, 'delete': 1, 'yield': 1, 'await': 1 };

function transformJsx(src, file) {
  var out = [];
  var i = 0;
  /* Previous significant token, kind and text kept apart on purpose: a
     one-letter identifier must not be mistaken for a punctuator, or the
     `/` in `var r = w / 2` scans as the start of a regex literal. */
  var lastKind = null; // null | 'word' | 'value' | 'punct'
  var lastText = '';
  function tok(kind, text) { lastKind = kind; lastText = text; }

  function fail(msg) {
    throw new Error('jsx transform: ' + msg + ' at ' +
      (file || '<jsx>') + ':' + src.slice(0, i).split('\n').length);
  }
  function jsxOpens() {
    if (lastKind === null) return true;
    if (lastKind === 'word') return KEYWORDS[lastText] === 1;
    if (lastKind === 'punct') return OPENERS[lastText] === 1;
    return false;
  }
  function regexAllowed() {
    if (lastKind === null) return true;
    if (lastKind === 'word') return KEYWORDS[lastText] === 1;
    if (lastKind === 'punct') return lastText !== ')' && lastText !== ']' && lastText !== '}';
    return false;
  }
  function newlines(s) {
    var n = 0;
    for (var k = 0; k < s.length; k++) if (s.charCodeAt(k) === 10) n++;
    return n;
  }

  /* copy plain JS through until a JSX '<' or the depth-0 `stop` char */
  function code(stop) {
    var depth = 0;
    while (i < src.length) {
      var c = src[i];
      if (stop && depth === 0 && c === stop) return;
      if (c === '/' && src[i + 1] === '/') {
        var e = src.indexOf('\n', i); e = e === -1 ? src.length : e;
        out.push(src.slice(i, e)); i = e; continue;
      }
      if (c === '/' && src[i + 1] === '*') {
        var e2 = src.indexOf('*/', i + 2); e2 = e2 === -1 ? src.length : e2 + 2;
        out.push(src.slice(i, e2)); i = e2; continue;
      }
      if (c === '"' || c === "'" || c === '`') { out.push(str()); tok('value', ''); continue; }
      if (c === '/' && regexAllowed()) { out.push(regex()); tok('value', ''); continue; }
      /* A '<' only opens an element when a NAME or '>' follows it. Without
         that guard `(x | 0) << 4` reads as JSX: ')' does not open, so the
         first '<' is a punctuator, and '<' IS in OPENERS, so the second one
         calls element() — which finds no tag name and blames fragments.
         packages/core/src/jsx.js has always required this; the cross-check
         did not, so the two transforms disagreed on shift operators. */
      if (c === '<' && jsxOpens() &&
          (NAME_START.test(src[i + 1] || '') || src[i + 1] === '>')) {
        out.push(element()); tok('value', ''); continue;
      }
      if (c === '(' || c === '[' || c === '{') depth++;
      else if (c === ')' || c === ']' || c === '}') depth--;
      if (WORD.test(c)) {
        var w = word();
        out.push(w);
        tok(NAME_START.test(w.charAt(0)) ? 'word' : 'value', w);
        continue;
      }
      if (c > ' ') tok('punct', c);
      out.push(c); i++;
    }
    if (stop) fail("unterminated, expected '" + stop + "'");
  }

  function word() { var s = i; while (i < src.length && WORD.test(src[i])) i++; return src.slice(s, i); }

  function str() {
    var q = src[i], s = i; i++;
    while (i < src.length && src[i] !== q) { if (src[i] === '\\') i++; i++; }
    i++;
    return src.slice(s, i);
  }

  function regex() {
    var s = i; i++;
    var inClass = false;
    while (i < src.length) {
      var c = src[i];
      if (c === '\\') { i += 2; continue; }
      if (c === '[') inClass = true;
      else if (c === ']') inClass = false;
      else if (c === '/' && !inClass) { i++; break; }
      else if (c === '\n') fail('unterminated regex literal');
      i++;
    }
    while (i < src.length && /[a-z]/.test(src[i])) i++;
    return src.slice(s, i);
  }

  function ws() { while (i < src.length && /\s/.test(src[i])) i++; }

  /* a balanced {...}; its contents are themselves transformed */
  function braced() {
    i++;
    var save = out; out = [];
    var sk = lastKind, st = lastText; tok('punct', '{');
    code('}');
    var inner = out.join(''); out = save; lastKind = sk; lastText = st;
    if (src[i] !== '}') fail("expected '}'");
    i++;
    return inner;
  }

  function element() {
    var start = i;
    i++; ws();
    var name = '';
    if (NAME_START.test(src[i])) {
      var s = i;
      while (i < src.length && /[A-Za-z0-9_$.]/.test(src[i])) i++;
      name = src.slice(s, i);
    }
    if (!name) fail('JSX fragments are not supported by this transform');
    var tag = /^[a-z]/.test(name) ? JSON.stringify(name) : name;

    var props = [], selfClose = false;
    for (;;) {
      ws();
      if (i >= src.length) fail('unterminated tag <' + name + '>');
      if (src[i] === '/' && src[i + 1] === '>') { i += 2; selfClose = true; break; }
      if (src[i] === '>') { i++; break; }
      if (src[i] === '{') fail('JSX spread attributes are not supported by this transform');
      if (!NAME_START.test(src[i])) fail("unexpected '" + src[i] + "' in <" + name + '> attributes');
      var as = i;
      while (i < src.length && /[A-Za-z0-9_$-]/.test(src[i])) i++;
      var attr = src.slice(as, i);
      ws();
      if (src[i] !== '=') { props.push(JSON.stringify(attr) + ': true'); continue; }
      i++; ws();
      if (src[i] === '"' || src[i] === "'") {
        props.push(JSON.stringify(attr) + ': ' + JSON.stringify(str().slice(1, -1)));
      } else if (src[i] === '{') {
        props.push(JSON.stringify(attr) + ': ' + braced());
      } else {
        fail('attribute ' + attr + ' needs a "string" or an {expression}');
      }
    }

    var kids = [];
    if (!selfClose) {
      for (;;) {
        if (i >= src.length) fail('unterminated <' + name + '>');
        if (src[i] === '<' && src[i + 1] === '/') {
          i += 2; ws();
          var cs = i;
          while (i < src.length && /[A-Za-z0-9_$.]/.test(src[i])) i++;
          var close = src.slice(cs, i);
          ws();
          if (src[i] !== '>') fail("expected '>' to close </" + close + '>');
          i++;
          if (close !== name) fail('</' + close + '> does not close <' + name + '>');
          break;
        }
        if (src[i] === '<') { kids.push(element()); continue; }
        if (src[i] === '{') {
          var expr = braced();
          if (expr.trim() === '' || /^\s*\/\*[\s\S]*\*\/\s*$/.test(expr)) continue; // {/* comment */}
          kids.push(expr);
          continue;
        }
        var ts = i;
        while (i < src.length && src[i] !== '<' && src[i] !== '{') i++;
        var text = src.slice(ts, i);
        if (/^\s*$/.test(text)) {
          if (text.length && text.indexOf('\n') === -1) kids.push(JSON.stringify(text));
          continue;
        }
        var trimmed = text.replace(/^\s*\n\s*/, '').replace(/\s*\n\s*$/, '').replace(/\s*\n\s*/g, ' ');
        if (trimmed) kids.push(JSON.stringify(trimmed));
      }
    }

    var call = 'h(' + tag + ', ' +
      (props.length ? '{ ' + props.join(', ') + ' }' : 'null') +
      (kids.length ? ', ' + kids.join(', ') : '') + ')';
    /* give back the newlines this element swallowed, so every line below
       it keeps the line number it has in the .jsx file */
    return call + new Array(newlines(src.slice(start, i)) + 1).join('\n');
  }

  code(null);
  return out.join('');
}

/* ------------------------------------------------------------------ *
 * The op sink. backends/wasm/glue.c routes every gfx call to
 * globalThis.mjsxGfx, so this IS the wasm backend's pixel host — it just
 * records the ten calls instead of painting them.
 * ------------------------------------------------------------------ */
var recording = [];
globalThis.mjsxGfx = {
  clear: function (rgb) { recording.push(['clear', rgb]); },
  rect: function (x, y, w, h, rgb, r) { recording.push(['rect', x, y, w, h, rgb, r]); },
  frect: function (x, y, w, h, rgb, r) { recording.push(['frect', x, y, w, h, rgb, r]); },
  circle: function (x, y, r, rgb, f) { recording.push(['circle', x, y, r, rgb, f]); },
  line: function (x0, y0, x1, y1, rgb) { recording.push(['line', x0, y0, x1, y1, rgb]); },
  text: function (x, y, size, rgb, s) { recording.push(['text', x, y, size, rgb, s]); },
  clip: function (x, y, w, h) { recording.push(['clip', x, y, w, h]); },
  unclip: function () { recording.push(['unclip']); },
  width: function () { return 240; },
  height: function () { return 280; }
};
function startRecording() { recording = []; return recording; }

/* ------------------------------------------------------------------ *
 * Engine harness
 *
 * Two constraints shape this, both properties of the emitted glue rather
 * than of the engine:
 *
 *  1. cwrap marshals a string argument onto the wasm stack, which tops out
 *     near 64KB — and mjsx-core alone is ~96KB. dist exports neither
 *     _malloc nor stringToUTF8, so there is no pointer to hand over
 *     instead. The bundle therefore goes in as chunks appended to an
 *     engine-side string, and the length is checked before it is compiled.
 *  2. mjsxEval reports only pass/fail, and a failed eval logs nothing. So
 *     the bundle is compiled with `new Function`, which turns both a
 *     SyntaxError and a runtime throw into values the engine can print —
 *     giving parse-vs-runtime classification and the engine's own message.
 *     `new Function` compiles the bundle as a function body, so the
 *     bindings a flat device eval would leave global are re-exported
 *     explicitly (EXPORT_TAIL) for UI.render()/mjsxRenderTick to find.
 * ------------------------------------------------------------------ */
const EXPORT_TAIL = '\n;globalThis.UI = UI; globalThis.h = h; globalThis.em = em;' +
  'globalThis.FONT = FONT; globalThis.Button = Button; globalThis.Swatch = Swatch;' +
  'globalThis.Modal = Modal; globalThis.Keyboard = Keyboard;\n';

/* MicroQuickJS reads the source as UTF-8; JSON.stringify leaves U+2028/9
   raw, which is a line terminator to a JS parser. Escape them. */
function jsLiteral(s) {
  return JSON.stringify(s).replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

async function engine() {
  const factory = require(GLUE);
  const saved = console.log;
  let sink = [];
  console.log = function () {
    sink.push(Array.prototype.map.call(arguments, String).join(' '));
  };
  let M;
  try { M = await factory(); } finally { console.log = saved; }

  const init = M.cwrap('mjsxInit', 'number', []);
  const rawEval = M.cwrap('mjsxEval', 'number', ['string']);
  const rawTick = M.cwrap('mjsxRenderTick', 'number', []);
  if (!init()) throw new Error('mjsxInit failed (engine heap allocation)');

  /* run one snippet, returning whether it evaluated plus whatever the
     engine printed while it did */
  function ev(src) {
    sink = [];
    const prev = console.log;
    console.log = function () {
      sink.push(Array.prototype.map.call(arguments, String).join(' '));
    };
    let ok;
    try { ok = !!rawEval(src); }
    catch (e) { ok = false; sink.push('host trap: ' + e); }
    finally { console.log = prev; }
    return { ok: ok, out: sink.join(' ') };
  }

  return {
    ev: ev,
    tick: function () { return !!rawTick(); },

    /* Upload + compile + run a bundle. Returns one of:
       {stage:'ok'} | {stage:'parse'|'runtime'|'harness', msg} */
    load: function (src) {
      if (!ev('var __SRC = "";').ok) return { stage: 'harness', msg: 'could not create __SRC' };
      const CHUNK = 20000;
      for (let at = 0; at < src.length;) {
        let end = Math.min(at + CHUNK, src.length);
        const c = src.charCodeAt(end - 1); // never split a surrogate pair
        if (end < src.length && c >= 0xd800 && c <= 0xdbff) end--;
        if (!ev('__SRC += ' + jsLiteral(src.slice(at, end)) + ';').ok) {
          return { stage: 'harness', msg: 'chunk upload failed at char ' + at };
        }
        at = end;
      }
      const len = ev('print(__SRC.length);');
      if (!len.ok || len.out.trim() !== String(src.length)) {
        return { stage: 'harness', msg: 'uploaded ' + len.out.trim() + ' chars, expected ' + src.length };
      }
      const c = ev('try { globalThis.__FN = new Function(__SRC); print("ok") }' +
        ' catch (e) { print("!" + e.name + ": " + e.message) }');
      if (!c.ok) return { stage: 'harness', msg: 'compile probe did not evaluate' };
      if (c.out.charAt(0) === '!') return { stage: 'parse', msg: c.out.slice(1) };

      const r = ev('try { __FN(); print("ok") }' +
        ' catch (e) { print("!" + e.name + ": " + e.message) }');
      if (!r.ok) return { stage: 'harness', msg: 'run probe did not evaluate' };
      if (r.out.charAt(0) === '!') return { stage: 'runtime', msg: r.out.slice(1) };
      return { stage: 'ok' };
    },

    /* UI.render() guarded the same way, so a draw-time throw is reported
       rather than swallowed */
    render: function () {
      const r = ev('try { UI.render(); print("ok") }' +
        ' catch (e) { print("!" + e.name + ": " + e.message) }');
      if (!r.ok) return { stage: 'harness', msg: 'render probe did not evaluate' };
      if (r.out.charAt(0) === '!') return { stage: 'runtime', msg: r.out.slice(1) };
      return { stage: 'ok' };
    }
  };
}

function describeResult(r) { return r.stage === 'ok' ? 'ok' : r.stage + ': ' + r.msg; }

const coreSource = fs.existsSync(CORE) ? fs.readFileSync(CORE, 'utf8') : '';
/* `var module` hoists, so the core's `typeof module !== 'undefined'` guard
   is false while the core runs (it stays a flat script, exporting nothing)
   and the declaration is live by the time an example sets module.exports.demo
   — the same trick packages/cli/src/bundle.js plays for the device. */
function bundleFor(appSource) {
  return coreSource + '\nvar module = { exports: {} };\n' + appSource + EXPORT_TAIL;
}

/* ------------------------------------------------------------------ *
 * 1. the core and a minimal app, through the real engine
 * ------------------------------------------------------------------ */
engineTest('wasm engine: mjsx-core + a minimal app render an op stream', async () => {
  const E = await engine();
  const ops = startRecording();

  const app = "function App() {\n" +
    "  return h('box', { pad: 8, bg: 0x101010 },\n" +
    "    h('text', { text: 'parity', size: 2, color: 0xffffff }));\n" +
    "}\n" +
    "UI.mount(App);\n";
  expect(describeResult(E.load(bundleFor(app)))).toBe('ok');
  expect(describeResult(E.render())).toBe('ok');

  expect(ops.length).toBeGreaterThan(0);
  expect(ops[0][0]).toBe('clear'); // every frame starts by clearing
  const texts = ops.filter(function (o) { return o[0] === 'text'; });
  expect(texts.length).toBe(1);
  expect(texts[0][5]).toBe('parity'); // ['text', x, y, size, rgb, str]
  const names = ops.map(function (o) { return o[0]; });
  names.forEach(function (n) {
    expect(['clear', 'rect', 'frect', 'circle', 'line', 'text', 'clip', 'unclip']).toContain(n);
  });

  /* the host's frame loop entry point, not just a bare eval */
  ops.length = 0;
  expect(E.ev('UI.set({ n: 1 });').ok).toBe(true);
  expect(E.tick()).toBe(true);
  expect(ops.length).toBeGreaterThan(0);
});

/* ------------------------------------------------------------------ *
 * 2. negative controls — a green sweep below is only worth something if
 *    this harness can actually fail
 * ------------------------------------------------------------------ */
engineTest('wasm engine: a non-ES5 construct is reported as a parse failure', async () => {
  /* Both offenders sit inside a function body that is never called, which
     is the point: they are still rejected, so the engine compiles every
     function eagerly and the sweep below syntax-checks whole files rather
     than only the lines a first render happens to reach. */
  const E = await engine();
  const arrow = E.load(bundleFor('function never(a) { return (b) => b + a; }\n'));
  expect(arrow.stage).toBe('parse');
  expect(arrow.msg).toMatch(/SyntaxError/);

  const spread = (await engine()).load(
    bundleFor('function alsoNever(o) { var p = { a: 1 }; return { ...p, b: o }; }\n'));
  expect(spread.stage).toBe('parse');

  const shorthand = (await engine()).load(
    bundleFor('function neverEither(x) { return { x }; }\n'));
  expect(shorthand.stage).toBe('parse');
});

engineTest('wasm engine: a top-level throw is reported as a runtime failure', async () => {
  const E = await engine();
  const bad = E.load(bundleFor('noSuchFunctionAnywhere();\n'));
  expect(bad.stage).toBe('runtime');
  expect(bad.msg).toMatch(/noSuchFunctionAnywhere/);
});

/* ------------------------------------------------------------------ *
 * 3. the transform is faithful
 *
 * Without this the sweep proves nothing: a transform that quietly
 * rewrote the examples would be testing itself. Rendering each example
 * twice under the pure-js backend — once as Bun's require() loads it,
 * once from our transformed text — and demanding identical framebuffers
 * pins the transform to Bun's semantics while leaving its syntax alone.
 * ------------------------------------------------------------------ */
const loader = (function () {
  try { return require('./load.js'); } catch (e) { return null; }
})();

const fidelityTest = loader && exampleNames.length ? test : test.skip;
exampleNames.forEach(function (name) {
  fidelityTest('jsx transform is pixel-faithful for examples/' + name, () => {
    const file = path.join(EXAMPLES, name, 'app.jsx');
    const expected = loader.sha256(
      loader.renderExample('examples/' + name + '/app.jsx', 240, 280).backend.raw);

    const t = loader.fresh(240, 280);
    const scope = {
      h: t.core.h, UI: t.core.UI, em: t.core.em, Button: t.core.Button,
      Swatch: t.core.Swatch, Modal: t.core.Modal, Keyboard: t.core.Keyboard,
      gfx: globalThis.gfx, sys: globalThis.sys, module: { exports: {} }
    };
    const keys = Object.keys(scope);
    const fn = new Function(keys.join(','), transformJsx(fs.readFileSync(file, 'utf8'), file));
    fn.apply(null, keys.map(function (k) { return scope[k]; }));
    t.UI.render();

    expect(loader.sha256(t.backend.raw)).toBe(expected);
  });
});

/* ------------------------------------------------------------------ *
 * 4. the sweep — every example through the engine, ES5-subset parity only
 * ------------------------------------------------------------------ */
const report = [];
exampleNames.forEach(function (name) {
  engineTest('es5 parity: examples/' + name + ' evaluates in the wasm engine', async () => {
    const file = path.join(EXAMPLES, name, 'app.jsx');
    let app;
    try { app = transformJsx(fs.readFileSync(file, 'utf8'), file); }
    catch (e) {
      report.push({ name: name, verdict: 'transform: ' + e.message, ops: 0 });
      throw e;
    }

    const E = await engine();
    const ops = startRecording();
    const loaded = E.load(bundleFor(app));
    const rendered = loaded.stage === 'ok' ? E.render() : { stage: 'skipped', msg: 'not loaded' };

    report.push({
      name: name,
      verdict: loaded.stage !== 'ok' ? describeResult(loaded)
        : rendered.stage !== 'ok' ? 'render ' + describeResult(rendered) : 'ok',
      ops: ops.length
    });

    /* the message rides along in the compared value so a failure prints
       the engine's own words, not just "expected ok, got parse" */
    expect(name + ' -> ' + describeResult(loaded)).toBe(name + ' -> ok');
    expect(name + ' render -> ' + describeResult(rendered)).toBe(name + ' render -> ok');
  });
});

afterAll(function () {
  if (!HAVE_ENGINE || !report.length) return;
  report.sort(function (a, b) { return a.name < b.name ? -1 : 1; });
  const lines = report.map(function (r) {
    return '  ' + r.name.padEnd(10) + (r.verdict === 'ok' ? 'PASS' : 'FAIL') +
      '  ops=' + String(r.ops).padStart(4) + '  ' + (r.verdict === 'ok' ? '' : r.verdict);
  });
  const passed = report.filter(function (r) { return r.verdict === 'ok'; }).length;
  console.log('\nES5-subset parity through the wasm MicroQuickJS engine — ' +
    passed + '/' + report.length + ' examples:\n' + lines.join('\n') + '\n');
});
