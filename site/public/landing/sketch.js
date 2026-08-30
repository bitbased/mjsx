/* sketch.js — alternative RENDERERS for the same op stream.
 *
 * The engine does not draw pixels. It emits ten calls, and something else
 * decides what they look like: on a board that is a display driver, over the
 * network it is whatever the far end runs, and here it is a Canvas2D that
 * draws with a wobbling pen.
 *
 * So the demonstration is literal — one running program, one op stream,
 * rendered twice at once. Nothing is re-simulated for the second view; it
 * receives exactly the calls the panel received.
 *
 * Each renderer implements the same contract as any backend:
 *   clear rect frect circle line text clip unclip poly blit width height
 */
(function (root) {
  'use strict';

  /* ---- deterministic wobble -------------------------------------------
     The hand-drawn look has to be STABLE. Reseeding per frame makes every
     line crawl and shimmer at 60 Hz, which reads as noise rather than as
     pencil. Seeding from the shape's own coordinates means the same box
     wobbles the same way every frame, and only moves when it moves. */
  function seedOf(a, b, c, d) {
    var s = (((a | 0) * 73856093) ^ ((b | 0) * 19349663) ^
             ((c | 0) * 83492791) ^ ((d | 0) * 2654435761)) >>> 0;
    return s || 1;
  }
  function rndFrom(seed) {
    var s = seed >>> 0;
    return function () {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 4294967296;
    };
  }

  function lum(c) {
    var r = (c >> 16) & 255, g = (c >> 8) & 255, b = c & 255;
    return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  }

  var THEMES = {
    /* graphite on paper */
    paper: {
      bg: '#f3f0e9', ink: '30,30,34', accent: '120,90,60',
      lw: 1.15, amp: 1.0, hatchGap: 5.5, passes: 2,
      font: '"Bradley Hand", "Segoe Print", "Comic Sans MS", ui-rounded, cursive'
    },
    /* white chalk on drafting blue */
    blueprint: {
      bg: '#0d3b66', ink: '226,238,248', accent: '150,215,255',
      lw: 1.1, amp: 0.85, hatchGap: 6, passes: 1,
      font: 'ui-monospace, "SF Mono", Menlo, monospace'
    }
  };

  function makeRenderer(canvas, w, h, opts) {
    opts = opts || {};
    /* The panel's font is a bitmap font with a known advance per character.
       Guessing a CSS pixel size for it puts every label at the wrong width,
       which pushes text out of its box and off the edge — so the size is
       DERIVED: measure the browser font once per text size and scale it until
       its advance matches the panel's. */
    var ADV = opts.advance || 6;
    var metrics = opts.metrics || function (size) { return { adv: ADV * size }; };
    var fontPx = {};
    var th = THEMES[opts.theme] || THEMES.paper;
    var dpr = opts.dpr || Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    /* the backing store is dpr-scaled; the element still lays out at the
       panel's own aspect so it sits level with the pixels beside it */
    canvas.style.display = 'block';
    canvas.style.width = '100%';
    canvas.style.height = 'auto';
    canvas.style.aspectRatio = w + ' / ' + h;
    var ctx = canvas.getContext('2d');
    var clips = 0;
    var tmp = null, tctx = null;          /* scratch for compositing a blit */
    function lumRGB(r, g, b) { return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255; }
    var bgRGB = (function (hex) {
      var v = parseInt(hex.slice(1), 16);
      return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
    })(th.bg);
    var inkRGBv = th.ink.split(',').map(Number);

    /* A FILL MUST OCCLUDE.
       In the pixel backend a filled rect is opaque, so anything drawn under it
       disappears. Hatching alone is transparent, which let every earlier layer
       show straight through — a keyboard drawn over a form appeared on top of
       the form instead of covering it. So a fill lays down an opaque tone
       first (the op's own brightness, blended toward the paper) and only then
       draws texture on it. */
    function toneOf(c) {
      var t = 0.06 + 0.30 * lum(c === undefined ? 0 : c);
      return 'rgb(' + [0, 1, 2].map(function (i) {
        return Math.round(bgRGB[i] + (inkRGBv[i] - bgRGB[i]) * t);
      }).join(',') + ')';
    }

    function ink(c, boost) {
      /* The app's own colour is not thrown away — its brightness becomes the
         pen's weight, so a dim label stays dim and an accent stays loud. */
      var a = 0.32 + 0.68 * lum(c === undefined ? 0xffffff : c);
      return 'rgba(' + th.ink + ',' + Math.min(1, a * (boost || 1)).toFixed(3) + ')';
    }

    /* one wobbling stroke from a to b */
    function wline(x0, y0, x1, y1, rnd, amp) {
      var dx = x1 - x0, dy = y1 - y0;
      var len = Math.sqrt(dx * dx + dy * dy);
      if (len < 0.001) { return; }
      var nx = -dy / len, ny = dx / len;
      var steps = Math.max(2, Math.min(14, Math.round(len / 14)));
      ctx.beginPath();
      for (var i = 0; i <= steps; i++) {
        var t = i / steps;
        /* the ends barely move: a pen lands where it is aimed and drifts in
           the middle of the stroke, not at the corners */
        var ease = Math.sin(t * Math.PI);
        var o = (rnd() - 0.5) * amp * ease;
        var px = x0 + dx * t + nx * o, py = y0 + dy * t + ny * o;
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.stroke();
    }

    function strokePath(pts, close, rnd, amp) {
      for (var i = 1; i < pts.length; i++) {
        wline(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1], rnd, amp);
      }
      if (close && pts.length > 2) {
        wline(pts[pts.length - 1][0], pts[pts.length - 1][1], pts[0][0], pts[0][1], rnd, amp);
      }
    }

    /* a fill is HATCHING: diagonal strokes inside the shape's clip */
    function hatch(x, y, ww, hh, rnd, dense) {
      /* Hatching is a FILL, and a fill sits under its own label. Too dense
         and the text on top becomes unreadable, which is what happened to
         every input field on the drafting sheet. */
      var gap = th.hatchGap * (dense ? 0.78 : 1.25);
      ctx.save();
      ctx.beginPath(); ctx.rect(x, y, ww, hh); ctx.clip();
      var span = ww + hh;
      for (var d = -hh; d < span; d += gap) {
        wline(x + d, y, x + d - hh, y + hh, rnd, th.amp * 0.5);
      }
      ctx.restore();
    }

    function begin() {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.lineWidth = th.lw;
    }

    var gfx = {
      width: function () { return w; },
      height: function () { return h; },

      clear: function () {
        /* Drop the clip FIRST. A clip left over from the previous frame is
           still in force, so filling before restoring wiped only the clipped
           strip and the old frame showed through under the new one. */
        while (clips > 0) { ctx.restore(); clips--; }
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.fillStyle = th.bg;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        begin();
      },

      rect: function (x, y, ww, hh, c) {
        var rnd = rndFrom(seedOf(x, y, ww, hh));
        ctx.strokeStyle = ink(c);
        for (var p = 0; p < th.passes; p++) {
          var r2 = rndFrom(seedOf(x + p * 7, y, ww, hh));
          strokePath([[x, y], [x + ww, y], [x + ww, y + hh], [x, y + hh]], true, r2, th.amp);
        }
        rnd();
      },

      frect: function (x, y, ww, hh, c) {
        var rnd = rndFrom(seedOf(x, y, ww, hh));
        ctx.fillStyle = toneOf(c);
        ctx.fillRect(x, y, ww, hh);
        ctx.strokeStyle = ink(c, 0.42);
        hatch(x, y, ww, hh, rnd, lum(c) > 0.5);
        ctx.strokeStyle = ink(c);
        strokePath([[x, y], [x + ww, y], [x + ww, y + hh], [x, y + hh]], true,
                   rndFrom(seedOf(x, y, ww, hh)), th.amp);
      },

      circle: function (x, y, r, c, filled) {
        var rnd = rndFrom(seedOf(x, y, r, filled ? 1 : 0));
        ctx.strokeStyle = ink(c);
        var pts = [], n = Math.max(10, Math.min(40, Math.round(r * 1.6)));
        for (var i = 0; i < n; i++) {
          var a = i / n * Math.PI * 2;
          var rr = r + (rnd() - 0.5) * th.amp;
          pts.push([x + Math.cos(a) * rr, y + Math.sin(a) * rr]);
        }
        if (filled) {
          ctx.save();
          ctx.beginPath();
          ctx.moveTo(pts[0][0], pts[0][1]);
          for (var j = 1; j < pts.length; j++) ctx.lineTo(pts[j][0], pts[j][1]);
          ctx.closePath();
          ctx.fillStyle = toneOf(c);
          ctx.fill();               /* opaque first, so it occludes */
          ctx.clip();
          hatch(x - r, y - r, r * 2, r * 2, rndFrom(seedOf(x, y, r, 9)), true);
          ctx.restore();
        }
        strokePath(pts, true, rndFrom(seedOf(x, y, r, 3)), th.amp * 0.55);
      },

      line: function (x0, y0, x1, y1, c) {
        ctx.strokeStyle = ink(c);
        wline(x0, y0, x1, y1, rndFrom(seedOf(x0, y0, x1, y1)), th.amp);
      },

      text: function (x, y, size, c, str) {
        str = String(str);
        var px = fontPx[size];
        if (px === undefined) {
          var want = (metrics(size) || {}).adv || ADV * size;
          ctx.font = '20px ' + th.font;
          var per = ctx.measureText('MMMMMMMMMM').width / 10;
          px = per > 0 ? (20 * want / per) : size * 8;
          fontPx[size] = px = Math.max(5, px);
        }
        ctx.save();
        ctx.font = px + 'px ' + th.font;
        ctx.textBaseline = 'top';
        ctx.fillStyle = ink(c, 1.05);
        /* a hand does not set type on a perfect baseline */
        var rnd = rndFrom(seedOf(x, y, str.length, size));
        ctx.translate(x, y + (rnd() - 0.5) * 0.8);
        ctx.rotate((rnd() - 0.5) * 0.006);
        ctx.fillText(str, 0, 0);
        ctx.restore();
      },

      /* clip REPLACES the clip rect — it does not nest and it does not
         intersect. That is the backend contract (clipRect = {...}), and
         getting it wrong here is not a cosmetic difference: Canvas2D's clip()
         always intersects, so a second clip in the same frame shrank the
         visible area to the overlap of the two and every field below the
         first one silently disappeared. */
      clip: function (x, y, ww, hh) {
        while (clips > 0) { ctx.restore(); clips--; }
        ctx.save(); clips = 1;
        ctx.beginPath(); ctx.rect(x, y, ww, hh); ctx.clip();
      },
      unclip: function () { while (clips > 0) { ctx.restore(); clips--; } },

      poly: function (polys, c) {
        ctx.strokeStyle = ink(c);
        for (var i = 0; i < polys.length; i++) {
          var ring = polys[i] || [], pts = [];
          for (var j = 0; j < ring.length; j++) pts.push([ring[j].x, ring[j].y]);
          if (pts.length > 1) strokePath(pts, true, rndFrom(seedOf(pts[0][0], pts[0][1], pts.length, i)), th.amp * 0.8);
        }
      },

      /* A blit carries real pixels, and the drawing example is nothing but
         blits — hatching a placeholder there would erase the whole point.
         The source's RGB is fetched and re-inked in this renderer's palette,
         so what you drew appears, drawn in this pen. */
      blit: function (id, x, y, ww, hh) {
        var src = opts.source && opts.source(id);
        var rnd = rndFrom(seedOf(x, y, ww, hh));
        if (src) {
          if (!tmp) { tmp = document.createElement('canvas'); tctx = tmp.getContext('2d'); }
          if (tmp.width !== src.w || tmp.height !== src.h) { tmp.width = src.w; tmp.height = src.h; }
          var img = tctx.createImageData(src.w, src.h);
          var d = img.data, p2 = src.px, n = src.w * src.h;
          var inkRGB = th.ink.split(',');
          var bgL = lumRGB(bgRGB[0], bgRGB[1], bgRGB[2]);
          for (var i = 0, o = 0, s2 = 0; i < n; i++, o += 4, s2 += 3) {
            /* how far this pixel stands off the source's own background is
               how much ink it gets */
            var L = lumRGB(p2[s2], p2[s2 + 1], p2[s2 + 2]);
            var a = Math.min(1, Math.abs(L - bgL) * 2.6);
            d[o] = +inkRGB[0]; d[o + 1] = +inkRGB[1]; d[o + 2] = +inkRGB[2];
            d[o + 3] = Math.round(a * 235);
          }
          tctx.putImageData(img, 0, 0);
          ctx.save();
          ctx.imageSmoothingEnabled = false;
          ctx.drawImage(tmp, x, y, ww, hh);
          ctx.restore();
        }
        ctx.strokeStyle = 'rgba(' + th.accent + ',0.45)';
        strokePath([[x, y], [x + ww, y], [x + ww, y + hh], [x, y + hh]], true, rnd, th.amp);
      }
    };

    gfx.clear(0);
    return { gfx: gfx, canvas: canvas, w: w, h: h, theme: th };
  }

  root.MJSXSketch = { make: makeRenderer, THEMES: THEMES };
})(window);
