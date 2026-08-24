/*
 * The 4x6 dot-matrix font shared by backends that rasterize text into
 * their own pixel buffer (pure-js, terminal in pixel-text mode). Uppercase
 * plus digits and a little punctuation — glyphs get added as examples need
 * them. Unknown glyphs are the caller's problem to skip.
 */
var FONT4x6 = {
  ' ': [0, 0, 0, 0, 0, 0],
  'A': [6, 9, 15, 9, 9, 9],
  'V': [9, 9, 9, 6, 6, 2],
  'Y': [9, 9, 6, 4, 4, 4],
  'Z': [15, 1, 2, 4, 8, 15],
  '(': [2, 4, 4, 4, 4, 2],
  ')': [4, 2, 2, 2, 2, 4],
  '/': [1, 2, 2, 4, 4, 8],
  'F': [15, 8, 14, 8, 8, 8],
  'G': [7, 8, 8, 11, 9, 7],
  'K': [9, 10, 12, 10, 9, 9],
  'Q': [6, 9, 9, 9, 6, 1],
  '?': [6, 9, 1, 2, 0, 2],
  "'": [4, 4, 0, 0, 0, 0],
  '%': [9, 1, 2, 4, 8, 9],
  /* lowercase: derived from Filmote's Font4x6 for the Arduboy
     (github.com/filmote/Font4x6, BSD 3-Clause, copyright 2018 Filmote),
     decoded from its column-major data. Descenders (g j p q y, and f's
     ascender-height cousin j) use row 6 - BELOW the 6-row cell, inside
     the line pitch's spacing rows, which is what real descenders do.
     Glyph arrays here are variable-length; the rasterizers draw
     rows.length rows, not a fixed cell height. */
  'a': [0, 6, 1, 7, 9, 7],
  'b': [8, 8, 14, 9, 9, 14],
  'c': [0, 6, 9, 8, 9, 6],
  'd': [1, 1, 7, 9, 9, 7],
  'e': [0, 6, 9, 15, 8, 7],
  'f': [3, 4, 14, 4, 4, 4], /* Filmote's f descends below baseline; ours stops on it */
  'g': [0, 7, 9, 9, 7, 1, 14],
  'h': [8, 8, 14, 9, 9, 9],
  'i': [4, 0, 12, 4, 4, 14],
  'j': [1, 0, 3, 1, 1, 1, 14],
  'k': [8, 9, 10, 12, 10, 9],
  'l': [12, 4, 4, 4, 4, 14],
  'm': [0, 9, 15, 9, 9, 9],
  'n': [0, 10, 13, 9, 9, 9],
  'o': [0, 6, 9, 9, 9, 6],
  'p': [0, 14, 9, 9, 9, 14, 8],
  'q': [0, 7, 9, 9, 9, 7, 1],
  'r': [0, 10, 13, 8, 8, 8],
  's': [0, 7, 8, 6, 1, 14],
  't': [4, 14, 4, 4, 4, 3],
  'u': [0, 9, 9, 9, 9, 6],
  'v': [0, 9, 9, 9, 5, 2],
  'w': [0, 9, 9, 9, 15, 9],
  'x': [0, 9, 9, 6, 9, 9],
  'y': [0, 9, 9, 9, 7, 1, 14],
  'z': [0, 15, 2, 4, 8, 15],
  '0': [6, 9, 9, 9, 9, 6],
  '1': [4, 12, 4, 4, 4, 14],
  '2': [14, 1, 6, 8, 8, 15],
  '3': [14, 1, 6, 1, 1, 14],
  '4': [9, 9, 15, 1, 1, 1],
  '5': [15, 8, 14, 1, 1, 14],
  '6': [7, 8, 14, 9, 9, 6],
  '7': [15, 1, 2, 4, 4, 4],
  '8': [6, 9, 6, 9, 9, 6],
  '9': [6, 9, 9, 7, 1, 14],
  'B': [14, 9, 14, 9, 9, 14],
  'C': [7, 8, 8, 8, 8, 7],
  'D': [14, 9, 9, 9, 9, 14],
  'E': [15, 8, 14, 8, 8, 15],
  'H': [9, 9, 15, 9, 9, 9],
  'I': [15, 4, 4, 4, 4, 15],
  'J': [3, 1, 1, 1, 9, 6],
  'L': [8, 8, 8, 8, 8, 15],
  'M': [9, 15, 9, 9, 9, 9],
  'N': [9, 13, 11, 9, 9, 9],
  'O': [6, 9, 9, 9, 9, 6],
  'P': [14, 9, 14, 8, 8, 8],
  'R': [14, 9, 14, 10, 9, 9],
  'S': [7, 8, 6, 1, 1, 14],
  'T': [15, 4, 4, 4, 4, 4],
  'U': [9, 9, 9, 9, 9, 6],
  'W': [9, 9, 9, 9, 15, 9],
  'X': [9, 9, 6, 6, 9, 9],
  '!': [4, 4, 4, 4, 0, 4],
  ',': [0, 0, 0, 0, 4, 8],
  '.': [0, 0, 0, 0, 0, 4],
  ':': [0, 4, 0, 0, 4, 0],
  '+': [0, 4, 14, 4, 0, 0],
  '-': [0, 0, 14, 0, 0, 0],
  '=': [0, 15, 0, 15, 0, 0]
};
var GLYPH_W = 4, GLYPH_H = 6;

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { FONT4x6: FONT4x6, GLYPH_W: GLYPH_W, GLYPH_H: GLYPH_H };
}
