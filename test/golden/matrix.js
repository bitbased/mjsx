/*
 * The golden matrix: every example x every display shape, rendered the
 * same way by the test and by regen.mjs so the two can never drift.
 *
 * Shapes are the three the layout code actually branches on:
 *   240x280  tall portrait — the default panel the examples were drawn for
 *   320x172  short landscape — wide, and short enough that vertical space
 *            is genuinely scarce (scroll clamps, footers, keyboards)
 *   240x240r round glass — configStorage 'round'='1', which is what a
 *            firmware seeds and what UI.isRound() reads
 *
 * DETERMINISM. A golden hash is only worth having if the same source
 * gives the same bytes forever, so everything the frame can vary with is
 * pinned here:
 *   - sys.millis() is frozen at 0 before the example loads. examples/sensors
 *     prints an uptime and derives its accelerometer numbers from millis, so
 *     unfrozen it would hash differently on every run. Freezing keeps it in
 *     the matrix instead of excluding it.
 *   - the backend, the core and the example module are all fresh per render
 *     (test/load.js's fresh() drops the core's require-cache entry; we drop
 *     the example's), so no state leaks between cells of the matrix.
 * Nothing else in core or the examples reads a clock or Math.random —
 * checked, and worth re-checking if a cell ever starts flapping.
 */
'use strict';
var fs = require('fs');
var path = require('path');
var load = require('../load.js');

var ROOT = load.ROOT;
var EXAMPLES_DIR = path.join(ROOT, 'examples');

/* Every directory under examples/ that has an app.jsx, sorted. Discovered,
   not listed: a new example joins the matrix by existing, and then fails
   until someone reseeds its hashes — which is the intent. */
function exampleNames() {
  return fs.readdirSync(EXAMPLES_DIR).filter(function (n) {
    return fs.statSync(path.join(EXAMPLES_DIR, n)).isDirectory() &&
           fs.existsSync(path.join(EXAMPLES_DIR, n, 'app.jsx'));
  }).sort();
}

var SHAPES = [
  { w: 240, h: 280, round: false },
  { w: 320, h: 172, round: false },
  { w: 240, h: 240, round: true }
];

function keyFor(name, shape) {
  return name + '@' + shape.w + 'x' + shape.h + (shape.round ? 'r' : '');
}

/* Render one cell and return the sha256 of the raw RGB framebuffer.
   Mirrors test/load.js's renderExample(), plus the millis freeze and the
   round seed — both of which must happen BEFORE the example's top-level
   code runs, since an example may read either while mounting. */
function renderCell(name, shape) {
  var t = load.fresh(shape.w, shape.h);
  t.backend.sys.millis = function () { return 0; };
  if (shape.round) t.backend.sys.store('round', '1'); // what a firmware seeds; UI.isRound() reads it
  var abs = path.join(EXAMPLES_DIR, name, 'app.jsx');
  delete require.cache[require.resolve(abs)];
  require(abs);
  t.UI.render();
  return load.sha256(t.backend.raw);
}

/* [{ name, shape, key }] in a stable order: example, then shape. */
function matrix() {
  var cells = [];
  var names = exampleNames();
  for (var i = 0; i < names.length; i++) {
    for (var j = 0; j < SHAPES.length; j++) {
      cells.push({ name: names[i], shape: SHAPES[j], key: keyFor(names[i], SHAPES[j]) });
    }
  }
  return cells;
}

module.exports = {
  SHAPES: SHAPES,
  exampleNames: exampleNames,
  keyFor: keyFor,
  renderCell: renderCell,
  matrix: matrix,
  HASHES_FILE: path.join(__dirname, 'hashes.json')
};
