/*
 * Optional host-font text for the SDL backends, via SDL2_ttf — the desktop
 * twin of the http backend's --hostfont mode. Consumes the pure-js
 * backend's captured textOps and composites REAL font glyphs into the RGB
 * frame before it is presented, fitted to the mjsx grid: one glyph advance
 * per op.adv, ascent+descent within op.lineH, baseline on the cell bottom
 * so descenders use the leading rows like the bitmap fonts do.
 *
 * Same optionality rules as SDL2 itself: dlopen'd at runtime
 * (brew install sdl2_ttf / apt install libsdl2-ttf-2.0-0), and a build
 * without it simply keeps bitmap text.
 */
var ffi = require('bun:ffi');
var dlopen = ffi.dlopen, fptr = ffi.ptr, toArrayBuffer = ffi.toArrayBuffer, read = ffi.read;
var fs = require('fs');

function libPath() {
  var cands = process.platform === 'darwin'
    ? ['/opt/homebrew/lib/libSDL2_ttf.dylib', '/usr/local/lib/libSDL2_ttf.dylib', 'libSDL2_ttf.dylib']
    : (process.platform === 'win32' ? ['SDL2_ttf.dll'] : ['libSDL2_ttf-2.0.so.0', 'libSDL2_ttf.so']);
  for (var i = 0; i < cands.length; i++) {
    if (cands[i].indexOf('/') === -1 || fs.existsSync(cands[i])) return cands[i];
  }
  return cands[0];
}

var FONT_CANDIDATES = [
  '/System/Library/Fonts/Menlo.ttc',
  '/System/Library/Fonts/Monaco.ttf',
  '/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf',
  '/usr/share/fonts/TTF/DejaVuSansMono.ttf',
  'C:\\Windows\\Fonts\\consola.ttf'
];

function createTtfText(fontFile) {
  var lib;
  try {
    lib = dlopen(libPath(), {
      TTF_Init: { args: [], returns: 'i32' },
      TTF_OpenFont: { args: ['ptr', 'i32'], returns: 'ptr' },
      TTF_CloseFont: { args: ['ptr'], returns: 'void' },
      TTF_SizeUTF8: { args: ['ptr', 'ptr', 'ptr', 'ptr'], returns: 'i32' },
      TTF_FontAscent: { args: ['ptr'], returns: 'i32' },
      TTF_FontDescent: { args: ['ptr'], returns: 'i32' },
      /* SDL_Color is a 4-byte struct passed by value = one 32-bit register */
      TTF_RenderUTF8_Blended: { args: ['ptr', 'ptr', 'u32'], returns: 'ptr' },
      SDL_FreeSurface: { args: ['ptr'], returns: 'void' }
    }).symbols;
  } catch (e) {
    return { ok: false, err: 'SDL2_ttf not available: ' + e.message };
  }
  if (lib.TTF_Init() !== 0) return { ok: false, err: 'TTF_Init failed' };

  var file = fontFile;
  if (!file) {
    for (var i = 0; i < FONT_CANDIDATES.length; i++) {
      if (fs.existsSync(FONT_CANDIDATES[i])) { file = FONT_CANDIDATES[i]; break; }
    }
  }
  if (!file || !fs.existsSync(file)) return { ok: false, err: 'no monospace font file found' };

  function cstr(s) { return fptr(Buffer.from(s + '\0', 'utf8')); }

  /* Reference metrics at 64pt: everything scales linearly from these. */
  var ref = lib.TTF_OpenFont(cstr(file), 64);
  if (!ref) return { ok: false, err: 'cannot open font ' + file };
  var wBuf = new Int32Array(1), hBuf = new Int32Array(1);
  lib.TTF_SizeUTF8(ref, cstr('M'), fptr(wBuf), fptr(hBuf));
  var refAdv = wBuf[0];
  var refLine = lib.TTF_FontAscent(ref) - lib.TTF_FontDescent(ref); /* descent is negative */
  lib.TTF_CloseFont(ref);

  var fonts = {};   /* pt -> font handle */
  var glyphs = {};  /* pt|char -> {w, h, a, ascent, data} */

  function fontAt(pt) {
    if (!fonts[pt]) fonts[pt] = lib.TTF_OpenFont(cstr(file), pt);
    return fonts[pt];
  }

  /* Fit the grid: the largest pt whose advance fits op.adv AND whose line
     box fits op.lineH — width fit first-class, as agreed. */
  function fitPt(advPx, linePx) {
    var pt = Math.floor(Math.min(64 * advPx / refAdv, 64 * linePx / refLine));
    return pt < 4 ? 4 : pt;
  }

  function glyph(pt, ch) {
    var key = pt + '|' + ch;
    if (glyphs[key]) return glyphs[key];
    var f = fontAt(pt);
    if (!f) return null;
    var surf = lib.TTF_RenderUTF8_Blended(f, cstr(ch), 0xFFFFFFFF);
    if (!surf) return null;
    /* SDL_Surface, 64-bit: w @16, h @20, pitch @24, pixels @32 */
    var gw = read.i32(surf, 16), gh = read.i32(surf, 20), pitch = read.i32(surf, 24);
    var pixels = read.ptr(surf, 32);
    var data = new Uint8Array(toArrayBuffer(pixels, 0, pitch * gh).slice(0));
    lib.SDL_FreeSurface(surf);
    var g = { w: gw, h: gh, pitch: pitch, ascent: lib.TTF_FontAscent(f), data: data };
    glyphs[key] = g;
    return g;
  }

  /* Alpha-blend the ops' glyphs into an RGB frame (3 bytes/px), honouring
     each op's clip. Coordinates are logical; dpr scales into the frame. */
  function composite(frame, PW, PH, ops, dpr) {
    for (var oi = 0; oi < ops.length; oi++) {
      var op = ops[oi];
      var pt = fitPt(op.adv * dpr, op.lineH * dpr);
      var baseY = Math.round((op.y + op.h) * dpr);
      var cr = op.color >> 16 & 255, cg = op.color >> 8 & 255, cb = op.color & 255;
      var cx0 = 0, cy0 = 0, cx1 = PW, cy1 = PH;
      if (op.clip) {
        cx0 = Math.max(0, Math.floor(op.clip.x * dpr)); cy0 = Math.max(0, Math.floor(op.clip.y * dpr));
        cx1 = Math.min(PW, Math.ceil((op.clip.x + op.clip.w) * dpr)); cy1 = Math.min(PH, Math.ceil((op.clip.y + op.clip.h) * dpr));
      }
      for (var ci = 0; ci < op.str.length; ci++) {
        var ch = op.str[ci];
        if (ch === ' ') continue;
        var g = glyph(pt, ch);
        if (!g) continue;
        var cellX = (op.x + ci * op.adv) * dpr;
        var gx0 = Math.round(cellX + (op.adv * dpr - g.w) / 2);
        var gy0 = baseY - g.ascent;
        for (var yy = 0; yy < g.h; yy++) {
          var fy = gy0 + yy;
          if (fy < cy0 || fy >= cy1) continue;
          for (var xx = 0; xx < g.w; xx++) {
            var fx = gx0 + xx;
            if (fx < cx0 || fx >= cx1) continue;
            var a = g.data[yy * g.pitch + xx * 4 + 3];
            if (!a) continue;
            var fi = (fy * PW + fx) * 3;
            frame[fi] = (cr * a + frame[fi] * (255 - a)) / 255 | 0;
            frame[fi + 1] = (cg * a + frame[fi + 1] * (255 - a)) / 255 | 0;
            frame[fi + 2] = (cb * a + frame[fi + 2] * (255 - a)) / 255 | 0;
          }
        }
      }
    }
  }

  return { ok: true, composite: composite, file: file };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { createTtfText: createTtfText };
}
