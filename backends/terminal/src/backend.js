/*
 * terminal backend — mjsx rendered straight to an ANSI true-color terminal.
 * The "something like Ink" backend: same native-api, same mjsx-core, no
 * pixel buffer file to open — it just draws where you're already looking.
 *
 * Two modes, one switch (opts.mode). 'pixel': everything — text included —
 * is rasterized into a sub-pixel buffer shown as half-blocks (▀, two
 * vertical sub-pixels per cell with independent fg/bg colours), a faithful
 * preview of what a pixel panel renders. 'char': one pixel per cell as
 * background-coloured spaces, with text printed as real characters in the
 * terminal's own font — compact and legible rather than faithful.
 */

var fontsMod = require('../../../packages/core/src/fonts.js');
var FONTS = fontsMod.FONTS, pickFont = fontsMod.pickFont;

var HALF_BLOCK = '\u2584'; /* ▄ LOWER half block: foreground carries the BOTTOM
   sub-pixel, background the top. Lower, not upper, deliberately: in many
   monospace fonts U+2580 (▀) is drawn mis-sized / floating mid-cell while
   U+2584 sits edge-to-edge — the same reason viu/catimg render with ▄. */

function createTerminalBackend(cols, charH, opts) {
  charH = charH || Math.max(1, Math.floor((process.stdout.rows || 24) - 1));
  opts = opts || {};
  /* Three renders, one switch.
     'pixel' (default): 2 vertical sub-pixels per cell via ▄ (lower half
       block — see HALF_BLOCK for why lower), text rasterized through the
       shared 4x6 bitmap font — nothing on screen is terminal text.
     'block': 1 pixel = 2 cells wide x 1 cell tall (~square), every pixel a
       run of background-coloured spaces, text still rasterized. Half the
       vertical resolution of 'pixel' and half the columns, but zero glyph
       dependence — renders exactly the same in every font.
     'char': 1 pixel per cell, text as real characters in the terminal's own
       font — compact and legible, not a pixel preview. */
  var mode = (opts.mode === 'char' || opts.mode === 'cell') ? 'char'
           : (opts.mode === 'block' ? 'block' : 'pixel');
  /* Which bitmap font pixel/block modes rasterize with — '4x6' default
     (terminal cells are already big); '6x8' / '12x16' when clearer text
     matters more than space. */
  var bfixed = opts.font ? (FONTS[opts.font] || FONTS['4x6']) : null;
  function bfontFor(size) {
    if (!bfixed) return pickFont(size);
    return { glyphs: bfixed.glyphs, w: bfixed.w, h: bfixed.h, scale: size };
  }
  var ySub = mode === 'pixel' ? 2 : 1; // sub-pixel rows per character row
  var xSub = mode === 'block' ? 2 : 1; // character columns per pixel
  var w = Math.floor(cols / xSub), h = charH * ySub;
  var px = new Uint32Array(w * h); // packed 0xRRGGBB, one entry per sub-pixel
  var clipRect = null;
  var texts = []; // {x, y, size, color, str} — drawn after the pixel grid, in the real font
  var startedAt = Date.now();

  function inClip(x, y) {
    if (!clipRect) return true;
    return x >= clipRect.x && y >= clipRect.y && x < clipRect.x + clipRect.w && y < clipRect.y + clipRect.h;
  }
  function setPixel(x, y, rgb) {
    x = Math.round(x); y = Math.round(y);
    if (x < 0 || y < 0 || x >= w || y >= h || !inClip(x, y)) return;
    px[y * w + x] = rgb;
  }
  function fillRect(x, y, ww, hh, rgb) {
    for (var yy = y; yy < y + hh; yy++) for (var xx = x; xx < x + ww; xx++) setPixel(xx, yy, rgb);
  }
  function drawLine(x0, y0, x1, y1, rgb) {
    x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
    var dx = Math.abs(x1 - x0), sx = x0 < x1 ? 1 : -1;
    var dy = -Math.abs(y1 - y0), sy = y0 < y1 ? 1 : -1;
    var err = dx + dy;
    for (;;) {
      setPixel(x0, y0, rgb);
      if (x0 === x1 && y0 === y1) break;
      var e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
  }
  function drawCircle(cx, cy, r, rgb, filled) {
    for (var y = -r; y <= r; y++) for (var x = -r; x <= r; x++) {
      var d = x * x + y * y;
      if (filled ? d <= r * r : (d <= r * r && d > (r - 1) * (r - 1))) setPixel(cx + x, cy + y, rgb);
    }
  }

  var gfx = {
    clear: function (color) { fillRect(0, 0, w, h, color >>> 0); texts.length = 0; },
    rect: function (x, y, ww, hh, color, radius) {
      drawLine(x, y, x + ww - 1, y, color); drawLine(x, y + hh - 1, x + ww - 1, y + hh - 1, color);
      drawLine(x, y, x, y + hh - 1, color); drawLine(x + ww - 1, y, x + ww - 1, y + hh - 1, color);
    },
    frect: function (x, y, ww, hh, color, radius) { fillRect(x, y, ww, hh, color); },
    circle: function (x, y, r, color, filled) { drawCircle(x, y, r, color, filled); },
    line: function (x0, y0, x1, y1, color) { drawLine(x0, y0, x1, y1, color); },
    text: function (x, y, size, color, str) {
      if (mode !== 'char') {
        /* Rasterized like every other shape — setPixel honours the active
           clip, so scrolled-out glyphs clip themselves. No terminal text
           in this mode, at all. */
        var bf = bfontFor(size);
        var s2 = ('' + str).toUpperCase();
        for (var gi = 0; gi < s2.length; gi++) {
          var rows = bf.glyphs[s2[gi]];
          var gx = x + gi * (bf.w + 1) * bf.scale;
          if (!rows) continue; // unknown glyph: skip rather than draw noise
          for (var gr = 0; gr < bf.h; gr++) {
            var bits = rows[gr];
            for (var gc = 0; gc < bf.w; gc++) {
              if (bits & (1 << (bf.w - 1 - gc))) {
                fillRect(gx + gc * bf.scale, y + gr * bf.scale, bf.scale, bf.scale, color >>> 0);
              }
            }
          }
        }
        return;
      }
      /* char mode: drawn later as real characters. The active clip travels
         with the stamp — text lands after the pixel grid, and by then the
         scroll viewport's clip is long gone; without it a label scrolled
         out of view prints below the canvas, over the footer. */
      texts.push({ x: x, y: y, size: size, color: color, str: '' + str, clip: clipRect });
    },
    clip: function (x, y, ww, hh) { clipRect = { x: x, y: y, w: ww, h: hh }; },
    unclip: function () { clipRect = null; },
    width: function () { return w; },
    height: function () { return h; } // sub-pixel rows — the same space every gfx.* call draws in
  };

  var sys = {
    millis: function () { return Date.now() - startedAt; },
    beep: function () { process.stdout.write('\x07'); }, // the one native call a terminal can genuinely do
    tone: function () { },
    exit: function () { },
    store: function () { }, fetch: function () { return ''; }
  };

  function rgbOf(c) { return [(c >> 16) & 0xff, (c >> 8) & 0xff, c & 0xff]; }

  /* Terminal.app has NO 24-bit colour support — it mis-parses 38;2;R;G;B as
     a run of legacy codes and everything collapses to default white-on-black
     (full-width white stripe bars, in practice). So true-colour SGR is only
     emitted when the terminal says it can take it (COLORTERM, set by iTerm2,
     kitty, VS Code, etc); everything else gets the xterm-256 palette, which
     Terminal.app has handled forever. */
  var TRUECOLOR = /truecolor|24bit/i.test(process.env.COLORTERM || '');
  function to256(r, g, b) {
    if (r === g && g === b) { // grayscale ramp is finer than the 6x6x6 cube
      if (r < 8) return 16;
      if (r > 248) return 231;
      return 232 + Math.round((r - 8) / 247 * 23);
    }
    return 16 + 36 * Math.round(r / 255 * 5) + 6 * Math.round(g / 255 * 5) + Math.round(b / 255 * 5);
  }
  function fg(c) {
    var r = rgbOf(c);
    return TRUECOLOR ? '\x1b[38;2;' + r[0] + ';' + r[1] + ';' + r[2] + 'm'
                     : '\x1b[38;5;' + to256(r[0], r[1], r[2]) + 'm';
  }
  function bg(c) {
    var r = rgbOf(c);
    return TRUECOLOR ? '\x1b[48;2;' + r[0] + ';' + r[1] + ';' + r[2] + 'm'
                     : '\x1b[48;5;' + to256(r[0], r[1], r[2]) + 'm';
  }

  /* Render the half-block grid, then stamp text over it at its cell
     position — real glyphs, the terminal's own font, drawn last so a label
     is never hidden behind the colour it sits on. */
  function toAnsi() {
    var out = '\x1b[H'; // cursor home; the caller decides whether to also clear scrollback
    var lastFg = -1, lastBg = -1;
    for (var row = 0; row < charH; row++) {
      var line = '';
      for (var col = 0; col < w; col++) {
        var top = px[(row * ySub) * w + col];
        var bot = mode === 'pixel' ? px[(row * 2 + 1) * w + col] : top;
        if (top === bot) {
          /* Uniform cell: background-coloured space(s) — no glyph, so no
             dependence on how the font draws ▀ (some centre it in the cell),
             and no foreground colour to get wrong at all. */
          if (bot !== lastBg) { line += bg(bot); lastBg = bot; }
          line += xSub === 2 ? '  ' : ' ';
        } else {
          /* ▄: the glyph ink is the bottom sub-pixel, the showing-through
             background is the top one. */
          if (bot !== lastFg) { line += fg(bot); lastFg = bot; }
          if (top !== lastBg) { line += bg(top); lastBg = top; }
          line += HALF_BLOCK;
        }
      }
      out += line + '\x1b[0m\r\n';
      lastFg = lastBg = -1;
    }
    for (var i = 0; i < texts.length; i++) {
      var t = texts[i];
      var col2 = Math.round(t.x / 1), row2 = Math.round(t.y / ySub) + 1; // sub-pixel y -> character row
      var s = t.str;
      if (t.clip) {
        /* Character-row granularity version of the pixel clip: outside
           vertically -> gone entirely; sticking out horizontally -> trimmed
           to the clipped columns. */
        var rowMin = Math.floor(t.clip.y / ySub) + 1, rowMax = Math.ceil((t.clip.y + t.clip.h) / ySub);
        if (row2 < rowMin || row2 > rowMax) continue;
        var cx0 = Math.max(col2, Math.ceil(t.clip.x));
        var cx1 = Math.min(col2 + s.length, Math.floor(t.clip.x + t.clip.w));
        if (cx1 <= cx0) continue;
        s = s.substring(cx0 - col2, cx1 - col2);
        col2 = cx0;
      }
      /* And never off the canvas itself — a stamp past the last row lands on
         the footer, past the right edge wraps onto the next line. */
      if (row2 < 1 || row2 > charH) continue;
      if (col2 < 0) { s = s.substring(-col2); col2 = 0; }
      if (col2 + s.length > w) s = s.substring(0, w - col2);
      if (!s) continue;
      /* Per-character background sampled from the pixels underneath — with
         only a foreground set, the terminal paints its own default behind
         the glyphs and every label sits in a black box instead of on the
         fill it was drawn over. */
      var stamp = '\x1b[' + row2 + ';' + (col2 + 1) + 'H' + fg(t.color);
      var lastTBg = -1;
      for (var j = 0; j < s.length; j++) {
        var py = (row2 - 1) * ySub;
        var under = px[(ySub === 2 ? py + 1 : py) * w + (col2 + j)];
        if (under !== lastTBg) { stamp += bg(under); lastTBg = under; }
        stamp += s[j];
      }
      out += stamp + '\x1b[0m';
    }
    return out;
  }

  /* font: what a runner should copy onto mjsx-core's FONT for this mode —
     pixel text has real glyph metrics, char text is one cell per char and
     one row per line. quantum keeps em() spacing on whole character rows. */
  var bbase = bfontFor(1);
  var font = mode === 'char'
    ? { advance: 1, lineH: 1, quantum: 1, pick: null }
    : { advance: bbase.w + 1, lineH: bbase.h + 2, quantum: ySub, pick: bfixed ? null : pickFont };
  return { gfx: gfx, sys: sys, toAnsi: toAnsi, width: w, height: charH, mode: mode, ySub: ySub, xSub: xSub, font: font };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { createTerminalBackend: createTerminalBackend };
}
