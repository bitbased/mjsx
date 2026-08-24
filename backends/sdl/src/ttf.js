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

/* Face discovery, two tiers. First: any .ttf/.ttc dropped into the repo's
   fonts/ directory (JetBrains Mono and Roboto Mono Bold ship there; add
   whatever you like). Then per-platform system fallbacks, best first. The
   sim's FACE button cycles everything found. */
var path = require('path');
var FONTS_DIR = path.resolve(__dirname, '../../../fonts');
var SYSTEM_FACES = [
  { name: 'SF MONO', candidates: ['/System/Library/Fonts/SFNSMono.ttf'] },
  { name: 'PT MONO', candidates: ['/System/Library/Fonts/Supplemental/PTMono.ttc'] },
  { name: 'MENLO', candidates: [
    '/System/Library/Fonts/Menlo.ttc',
    '/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf',
    '/usr/share/fonts/TTF/DejaVuSansMono.ttf',
    'C:\\Windows\\Fonts\\consola.ttf'
  ] }
];

function availableFaces() {
  var out = [];
  try {
    var files = fs.readdirSync(FONTS_DIR).sort();
    for (var fi = 0; fi < files.length; fi++) {
      if (/\.(ttf|ttc|otf)$/i.test(files[fi])) {
        var nm = files[fi].replace(/\.(ttf|ttc|otf)$/i, '').replace(/-Regular$/i, '')
                          .replace(/([a-z])([A-Z])/g, '$1 $2').toUpperCase();
        out.push({ name: nm, file: path.join(FONTS_DIR, files[fi]) });
      }
    }
  } catch (e) { /* no fonts dir: system faces only */ }
  for (var i = 0; i < SYSTEM_FACES.length; i++) {
    for (var j = 0; j < SYSTEM_FACES[i].candidates.length; j++) {
      if (fs.existsSync(SYSTEM_FACES[i].candidates[j])) {
        out.push({ name: SYSTEM_FACES[i].name, file: SYSTEM_FACES[i].candidates[j] });
        break;
      }
    }
  }
  return out;
}

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
  if (file && !fs.existsSync(file)) {
    /* a face NAME rather than a path */
    var byName = availableFaces().filter(function (f) { return f.name === ('' + file).toUpperCase(); });
    file = byName.length ? byName[0].file : null;
  }
  if (!file) {
    var av = availableFaces();
    file = av.length ? av[0].file : null;
  }
  if (!file || !fs.existsSync(file)) return { ok: false, err: 'no monospace font file found' };

  function cstr(s) { return fptr(Buffer.from(s + '\0', 'utf8')); }

  /* Reference metrics at 64pt: everything scales linearly from these. The
     crucial one is MEASURED cap height (the 'M' ink's rise above the
     baseline), not the font's nominal line box — monospace faces carry
     line boxes far taller than their caps (~1.17em for Menlo), and fitting
     the whole box shrinks the visible glyphs well below the bitmap's.
     Caps fill the cell; descenders spill into the leading rows, exactly
     like the bitmap fonts. */
  var ref = lib.TTF_OpenFont(cstr(file), 64);
  if (!ref) return { ok: false, err: 'cannot open font ' + file };
  var wBuf = new Int32Array(1), hBuf = new Int32Array(1);
  lib.TTF_SizeUTF8(ref, cstr('M'), fptr(wBuf), fptr(hBuf));
  var refAdv = wBuf[0];
  var refAscent = lib.TTF_FontAscent(ref);
  var refCap = refAscent * 0.75; /* fallback if the ink scan fails */
  var mSurf = lib.TTF_RenderUTF8_Blended(ref, cstr('M'), 0xFFFFFFFF);
  if (mSurf) {
    var mw = read.i32(mSurf, 16), mh = read.i32(mSurf, 20), mp = read.i32(mSurf, 24);
    var mpx = new Uint8Array(toArrayBuffer(read.ptr(mSurf, 32), 0, mp * mh).slice(0));
    var inkTop = -1;
    for (var sy = 0; sy < mh && inkTop < 0; sy++) {
      for (var sx = 0; sx < mw; sx++) {
        if (mpx[sy * mp + sx * 4 + 3] > 32) { inkTop = sy; break; }
      }
    }
    if (inkTop >= 0) refCap = refAscent - inkTop;
    lib.SDL_FreeSurface(mSurf);
  }
  lib.TTF_CloseFont(ref);

  var fonts = {};   /* pt -> font handle */
  var glyphs = {};  /* pt|char -> {w, h, a, ascent, data} */

  function fontAt(pt) {
    if (!fonts[pt]) fonts[pt] = lib.TTF_OpenFont(cstr(file), pt);
    return fonts[pt];
  }

  /* Fit the grid: the largest pt whose advance fits op.adv AND whose CAP
     HEIGHT fits the glyph cell — width fit as agreed, cap fit so letters
     stand as tall as the bitmap's instead of shrinking to make room for a
     line box nothing here uses. */
  function fitPt(advPx, cellHPx) {
    var pt = Math.floor(Math.min(64 * advPx / refAdv, 64 * cellHPx / refCap));
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
      var pt = fitPt(op.adv * dpr, op.h * dpr);
      var baseY = Math.round((op.y + (op.base || op.h)) * dpr);
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
        var inkW = (op.adv - (op.sp || 0)) * dpr;
        var gx0 = Math.round(cellX + (inkW - g.w) / 2);
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
  module.exports = { createTtfText: createTtfText, availableFaces: availableFaces };
}
