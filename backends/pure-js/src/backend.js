/*
 * pure-js backend — the native-api (gfx.* and sys.*) implemented as plain JS,
 * no C glue, no engine adapter. This is what "regular JS" means for mjsx:
 * mjsx-core runs directly under Node/Bun/a browser's own engine, and the
 * only native code anywhere is this file.
 *
 * Renders into an in-memory RGBA buffer and writes it out as a binary PPM
 * (P6) — zero image-library dependency, on purpose: a "pure JS" backend
 * that needed a native PNG encoder wouldn't be pure JS. Convert to PNG for
 * viewing with any tool that reads PPM (e.g. `sips -s format png` on
 * macOS, or ImageMagick's `convert`).
 *
 * The font is a small hand-built 4x6 dot-matrix table covering the glyphs
 * mjsx's own examples need (uppercase letters, digits, a few punctuation
 * marks). This is a placeholder appropriate to a first pure-JS backend, not
 * a claim about what mjsx-core's text rendering is — mjsx-core never draws
 * a glyph itself, it only calls gfx.text(); a backend with a real font
 * (a TTF rasterizer, a browser <canvas> fillText call) drops in without
 * mjsx-core changing at all. Text is upper-cased on the way in because this
 * font has no lowercase table, not because mjsx cares about case.
 */

/* Fonts come from the shared registry ('4x6' tiny, '6x8' clear, '12x16'
   large); an instance picks one at creation (opts.font) and reports its
   metrics as backend.font so the runner can hand them to mjsx-core. */
var raster = require('./../../../packages/core/src/raster.js');
var vectorize = require('./../../../packages/core/src/vectorize.js').vectorize;
var fontsMod = require('./../../../packages/core/src/fonts.js');
var vectorizeMod = require('./../../../packages/core/src/vectorize.js');
var FONTS = fontsMod.FONTS, pickFont = fontsMod.pickFont;
var hdFactor = fontsMod.hdFactor, hdGlyph = fontsMod.hdGlyph;

/* Creates a fresh backend bound to one W x H canvas. Multiple backends can
   coexist in the same process (each with its own gfx/sys/UI trio via
   mjsx.createInstance-style usage) — see run.js for how an example wires
   one up. */
function createPureJsBackend(w, h, opts) {
  opts = opts || {};
  /* Default is the AUTO ladder: every text size picks its own closest
     native font (see fonts.pickFont). opts.font pins one font for all
     sizes, scaled linearly — the old behaviour, kept as an override. */
  var fixed = opts.font ? (FONTS[opts.font] || FONTS['4x6']) : null;
  /* How text sharpens in precise (dpr) mode:
       'vector' (default) — the designed stroke face, same grid and metrics
         as the bitmap class, rasterized with a round pen at any dpr;
       'smooth' — the same family's higher-resolution bitmap member;
       'pixel'  — stamp the logical font at dpr, authentic chunky look. */
  var fontScaleMode = opts.fontScale === 'pixel' ? 'pixel'
                    : (opts.fontScale === 'smooth' ? 'smooth'
                    : (opts.fontScale === 'exact' ? 'exact' : 'vector'));
  var strokeStyle = fontScaleMode === 'exact' ? 'exact' : 'refined';
  function fontFor(size) {
    if (!fixed) return pickFont(size);
    return { glyphs: fixed.glyphs, w: fixed.w, h: fixed.h, scale: size, fam: fixed.fam };
  }
  /* dpr: precise rendering at the SAME virtual size. Layout, hit boxes and
     gfx.width()/height() stay logical (w x h); the buffer is w*dpr x h*dpr
     and every shape is rasterized at that resolution — arcs and diagonals
     get real sub-logical-pixel geometry instead of blown-up pixels. Text
     upgrades itself through the ladder to the sharpest font that fits the
     scaled cell, so it gains detail rather than blockiness. */
  var dpr = opts.dpr || 1;
  var PW = w * dpr, PH = h * dpr;
  /* textMode 'capture': text is NOT rasterized into the pixel buffer.
     Instead each gfx.text call is recorded on backend.textOps — logical
     coordinates plus the resolved per-size cell metrics and the active
     clip — for a host that draws text itself with a REAL font (the
     browser's canvas, a future SDL_ttf, a remote renderer). The contract:
     fit the ORIGINAL grid — one glyph advance equals op.adv, the line box
     fits op.lineH (= glyph height + 2, so descenders may use the leading
     rows exactly as the bitmap fonts do), baseline on the cell bottom. */
  var textCapture = opts.textMode === 'capture';
  var textOps = [];
  var px = new Uint8Array(PW * PH * 3); // RGB, 3 bytes/pixel, PHYSICAL
  var clipRect = null;
  var storeMap = {};
  var startedAt = Date.now();

  function toRGB(color24) {
    return [(color24 >> 16) & 0xff, (color24 >> 8) & 0xff, color24 & 0xff];
  }

  function setPixel(x, y, rgb) {
    if (x < 0 || y < 0 || x >= PW || y >= PH) return;
    if (clipRect) {
      if (x < clipRect.x || y < clipRect.y || x >= clipRect.x + clipRect.w || y >= clipRect.y + clipRect.h) return;
    }
    var i = (y * PW + x) * 3;
    px[i] = rgb[0]; px[i + 1] = rgb[1]; px[i + 2] = rgb[2];
  }
  /* A logical 1px pen is dpr physical pixels wide. */
  function stamp(x, y, rgb) {
    for (var sy = 0; sy < dpr; sy++) for (var sx = 0; sx < dpr; sx++) setPixel(x + sx, y + sy, rgb);
  }

  function fillRect(x, y, ww, hh, rgb) {
    for (var yy = y; yy < y + hh; yy++) {
      for (var xx = x; xx < x + ww; xx++) setPixel(xx, yy, rgb);
    }
  }

  /* Plain Bresenham — no anti-aliasing, matches the "flat colour, thin
     borders" aesthetic every mjsx target is designed around. */
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

  function drawCircle(cx, cy, r, rgb, filled, band) {
    band = band || 1; /* outline thickness in PHYSICAL pixels */
    for (var y = -r; y <= r; y++) {
      for (var x = -r; x <= r; x++) {
        var d = x * x + y * y;
        if (filled) { if (d <= r * r) setPixel(cx + x, cy + y, rgb); }
        else { if (d <= r * r && d > (r - band) * (r - band)) setPixel(cx + x, cy + y, rgb); }
      }
    }
  }

  /* compat 'adafruit': draw arcs, circles and clip QUIRKS exactly the
     way Adafruit_GFX does on the filament-rfid bridge, so replaying a
     device op stream is pixel-identical. Midpoint algorithms run in
     LOGICAL coordinates and stamp dpr blocks -- at dpr 1 they are the
     library's own pixels; scaled up they are the device look, magnified
     (fidelity, not smoothness, is the point of this mode). */
  var compat = opts.compat === 'adafruit';
  function afPix(x, y, rgb) { fillRect(x * dpr, y * dpr, dpr, dpr, rgb); }
  /* Adafruit's drawFastVLine(x, y, h) is writeLine(x, y, x, y+h-1) with
     NO h guard -- at h = 0 Bresenham still paints both endpoints, 2
     pixels. fillRoundRect's degenerate corners (a 2px-tall slider bar)
     depend on that, so the span is inclusive min..max, never empty. */
  function afVline(x, y, hh, rgb) {
    var y1 = y + hh - 1;
    var lo = y < y1 ? y : y1, hi = y < y1 ? y1 : y;
    fillRect(x * dpr, lo * dpr, dpr, (hi - lo + 1) * dpr, rgb);
  }
  function afHline(x, y, ww, rgb) {
    var x1 = x + ww - 1;
    var lo = x < x1 ? x : x1, hi = x < x1 ? x1 : x;
    fillRect(lo * dpr, y * dpr, (hi - lo + 1) * dpr, dpr, rgb);
  }
  /* Precise circle rasterizers for dpr > 1: the same logical footprint
     as Adafruit's midpoint arcs (radius r+0.5 around the pixel centre),
     but computed per DEVICE pixel -- real curves instead of magnified
     logical steps. dpr 1 keeps byte-exact Adafruit semantics. */
  function hdCapsuleFill(cx, cy, delta, rr, halves, rgb) {
    var X = (cx + 0.5) * dpr, Y0 = (cy + 0.5) * dpr, Y1 = (cy + 0.5 + delta) * dpr;
    var R = (rr + 0.5) * dpr, R2 = R * R;
    for (var py = Math.floor(Y0 - R); py < Math.ceil(Y1 + R); py++) {
      var yc = py + 0.5;
      var dy2 = yc < Y0 ? Y0 - yc : (yc > Y1 ? yc - Y1 : 0);
      var s2 = R2 - dy2 * dy2;
      if (s2 <= 0) continue;
      var half = Math.sqrt(s2);
      var xa = halves === 1 ? X : X - half;
      var xb = halves === 2 ? X : X + half;
      var ix = Math.round(xa), ix2 = Math.round(xb);
      if (ix2 > ix) fillRect(ix, py, ix2 - ix, 1, rgb);
    }
  }
  function hdRing(cx, cy, rr, quad, rgb) {
    var X = (cx + 0.5) * dpr, Y = (cy + 0.5) * dpr;
    var Ro = (rr + 0.5) * dpr, Ri = Math.max(0, (rr - 0.5) * dpr);
    var Ro2 = Ro * Ro, Ri2 = Ri * Ri;
    for (var py = Math.floor(Y - Ro); py < Math.ceil(Y + Ro); py++) {
      var dy3 = py + 0.5 - Y;
      var so = Ro2 - dy3 * dy3;
      if (so <= 0) continue;
      var ho = Math.sqrt(so);
      var si = Ri2 - dy3 * dy3;
      var hi = si > 0 ? Math.sqrt(si) : 0;
      var leftOK = (dy3 <= 0 && (quad & 1)) || (dy3 >= 0 && (quad & 8));
      var rightOK = (dy3 <= 0 && (quad & 2)) || (dy3 >= 0 && (quad & 4));
      if (leftOK) {
        var la = Math.round(X - ho), lb = Math.round(X - hi);
        if (lb > la) fillRect(la, py, lb - la, 1, rgb);
      }
      if (rightOK) {
        var ra = Math.round(X + hi), rb = Math.round(X + ho);
        if (rb > ra) fillRect(ra, py, rb - ra, 1, rgb);
      }
    }
  }
  function afDrawCircle(x0, y0, r, rgb) {
    if (dpr > 1) { hdRing(x0, y0, r, 15, rgb); return; }
    var f = 1 - r, dx = 1, dy = -2 * r, x = 0, y = r;
    afPix(x0, y0 + r, rgb); afPix(x0, y0 - r, rgb); afPix(x0 + r, y0, rgb); afPix(x0 - r, y0, rgb);
    while (x < y) {
      if (f >= 0) { y--; dy += 2; f += dy; }
      x++; dx += 2; f += dx;
      afPix(x0 + x, y0 + y, rgb); afPix(x0 - x, y0 + y, rgb);
      afPix(x0 + x, y0 - y, rgb); afPix(x0 - x, y0 - y, rgb);
      afPix(x0 + y, y0 + x, rgb); afPix(x0 - y, y0 + x, rgb);
      afPix(x0 + y, y0 - x, rgb); afPix(x0 - y, y0 - x, rgb);
    }
  }
  function afDrawCircleHelper(x0, y0, r, corner, rgb) {
    if (dpr > 1) {
      /* Adafruit corner bits: 1 TL, 2 TR, 4 BR, 8 BL -- same here */
      hdRing(x0, y0, r, corner, rgb);
      return;
    }
    var f = 1 - r, dx = 1, dy = -2 * r, x = 0, y = r;
    while (x < y) {
      if (f >= 0) { y--; dy += 2; f += dy; }
      x++; dx += 2; f += dx;
      if (corner & 4) { afPix(x0 + x, y0 + y, rgb); afPix(x0 + y, y0 + x, rgb); }
      if (corner & 2) { afPix(x0 + x, y0 - y, rgb); afPix(x0 + y, y0 - x, rgb); }
      if (corner & 8) { afPix(x0 - y, y0 + x, rgb); afPix(x0 - x, y0 + y, rgb); }
      if (corner & 1) { afPix(x0 - y, y0 - x, rgb); afPix(x0 - x, y0 - y, rgb); }
    }
  }
  function afFillCircleHelper(x0, y0, r, corners, delta, rgb) {
    if (dpr > 1) { hdCapsuleFill(x0, y0, delta, r, corners === 3 ? 0 : corners, rgb); return; }
    var f = 1 - r, dx = 1, dy = -2 * r, x = 0, y = r, px = 0, py = r;
    delta++;
    while (x < y) {
      if (f >= 0) { y--; dy += 2; f += dy; }
      x++; dx += 2; f += dx;
      if (x < y + 1) {
        if (corners & 1) afVline(x0 + x, y0 - y, 2 * y + delta, rgb);
        if (corners & 2) afVline(x0 - x, y0 - y, 2 * y + delta, rgb);
      }
      if (y !== py) {
        if (corners & 1) afVline(x0 + py, y0 - px, 2 * px + delta, rgb);
        if (corners & 2) afVline(x0 - py, y0 - px, 2 * px + delta, rgb);
        py = y;
      }
      px = x;
    }
  }
  function afFillCircle(x0, y0, r, rgb) {
    if (dpr > 1) { hdCapsuleFill(x0, y0, 0, r, 0, rgb); return; }
    afVline(x0, y0 - r, 2 * r + 1, rgb);
    afFillCircleHelper(x0, y0, r, 3, 0, rgb);
  }
  function afFillRoundRect(x, y, w, h, r, rgb) {
    var mr = ((w < h ? w : h) >> 1);
    if (r > mr) r = mr;
    fillRect((x + r) * dpr, y * dpr, (w - 2 * r) * dpr, h * dpr, rgb);
    afFillCircleHelper(x + w - r - 1, y + r, r, 1, h - 2 * r - 1, rgb);
    afFillCircleHelper(x + r, y + r, r, 2, h - 2 * r - 1, rgb);
  }
  function afDrawRoundRect(x, y, w, h, r, rgb) {
    var mr = ((w < h ? w : h) >> 1);
    if (r > mr) r = mr;
    afHline(x + r, y, w - 2 * r, rgb);
    afHline(x + r, y + h - 1, w - 2 * r, rgb);
    afVline(x, y + r, h - 2 * r, rgb);
    afVline(x + w - 1, y + r, h - 2 * r, rgb);
    afDrawCircleHelper(x + r, y + r, r, 1, rgb);
    afDrawCircleHelper(x + w - r - 1, y + r, r, 2, rgb);
    afDrawCircleHelper(x + w - r - 1, y + h - r - 1, r, 4, rgb);
    afDrawCircleHelper(x + r, y + h - r - 1, r, 8, rgb);
  }
  /* the bridge clips lines with integer Cohen-Sutherland then draws
     Adafruit's Bresenham (err = dx/2 variant) on the ADJUSTED endpoints
     -- both steps ported exactly, since per-pixel clipping of the
     original line lands on subtly different pixels */
  function afLine(x0, y0, x1, y1, rgb) {
    var c = afClip();
    if (c) {
      var xmin = c.x, xmax = c.x + c.w - 1, ymin = c.y, ymax = c.y + c.h - 1;
      function code(x, y) {
        var cc = 0;
        if (x < xmin) cc |= 1; else if (x > xmax) cc |= 2;
        if (y < ymin) cc |= 4; else if (y > ymax) cc |= 8;
        return cc;
      }
      var c0 = code(x0, y0), c1 = code(x1, y1);
      for (var guard = 0; guard < 8; guard++) {
        if (!(c0 | c1)) break;
        if (c0 & c1) return;
        var cs = c0 ? c0 : c1;
        var nx = x0, ny = y0;
        if (cs & 8) { nx = x0 + Math.trunc((x1 - x0) * (ymax - y0) / (y1 - y0)); ny = ymax; }
        else if (cs & 4) { nx = x0 + Math.trunc((x1 - x0) * (ymin - y0) / (y1 - y0)); ny = ymin; }
        else if (cs & 2) { ny = y0 + Math.trunc((y1 - y0) * (xmax - x0) / (x1 - x0)); nx = xmax; }
        else { ny = y0 + Math.trunc((y1 - y0) * (xmin - x0) / (x1 - x0)); nx = xmin; }
        if (cs === c0) { x0 = nx; y0 = ny; c0 = code(x0, y0); }
        else { x1 = nx; y1 = ny; c1 = code(x1, y1); }
      }
    }
    var steep = Math.abs(y1 - y0) > Math.abs(x1 - x0), t;
    if (steep) { t = x0; x0 = y0; y0 = t; t = x1; x1 = y1; y1 = t; }
    if (x0 > x1) { t = x0; x0 = x1; x1 = t; t = y0; y0 = y1; y1 = t; }
    var ldx = x1 - x0, ldy = Math.abs(y1 - y0);
    var err = ldx >> 1;
    var ystep = y0 < y1 ? 1 : -1;
    for (; x0 <= x1; x0++) {
      if (steep) afPix(y0, x0, rgb); else afPix(x0, y0, rgb);
      err -= ldy;
      if (err < 0) { y0 += ystep; err += ldx; }
    }
  }

  /* the device's logical clip, for mirroring its clamp/skip quirks */
  function afClip() {
    return clipRect ? { x: clipRect.x / dpr, y: clipRect.y / dpr,
                        w: clipRect.w / dpr, h: clipRect.h / dpr } : null;
  }
  /* the bridge clamps a rect to the clip and SQUARES it if clamped */
  function afRect(x, y, w, h, rgb, r, fill) {
    var c = afClip();
    if (c) {
      var x2 = x + w, y2 = y + h;
      if (x < c.x) { x = c.x; r = 0; }
      if (y < c.y) { y = c.y; r = 0; }
      if (x2 > c.x + c.w) { x2 = c.x + c.w; r = 0; }
      if (y2 > c.y + c.h) { y2 = c.y + c.h; r = 0; }
      w = x2 - x; h = y2 - y;
      if (w <= 0 || h <= 0) return;
    }
    if (fill) {
      if (r > 0) afFillRoundRect(x, y, w, h, r, rgb);
      else fillRect(x * dpr, y * dpr, w * dpr, h * dpr, rgb);
    } else {
      if (r > 0) afDrawRoundRect(x, y, w, h, r, rgb);
      else {
        afHline(x, y, w, rgb); afHline(x, y + h - 1, w, rgb);
        afVline(x, y, h, rgb); afVline(x + w - 1, y, h, rgb);
      }
    }
  }

  /* Round-pen renderer for VECTORIZED bitmap glyphs: stroke centrelines run
     through the bitmap's exact pixel centres (see vectorize.js), so the
     glyph's size and grid are identical to the bitmap — the pen just draws
     them with rounded caps and true diagonals. Vectorizations are memoised
     per glyph table. */
  var _vecCache = new Map();
  function vecGlyph(fnt, ch) {
    if (fnt.strokes && fnt.strokes[strokeStyle] && fnt.strokes[strokeStyle][ch]) {
      return fnt.strokes[strokeStyle][ch]; /* authored wins */
    }
    var tbl = _vecCache.get(fnt.glyphs);
    if (!tbl) { tbl = {}; _vecCache.set(fnt.glyphs, tbl); }
    if (!tbl[ch]) tbl[ch] = vectorize(fnt.glyphs[ch], fnt.w, fnt.glyphs[ch].length);
    return tbl[ch];
  }
  function drawVecGlyph(vg, ox, oy, u, rgb) {
    /* Each stroke rasterizes as a CAPSULE: a pixel is inked iff its
       CENTER lies within the pen radius of the SEGMENT itself. Sampling
       discs along the line instead looks the same in theory but beads in
       practice: a stroke optically centred on a pixel boundary (the
       refined face does that on purpose -- a T stem between columns) has
       its edge pixels at EXACTLY pen radius, and they only inked on rows
       where a sampled disc happened to align -- scalloped stems every
       few rows. The exact-boundary tie resolves half-open (left/top in),
       the classic rasterisation rule, so such strokes come out uniform
       with a constant half-pixel bias instead of an oscillating edge. */
    var penR = u * 0.5;
    var r2 = penR * penR;
    function capsule(x0, y0, x1, y1) {
      var sx = x1 - x0, sy = y1 - y0;
      var ll = sx * sx + sy * sy;
      var px0 = Math.floor(Math.min(x0, x1) - penR), px1 = Math.ceil(Math.max(x0, x1) + penR);
      var py0 = Math.floor(Math.min(y0, y1) - penR), py1 = Math.ceil(Math.max(y0, y1) + penR);
      for (var py = py0; py <= py1; py++) {
        for (var px = px0; px <= px1; px++) {
          var cx3 = px + 0.5, cy3 = py + 0.5;
          var t = ll > 0 ? ((cx3 - x0) * sx + (cy3 - y0) * sy) / ll : 0;
          if (t < 0) t = 0;
          if (t > 1) t = 1;
          var ddx = cx3 - (x0 + sx * t), ddy = cy3 - (y0 + sy * t);
          var d2 = ddx * ddx + ddy * ddy;
          if (d2 < r2 || (d2 === r2 && (ddx < 0 || (ddx === 0 && ddy < 0)))) {
            setPixel(px, py, rgb);
          }
        }
      }
    }
    for (var si = 0; si < vg.s.length; si++) {
      var sg = vg.s[si];
      capsule(ox + sg[0] * u, oy + sg[1] * u, ox + sg[2] * u, oy + sg[3] * u);
    }
    for (si = 0; si < vg.d.length; si++) {
      capsule(ox + vg.d[si][0] * u, oy + vg.d[si][1] * u,
              ox + vg.d[si][0] * u, oy + vg.d[si][1] * u);
    }
  }

  /* The highest-resolution member of the SAME FAMILY as the logical font,
     fitting the dpr-scaled cell budget (height AND advance, so precise text
     can never outgrow the space layout reserved for it). Same letterforms,
     more real detail — a 4x6-class text stays a 4x6-class text. 'pixel'
     mode, or nothing fitting, stamps the logical font at dpr instead. */
  function fontForPrecise(size) {
    var lf = fontFor(size);
    var budgetAdv = (lf.w + 1) * lf.scale * dpr, budgetH = lf.h * lf.scale * dpr;
    var best = null;
    if (fontScaleMode === 'smooth') {
      for (var name in FONTS) {
        var f = FONTS[name];
        if (f.fam !== lf.fam) continue;
        for (var sc = 1; sc <= dpr; sc++) {
          var hh = f.h * sc, aa = (f.w + 1) * sc;
          if (hh > budgetH || aa > budgetAdv) continue;
          /* Native resolution FIRST — a smooth 12x18 at 1x beats a blocky
             4x6 stamped 3x even though both land at 18 — then rendered
             height, then the least scaling. */
          if (!best || f.h > best.h ||
              (f.h === best.h && (hh > best.h * best.scale ||
               (hh === best.h * best.scale && sc < best.scale)))) {
            best = { glyphs: f.glyphs, w: f.w, h: f.h, scale: sc, fam: f.fam };
          }
        }
      }
    }
    if (!best) best = { glyphs: lf.glyphs, w: lf.w, h: lf.h, scale: lf.scale * dpr, fam: lf.fam };
    best.cellAdv = budgetAdv;
    return best;
  }

  /* The gfx facade takes LOGICAL coordinates and scales into the physical
     buffer; at dpr 1 the scaling is all identity arithmetic. */
  var gfx = {
    clear: function (color) { fillRect(0, 0, PW, PH, toRGB(color)); textOps.length = 0; },
    rect: function (x, y, ww, hh, color, radius) {
      var rgb = toRGB(color);
      if (compat) { afRect(x, y, ww, hh, rgb, radius || 0, false); return; }
      raster.strokeRoundRect(
        function (px2, py2) { stamp(px2, py2, rgb); },
        function (x0, y0, x1, y1) {
          /* Bresenham at physical resolution, dpr-thick pen. */
          drawLineStamped(x0, y0, x1, y1, rgb);
        },
        x * dpr, y * dpr, ww * dpr, hh * dpr, (radius || 0) * dpr);
    },
    frect: function (x, y, ww, hh, color, radius) {
      if (compat) { afRect(x, y, ww, hh, toRGB(color), radius || 0, true); return; }
      if (textCapture) {
        /* z-order: a fill painted AFTER a text op sits on top of it (a
           modal over page text). Pixels get that for free; captured ops
           must be pruned or the covered text would resurface above the
           fill on the host. Fully-covered ops go; partial overlaps are the
           op-stream backend's problem, not this hybrid's. */
        for (var oi = textOps.length - 1; oi >= 0; oi--) {
          var op = textOps[oi];
          var ow = op.str.length * op.adv;
          if (op.x >= x && op.y >= y && op.x + ow <= x + ww && op.y + op.h <= y + hh) {
            textOps.splice(oi, 1);
          }
        }
      }
      var rgb = toRGB(color);
      raster.fillRoundRect(
        function (fx, fy, fw, fh) { fillRect(fx, fy, fw, fh, rgb); },
        x * dpr, y * dpr, ww * dpr, hh * dpr, (radius || 0) * dpr);
    },
    circle: function (x, y, r, color, filled) {
      if (compat) {
        /* the bridge skips circles that cross the clip vertically */
        var cc = afClip();
        if (cc && (y - r < cc.y || y + r > cc.y + cc.h)) return;
        if (filled) afFillCircle(x, y, r, toRGB(color));
        else afDrawCircle(x, y, r, toRGB(color));
        return;
      }
      drawCircle(x * dpr, y * dpr, r * dpr, toRGB(color), filled, dpr);
    },
    line: function (x0, y0, x1, y1, color) {
      if (compat) { afLine(x0, y0, x1, y1, toRGB(color)); return; }
      drawLineStamped(x0 * dpr, y0 * dpr, x1 * dpr, y1 * dpr, toRGB(color));
    },
    text: function (x, y, size, color, str) {
      if (compat) {
        /* the bridge skips a whole string that crosses the clip vertically */
        var ct = afClip();
        if (ct && (y < ct.y || y + 8 * size > ct.y + ct.h)) return;
      }
      if (textCapture) {
        var cf = fontFor(size);
        textOps.push({
          x: x, y: y, color: color, str: '' + str,
          adv: (cf.w + 1) * cf.scale, h: cf.h * cf.scale, lineH: (cf.h + 2) * cf.scale,
          /* sp: the cell's spacing column (right side) — hosts centre their
             glyph in the INK width, not the full advance, or text drifts
             right by half the spacing. base: the bitmap's true baseline
             row — the 6x8 family's is row 7 of its 8-row cell (row 7 is
             blank below caps), the 4x6's is the cell bottom. */
          sp: cf.scale,
          base: cf.scale * (cf.fam === '6x8' ? cf.h - cf.h / 8 : cf.h),
          clip: clipRect ? { x: clipRect.x / dpr, y: clipRect.y / dpr, w: clipRect.w / dpr, h: clipRect.h / dpr } : null
        });
        return;
      }
      var rgb = toRGB(color);
      if (dpr > 1 && (fontScaleMode === 'vector' || fontScaleMode === 'exact')) {
        /* The logical font's own glyphs, vectorized: stroke centrelines on
           the bitmap's pixel grid, one-pixel round pen — identical size and
           letterforms to non-HD, just smooth. u = physical px per glyph px. */
        var lf2 = fontFor(size);
        var cellAdv2 = (lf2.w + 1) * lf2.scale * dpr;
        var vgl = (lf2.fam && FONTS[lf2.fam] ? FONTS[lf2.fam] : lf2).glyphs;
        /* Vectorize the family's hand-drawn BASE bitmap and scale the
           strokes — a derived (Scale2x) member's pre-rounded corners would
           smooth twice and mush letterforms like D towards O. Same cell,
           same size; only the stroke source is the crispest original. */
        var vbase = (lf2.fam && FONTS[lf2.fam]) || lf2;
        var u = lf2.scale * dpr * (lf2.h / vbase.h);
        var s2v = '' + str;
        for (var vi = 0; vi < s2v.length; vi++) {
          /* real lowercase where the font has it; case-fold where it
             does not (the 4x6 family) */
          var vch = vbase.glyphs[s2v[vi]] ? s2v[vi] : s2v[vi].toUpperCase();
          if (!vbase.glyphs[vch]) continue; // unknown glyph: skip, like the bitmap path
          drawVecGlyph(vecGlyph(vbase, vch),
                       x * dpr + vi * cellAdv2, y * dpr, u, rgb);
        }
        return;
      }
      var f = dpr === 1 ? fontFor(size) : fontForPrecise(size);
      var cellAdv = f.cellAdv || (f.w + 1) * f.scale;
      var pad2 = Math.floor((cellAdv - (f.w + 1) * f.scale) / 2);
      var s = '' + str;
      /* HD stamping (default on): glyphs stamped at 2x+ get AdvMAME
         smoothing -- the same algorithm, junction guard, and factor rule
         (4/3/2 dividing the scale, remainder a block) the bridge runs in
         C, so a replay of its op stream lands on the same pixels. Only
         HAND-DRAWN faces smooth: the derived ladder members are already
         Scale2x products and would mush (D towards O) if smoothed again. */
      var fbase = f.fam && FONTS[f.fam];
      var hdOK = opts.hdText !== false && fbase &&
                 fbase.w === f.w && fbase.h === f.h;
      for (var i = 0; i < s.length; i++) {
        var ck = f.glyphs[s[i]] ? s[i] : s[i].toUpperCase();
        var rows = f.glyphs[ck];
        var gx = x * dpr + i * cellAdv + pad2;
        if (!rows) continue; // unknown glyph: skip rather than draw noise
        var fac = hdOK ? hdFactor(f.scale) : 1;
        if (fac > 1) {
          var hg = hdGlyph(f.glyphs, ck, fac, f.w, f.h);
          if (hg) {
            /* rounded block EDGES, not a fixed block size: the smoothed
               grid lands exactly on the cell at any scale, divisible or
               not (a 5x stamp gets 1-2px blocks that sum to 5) */
            var gy0 = y * dpr;
            for (var hy = 0; hy < hg.h; hy++) {
              var hbits = hg.rows[hy];
              if (!hbits) continue;
              var by0 = gy0 + Math.round(hy * f.scale / fac);
              var by1 = gy0 + Math.round((hy + 1) * f.scale / fac);
              if (by1 <= by0) continue;
              for (var hx = 0; hx < hg.w; hx++) {
                if (hbits & (1 << (hg.w - 1 - hx))) {
                  var bx0 = gx + Math.round(hx * f.scale / fac);
                  var bx1 = gx + Math.round((hx + 1) * f.scale / fac);
                  if (bx1 > bx0) fillRect(bx0, by0, bx1 - bx0, by1 - by0, rgb);
                }
              }
            }
            continue;
          }
        }
        for (var row = 0; row < rows.length; row++) {
          var bits = rows[row];
          for (var col = 0; col < f.w; col++) {
            if (bits & (1 << (f.w - 1 - col))) {
              fillRect(gx + col * f.scale, y * dpr + row * f.scale, f.scale, f.scale, rgb);
            }
          }
        }
      }
    },
    /* Optional extended op (not part of the 10-call contract): fill
       polygons given in LOGICAL float coordinates, scanline at DEVICE
       resolution. mjsx-core's path node hands its stroke outlines and
       shape fills here when present, so curves and joins sharpen with
       dpr exactly the way precise text does. rule: 'nonzero' (stroke
       outlines - absorbs offset self-overlaps) or 'evenodd' (SVG fill).
       Cores on backends without this op fall back to their own
       logical-resolution fill. */
    poly: function (polys, color, rule) {
      var rgb = toRGB(color), nonzero = rule === 'nonzero';
      var edges = [], minY = 1e9, maxY = -1e9;
      for (var pi = 0; pi < polys.length; pi++) {
        var ring = polys[pi];
        for (var vi = 0; vi < ring.length; vi++) {
          var va = ring[vi], vb = ring[(vi + 1) % ring.length];
          var ax = va.x * dpr, ay = va.y * dpr, bx = vb.x * dpr, by = vb.y * dpr;
          if (ay !== by) edges.push([ax, ay, bx, by, ay < by ? 1 : -1]);
          if (ay < minY) minY = ay;
          if (ay > maxY) maxY = ay;
        }
      }
      for (var sy = Math.max(0, Math.floor(minY)); sy <= Math.min(PH - 1, Math.ceil(maxY)); sy++) {
        var cy = sy + 0.5, xs = [];
        for (var ei = 0; ei < edges.length; ei++) {
          var ed = edges[ei];
          var lo = ed[1] < ed[3] ? ed[1] : ed[3], hi = ed[1] < ed[3] ? ed[3] : ed[1];
          if (cy >= lo && cy < hi) xs.push([ed[0] + (ed[2] - ed[0]) * (cy - ed[1]) / (ed[3] - ed[1]), ed[4]]);
        }
        xs.sort(function (a, b) { return a[0] - b[0]; });
        if (nonzero) {
          var wind = 0, openX = 0;
          for (var xi = 0; xi < xs.length; xi++) {
            var was = wind !== 0;
            wind += xs[xi][1];
            if (!was && wind !== 0) openX = xs[xi][0];
            else if (was && wind === 0) {
              for (var fx = Math.round(openX); fx < Math.round(xs[xi][0]); fx++) setPixel(fx, sy, rgb);
            }
          }
        } else {
          for (var xp = 0; xp + 1 < xs.length; xp += 2) {
            for (var fx2 = Math.round(xs[xp][0]); fx2 < Math.round(xs[xp + 1][0]); fx2++) setPixel(fx2, sy, rgb);
          }
        }
      }
    },
    clip: function (x, y, ww, hh) { clipRect = { x: x * dpr, y: y * dpr, w: ww * dpr, h: hh * dpr }; },
    unclip: function () { clipRect = null; },
    width: function () { return w; },
    height: function () { return h; }
  };
  function drawLineStamped(x0, y0, x1, y1, rgb) {
    if (dpr === 1) { drawLine(x0, y0, x1, y1, rgb); return; }
    x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
    var dx = Math.abs(x1 - x0), sx = x0 < x1 ? 1 : -1;
    var dy = -Math.abs(y1 - y0), sy = y0 < y1 ? 1 : -1;
    var err = dx + dy;
    for (;;) {
      stamp(x0, y0, rgb);
      if (x0 === x1 && y0 === y1) break;
      var e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
  }

  var sys = {
    millis: function () { return Date.now() - startedAt; },
    beep: function () { /* no speaker in a pixel buffer */ },
    tone: function () { },
    exit: function () { },
    store: function (k, v) { storeMap[k] = v; },
    fetch: function (k) { return storeMap[k] === undefined ? '' : storeMap[k]; }
  };

  /* Binary PPM (P6): a 3-line ASCII header, then raw RGB bytes. The
     simplest image format that says anything at all — no compression, no
     dependency, readable by most image tools directly. */
  function toPPM() {
    var header = 'P6\n' + PW + ' ' + PH + '\n255\n';
    var headerBytes = Buffer.from(header, 'ascii');
    return Buffer.concat([headerBytes, Buffer.from(px.buffer, px.byteOffset, px.byteLength)]);
  }

  var base = fontFor(1);
  /* raw: the live RGB framebuffer itself (w*dpr x h*dpr x 3). Hosts that
     present every frame read it in place instead of paying toPPM's copy. */
  return { gfx: gfx, sys: sys, toPPM: toPPM, raw: px, width: w, height: h, dpr: dpr, textOps: textOps,
           font: { advance: base.advance || (base.w + 1), lineH: (base.h + 2) * (fixed ? 1 : 1),
                   pick: fixed ? null : pickFont } };
}

/* ---- the GLASS emulator -------------------------------------------
 *
 * createGlassBackend(w, h, {q, fontMode}) renders ops the way the
 * BRIDGE FIRMWARE renders them onto its panel: a physical canvas of
 * ceil(w*q/4) x ceil(h*q/4), every op's endpoints floor-scaled on the
 * way in (vpx), and -- in font mode 2 -- text drawn from the vectorized
 * strokes as round-pen capsules with supersampled, alpha-blended
 * coverage. A /remote viewer in PIX mode uses this to show the device's
 * PIXELS, not merely its ops. Font mode 1 stamps glyphs at the floored
 * integer scale, exactly like the firmware's textBlit. */
function createGlassBackend(w, h, glassOpts) {
  var q = (glassOpts && glassOpts.q) || 4;
  var fontMode = glassOpts && glassOpts.fontMode !== undefined ? glassOpts.fontMode : 2;
  var PW = Math.floor((w * q + 3) / 4), PH = Math.floor((h * q + 3) / 4);
  /* hdText OFF: the inner backend supplies the firmware's RAW stamping
     (NATIVE is a scaling mode, not a font mode) -- HD text comes only
     from this emulator's own AA path when fontMode is 2 */
  var inner = createPureJsBackend(PW, PH, { font: '5x7', compat: 'adafruit', hdText: false });
  var g = inner.gfx, raw = inner.raw;
  function vpx(v) { return Math.floor(v * q / 4); }
  var clip = null;   /* physical, mirrored for the AA text path */
  var vecCache = {};
  function vecOf(ch) {
    if (vecCache[ch]) return vecCache[ch];
    var vg;
    if (ch === '*') {
      vg = { s: [[2, 1, 2, 6], [0, 1, 4, 5], [4, 1, 0, 5]], d: [] };
    } else {
      var f5 = FONTS['5x7'];
      var rows = f5.glyphs[ch] || f5.glyphs[String(ch).toUpperCase()];
      if (!rows) return null;
      vg = vectorizeMod.vectorize(rows, 5, rows.length);
    }
    vecCache[ch] = vg;
    return vg;
  }
  var covCache = {};
  function covOf(ch, ps) {
    var key = ps + ':' + ch;
    if (covCache[key]) return covCache[key];
    var vg = vecOf(ch);
    if (!vg) return null;
    var gw = 6 * ps, gh = 8 * ps;
    var cov = new Uint8Array(gw * gh);
    var u = ps, r2 = (u * 0.5) * (u * 0.5);
    for (var gy = 0; gy < gh; gy++) {
      for (var gx = 0; gx < gw; gx++) {
        var n = 0;
        for (var sub = 0; sub < 4; sub++) {
          var cx = gx + ((sub & 1) ? 0.75 : 0.25);
          var cy = gy + ((sub & 2) ? 0.75 : 0.25);
          var isIn = false;
          for (var si = 0; si < vg.s.length && !isIn; si++) {
            var sg = vg.s[si];
            var x0 = sg[0] * u, y0 = sg[1] * u;
            var sx = sg[2] * u - x0, sy = sg[3] * u - y0;
            var ll = sx * sx + sy * sy;
            var t = ll > 0 ? ((cx - x0) * sx + (cy - y0) * sy) / ll : 0;
            if (t < 0) t = 0;
            if (t > 1) t = 1;
            var dx = cx - (x0 + sx * t), dy = cy - (y0 + sy * t);
            isIn = dx * dx + dy * dy <= r2;
          }
          for (var di = 0; di < vg.d.length && !isIn; di++) {
            var dx2 = cx - vg.d[di][0] * u, dy2 = cy - vg.d[di][1] * u;
            isIn = dx2 * dx2 + dy2 * dy2 <= r2;
          }
          if (isIn) n++;
        }
        cov[gy * gw + gx] = n * 16;
      }
    }
    covCache[key] = cov;
    return cov;
  }
  function aaText(x, y, size, color, str) {
    var ps = Math.max(1, Math.floor(size * q / 4));
    var py = vpx(y);
    /* the firmware's whole-string vertical clip skip, physical terms */
    if (clip && (vpx(y) < clip.y || vpx(y + 8 * size) > clip.y + clip.h)) return;
    var cx0 = clip ? Math.max(0, clip.x) : 0;
    var cx1 = clip ? Math.min(PW, clip.x + clip.w) : PW;
    /* blend in RGB565 exactly as the firmware does -- the panel's
       canvas is 565, and matching its rounding is what makes the
       emulator pixel-exact rather than merely close */
    var f5r = ((color >> 16) & 255) >> 3, f6g = ((color >> 8) & 255) >> 2, f5b = (color & 255) >> 3;
    var s2 = '' + str;
    for (var i = 0; i < s2.length; i++) {
      var cov = covOf(s2.charAt(i), ps);
      if (!cov) continue;
      var gx0 = vpx(x + i * 6 * size);
      var gw = 6 * ps, gh = 8 * ps;
      for (var gy = 0; gy < gh; gy++) {
        var yy = py + gy;
        if (yy < 0) continue;
        if (yy >= PH) break;
        for (var gx = 0; gx < gw; gx++) {
          var a = cov[gy * gw + gx];
          if (!a) continue;
          var xx = gx0 + gx;
          if (xx < cx0 || xx >= cx1) continue;
          var o = (yy * PW + xx) * 3;
          if (a >= 64) {
            raw[o] = f5r << 3; raw[o + 1] = f6g << 2; raw[o + 2] = f5b << 3;
          } else {
            var d5r = raw[o] >> 3, d6g = raw[o + 1] >> 2, d5b = raw[o + 2] >> 3;
            raw[o] = ((d5r * (64 - a) + f5r * a) >> 6) << 3;
            raw[o + 1] = ((d6g * (64 - a) + f6g * a) >> 6) << 2;
            raw[o + 2] = ((d5b * (64 - a) + f5b * a) >> 6) << 3;
          }
        }
      }
    }
  }
  /* HD round corners, the firmware's exact twin: 2x2-supersampled AA
     arcs blended in 565, float math via Math.fround for bit parity. */
  var _fr = Math.fround;
  function rawSet(o, f5r, f6g, f5b, n) {
    if (n >= 4) { raw[o] = f5r << 3; raw[o + 1] = f6g << 2; raw[o + 2] = f5b << 3; return; }
    var a = n * 16;
    var d5r = raw[o] >> 3, d6g = raw[o + 1] >> 2, d5b = raw[o + 2] >> 3;
    raw[o] = ((d5r * (64 - a) + f5r * a) >> 6) << 3;
    raw[o + 1] = ((d6g * (64 - a) + f6g * a) >> 6) << 2;
    raw[o + 2] = ((d5b * (64 - a) + f5b * a) >> 6) << 3;
  }
  function hdCorner(Cx, Cy, R, px0, py0, px1, py1, color, fillDisc) {
    var Ro2 = _fr(R * R);
    var Ri = R - 1 > 0 ? _fr(R - 1) : 0;
    var Ri2 = _fr(Ri * Ri);
    if (px0 < 0) px0 = 0;
    if (py0 < 0) py0 = 0;
    if (px1 > PW) px1 = PW;
    if (py1 > PH) py1 = PH;
    var f5r = ((color >> 16) & 255) >> 3, f6g = ((color >> 8) & 255) >> 2, f5b = (color & 255) >> 3;
    for (var py = py0; py < py1; py++) {
      for (var px = px0; px < px1; px++) {
        var n = 0;
        for (var sub = 0; sub < 4; sub++) {
          var sx = _fr(px + ((sub & 1) ? 0.75 : 0.25));
          var sy = _fr(py + ((sub & 2) ? 0.75 : 0.25));
          var dx = _fr(sx - Cx), dy = _fr(sy - Cy);
          var d2 = _fr(_fr(dx * dx) + _fr(dy * dy));
          if (fillDisc ? (d2 <= Ro2) : (d2 <= Ro2 && d2 >= Ri2)) n++;
        }
        if (n) rawSet((py * PW + px) * 3, f5r, f6g, f5b, n);
      }
    }
  }
  function rawFill(x, y, w2, h2, color) {
    if (x < 0) { w2 += x; x = 0; }
    if (y < 0) { h2 += y; y = 0; }
    if (x + w2 > PW) w2 = PW - x;
    if (y + h2 > PH) h2 = PH - y;
    var f5r = ((color >> 16) & 255) >> 3, f6g = ((color >> 8) & 255) >> 2, f5b = (color & 255) >> 3;
    for (var py = y; py < y + h2; py++) {
      var o = (py * PW + x) * 3;
      for (var px = 0; px < w2; px++) {
        raw[o] = f5r << 3; raw[o + 1] = f6g << 2; raw[o + 2] = f5b << 3; o += 3;
      }
    }
  }
  function hdRect(x, y, ww, hh, c, r, fill) {
    var x0 = vpx(x), y0 = vpx(y);
    var w2 = vpx(x + ww) - x0, h2 = vpx(y + hh) - y0, rr = vpx(r || 0);
    if (clip) {
      var cx2 = x0 + w2, cy2 = y0 + h2;
      if (x0 < clip.x) { x0 = clip.x; rr = 0; }
      if (y0 < clip.y) { y0 = clip.y; rr = 0; }
      if (cx2 > clip.x + clip.w) { cx2 = clip.x + clip.w; rr = 0; }
      if (cy2 > clip.y + clip.h) { cy2 = clip.y + clip.h; rr = 0; }
      w2 = cx2 - x0; h2 = cy2 - y0;
      if (w2 <= 0 || h2 <= 0) return;
    }
    if (fontMode >= 2 && rr > 1 && w2 > 2 * rr && h2 > 2 * rr) {
      var R = _fr(rr);
      if (fill) {
        rawFill(x0, y0 + rr, w2, h2 - 2 * rr, c);
        rawFill(x0 + rr, y0, w2 - 2 * rr, rr, c);
        rawFill(x0 + rr, y0 + h2 - rr, w2 - 2 * rr, rr, c);
        hdCorner(_fr(x0 + R), _fr(y0 + R), R, x0, y0, x0 + rr, y0 + rr, c, true);
        hdCorner(_fr(x0 + w2 - R), _fr(y0 + R), R, x0 + w2 - rr, y0, x0 + w2, y0 + rr, c, true);
        hdCorner(_fr(x0 + R), _fr(y0 + h2 - R), R, x0, y0 + h2 - rr, x0 + rr, y0 + h2, c, true);
        hdCorner(_fr(x0 + w2 - R), _fr(y0 + h2 - R), R, x0 + w2 - rr, y0 + h2 - rr, x0 + w2, y0 + h2, c, true);
      } else {
        rawFill(x0 + rr, y0, w2 - 2 * rr, 1, c);
        rawFill(x0 + rr, y0 + h2 - 1, w2 - 2 * rr, 1, c);
        rawFill(x0, y0 + rr, 1, h2 - 2 * rr, c);
        rawFill(x0 + w2 - 1, y0 + rr, 1, h2 - 2 * rr, c);
        hdCorner(_fr(x0 + R), _fr(y0 + R), R, x0, y0, x0 + rr, y0 + rr, c, false);
        hdCorner(_fr(x0 + w2 - R), _fr(y0 + R), R, x0 + w2 - rr, y0, x0 + w2, y0 + rr, c, false);
        hdCorner(_fr(x0 + R), _fr(y0 + h2 - R), R, x0, y0 + h2 - rr, x0 + rr, y0 + h2, c, false);
        hdCorner(_fr(x0 + w2 - R), _fr(y0 + h2 - R), R, x0 + w2 - rr, y0 + h2 - rr, x0 + w2, y0 + h2, c, false);
      }
      return;
    }
    (fill ? g.frect : g.rect)(x0, y0, w2, h2, c, rr);
  }
  var gfx = {
    clear: function (c) { clip = null; g.unclip(); g.clear(c); },
    rect: function (x, y, ww, hh, c, r) { hdRect(x, y, ww, hh, c, r, false); },
    frect: function (x, y, ww, hh, c, r) { hdRect(x, y, ww, hh, c, r, true); },
    circle: function (x, y, r, c, f) {
      var X = vpx(x), Y = vpx(y), R2 = vpx(r);
      if (clip && (Y - R2 < clip.y || Y + R2 > clip.y + clip.h)) return;
      if (fontMode >= 2 && R2 > 1) {
        hdCorner(_fr(X + 0.5), _fr(Y + 0.5), _fr(R2 + 0.5), X - R2 - 1, Y - R2 - 1, X + R2 + 2, Y + R2 + 2, c, f);
        return;
      }
      g.circle(X, Y, R2, c, f);
    },
    line: function (x0, y0, x1, y1, c) { g.line(vpx(x0), vpx(y0), vpx(x1), vpx(y1), c); },
    text: function (x, y, size, c, str) {
      if (fontMode >= 2) { aaText(x, y, size, c, str); return; }
      /* font mode 1: the firmware's textBlit -- floored glyph scale,
         each char at its scaled logical advance */
      var ps = Math.max(1, Math.floor(size * q / 4));
      var s3 = '' + str;
      if (clip && (vpx(y) < clip.y || vpx(y + 8 * size) > clip.y + clip.h)) return;
      for (var i = 0; i < s3.length; i++) {
        g.text(vpx(x + i * 6 * size), vpx(y), ps, c, s3.charAt(i));
      }
    },
    clip: function (x, y, ww, hh) {
      var x0 = vpx(x), y0 = vpx(y);
      clip = { x: x0, y: y0, w: vpx(x + ww) - x0, h: vpx(y + hh) - y0 };
      g.clip(x0, y0, clip.w, clip.h);
    },
    unclip: function () { clip = null; g.unclip(); },
    poly: function (polys, color, rule) {
      var f = q / 4;
      g.poly(polys.map(function (ring) {
        return ring.map(function (pt) { return { x: pt.x * f, y: pt.y * f }; });
      }), color, rule);
    },
    width: function () { return w; },
    height: function () { return h; }
  };
  return { gfx: gfx, raw: raw, w: PW, h: PH };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { createPureJsBackend: createPureJsBackend, createGlassBackend: createGlassBackend };
}

if (typeof createPureJsBackend === 'function') createPureJsBackend.hdStamp = true;
if (typeof window !== 'undefined' && window.createPureJsBackend) window.createPureJsBackend.hdStamp = true;
if (typeof window !== 'undefined' && typeof createGlassBackend === 'function') window.createGlassBackend = createGlassBackend;
