/*
 * The font registry: three sizes, one shape of table (rows of column
 * bitmasks, bit (w-1) = leftmost column).
 *
 *   '4x6'    tiny — hand-drawn, the original
 *   '6x8'    clear — hand-drawn 5x7 letterforms in a 6x8 cell
 *   '12x16'  large — generated from 6x8 with Scale2x, which rounds the
 *            corners of diagonals and curves instead of just doubling
 *            blocks; a genuinely smoother glyph, not a fatter one
 *
 * A backend picks one by name and reports {advance, lineH} for mjsx-core's
 * FONT so em() spacing and fitText widths follow the choice.
 */
var f4 = require('./font4x6.js');
var f6 = require('./font6x8.js');

function bit(rows, w, x, y, h) {
  if (x < 0 || y < 0 || x >= w || y >= h) return 0;
  return (rows[y] >> (w - 1 - x)) & 1;
}

/* Scale2x (AdvMAME2x): each source pixel becomes 2x2, corners borrowed from
   matching neighbours — the standard pixel-art doubling that keeps edges. */
function scale2x(glyphs, w, h) {
  var out = {};
  for (var ch in glyphs) {
    var src = glyphs[ch];
    var rows = [];
    for (var y = 0; y < h; y++) { rows.push(0); rows.push(0); }
    for (var y2 = 0; y2 < h; y2++) {
      for (var x = 0; x < w; x++) {
        var E = bit(src, w, x, y2, h);
        var B = bit(src, w, x, y2 - 1, h), D = bit(src, w, x - 1, y2, h);
        var F = bit(src, w, x + 1, y2, h), H = bit(src, w, x, y2 + 1, h);
        var e0 = (D === B && B !== F && D !== H) ? D : E;
        var e1 = (B === F && B !== D && F !== H) ? F : E;
        var e2 = (D === H && D !== B && H !== F) ? D : E;
        var e3 = (H === F && D !== H && B !== F) ? F : E;
        var w2 = w * 2;
        if (e0) rows[y2 * 2] |= 1 << (w2 - 1 - x * 2);
        if (e1) rows[y2 * 2] |= 1 << (w2 - 1 - (x * 2 + 1));
        if (e2) rows[y2 * 2 + 1] |= 1 << (w2 - 1 - x * 2);
        if (e3) rows[y2 * 2 + 1] |= 1 << (w2 - 1 - (x * 2 + 1));
      }
    }
    out[ch] = rows;
  }
  return out;
}

var FONTS = {
  '4x6': { glyphs: f4.FONT4x6, w: f4.GLYPH_W, h: f4.GLYPH_H },
  '6x8': { glyphs: f6.FONT6x8, w: f6.GLYPH_W, h: f6.GLYPH_H }
};
FONTS['8x12'] = { glyphs: scale2x(FONTS['4x6'].glyphs, 4, 6), w: 8, h: 12 };
FONTS['12x16'] = { glyphs: scale2x(FONTS['6x8'].glyphs, 6, 8), w: 12, h: 16 };
FONTS['16x24'] = { glyphs: scale2x(FONTS['8x12'].glyphs, 8, 12), w: 16, h: 24 };

/* Per-size font selection — the point of having several fonts at all. A
 * text size names a TARGET height (6px per step, the historic 4x6 ladder);
 * the picker takes the largest font x integer-scale (1x or 2x, never
 * fractional) that FITS WITHIN the target — never larger, so text can
 * never overflow a box its author sized for 6px-per-step — and ties go to
 * the font with more native detail over a scaled-up smaller one. So size 1
 * is the crisp 4x6, size 2 the smooth 8x12 instead of a blocky doubled
 * 4x6, size 3 the 12x16: larger text gets CLEARER, not just bigger.
 * Metrics (advance/lineH) come back with the choice so layout and
 * rasterizer always agree. */
var LADDER = [FONTS['4x6'], FONTS['6x8'], FONTS['8x12'], FONTS['12x16'], FONTS['16x24']];
var _pickMemo = {};
function pickFont(size) {
  if (_pickMemo[size]) return _pickMemo[size];
  var T = 6 * size;
  var best = null;
  for (var i = 0; i < LADDER.length; i++) {
    for (var sc = 1; sc <= 2; sc++) {
      var f = LADDER[i], hh = f.h * sc;
      if (hh > T) continue; // never larger than the size asks for
      if (!best || hh > best.h * best.scale ||
          (hh === best.h * best.scale && f.h > best.h)) {
        best = { glyphs: f.glyphs, w: f.w, h: f.h, scale: sc };
      }
    }
  }
  if (!best) { var f0 = LADDER[0]; best = { glyphs: f0.glyphs, w: f0.w, h: f0.h, scale: 1 }; }
  best.advance = (best.w + 1) * best.scale;
  best.lineH = best.h * best.scale + 2;
  _pickMemo[size] = best;
  return best;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { FONTS: FONTS, pickFont: pickFont };
}
