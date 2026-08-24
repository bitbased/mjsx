/*
 * AUTHORED stroke data for HD text — two faces per family:
 *
 *   exact    a faithful TRACE of the bitmap's letterform. Same style, same
 *            stroke starts, same proportions; only shapes the automatic
 *            derivation cannot express (converging V, crossing X, the /
 *            line). Pixel <-> HD-exact shows identical letters. Kept
 *            selectable (fontScale 'exact') even while refined is default.
 *
 *   refined  the SAME letterforms with optical centring only. The one
 *            liberty refined may ever take is moving a stem to the true
 *            middle of the cell where the even-width 4x6 grid forced it
 *            off to col 1 (I, T, 1, !, +), and giving M and W their
 *            centre peaks at a consistent 45 degrees while the sides stay
 *            dead straight, exactly as the bitmaps structure them — never
 *            a different structure beyond that. Everything unlisted inherits exact,
 *            then falls back to the bitmap derivation, so every glyph
 *            keeps the bitmap's own letterform and angles.
 *
 * Coordinates are glyph-pixel units at pixel centres; 4x6 glyphs span
 * y 0.5..5.5, 6x8 glyphs are 5x7 letterforms spanning y 0.5..6.5.
 */

var EXACT = {
  '4x6': {
    'V': { s: [[0.5, 0.5, 0.5, 2.5], [0.5, 2.5, 2.5, 5.5], [3.5, 0.5, 3.5, 2.5], [3.5, 2.5, 2.5, 5.5]], d: [] },
    'X': { s: [[0.5, 0.5, 3.5, 5.5], [3.5, 0.5, 0.5, 5.5]], d: [] },
    '/': { s: [[3.5, 0.5, 0.5, 5.5]], d: [] },
    '*': { s: [[0.5, 1.5, 2.5, 3.5], [2.5, 1.5, 0.5, 3.5]], d: [] }
  },
  '6x8': {
    'V': { s: [[0.5, 0.5, 0.5, 4.5], [0.5, 4.5, 2.5, 6.5], [4.5, 0.5, 4.5, 4.5], [4.5, 4.5, 2.5, 6.5]], d: [] },
    'X': { s: [[0.5, 0.5, 4.5, 6.5], [4.5, 0.5, 0.5, 6.5]], d: [] },
    '/': { s: [[4.5, 0.5, 0.5, 6.5]], d: [] },
    '*': { s: [[2.5, 1.5, 2.5, 5.5], [0.5, 2.5, 4.5, 4.5], [4.5, 2.5, 0.5, 4.5], [1.5, 3.5, 3.5, 3.5]], d: [] }
  }
};

var REFINED = {
  '4x6': {
    'I': { s: [[0.5, 0.5, 3.5, 0.5], [2, 0.5, 2, 5.5], [0.5, 5.5, 3.5, 5.5]], d: [] },
    'T': { s: [[0.5, 0.5, 3.5, 0.5], [2, 0.5, 2, 5.5]], d: [] },
    '!': { s: [[2, 0.5, 2, 3.5]], d: [[2, 5.5]] },
    '+': { s: [[2, 1.4, 2, 3.6], [0.9, 2.5, 3.1, 2.5]], d: [] },
    '1': { s: [[1, 1.5, 2, 0.5], [2, 0.5, 2, 5.5], [0.9, 5.5, 3.1, 5.5]], d: [] },
    'M': { s: [[0.5, 5.5, 0.5, 0.5], [3.5, 5.5, 3.5, 0.5], [0.5, 0.5, 2, 2], [2, 2, 3.5, 0.5]], d: [] },
    'W': { s: [[0.5, 0.5, 0.5, 5.5], [3.5, 0.5, 3.5, 5.5], [0.5, 5.5, 2, 4], [2, 4, 3.5, 5.5]], d: [] }
  },
  '6x8': {
    'M': { s: [[0.5, 6.5, 0.5, 0.5], [4.5, 6.5, 4.5, 0.5], [0.5, 0.5, 2.5, 2.5], [2.5, 2.5, 4.5, 0.5]], d: [] },
    'W': { s: [[0.5, 0.5, 0.5, 6.5], [4.5, 0.5, 4.5, 6.5], [0.5, 6.5, 2.5, 4.5], [2.5, 4.5, 4.5, 6.5]], d: [] }
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
