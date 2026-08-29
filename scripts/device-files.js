/*
 * WHICH FILES SHIP TO A CHIP.
 *
 * One definition, used by both `bun run lint` and test/es5lint.test.js.
 * If the CLI and the test disagreed about the file set, the useful case
 * would be exactly the one that breaks: lint passes locally, CI fails.
 *
 * The boundary is not "everything in the repo". MicroQuickJS is an ES5
 * engine, so the subset rule applies to code that is loaded ON a device:
 * the core, the examples that get pushed to one, and the two esp32 tools
 * that are themselves shipped as device scripts. Everything else — the
 * harness, the backends, this file — runs under bun or node and is free
 * to use whatever the host supports.
 */
var fs = require('fs');
var path = require('path');

/* named individually rather than by walking backends/esp32/tools, because
   most of that directory is host-side flashing tooling that must NOT be
   held to ES5 — an earlier sweep did walk it and produced 85 false
   positives, which is how a linter gets switched off */
var ESP32_DEVICE_SCRIPTS = ['device-shim.js', 'device-menu.js'];

var TREES = ['packages/core/src', 'examples', 'local-examples'];

function deviceFiles(root) {
  var out = [];
  function walk(dir) {
    if (!fs.existsSync(dir)) return;
    fs.readdirSync(dir, { withFileTypes: true }).forEach(function (e) {
      var full = path.join(dir, e.name);
      if (e.isDirectory()) { if (e.name !== 'node_modules') walk(full); }
      else if (/\.(js|jsx)$/.test(e.name)) out.push(full);
    });
  }
  TREES.forEach(function (t) { walk(path.join(root, t)); });
  ESP32_DEVICE_SCRIPTS.forEach(function (f) {
    var p = path.join(root, 'backends/esp32/tools', f);
    if (fs.existsSync(p)) out.push(p);
  });
  return out;
}

module.exports = { deviceFiles: deviceFiles, TREES: TREES,
                   ESP32_DEVICE_SCRIPTS: ESP32_DEVICE_SCRIPTS };
