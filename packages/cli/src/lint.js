/*
 * mjsx lint — is this code inside the subset its target can parse?
 *
 * The levels are a property of WHERE the file runs, so they are decided
 * by path rather than asked for: packages/core and examples/ ship to a
 * chip and must be ES5; everything else only ever runs under bun or node.
 * That default is the whole point — a rule nobody has to remember.
 */
var fs = require('fs');
var path = require('path');
var U = require('./util.js');

var linter = require(path.join(U.REPO, 'packages/core/src/es5lint.js'));

/* Which subset a path must satisfy. First match wins. */
var LEVELS = [
  ['packages/core/', 'mquickjs'],
  ['examples/', 'mquickjs'],
  ['local-examples/', 'mquickjs'],
  /* Only these two files from the ESP32 tools directory are part of the
     bundle; the rest are build scripts that run under bun and may use
     anything. Naming the files beats trusting a directory. */
  ['backends/esp32/tools/device-shim.js', 'mquickjs'],
  ['backends/esp32/tools/device-menu.js', 'mquickjs'],
];

function levelFor(rel) {
  for (var i = 0; i < LEVELS.length; i++) {
    if (rel.indexOf(LEVELS[i][0]) === 0) return LEVELS[i][1];
  }
  return 'modern';
}

function walk(dir, out, skip) {
  var entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return out; }
  for (var i = 0; i < entries.length; i++) {
    var e = entries[i];
    var full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (skip.indexOf(e.name) !== -1) continue;
      walk(full, out, skip);
    } else if (/\.(js|jsx|mjs)$/.test(e.name)) {
      out.push(full);
    }
  }
  return out;
}

function run(args) {
  var forced = null;
  var targets = [];
  for (var i = 0; i < args.length; i++) {
    if (args[i] === '--level') { forced = args[++i]; continue; }
    if (args[i] === '--help' || args[i] === '-h') {
      console.log('usage: mjsx lint [path...] [--level mquickjs|quickjs|modern]');
      console.log('');
      console.log('Checks that code stays inside the subset its target can parse.');
      console.log('Without paths, checks everything that ships to a device:');
      console.log('  packages/core, examples, local-examples, backends/esp32/tools');
      console.log('The level is chosen per path unless --level forces one.');
      return 0;
    }
    targets.push(args[i]);
  }

  var files = [];
  var skip = ['node_modules', 'dist', 'out', '.astro', '.git', 'site'];
  if (targets.length) {
    for (var t = 0; t < targets.length; t++) {
      var p = path.resolve(targets[t]);
      if (!fs.existsSync(p)) U.die('mjsx lint: no such path: ' + targets[t]);
      if (fs.statSync(p).isDirectory()) walk(p, files, skip);
      else files.push(p);
    }
  } else {
    walk(path.join(U.REPO, 'packages/core'), files, skip);
    walk(path.join(U.REPO, 'examples'), files, skip);
    walk(path.join(U.REPO, 'local-examples'), files, skip);
    files.push(path.join(U.REPO, 'backends/esp32/tools/device-shim.js'));
    files.push(path.join(U.REPO, 'backends/esp32/tools/device-menu.js'));
  }

  var problems = 0;
  var checked = 0;
  for (var f = 0; f < files.length; f++) {
    var file = files[f];
    var rel = path.relative(U.REPO, file);
    var level = forced || levelFor(rel);
    if (level === 'modern') continue;
    checked++;
    var findings = linter.lint(fs.readFileSync(file, 'utf8'), { level: level });
    for (var k = 0; k < findings.length; k++) {
      var d = findings[k];
      console.log(rel + ':' + d.line + '  ' + d.rule + ' — ' + d.message);
      problems++;
    }
  }

  if (problems) {
    console.log('');
    console.log(problems + ' problem(s) in ' + checked + ' file(s) — this code would not parse on the device');
    return 1;
  }
  console.log(checked + ' file(s) clean');
  return 0;
}

function main(argv) {
  var code = run(argv);
  if (code) process.exit(code);
}

module.exports = { main: main, run: run, levelFor: levelFor };
