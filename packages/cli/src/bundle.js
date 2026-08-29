/*
 * Bundle assembly for the ESP32 push path — mjsx-core + the device shim +
 * app code, exactly the bundle backends/esp32/tools/push-examples.mjs
 * builds (the transpile flags, harness check and layout come from there;
 * this module exists so `mjsx push` and `mjsx fleet push` share one copy).
 */
var fs = require('fs');
var os = require('os');
var path = require('path');
var { execFileSync } = require('child_process');
var U = require('./util.js');

var TOOLS = path.join(U.REPO, 'backends/esp32/tools');

/* The built-in transpiler: no dependency, and it is the same file a
   browser playground or the device itself would use. tsc stays reachable
   through MJSX_TSC for anyone who wants to diff the two. */
var jsx = require(path.join(U.REPO, 'packages/core/src/jsx.js'));

function findTsc() {
  var cands = [process.env.MJSX_TSC];
  for (var i = 0; i < cands.length; i++) {
    if (cands[i] && fs.existsSync(cands[i])) return cands[i];
  }
  return null;   /* the built-in transpiler handles it */
}

/* The built-in transpiler by default; tsc only when MJSX_TSC points at
   one. Bun's transpiler is the wrong tool either way -- it MODERNISES the
   ES5 that MicroQuickJS requires, handing arrow functions and `let` back
   to an engine that rejects them. */
function transpile(file, tsc) {
  if (!tsc) {
    try {
      return jsx.transpile(fs.readFileSync(file, 'utf8'));
    } catch (e) {
      U.die('mjsx push: could not transform ' + path.basename(file) + ' — ' + U.message(e));
    }
  }
  var dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mjsx-tsc-'));
  var src = path.join(dir, 'in.jsx');
  fs.writeFileSync(src, fs.readFileSync(file, 'utf8'));
  try {
    execFileSync(tsc, [
      '--jsx', 'react', '--jsxFactory', 'h', '--jsxFragmentFactory', 'Fragment',
      '--target', 'es2015', '--module', 'commonjs', '--noResolve', '--skipLibCheck',
      '--allowJs', '--ignoreConfig', '--outDir', dir, src
    ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    /* tsc reports syntax errors on stdout; show the first, not a stack. */
    var out = String((e && e.stdout) || '') + String((e && e.stderr) || '');
    var first = out.split('\n').filter(function (l) { return l.trim(); })[0];
    U.die('mjsx push: tsc could not transform ' + path.basename(file) +
          (first ? ' — ' + first.replace(/^.*in\.jsx/, path.basename(file)) : ' (' + U.message(e) + ')'));
  }
  return fs.readFileSync(path.join(dir, 'in.js'), 'utf8');
}

function need(file, what) {
  if (!fs.existsSync(file)) U.die('mjsx push: ' + what + ' is missing: ' + file + ' — run mjsx from a full checkout');
  return file;
}

function coreAndShim() {
  return fs.readFileSync(need(path.join(U.REPO, 'packages/core/src/mjsx.js'), 'mjsx-core'), 'utf8') +
    '\n' + fs.readFileSync(need(path.join(TOOLS, 'device-shim.js'), 'the device shim'), 'utf8') +
    /* the desktop runners give each app a CommonJS `module` for the
       optional demo() export; the engine has no such global. A stub
       keeps that runner-only convention inert on device (the harness
       rejects examples/counter without it). */
    '\nvar module = { exports: {} };\n';
}

/* One app: core + shim + the app itself. The app's own top-level
   UI.mount runs at boot; the shim's EXAMPLES list stays empty. */
function buildAppBundle(appFile) {
  var tsc = findTsc();
  return coreAndShim() + '\n/* ---- app: ' + path.basename(path.dirname(appFile)) + ' ---- */\n' + transpile(appFile, tsc);
}

/* The examples bundle with the on-device picker menu. */
function buildExamplesBundle(wanted) {
  var tsc = findTsc();
  var exDir = path.join(U.REPO, 'examples');
  if (!fs.existsSync(exDir)) U.die('mjsx push: no examples/ directory at ' + exDir + ' — run mjsx from a full checkout');
  /* local-examples/ is the gitignored sibling: apps bound to one person's
     hardware (a specific printer, a specific rig) that belong on the
     device but not in a public repo. Same shape as examples/, picked up
     automatically when present, and it wins a name collision so a local
     copy can shadow a shipped example. */
  var dirs = [exDir];
  var localDir = path.join(U.REPO, 'local-examples');
  if (fs.existsSync(localDir)) dirs.push(localDir);
  var srcOf = {};
  for (var d = 0; d < dirs.length; d++) {
    var entries = fs.readdirSync(dirs[d]);
    for (var e = 0; e < entries.length; e++) {
      var app = path.join(dirs[d], entries[e], 'app.jsx');
      if (fs.existsSync(app)) srcOf[entries[e]] = app;
    }
  }
  var names = Object.keys(srcOf).sort();
  var all = names.slice();
  if (wanted && wanted.length) {
    names = names.filter(function (n) { return wanted.indexOf(n) !== -1; });
  }
  if (!names.length) U.die('mjsx push: no examples matched — have: ' + all.join(', '));
  var bundle = coreAndShim();
  for (var i = 0; i < names.length; i++) {
    var code = transpile(srcOf[names[i]], tsc);
    bundle += '\n/* ---- example: ' + names[i] + ' ---- */\nEXAMPLES.push([\'' + names[i] + '\', function () {\n' + code + '\n}]);\n';
  }
  bundle += '\n' + fs.readFileSync(path.join(TOOLS, 'device-menu.js'), 'utf8');
  return { bundle: bundle, names: names };
}

/* Validate in the real engine (the kit repo's MicroQuickJS harness, same
   build as the firmware) before a byte leaves this machine. Optional:
   without the harness the push proceeds unchecked, and says so. */
function validate(bundle) {
  var harness = process.env.MJSX_HARNESS || path.join(U.KIT, 'firmware/esp32/mquickjs-host/harness');
  if (!fs.existsSync(harness)) {
    console.warn('harness not built - pushing unchecked');
    return;
  }
  var out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mjsx-esp32-')), 'app.bundle.js');
  fs.writeFileSync(out, bundle);
  var ho;
  try { ho = execFileSync(harness, [out, 'render'], { encoding: 'utf8' }); }
  catch (e) { ho = (e.stdout || '') + (e.stderr || ''); }
  if (/EXCEPTION/.test(ho)) {
    var m = ho.match(/app\.bundle\.js:(\d+)/);
    var lines = ho.split('\n').filter(function (l) { return /EXCEPTION|^\s+at /.test(l); });
    if (m) {
      var src = bundle.split('\n'), n = Number(m[1]);
      for (var i = Math.max(0, n - 2); i < Math.min(src.length, n + 1); i++) lines.push('  ' + (i + 1) + ' | ' + src[i]);
    }
    /* Not a stack trace: this is the engine's own verdict on the code
       about to be shipped, so it survives past the one-line headline. */
    var err = new Error('the MicroQuickJS engine rejected this bundle — the app will not boot on a board');
    err.detail = lines.join('\n');
    throw err;
  }
  console.log('engine check: ok');
}

module.exports = { buildAppBundle: buildAppBundle, buildExamplesBundle: buildExamplesBundle, validate: validate };
