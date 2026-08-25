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
var FONTS = fontsMod.FONTS, pickFont = fontsMod.pickFont;

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
  function afDrawCircle(x0, y0, r, rgb) {
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
            best = { glyphs: f.glyphs, w: f.w, h: f.h, scale: sc };
          }
        }
      }
    }
    if (!best) best = { glyphs: lf.glyphs, w: lf.w, h: lf.h, scale: lf.scale * dpr };
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
      for (var i = 0; i < s.length; i++) {
        var rows = f.glyphs[s[i]] || f.glyphs[s[i].toUpperCase()];
        var gx = x * dpr + i * cellAdv + pad2;
        if (!rows) continue; // unknown glyph: skip rather than draw noise
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

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { createPureJsBackend: createPureJsBackend };
}
