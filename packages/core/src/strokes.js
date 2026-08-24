/*
 * AUTHORED stroke data for HD text — two faces per family:
 *
 *   exact    a faithful TRACE of the bitmap's letterform. Same style, same
 *            stroke starts, same proportions; only shapes the automatic
 *            derivation cannot express (converging V, crossing X, the /
 *            line). Pixel <-> HD-exact shows identical letters. Kept
 *            selectable (fontScale 'exact') even while refined is default.
 *
 *   refined  the polish face: modest, DELIBERATE liberties on the same
 *            metrics — optical centring (the 4x6 I and T stems sit at the
 *            true middle instead of col 1), smooth full-slope V/W/Y legs,
 *            a peaked M, full N/Z diagonals, Q's bowl with a crossing
 *            tail. Everything unlisted inherits exact, then falls back to
 *            the bitmap derivation.
 *
 * Coordinates are glyph-pixel units at pixel centres; 4x6 glyphs span
 * y 0.5..5.5, 6x8 glyphs are 5x7 letterforms spanning y 0.5..6.5.
 */

var EXACT = {
  '4x6': {
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

var REFINED = {
  '4x6': {
    'I': { s: [[0.5, 0.5, 3.5, 0.5], [2, 0.5, 2, 5.5], [0.5, 5.5, 3.5, 5.5]], d: [] },
    'T': { s: [[0.5, 0.5, 3.5, 0.5], [2, 0.5, 2, 5.5]], d: [] },
    '!': { s: [[2, 0.5, 2, 3.5]], d: [[2, 5.5]] },
    '+': { s: [[2, 1.4, 2, 3.6], [0.9, 2.5, 3.1, 2.5]], d: [] },
    '1': { s: [[1, 1.5, 2, 0.5], [2, 0.5, 2, 5.5], [0.9, 5.5, 3.1, 5.5]], d: [] },
    'V': { s: [[0.5, 0.5, 2, 5.5], [2, 5.5, 3.5, 0.5]], d: [] },
    'W': { s: [[0.5, 0.5, 1.17, 5.5], [1.17, 5.5, 2, 1.8], [2, 1.8, 2.83, 5.5], [2.83, 5.5, 3.5, 0.5]], d: [] },
    'Y': { s: [[0.5, 0.5, 2, 3], [3.5, 0.5, 2, 3], [2, 3, 2, 5.5]], d: [] },
    'M': { s: [[0.5, 5.5, 0.5, 0.5], [0.5, 0.5, 2, 2.5], [2, 2.5, 3.5, 0.5], [3.5, 0.5, 3.5, 5.5]], d: [] },
    'N': { s: [[0.5, 5.5, 0.5, 0.5], [0.5, 0.5, 3.5, 5.5], [3.5, 5.5, 3.5, 0.5]], d: [] },
    'K': { s: [[0.5, 0.5, 0.5, 5.5], [3.5, 0.5, 0.7, 3], [1.3, 2.6, 3.5, 5.5]], d: [] },
    'Z': { s: [[0.5, 0.5, 3.5, 0.5], [3.5, 0.5, 0.5, 5.5], [0.5, 5.5, 3.5, 5.5]], d: [] },
    '7': { s: [[0.5, 0.5, 3.5, 0.5], [3.5, 0.5, 1.5, 5.5]], d: [] },
    'Q': { s: [[1.2, 0.5, 2.8, 0.5], [0.5, 1.2, 0.5, 3.8], [3.5, 1.2, 3.5, 3.6], [1.2, 4.5, 2.2, 4.5], [1.2, 0.5, 0.5, 1.2], [2.8, 0.5, 3.5, 1.2], [0.5, 3.8, 1.2, 4.5], [2.3, 3.9, 3.5, 5.5]], d: [] }
  },
  '6x8': {
    'V': { s: [[0.5, 0.5, 2.5, 6.5], [2.5, 6.5, 4.5, 0.5]], d: [] },
    'W': { s: [[0.5, 0.5, 1.5, 6.5], [1.5, 6.5, 2.5, 2.5], [2.5, 2.5, 3.5, 6.5], [3.5, 6.5, 4.5, 0.5]], d: [] },
    'Y': { s: [[0.5, 0.5, 2.5, 3.5], [4.5, 0.5, 2.5, 3.5], [2.5, 3.5, 2.5, 6.5]], d: [] },
    'M': { s: [[0.5, 6.5, 0.5, 0.5], [0.5, 0.5, 2.5, 2.9], [2.5, 2.9, 4.5, 0.5], [4.5, 0.5, 4.5, 6.5]], d: [] },
    'N': { s: [[0.5, 6.5, 0.5, 0.5], [0.5, 0.5, 4.5, 6.5], [4.5, 6.5, 4.5, 0.5]], d: [] },
    'K': { s: [[0.5, 0.5, 0.5, 6.5], [4.5, 0.5, 0.7, 3.5], [1.6, 2.9, 4.5, 6.5]], d: [] },
    'Z': { s: [[0.5, 0.5, 4.5, 0.5], [4.5, 0.5, 0.5, 6.5], [0.5, 6.5, 4.5, 6.5]], d: [] },
    '7': { s: [[0.5, 0.5, 4.5, 0.5], [4.5, 0.5, 2, 6.5]], d: [] },
    'Q': { s: [[1.4, 0.5, 3.6, 0.5], [0.5, 1.4, 0.5, 5.6], [4.5, 1.4, 4.5, 4.4], [1.4, 6.5, 2.4, 6.5], [1.4, 0.5, 0.5, 1.4], [3.6, 0.5, 4.5, 1.4], [0.5, 5.6, 1.4, 6.5], [2.6, 4.3, 4.5, 6.5]], d: [] }
  }
};

/* refined inherits exact, then overrides */
function merge(a, b) {
  var out = {};
  var k;
  for (k in a) out[k] = a[k];
  for (k in b) out[k] = b[k];
  return out;
}

var STROKES = {
  '4x6': { exact: EXACT['4x6'], refined: merge(EXACT['4x6'], REFINED['4x6']) },
  '6x8': { exact: EXACT['6x8'], refined: merge(EXACT['6x8'], REFINED['6x8']) }
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { STROKES: STROKES };
}
