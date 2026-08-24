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
  /* How text sharpens in precise (dpr) mode: 'smooth' (default) upgrades to
     the same FAMILY's higher-resolution face — identical letterforms, real
     detail; 'pixel' stamps the logical font at dpr for the authentic chunky
     device look. */
  var fontScaleMode = opts.fontScale === 'pixel' ? 'pixel' : 'smooth';
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
          if (!best || hh > best.h * best.scale ||
              (hh === best.h * best.scale && f.h > best.h)) {
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
    clear: function (color) { fillRect(0, 0, PW, PH, toRGB(color)); },
    rect: function (x, y, ww, hh, color, radius) {
      var rgb = toRGB(color);
      raster.strokeRoundRect(
        function (px2, py2) { stamp(px2, py2, rgb); },
        function (x0, y0, x1, y1) {
          /* Bresenham at physical resolution, dpr-thick pen. */
          drawLineStamped(x0, y0, x1, y1, rgb);
        },
        x * dpr, y * dpr, ww * dpr, hh * dpr, (radius || 0) * dpr);
    },
    frect: function (x, y, ww, hh, color, radius) {
      var rgb = toRGB(color);
      raster.fillRoundRect(
        function (fx, fy, fw, fh) { fillRect(fx, fy, fw, fh, rgb); },
        x * dpr, y * dpr, ww * dpr, hh * dpr, (radius || 0) * dpr);
    },
    circle: function (x, y, r, color, filled) {
      drawCircle(x * dpr, y * dpr, r * dpr, toRGB(color), filled, dpr);
    },
    line: function (x0, y0, x1, y1, color) {
      drawLineStamped(x0 * dpr, y0 * dpr, x1 * dpr, y1 * dpr, toRGB(color));
    },
    text: function (x, y, size, color, str) {
      var rgb = toRGB(color);
      var f = dpr === 1 ? fontFor(size) : fontForPrecise(size);
      var cellAdv = f.cellAdv || (f.w + 1) * f.scale;
      var pad2 = Math.floor((cellAdv - (f.w + 1) * f.scale) / 2);
      var s = ('' + str).toUpperCase();
      for (var i = 0; i < s.length; i++) {
        var rows = f.glyphs[s[i]];
        var gx = x * dpr + i * cellAdv + pad2;
        if (!rows) continue; // unknown glyph: skip rather than draw noise
        for (var row = 0; row < f.h; row++) {
          var bits = rows[row];
          for (var col = 0; col < f.w; col++) {
            if (bits & (1 << (f.w - 1 - col))) {
              fillRect(gx + col * f.scale, y * dpr + row * f.scale, f.scale, f.scale, rgb);
            }
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
  return { gfx: gfx, sys: sys, toPPM: toPPM, width: w, height: h, dpr: dpr,
           font: { advance: base.advance || (base.w + 1), lineH: (base.h + 2) * (fixed ? 1 : 1),
                   pick: fixed ? null : pickFont } };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { createPureJsBackend: createPureJsBackend };
}
