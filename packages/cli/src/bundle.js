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

function findTsc() {
  var cands = [
    process.env.MJSX_TSC,
    path.join(U.REPO, 'node_modules/.bin/tsc'),
    path.join(U.KIT, 'node_modules/.bin/tsc')
  ];
  for (var i = 0; i < cands.length; i++) {
    if (cands[i] && fs.existsSync(cands[i])) return cands[i];
  }
  try { execFileSync('tsc', ['--version'], { stdio: 'ignore' }); return 'tsc'; } catch (e) {}
  U.die('push needs tsc — Bun\'s transpiler modernises ES5 into syntax MicroQuickJS rejects: bun add -d typescript');
}

/* tsc, not Bun: tsc never modernises. The apps are written in the ES5
   subset already, so tsc only has the JSX to transform and prints the
   rest as it was written. */
function transpile(file, tsc) {
  var dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mjsx-tsc-'));
  var src = path.join(dir, 'in.jsx');
  fs.writeFileSync(src, fs.readFileSync(file, 'utf8'));
  execFileSync(tsc, [
    '--jsx', 'react', '--jsxFactory', 'h', '--jsxFragmentFactory', 'Fragment',
    '--target', 'es2015', '--module', 'commonjs', '--noResolve', '--skipLibCheck',
    '--allowJs', '--ignoreConfig', '--outDir', dir, src
  ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  return fs.readFileSync(path.join(dir, 'in.js'), 'utf8');
}

function coreAndShim() {
  return fs.readFileSync(path.join(U.REPO, 'packages/core/src/mjsx.js'), 'utf8') +
    '\n' + fs.readFileSync(path.join(TOOLS, 'device-shim.js'), 'utf8') +
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
  var names = fs.readdirSync(exDir).filter(function (n) {
    return fs.existsSync(path.join(exDir, n, 'app.jsx'));
  }).sort();
  if (wanted && wanted.length) {
    names = names.filter(function (n) { return wanted.indexOf(n) !== -1; });
  }
  if (!names.length) U.die('no matching examples in ' + exDir);
  var bundle = coreAndShim();
  for (var i = 0; i < names.length; i++) {
    var code = transpile(path.join(exDir, names[i], 'app.jsx'), tsc);
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
    throw new Error('engine rejected the bundle:\n' + lines.join('\n'));
  }
  console.log('engine check: ok');
}

module.exports = { buildAppBundle: buildAppBundle, buildExamplesBundle: buildExamplesBundle, validate: validate };
