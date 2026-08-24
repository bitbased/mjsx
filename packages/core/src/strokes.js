/*
 * AUTHORED stroke data for HD text — deliberately MINIMAL. Each entry must
 * be a faithful TRACE of the bitmap's own letterform (same style, same
 * stroke starts, same proportions), never a redesign: HD is the same
 * glyph rendered cleanly, and a viewer flipping Pixel <-> HD should see
 * identical letters. Only shapes the automatic derivation cannot express
 * belong here — converging strokes (V) and full crossing/single diagonals
 * sampled onto the grid (X, /). Everything else derives from the bitmap
 * in vectorize.js. Coordinates are glyph-pixel units at pixel centres.
 */

var STROKES = {
  '4x6': {
    /* stems straight for 3 rows, then converging to the single-pixel tip
       at col 2 — exactly the bitmap's V */
    'V': { s: [[0.5, 0.5, 0.5, 2.5], [0.5, 2.5, 2.5, 5.5], [3.5, 0.5, 3.5, 2.5], [3.5, 2.5, 2.5, 5.5]], d: [] },
    'X': { s: [[0.5, 0.5, 3.5, 5.5], [3.5, 0.5, 0.5, 5.5]], d: [] },
    '/': { s: [[3.5, 0.5, 0.5, 5.5]], d: [] }
  },
  '6x8': {
    'V': { s: [[0.5, 0.5, 0.5, 4.5], [0.5, 4.5, 2.5, 6.5], [4.5, 0.5, 4.5, 4.5], [4.5, 4.5, 2.5, 6.5]], d: [] },
    'X': { s: [[0.5, 0.5, 4.5, 6.5], [4.5, 0.5, 0.5, 6.5]], d: [] },
    '/': { s: [[4.5, 0.5, 0.5, 6.5]], d: [] }
  }
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { STROKES: STROKES };
}
