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
  '6x8': { glyphs: f6.FONT6x8, w: f6.GLYPH_W, h: f6.GLYPH_H },
  '12x16': { glyphs: scale2x(f6.FONT6x8, f6.GLYPH_W, f6.GLYPH_H), w: 12, h: 16 }
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { FONTS: FONTS };
}
