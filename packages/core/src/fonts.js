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
var STROKES = require('./strokes.js').STROKES;

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
    var gh = src.length; /* per glyph — descenders make tables variable-length */
    var rows = [];
    for (var y = 0; y < gh; y++) { rows.push(0); rows.push(0); }
    for (var y2 = 0; y2 < gh; y2++) {
      for (var x = 0; x < w; x++) {
        var E = bit(src, w, x, y2, gh);
        var B = bit(src, w, x, y2 - 1, gh), D = bit(src, w, x - 1, y2, gh);
        var F = bit(src, w, x + 1, y2, gh), H = bit(src, w, x, y2 + 1, gh);
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

/* d = native DETAIL: the hand-drawn source's glyph height. A derived font
   is smoother than plain doubling but carries no more real detail than the
   font it came from — the picker uses d to prefer a genuinely sharper font
   over a bigger-but-blockier one. */
/* fam = the hand-drawn FAMILY a font's letterforms come from. Precise
   (dpr) rendering upgrades resolution WITHIN a family — same face, smoother
   — so a 4x6-class text keeps looking like the 4x6, never silently swaps
   to another face. A future vector family slots in here the same way. */
/* Scale3x (AdvMAME3x): the 3x sibling of scale2x, so families have exact
   1x/2x/3x/4x members and precise mode can hit every dpr without falling
   back to blocky stamping. */
function scale3x(glyphs, w, h) {
  var out = {};
  for (var ch in glyphs) {
    var src = glyphs[ch];
    var gh = src.length; /* per glyph, same as scale2x */
    var rows = [];
    for (var i = 0; i < gh * 3; i++) rows.push(0);
    for (var y = 0; y < gh; y++) {
      for (var x = 0; x < w; x++) {
        var E = bit(src, w, x, y, gh);
        var A = bit(src, w, x - 1, y - 1, gh), B = bit(src, w, x, y - 1, gh), C = bit(src, w, x + 1, y - 1, gh);
        var D = bit(src, w, x - 1, y, gh), F = bit(src, w, x + 1, y, gh);
        var G = bit(src, w, x - 1, y + 1, gh), H = bit(src, w, x, y + 1, gh), I = bit(src, w, x + 1, y + 1, gh);
        var e = [E, E, E, E, E, E, E, E, E];
        if (B !== H && D !== F) {
          e[0] = D === B ? D : E;
          e[1] = (D === B && E !== C) || (B === F && E !== A) ? B : E;
          e[2] = B === F ? F : E;
          e[3] = (D === B && E !== G) || (D === H && E !== A) ? D : E;
          e[4] = E;
          e[5] = (B === F && E !== I) || (H === F && E !== C) ? F : E;
          e[6] = D === H ? D : E;
          e[7] = (D === H && E !== I) || (H === F && E !== G) ? H : E;
          e[8] = H === F ? F : E;
        }
        var w3 = w * 3;
        for (var q = 0; q < 9; q++) {
          if (e[q]) rows[y * 3 + Math.floor(q / 3)] |= 1 << (w3 - 1 - (x * 3 + (q % 3)));
        }
      }
    }
    out[ch] = rows;
  }
  return out;
}

var f5 = require('./font5x7.js');

var FONTS = {
  /* The Adafruit GFX classic face -- what the filament-rfid bridge
     firmware draws with natively. Here so a browser replaying that
     device's op stream renders the SAME glyphs on the SAME 6px advance;
     fixed-face only (opts.font = '5x7'), never in the size ladder. */
  '5x7': { glyphs: f5.FONT5x7, w: 5, h: 8, d: 7, fam: '5x7' },
  '4x6': { glyphs: f4.FONT4x6, w: f4.GLYPH_W, h: f4.GLYPH_H, d: 6, fam: '4x6', strokes: STROKES['4x6'] },
  '6x8': { glyphs: f6.FONT6x8, w: f6.GLYPH_W, h: f6.GLYPH_H, d: 8, fam: '6x8', strokes: STROKES['6x8'] }
};
FONTS['8x12'] = { glyphs: scale2x(FONTS['4x6'].glyphs, 4, 6), w: 8, h: 12, d: 6, fam: '4x6' };
FONTS['12x16'] = { glyphs: scale2x(FONTS['6x8'].glyphs, 6, 8), w: 12, h: 16, d: 8, fam: '6x8' };
FONTS['16x24'] = { glyphs: scale2x(FONTS['8x12'].glyphs, 8, 12), w: 16, h: 24, d: 6, fam: '4x6' };
FONTS['24x32'] = { glyphs: scale2x(FONTS['12x16'].glyphs, 12, 16), w: 24, h: 32, d: 8, fam: '6x8' };
FONTS['32x48'] = { glyphs: scale2x(FONTS['16x24'].glyphs, 16, 24), w: 32, h: 48, d: 6, fam: '4x6' };
FONTS['12x18'] = { glyphs: scale3x(FONTS['4x6'].glyphs, 4, 6), w: 12, h: 18, d: 6, fam: '4x6' };
FONTS['18x24'] = { glyphs: scale3x(FONTS['6x8'].glyphs, 6, 8), w: 18, h: 24, d: 8, fam: '6x8' };
FONTS['24x36'] = { glyphs: scale2x(FONTS['12x18'].glyphs, 12, 18), w: 24, h: 36, d: 6, fam: '4x6' };
FONTS['36x48'] = { glyphs: scale2x(FONTS['18x24'].glyphs, 18, 24), w: 36, h: 48, d: 8, fam: '6x8' };

/* Per-size font selection — the point of having several fonts at all. A
 * text size names a TARGET height (6px per step, the historic 4x6 ladder)
 * and the picker NEVER exceeds it, so text cannot overflow a box authored
 * against the linear ladder. Among the candidates that fit within one step
 * below the target, the SHARPEST font wins (highest native detail d, then
 * taller, then less scaling) — a crisp 6x8 beats a fat doubled-4x6 that
 * happens to be taller, which is the whole point of "larger should be
 * CLEARER". Only when nothing lands in that band does plain
 * largest-that-fits apply. Scales are integers (1x/2x), never fractional.
 * Metrics come back with the choice so layout and rasterizer agree. */
var LADDER = [FONTS['4x6'], FONTS['6x8'], FONTS['8x12'], FONTS['12x16'], FONTS['16x24']];
var _pickMemo = {};
function pickFont(size) {
  if (_pickMemo[size]) return _pickMemo[size];
  var T = 6 * size;
  var best = null, bestKey = null;
  for (var i = 0; i < LADDER.length; i++) {
    for (var sc = 1; sc <= 2; sc++) {
      var f = LADDER[i], hh = f.h * sc;
      if (hh > T) continue; // never larger than the size asks for
      var inBand = hh > T - 6 ? 1 : 0;
      /* lexicographic: in-band first, then detail, then height, then 1x
         over 2x */
      var key = [inBand, inBand ? f.d : 0, hh, -sc];
      var better = false;
      if (!bestKey) better = true;
      else {
        for (var k = 0; k < key.length; k++) {
          if (key[k] !== bestKey[k]) { better = key[k] > bestKey[k]; break; }
        }
      }
      if (better) {
        bestKey = key;
        best = { glyphs: f.glyphs, w: f.w, h: f.h, scale: sc, fam: f.fam };
      }
    }
  }
  if (!best) { var f0 = LADDER[0]; best = { glyphs: f0.glyphs, w: f0.w, h: f0.h, scale: 1, fam: f0.fam }; }
  best.advance = (best.w + 1) * best.scale;
  best.lineH = best.h * best.scale + 2;
  _pickMemo[size] = best;
  return best;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { FONTS: FONTS, pickFont: pickFont };
}
