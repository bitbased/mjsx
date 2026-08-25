/*
 * mjsx-core — an Ink-style JSX/hyperscript UI engine for small screens.
 *
 * Components are plain functions returning trees built with h(); a walker
 * lays the tree out top-to-bottom (rows supported), draws through a native
 * `gfx` object, and registers touch targets AS IT DRAWS THEM — the drawn box
 * and the hit box are the same rectangle by construction, which is the class
 * of bug (drift between the two) that motivated this framework.
 *
 * Written in the MicroQuickJS-safe ES5 subset deliberately: no classes, no
 * arrows, no template literals, no destructuring, no spread. This file is
 * meant to load unmodified on an ES5 microcontroller engine, a modern
 * desktop JS engine, or inside a browser — one dialect, every target, so a
 * component author never has to know which one they're on.
 *
 * Rendering is interval-driven: the host calls UI.render() on a tick
 * whenever UI.dirty() says so. There is no reconciler and no retained tree —
 * the whole screen redraws from state every dirty frame, which at the sizes
 * this targets is cheap. See ../../README.md for the two things this file
 * deliberately does NOT know: what "gfx"/"sys" are backed by (a real panel,
 * a pixel buffer, a <canvas>), and anything domain-specific to an app.
 *
 * What this file assumes exists in scope, supplied by a backend:
 *   gfx.clear(color)
 *   gfx.rect/frect(x,y,w,h,color,radius)
 *   gfx.circle(x,y,r,color,filled)
 *   gfx.line(x0,y0,x1,y1,color)
 *   gfx.text(x,y,size,color,str)
 *   gfx.clip(x,y,w,h) / gfx.unclip()
 *   gfx.width() / gfx.height()
 *   sys.millis()   — a monotonic clock, milliseconds
 * Nothing else. No beep/tone/store/net/board assumptions live here — those
 * are backend or app concerns, registered alongside this engine, not baked
 * into it.
 *
 * Colours are 24-bit 0xRRGGBB throughout; a backend converts to its own
 * native depth (5-6-5, RGBA8, whatever the target wants).
 */

/* hyperscript: h(type, props, ...children). Arrays flatten one level. */
function h(type, props) {
  var kids = [];
  for (var i = 2; i < arguments.length; i++) {
    var c = arguments[i];
    if (c === null || c === undefined || c === false) continue;
    if (typeof c === 'object' && c.splice && c.type === undefined) {
      for (var j = 0; j < c.length; j++) {
        if (c[j] !== null && c[j] !== undefined && c[j] !== false) kids.push(c[j]);
      }
    } else {
      kids.push(c);
    }
  }
  return { type: type, props: props || {}, kids: kids };
}

/* A function component expands with its children attached to props.
 *
 * The expansion is cached on the node, because a render walks the same node
 * several times — draw asks for its height, a row asks again to size its
 * columns, a scroll box asks a third time to decide what is visible — and
 * without this every one of those re-ran every component function beneath
 * it. Nodes are rebuilt by h() on each render, so the cache cannot go stale.
 */
function expand(node) {
  if (!node || typeof node !== 'object') return node;
  if (node._x !== undefined) return node._x;
  var out = node;
  while (out && typeof out.type === 'function') {
    var p = out.props || {};
    p.children = out.kids;
    out = out.type(p);
  }
  node._x = out;
  return out;
}

/* Default font metric: a fixed-width bitmap font, 6px advance per char per
 * size step, 8px line height. This is the one place mjsx-core assumes
 * something about the font — a backend with a variable-width or vector font
 * can override fitText/textLines (or the FONT object below) without
 * touching layout/draw. */
var FONT = { advance: 6, lineH: 8 };

/* Text-relative spacing, like CSS em: n line-heights, resolved against the
 * CURRENT font metric at call time. Padding and gaps authored with this
 * stay proportional to the text when a backend swaps the font scale — a
 * terminal (lineH 2) tightens to a quarter of a pixel panel (lineH 8)
 * automatically, instead of keeping panel-sized gutters around tiny text.
 *
 * FONT.quantum (default 1) is the alignment unit em snaps to. A terminal
 * backend sets it to its sub-pixels-per-cell so every em-derived offset
 * lands on a whole character row — an odd-sub-pixel gap would put every
 * box edge below it mid-cell, rendering as a dashed half-block hairline. */
function em(n) {
  var q = FONT.quantum || 1;
  var v = Math.round(n * FONT.lineH / q) * q;
  return v < q ? q : v;
}

/* Per-size metrics. A pixel backend installs FONT.pick(size) — the ladder
 * picker from fonts.js — and every size gets its own font's real advance
 * and line height. Without it, metrics scale linearly from FONT.advance /
 * FONT.lineH exactly as before. */
function fadv(size) { return FONT.pick ? FONT.pick(size).advance : FONT.advance * size; }
/* Visible CAP-INK height of a text cell -- the line box carries leading
   and (in the 6x8 family) a blank baseline row below the caps, so
   centring the line box leaves text riding high. Centre this instead. */
function fink(size) {
  if (FONT.pick) {
    var f = FONT.pick(size);
    if (f.h && f.scale) {
      var hh = f.h * f.scale;
      return f.fam === '6x8' ? hh - Math.floor(hh / 8) : hh;
    }
    return (f.lineH || FONT.lineH * size) - 2;
  }
  return FONT.lineH * size - 2;
}
function flh(size) { return FONT.pick ? FONT.pick(size).lineH - 2 : FONT.lineH * size; }

/* Truncate to a width, marking the cut with the fonts' ellipsis glyph —
   one character instead of three dots, so truncation keeps two more
   characters of the actual text. */
function fitText(str, size, availW) {
  var s = '' + str;
  var maxChars = Math.floor(availW / fadv(size));
  if (s.length <= maxChars) return s;
  if (maxChars <= 1) return s.substring(0, maxChars);
  return s.substring(0, maxChars - 1) + '\u2026';
}

function textLines(str, size, availW) {
  var s = '' + str;
  var maxChars = Math.floor(availW / fadv(size));
  if (maxChars < 1) maxChars = 1;
  if (s.length <= maxChars) return [s];
  var words = s.split(' ');
  var lines = [];
  var line = '';
  for (var i = 0; i < words.length; i++) {
    var w = words[i];
    if (line.length === 0) line = w;
    else if (line.length + 1 + w.length <= maxChars) line = line + ' ' + w;
    else { lines.push(line); line = w; }
    while (line.length > maxChars) { /* a single over-long word hard-breaks */
      lines.push(line.substring(0, maxChars));
      line = line.substring(maxChars);
    }
  }
  if (line.length) lines.push(line);
  return lines;
}

/* How tall will this node be at this width? (Layout is width-in, height-out.)
   forcedH pins a node's height from outside — how flex children get theirs.
   Memoised per node and width for the same reason expand() is: measuring a
   subtree is the expensive half of a frame, and the walk repeats it. */
function measure(node, availW, forcedH) {
  var e = expand(node);
  if (e && typeof e === 'object' && e._mw === availW && e._mf === forcedH) return e._mh;
  var out = measureRaw(e, availW, forcedH);
  if (e && typeof e === 'object') { e._mw = availW; e._mf = forcedH; e._mh = out; }
  return out;
}

function measureRaw(node, availW, forcedH) {
  if (!node) return 0;
  if (typeof node === 'string' || typeof node === 'number') {
    return FONT.lineH; /* bare string = size-1 text line */
  }
  var p = node.props;
  var t = node.type;
  if (t === 'text') {
    var size = p.size || 1;
    var lines = p.wrap ? textLines(p.text, size, availW - 0)
                       : [p.nowrap ? String(p.text) : fitText(p.text, size, availW)];
    return lines.length * (flh(size) + 2) - 2;
  }
  if (t === 'input') {
    var isz0 = p.size || 1;
    var ilh0 = flh(isz0) + 2;
    var ipd0 = p.pad === undefined ? Math.max(4, Math.floor(ilh0 / 3)) : p.pad;
    return ilh0 + ipd0 * 2;
  }
  if (t === 'spacer') return p.h || 6;
  if (t === 'pbar') return p.h || 12;
  if (t === 'canvas') return p.h || 100;
  if (t === 'circle') return (p.r || 5) * 2;
  if (t === 'abs') return 0;  /* drawn at its own coordinates; owns no space */
  /* A line is a mark, not a block: it takes no height and its endpoints are
     offsets from wherever the flow has got to. A box with a fixed height and
     lines inside it is therefore a plotting area, with no new concept
     needed. */
  if (t === 'line' || t === 'path') return 0;
  if (t === 'row') {
    if (p.h) return p.h;  /* a pinned row is as tall as it says, not as its tallest child */
    var cols = rowWidths(node, availW);
    var hMax = 0;
    for (var i = 0; i < node.kids.length; i++) {
      var ch = measure(node.kids[i], cols[i]);
      if (ch > hMax) hMax = ch;
    }
    return hMax + (p.pad || 0) * 2;
  }
  /* box (and anything unknown renders as a box) */
  if (forcedH) return forcedH;
  if (p.h) return p.h;
  var gap = p.gap === undefined ? 4 : p.gap;
  var total = 0, seen = false;
  for (var k = 0; k < node.kids.length; k++) {
    var kh = measure(node.kids[k], availW - padL(p) - padR(p));
    /* Marks — lines, overlays — have no height, and something with no height
       must not push its siblings down by a gap. */
    if (kh === 0) continue;
    if (seen) total += gap;
    total += kh;
    seen = true;
  }
  return total + padT(p) + padB(p);
}

/* Split a row's width among its children: fixed `w` first, the rest evenly. */
function rowWidths(node, availW) {
  var p = node.props;
  var pad = p.pad || 0;
  var gap = p.gap === undefined ? 4 : p.gap;
  var inner = availW - pad * 2 - gap * (node.kids.length - 1);
  var flexN = 0, used = 0, i, k;
  for (i = 0; i < node.kids.length; i++) {
    k = expand(node.kids[i]);
    if (k && k.props && k.props.w) used += k.props.w; else flexN++;
  }
  var share = flexN > 0 ? Math.floor((inner - used) / flexN) : 0;
  var out = [];
  for (i = 0; i < node.kids.length; i++) {
    k = expand(node.kids[i]);
    out.push(k && k.props && k.props.w ? k.props.w : share);
  }
  return out;
}

/* The native clip is a SINGLE rect, not a stack. Anything that clips
   inside something already clipped -- an input inside a scroll viewport,
   a clip box in a scroll row -- must INTERSECT with the active rect and
   restore it afterwards, or it would punch a hole in the outer clip and
   paint over whatever the viewport was keeping it away from (a sticky
   header, an overlay). These two keep the one honest rect. */
var CLIP = null;
function pushClip(cx, cy, cw, ch) {
  var prev = CLIP;
  if (prev) {
    var nx = cx > prev.x ? cx : prev.x;
    var ny = cy > prev.y ? cy : prev.y;
    var nr = cx + cw < prev.x + prev.w ? cx + cw : prev.x + prev.w;
    var nb = cy + ch < prev.y + prev.h ? cy + ch : prev.y + prev.h;
    cx = nx; cy = ny;
    cw = nr - nx > 0 ? nr - nx : 0;
    ch = nb - ny > 0 ? nb - ny : 0;
  }
  CLIP = { x: cx, y: cy, w: cw, h: ch };
  gfx.clip(cx, cy, cw, ch);
  return prev;
}
function popClip(prev) {
  CLIP = prev;
  if (prev) gfx.clip(prev.x, prev.y, prev.w, prev.h);
  else gfx.unclip();
}

/* Draw the node at (x, y) within availW. Returns the height consumed. */
function draw(node, x, y, availW, forcedH) {
  node = expand(node);
  if (!node) return 0;
  if (typeof node === 'string' || typeof node === 'number') {
    gfx.text(x, y, 1, UI.theme.text, '' + node);
    return FONT.lineH;
  }
  var p = node.props;
  var t = node.type;
  var hgt = measure(node, availW, forcedH);

  if (t === 'text') {
    var size = p.size || 1;
    var color = p.color === undefined ? UI.theme.text : p.color;
    var lines = p.wrap ? textLines(p.text, size, availW)
                       : [p.nowrap ? String(p.text) : fitText(p.text, size, availW)];
    var ty = y;
    for (var li = 0; li < lines.length; li++) {
      var tx = x;
      if (p.align === 'center') tx = x + Math.floor((availW - lines[li].length * fadv(size)) / 2);
      if (p.align === 'right') tx = x + availW - lines[li].length * fadv(size);
      gfx.text(tx, ty, size, color, lines[li]);
      ty += flh(size) + 2;
    }
  } else if (t === 'spacer') {
    /* nothing to draw */
  } else if (t === 'canvas') {
    /* a CANVAS SOURCE: pixels that live outside the op stream (a camera
       frame, a drawable bitmap, a logo), placed here and scaled to fit.
       Hosts with gfx.blit composite the real pixels; others show the
       frame so layout is developable anywhere. */
    var cw2 = p.w || availW, chh = p.h || 100;
    if (typeof gfx.blit === 'function' && p.src !== undefined) {
      gfx.blit(p.src, x, y, cw2, chh);
    } else {
      gfx.rect(x, y, cw2, chh, UI.theme.muted, 4);
      gfx.line(x, y, x + cw2 - 1, y + chh - 1, UI.theme.key);
      gfx.line(x + cw2 - 1, y, x, y + chh - 1, UI.theme.key);
    }
  } else if (t === 'pbar') {
    var bh = p.h || 12;
    var pct = p.pct || 0;
    if (pct > 1) pct = 1;
    if (pct < 0) pct = 0;
    if (bh <= 5) {
      /* Too thin to draw as an outline around an inset fill: a thin bar is
         two flat rectangles instead. */
      gfx.frect(x, y, availW, bh, p.track === undefined ? UI.theme.key : p.track, 0);
      if (pct > 0) gfx.frect(x, y, Math.floor(availW * pct), bh, p.color === undefined ? UI.theme.accent : p.color, 0);
    } else {
      gfx.rect(x, y, availW, bh, p.track === undefined ? UI.theme.muted : p.track, 4);
      if (pct > 0) gfx.frect(x + 2, y + 2, Math.floor((availW - 4) * pct), bh - 4, p.color === undefined ? UI.theme.accent : p.color, 3);
    }
  } else if (t === 'circle') {
    var r = p.r || 5;
    gfx.circle(x + r, y + r, r, p.color === undefined ? UI.theme.muted : p.color, p.filled === undefined ? true : p.filled);
  } else if (t === 'line') {
    var lc = p.color === undefined ? UI.theme.muted : p.color;
    /* No thickness in the native call, so a w-px line is w parallel 1px
       lines, offset across the shorter axis (where the gap would show)
       and centred on the nominal position. */
    var lw = p.w || 1;
    var steep = Math.abs((p.y2 || 0) - (p.y1 || 0)) > Math.abs((p.x2 || 0) - (p.x1 || 0));
    var ox = steep ? 1 : 0, oy = steep ? 0 : 1;
    for (var lq = 0; lq < lw; lq++) {
      var loff = lq - ((lw - 1) >> 1);
      gfx.line(x + (p.x1 || 0) + ox * loff, y + (p.y1 || 0) + oy * loff,
               x + (p.x2 || 0) + ox * loff, y + (p.y2 || 0) + oy * loff, lc);
    }
    return 0;
  } else if (t === 'path') {
    /* Geometry cache: a path node REUSED across frames (UI.memo, or any
       node reuse) at the same position replays its computed polygons
       instead of re-running the outline stroker -- with many finished
       strokes on screen the stroker's per-point trig is the frame's
       dominant cost by far. Poly-capable backends only: every emission
       funnels through gfx.poly (or the recorded dot cases). */
    if (gfx.poly && node._pg && node._pgx === x && node._pgy === y) {
      var pgc = node._pg;
      for (var pgi = 0; pgi < pgc.length; pgi++) {
        var pge = pgc[pgi];
        if (pge[0] === 'p') gfx.poly(pge[1], pge[2], pge[3]);
        else if (pge[0] === 'c') gfx.circle(pge[1], pge[2], pge[3], pge[4], pge[5]);
        else gfx.line(pge[1], pge[2], pge[3], pge[4], pge[5]);
      }
      return 0;
    }
    var pgCap = gfx.poly ? [] : null;
    if (pgCap) { node._pg = pgCap; node._pgx = x; node._pgy = y; }
    /* A polyline stroke, and optionally an SVG-style filled shape.
       `pts` is a point list, or a list of point lists (subpaths). `fill`
       scanline-fills with the EVEN-ODD rule (SVG fill-rule=evenodd:
       alternating spans, self-intersections and subpath holes included).
       Strokes are OUTLINE strokes: the stroke's boundary polygon is built
       by offsetting the path both ways with real join geometry (round
       arcs by default, `join="miter"` for sharp corners, round caps on
       open ends) and filled in ONE pass with NONZERO winding, which
       absorbs the self-overlaps offsetting creates at inner corners. One
       polygon means no seams, no gaps, uniform width at every angle. */
    var subs5 = (p.pts && p.pts.length && p.pts[0] && p.pts[0].length !== undefined) ? p.pts : [p.pts || []];
    var pc5 = p.color === undefined ? UI.theme.muted : p.color;
    var pw5 = p.w || 1;

    var scanFill5 = function scanFill5(polys, colr, nonzero) {
      if (gfx.poly) {
        /* Backend can fill float polygons at its own (device) resolution
           - hand the geometry over untouched except for tree position. */
        var tp5 = [];
        for (var tq5 = 0; tq5 < polys.length; tq5++) {
          var tr5 = [];
          for (var ts5 = 0; ts5 < polys[tq5].length; ts5++) {
            tr5.push({ x: x + polys[tq5][ts5].x, y: y + polys[tq5][ts5].y });
          }
          tp5.push(tr5);
        }
        var rule5 = nonzero ? 'nonzero' : 'evenodd';
        if (pgCap) pgCap.push(['p', tp5, colr, rule5]);
        gfx.poly(tp5, colr, rule5);
        return;
      }
      var minY5 = 1e9, maxY5 = -1e9, e5 = [];
      for (var sp5 = 0; sp5 < polys.length; sp5++) {
        var sq5 = polys[sp5];
        for (var se5 = 0; se5 < sq5.length; se5++) {
          var pA5 = sq5[se5], pB5 = sq5[(se5 + 1) % sq5.length];
          if (pA5.y !== pB5.y) e5.push([pA5.x, pA5.y, pB5.x, pB5.y, pA5.y < pB5.y ? 1 : -1]);
          if (pA5.y < minY5) minY5 = pA5.y;
          if (pA5.y > maxY5) maxY5 = pA5.y;
        }
      }
      for (var sy5 = Math.floor(minY5); sy5 <= Math.ceil(maxY5); sy5++) {
        var cy5 = sy5 + 0.5, xs5 = [];
        for (var ei5 = 0; ei5 < e5.length; ei5++) {
          var ed5 = e5[ei5];
          var lo9 = ed5[1] < ed5[3] ? ed5[1] : ed5[3];
          var hi9 = ed5[1] < ed5[3] ? ed5[3] : ed5[1];
          if (cy5 >= lo9 && cy5 < hi9) {
            xs5.push([ed5[0] + (ed5[2] - ed5[0]) * (cy5 - ed5[1]) / (ed5[3] - ed5[1]), ed5[4]]);
          }
        }
        xs5.sort(function (a5, b5) { return a5[0] - b5[0]; });
        if (nonzero) {
          var wind5 = 0, open5 = -1;
          for (var xw5 = 0; xw5 < xs5.length; xw5++) {
            var was5 = wind5 !== 0;
            wind5 += xs5[xw5][1];
            var is5 = wind5 !== 0;
            if (!was5 && is5) open5 = xs5[xw5][0];
            else if (was5 && !is5 && open5 !== null) {
              var fz5 = Math.round(open5), tz5 = Math.round(xs5[xw5][0]);
              if (tz5 > fz5) gfx.frect(x + fz5, y + sy5, tz5 - fz5, 1, colr, 0);
            }
          }
        } else {
          for (var xp5 = 0; xp5 + 1 < xs5.length; xp5 += 2) {
            var fx5 = Math.round(xs5[xp5][0]), tx5 = Math.round(xs5[xp5 + 1][0]);
            if (tx5 > fx5) gfx.frect(x + fx5, y + sy5, tx5 - fx5, 1, colr, 0);
          }
        }
      }
    };

    if (p.fill !== undefined) scanFill5(subs5, p.fill, false);

    if (p.color !== undefined || p.fill === undefined) {
      var hw5 = pw5 / 2;
      var miter5 = p.join === 'miter';

      var arc5 = function arc5(out5, cx6, cy6, a0, a1, viaA) {
        /* sample from angle a0 to a1, sweeping in the direction that
           passes nearest viaA when given, else the short way */
        var d6 = a1 - a0;
        while (d6 > Math.PI) d6 -= 2 * Math.PI;
        while (d6 < -Math.PI) d6 += 2 * Math.PI;
        if (viaA !== undefined) {
          var mid6 = a0 + d6 / 2;
          var dm6 = mid6 - viaA;
          while (dm6 > Math.PI) dm6 -= 2 * Math.PI;
          while (dm6 < -Math.PI) dm6 += 2 * Math.PI;
          if (Math.abs(dm6) > Math.PI / 2) d6 = d6 > 0 ? d6 - 2 * Math.PI : d6 + 2 * Math.PI;
        }
        var n6 = Math.max(2, Math.ceil(Math.abs(d6) / (Math.PI / 8)));
        for (var k6 = 1; k6 < n6; k6++) {
          var a6 = a0 + (d6 * k6) / n6;
          out5.push({ x: cx6 + Math.cos(a6) * hw5, y: cy6 + Math.sin(a6) * hw5 });
        }
      };

      var sideJoin5 = function sideJoin5(out5, pt6, nA, nB, cross6, sgn6) {
        out5.push({ x: pt6.x + nA.x * sgn6, y: pt6.y + nA.y * sgn6 });
        var outside6 = sgn6 * cross6 < 0;
        if (outside6) {
          if (miter5) {
            var bx6 = (nA.x + nB.x) * sgn6, by6 = (nA.y + nB.y) * sgn6;
            var bl6 = Math.sqrt(bx6 * bx6 + by6 * by6);
            if (bl6 > 0.0001) {
              /* miter length hw/cos(half-angle) = 2*hw^2/|nA+nB|, limit 3x */
              var ml6 = Math.min(2 * hw5 * hw5 / bl6, hw5 * 3);
              out5.push({ x: pt6.x + bx6 / bl6 * ml6, y: pt6.y + by6 / bl6 * ml6 });
            }
          } else {
            arc5(out5, pt6.x, pt6.y,
                 Math.atan2(nA.y * sgn6, nA.x * sgn6),
                 Math.atan2(nB.y * sgn6, nB.x * sgn6));
          }
        }
        out5.push({ x: pt6.x + nB.x * sgn6, y: pt6.y + nB.y * sgn6 });
      };

      for (var sp6 = 0; sp6 < subs5.length; sp6++) {
        var pts5 = subs5[sp6];
        var closed5 = (p.close || p.fill !== undefined) && pts5.length > 2;
        if (pts5.length === 1) {
          if (pw5 >= 2) {
            var dr5 = Math.max(1, Math.round(hw5));
            if (pgCap) pgCap.push(['c', x + pts5[0].x, y + pts5[0].y, dr5, pc5, true]);
            gfx.circle(x + pts5[0].x, y + pts5[0].y, dr5, pc5, true);
          } else {
            if (pgCap) pgCap.push(['l', x + pts5[0].x, y + pts5[0].y, x + pts5[0].x, y + pts5[0].y, pc5]);
            gfx.line(x + pts5[0].x, y + pts5[0].y, x + pts5[0].x, y + pts5[0].y, pc5);
          }
          continue;
        }
        if (pw5 <= 1 && !gfx.poly) {
          var segN7 = closed5 ? pts5.length : pts5.length - 1;
          for (var pl7 = 0; pl7 < segN7; pl7++) {
            var a7 = pts5[pl7], b7 = pts5[(pl7 + 1) % pts5.length];
            gfx.line(x + a7.x, y + a7.y, x + b7.x, y + b7.y, pc5);
          }
          continue;
        }
        /* segment normals (left side, half-width length) */
        var segs5 = [];
        for (var si5 = 0; si5 < (closed5 ? pts5.length : pts5.length - 1); si5++) {
          var pA6 = pts5[si5], pB6 = pts5[(si5 + 1) % pts5.length];
          var dx7 = pB6.x - pA6.x, dy7 = pB6.y - pA6.y;
          var ln7 = Math.sqrt(dx7 * dx7 + dy7 * dy7);
          if (ln7 < 0.0001) continue;
          segs5.push({ a: pA6, b: pB6, dx: dx7 / ln7, dy: dy7 / ln7,
                       n: { x: -dy7 / ln7 * hw5, y: dx7 / ln7 * hw5 } });
        }
        if (!segs5.length) continue;
        if (closed5) {
          /* two rings: left offsets forward, right offsets forward (the
             scan uses winding, so orientation handles the hole) */
          var ringL = [], ringR = [];
          for (var jj5 = 0; jj5 < segs5.length; jj5++) {
            var sA5 = segs5[jj5], sB5 = segs5[(jj5 + 1) % segs5.length];
            var cr5 = sA5.dx * sB5.dy - sA5.dy * sB5.dx;
            sideJoin5(ringL, sA5.b, sA5.n, sB5.n, cr5, 1);
            sideJoin5(ringR, sA5.b, sA5.n, sB5.n, cr5, -1);
          }
          ringR.reverse();
          scanFill5([ringL, ringR], pc5, true);
        } else {
          var out6 = [];
          out6.push({ x: segs5[0].a.x + segs5[0].n.x, y: segs5[0].a.y + segs5[0].n.y });
          for (var jf5 = 0; jf5 + 1 < segs5.length; jf5++) {
            var c5 = segs5[jf5].dx * segs5[jf5 + 1].dy - segs5[jf5].dy * segs5[jf5 + 1].dx;
            sideJoin5(out6, segs5[jf5].b, segs5[jf5].n, segs5[jf5 + 1].n, c5, 1);
          }
          var lastS5 = segs5[segs5.length - 1];
          out6.push({ x: lastS5.b.x + lastS5.n.x, y: lastS5.b.y + lastS5.n.y });
          /* end cap: half circle through the forward direction */
          arc5(out6, lastS5.b.x, lastS5.b.y,
               Math.atan2(lastS5.n.y, lastS5.n.x),
               Math.atan2(-lastS5.n.y, -lastS5.n.x),
               Math.atan2(lastS5.dy, lastS5.dx));
          out6.push({ x: lastS5.b.x - lastS5.n.x, y: lastS5.b.y - lastS5.n.y });
          for (var jb5 = segs5.length - 1; jb5 > 0; jb5--) {
            var c6 = segs5[jb5 - 1].dx * segs5[jb5].dy - segs5[jb5 - 1].dy * segs5[jb5].dx;
            sideJoin5(out6, segs5[jb5 - 1].b, segs5[jb5].n, segs5[jb5 - 1].n, -c6, -1);
          }
          var firstS5 = segs5[0];
          out6.push({ x: firstS5.a.x - firstS5.n.x, y: firstS5.a.y - firstS5.n.y });
          /* start cap: half circle through the backward direction */
          arc5(out6, firstS5.a.x, firstS5.a.y,
               Math.atan2(-firstS5.n.y, -firstS5.n.x),
               Math.atan2(firstS5.n.y, firstS5.n.x),
               Math.atan2(-firstS5.dy, -firstS5.dx));
          scanFill5([out6], pc5, true);
        }
      }
    }
    return 0;
  } else if (t === 'input') {
    /* A single-line text field. The engine owns the editing state per
       `id` (text when uncontrolled, caret, horizontal scroll) so the
       app's render stays a pure description; a `value` prop makes it
       controlled. Tap focuses and places the caret; a drag scrolls
       overflowing text; press-and-hold then drag moves the caret under
       the finger. Keys reach the focused field from ANY keyboard --
       physical, the built-in virtual layouts, a host's native one, or an
       app's own JSX -- because they all travel as UI.key('press', name). */
    var iid = p.id || '_input';
    var ist = UI._inputs[iid];
    if (!ist) {
      ist = UI._inputs[iid] = {
        text: p.value !== undefined ? String(p.value)
            : (p.defaultValue === undefined ? '' : String(p.defaultValue)),
        cur: 1e9, sx: 0, bt: 0, follow: 1
      };
    }
    if (p.value !== undefined) ist.text = String(p.value);
    ist.p = p;
    var isz = p.size || 1;
    var ilh = flh(isz) + 2;
    var ipd = p.pad === undefined ? Math.max(4, Math.floor(ilh / 3)) : p.pad;
    var ih = ilh + ipd * 2;
    var iw = p.w && p.w < availW ? p.w : availW;
    var ifoc = UI._focus === iid;
    /* focus() may have run before this field ever drew (programmatic
       focus of something below the fold) -- honour its exclusive ask as
       soon as it exists */
    if (ifoc && p.exclusive && !UI._exclusive) { UI._exclusive = true; UI._dirty = true; }
    gfx.frect(x, y, iw, ih, p.bg === undefined ? UI.theme.key : p.bg, 6);
    gfx.rect(x, y, iw, ih,
             ifoc ? UI.theme.accent : (p.border === undefined ? UI.theme.muted : p.border), 6);
    var iadv = fadv(isz);
    if (ist.cur > ist.text.length) ist.cur = ist.text.length;
    var innW = iw - ipd * 2;
    var icx = ist.cur * iadv;
    /* The view follows the caret while the caret is what last moved; a
       deliberate drag-scroll clears `follow` so it is not yanked back. */
    if (ifoc && ist.follow) {
      if (icx - ist.sx > innW - iadv) ist.sx = icx - innW + iadv;
      if (icx - ist.sx < 0) ist.sx = icx;
    }
    var sxm = ist.text.length * iadv - innW;
    if (sxm < 0) sxm = 0;
    if (ist.sx > sxm) ist.sx = sxm;
    if (ist.sx < 0) ist.sx = 0;
    ist.geom = { pad: ipd, adv: iadv, w: iw };
    /* odd remainder goes ABOVE the text: caps carry their visual weight
       high, so erring low reads as centred while erring high reads as
       floating -- and the field's own border makes a high bias obvious */
    var ity = y + Math.ceil((ih - fink(isz)) / 2);
    var iclip0 = pushClip(x + 1, y + 1, iw - 2, ih - 2);
    var shown = ist.text;
    if (p.password) {
      var msk = '';
      for (var mi = 0; mi < shown.length; mi++) msk += '*';
      shown = msk;
    }
    if (!shown.length && p.placeholder) {
      gfx.text(x + ipd, ity, isz, UI.theme.muted, p.placeholder);
    } else {
      gfx.text(x + ipd - ist.sx, ity, isz,
               p.color === undefined ? UI.theme.text : p.color, shown);
    }
    if (ifoc && (Math.floor((sys.millis() - ist.bt) / 530) % 2) === 0) {
      gfx.frect(x + ipd - ist.sx + icx, ity - 1, isz > 1 ? 2 : 1, fink(isz) + 2, UI.theme.accent, 0);
    }
    popClip(iclip0);
    /* Focus order and scroll-into-view remember CONTENT coordinates, so a
       field scrolled out of sight can still be tabbed to and revealed. */
    if (p.focusable !== false) {
      ist.nav = {
        zone: UI._curZone || null,
        cy: y + (UI._curZone ? (UI._scroll[UI._curZone] || 0) : 0),
        h: ih, seen: UI._frame
      };
      UI._focusables.push(iid);
    }
    UI._hit(x, y, iw, ih, null, 0, 0, UI._inputStroke(iid));
    return ih;
  } else if (t === 'abs') {
    /* An escape hatch from the flow: children draw at absolute screen
       coordinates and the row above them never learns they happened. */
    for (var ai = 0; ai < node.kids.length; ai++) {
      var ak = expand(node.kids[ai]);
      var aw = (ak && ak.props && ak.props.w) ? ak.props.w : (p.w || availW);
      draw(node.kids[ai], p.x || 0, p.y || 0, aw, p.h);
    }
    return 0;
  } else if (t === 'row') {
    var pad2 = p.pad || 0;
    var gap2 = p.gap === undefined ? 4 : p.gap;
    if (p.bg !== undefined) gfx.frect(x, y, availW, hgt, p.bg, p.radius || 0);
    var cols = rowWidths(node, availW);
    var cx = x + pad2;
    var inner = hgt - pad2 * 2;
    for (var ri = 0; ri < node.kids.length; ri++) {
      var kid = expand(node.kids[ri]);
      var ky = y + pad2;
      var force = 0;
      /* In a pinned row, boxes fill the height and everything else centres. */
      if (p.h && kid && (kid.type === 'box' || kid.type === 'row') &&
          !(kid.props && kid.props.h)) {
        force = inner;
      } else if (p.h || (kid && kid.props && kid.props.middle)) {
        ky = y + pad2 + Math.floor((inner - measure(kid, cols[ri])) / 2);
      }
      draw(node.kids[ri], cx, ky, cols[ri], force || undefined);
      cx += cols[ri] + gap2;
    }
    if (p.onTap || p.onLongPress || p.onDraw) {
      UI._hit(x - hp(p), y - hp(p), availW + hp(p) * 2, hgt + hp(p) * 2,
              p.onTap, p.onHold || p.onLongPress,
              p.onHold ? (p.holdEvery || 320) : 0, p.onDraw);
    }
  } else {
    /* box — or a scroll viewport when `scroll` names an offset and `h` fixes
       the height */
    var pl = padL(p), pr = padR(p);
    /* An explicit width narrows the box wherever it sits — rows and abs
       containers already honoured w; flow children now do too. */
    if (p.w && p.w < availW) availW = p.w;
    var gap3 = p.gap === undefined ? 4 : p.gap;
    /* offX slides the children left by that many pixels and contentW lets
       them lay out wider than the box -- with clip, that is a horizontal
       scroller (the strip keyboard is one). Plain and flex columns only;
       a `scroll` viewport already owns its own offset. */
    var ox3 = p.offX || 0;
    var cwOv = p.contentW;
    if (p.border !== undefined && p.bg !== undefined) {
      /* Border AND fill: two nested rounded fills — the outer in the border
         colour, the inner inset by the border width. Gap-free at any width
         and radius, unlike stacked 1px outlines whose arcs tile poorly. */
      var bw0 = p.borderW || 1;
      gfx.frect(x, y, availW, hgt, p.border, p.radius || 0);
      var ir = (p.radius || 0) - bw0;
      gfx.frect(x + bw0, y + bw0, availW - bw0 * 2, hgt - bw0 * 2, p.bg, ir > 0 ? ir : 0);
    } else {
      if (p.bg !== undefined) gfx.frect(x, y, availW, hgt, p.bg, p.radius || 0);
      if (p.border !== undefined) {
        /* Outline-only box: stacked 1px rounded outlines. */
        var bw = p.borderW || 1;
        for (var q = 0; q < bw; q++) {
          var rr = (p.radius || 0) - q;
          gfx.rect(x + q, y + q, availW - q * 2, hgt - q * 2, p.border, rr > 0 ? rr : 0);
        }
      }
    }

    var boxH = forcedH || p.h;

    /* shield: this box occludes what it is drawn over. A swallow-all hit
       registered BEFORE the children (so its own controls, registered
       later, still win) plus a key-less swipe zone: taps between the
       controls die here instead of reaching covered fields, and drags or
       wheel over the box no longer scroll a zone underneath it. The hit
       an overlay panel (a keyboard, a docked toolbar) wants. */
    if (p.shield) {
      UI._hits.push({ x: x, y: y, w: availW, h: hgt, fn: p.onTap || null,
                      hold: 0, every: 0, draw: null, shield: true });
      UI._swipeZone(x, y, availW, hgt, null, 0, 0);
    }

    /* clip: confine the children's draws (and hit areas) to this box —
       what a canvas-like region needs so captured strokes recorded past
       its edges cannot paint over the neighbours. Scroll viewports clip
       already; the native clip is a single rect, not a stack, so nesting
       clips inside one another is not supported. */
    var clipHits0 = -1, clipPrev0 = null;
    if (p.clip && !p.scroll) {
      clipHits0 = UI._hits.length;
      clipPrev0 = pushClip(x, y, availW, hgt);
    }

    if (p.scroll && boxH) {
      /* Content height first, so the offset clamps before anything draws. */
      var contentH = 0, seenC = false;
      for (var ci = 0; ci < node.kids.length; ci++) {
        var cih = measure(node.kids[ci], availW - pl - pr);
        if (cih === 0) continue;
        if (seenC) contentH += gap3;
        contentH += cih;
        seenC = true;
      }
      var maxOff = contentH - (boxH - padT(p) - padB(p));
      if (maxOff < 0) maxOff = 0;
      /* An overlay covering part of this viewport makes the covered band
         scrollable-past -- extra range at the bottom, negative offsets at
         the top -- so every row can still be brought into the visible
         part. The same idea as a native scroll view's content insets. */
      var covB = (y + boxH) - (gfx.height() - UI._insetBot());
      if (covB > 0) maxOff += covB;
      var minOff = UI._insetTop() - y;
      minOff = minOff > 0 ? -minOff : 0;
      var off = UI._scroll[p.scroll] || 0;
      if (off > maxOff) off = maxOff;
      if (off < minOff) off = minOff;
      UI._scroll[p.scroll] = off;

      /* The clip makes partially-visible rows end at the box edge instead of
         spilling over the neighbours — and the hit areas are trimmed to
         match once the children have registered theirs. */
      var hits0 = UI._hits.length;
      var sclip0 = pushClip(x, y, availW, boxH);
      var pz0 = UI._curZone;
      UI._curZone = p.scroll;
      var sy = y + padT(p) - off, seenS = false;
      for (var si = 0; si < node.kids.length; si++) {
        var chh = measure(node.kids[si], availW - pl - pr);
        if (chh === 0) { draw(node.kids[si], x + pl, sy, availW - pl - pr); continue; }
        if (seenS) sy += gap3;
        seenS = true;
        /* Fully-outside items advance the cursor but skip their draw. */
        if (sy + chh >= y && sy <= y + boxH) draw(node.kids[si], x + pl, sy, availW - pl - pr);
        sy += chh;
      }
      UI._curZone = pz0;
      popClip(sclip0);
      UI._clipHits(hits0, x, y, availW, boxH);
      /* The viewport is a swipe target; a fixed step, or its own height. */
      UI._swipeZone(x, y, availW, boxH, p.scroll,
                    p.step === 'page' ? (boxH - padT(p) - padB(p)) : (p.step || 40), maxOff, minOff);
    } else if (boxH) {
      /* A pinned height makes this a flex column: children marked `flex` (or
         flex:N) split whatever the fixed-height children leave over. */
      var innerW = cwOv || (availW - pl - pr);
      var fixed = 0, flexTotal = 0, fi;
      var kidsX = [];
      var seenF = false;
      for (fi = 0; fi < node.kids.length; fi++) {
        var kx = expand(node.kids[fi]);
        kidsX.push(kx);
        var fl = kx && kx.props ? (kx.props.flex === true ? 1 : (kx.props.flex || 0)) : 0;
        var kh2 = fl > 0 ? -1 : measure(kx, innerW);
        if (kh2 === 0) continue;      /* a mark, not a block */
        if (fl > 0) flexTotal += fl;
        else fixed += kh2;
        if (seenF) fixed += gap3;
        seenF = true;
      }
      var leftover = boxH - padT(p) - padB(p) - fixed;
      if (leftover < 0) leftover = 0;
      var fy = y + padT(p), drewF = false;
      /* Nothing flexes and the height came from outside: centre the content,
         which is what a stretched button's label wants. */
      if (flexTotal === 0 && p.vcenter) {
        var vq = FONT.quantum || 1;
        fy += Math.floor(leftover / 2 / vq) * vq;
      }
      for (fi = 0; fi < node.kids.length; fi++) {
        var kf = kidsX[fi];
        var fl2 = kf && kf.props ? (kf.props.flex === true ? 1 : (kf.props.flex || 0)) : 0;
        if (fl2 === 0 && measure(kf, innerW) === 0) {
          draw(kf, x + pl - ox3, fy, innerW);   /* marks draw where the flow is */
          continue;
        }
        if (drewF) fy += gap3;
        drewF = true;
        if (fl2 > 0) {
          var share = Math.floor(leftover * fl2 / flexTotal);
          draw(kf, x + pl - ox3, fy, innerW, share);
          fy += share;
        } else {
          fy += draw(kf, x + pl - ox3, fy, innerW);
        }
      }
    } else {
      var cw3 = cwOv || (availW - pl - pr);
      var by = y + padT(p), drewB = false;
      for (var bi = 0; bi < node.kids.length; bi++) {
        if (measure(node.kids[bi], cw3) === 0) {
          draw(node.kids[bi], x + pl - ox3, by, cw3);
          continue;
        }
        if (drewB) by += gap3;
        drewB = true;
        by += draw(node.kids[bi], x + pl - ox3, by, cw3);
      }
    }
    if (clipHits0 >= 0) {
      popClip(clipPrev0);
      UI._clipHits(clipHits0, x, y, availW, hgt);
    }

    if ((p.onTap || p.onLongPress || p.onDraw) && !p.shield) {
      UI._hit(x - hp(p), y - hp(p), availW + hp(p) * 2, hgt + hp(p) * 2,
              p.onTap, p.onHold || p.onLongPress,
              p.onHold ? (p.holdEvery || 320) : 0, p.onDraw);
    }
  }
  return hgt;
}

/* How far a control's target extends past its paint. A fingertip is wider
   than a precise cursor, so the two rectangles are allowed to differ here,
   in one place, by an amount the control states. */
function hp(p) { return p.hitPad || 0; }

/* Side padding, defaulting to the uniform `pad`. One edge of a screen can be
   less reachable than another (a rotated panel's dead band, a notch), and
   content should only be held back from the edge that needs it. */
function padL(p) { return p.padL === undefined ? (p.pad || 0) : p.padL; }
function padR(p) { return p.padR === undefined ? (p.pad || 0) : p.padR; }
function padT(p) { return p.padT === undefined ? (p.pad || 0) : p.padT; }
function padB(p) { return p.padB === undefined ? (p.pad || 0) : p.padB; }

/* ---- a couple of ready-made components, not mandatory to use ---- */

function Button(p) {
  return h('box', {
    bg: p.bg === undefined ? UI.theme.key : p.bg,
    radius: 6, pad: p.pad === undefined ? em(1.25) : p.pad, /* em(1.25) is the old fixed 10 at the default font */
    h: p.h, w: p.w, onTap: p.onTap, onHold: p.onHold, holdEvery: p.holdEvery,
    onLongPress: p.onLongPress, hitPad: p.hitPad, vcenter: true
  }, h('text', { text: p.label, size: p.size || 2, color: p.color === undefined ? UI.theme.text : p.color, align: 'center' }));
}

function Swatch(p) {
  return h('box', { w: p.size || 24, h: p.size || 24, bg: p.color, radius: 4, border: UI.theme.muted });
}

/* A centred overlay panel for UI.openModal. Margins are MINIMUMS: the
 * panel centres vertically in the leftover space while its content fits,
 * and when the content would not fit inside the minimum margins the panel
 * pins to the available height and its CONTENT scrolls — while optional
 * `header` and `footer` nodes stay sticky above and below the scroll.
 * The panel node is rebuilt after the fits/pins decision rather than
 * mutated, because measure() caches by node and a stale content-height
 * cache would paint the background and border past the pinned bounds.
 * Usage: UI.openModal(function () { return h(Modal, {...}, ...kids); })
 */
function Modal(p) {
  var margin = p.margin === undefined ? em(1.5) : p.margin;
  var innerW = gfx.width() - margin * 2;
  var availH = gfx.height() - margin * 2;
  var gap = p.gap === undefined ? em(0.75) : p.gap;
  function build(pin) {
    var kids = [];
    if (p.header) kids.push(p.header);
    kids.push(h('box', pin ? { flex: 1, scroll: p.scroll || '_modal', gap: gap }
                           : { gap: gap }, p.children));
    if (p.footer) kids.push(p.footer);
    var props = {
      bg: p.bg === undefined ? UI.theme.panel : p.bg,
      border: p.border === undefined ? UI.theme.accent : p.border,
      borderW: p.borderW || 2,
      radius: p.radius === undefined ? 10 : p.radius,
      pad: p.pad === undefined ? em(1) : p.pad,
      gap: gap
    };
    if (pin) props.h = availH;
    return h('box', props, kids);
  }
  var probe = build(false);
  var panel = measure(probe, innerW) > availH ? build(true) : probe;
  return h('box', { h: gfx.height(), pad: margin, vcenter: true }, panel);
}

/* How far a finger may wander before the stroke stops being a tap. Small
   enough that a deliberate drag scrolls at once, large enough that a firm
   press on a button is not read as a one-pixel flick. */
var DRAG_SLOP = 6;

/* ---- virtual keyboards ------------------------------------------------
 *
 * Keyboard is plain JSX over ordinary boxes -- which is also the whole
 * story for a CUSTOM keyboard: build any view whose taps call
 * UI.key('press', name) (or UI.type("...") for literal text) and it is a
 * keyboard, with nothing to register. Every keystroke, from here, from a
 * physical board, or from a host's native OSK, takes the same road into
 * the focused input.
 *
 * Layouts: 'qwerty' (with shift and a symbols page), 'numbers', 't9'
 * (phone multi-tap: tap a key again within the window to cycle its
 * letters), and 'strip' -- a single scrolling row of characters, drag to
 * scroll, tap to type, for displays too small for a grid.
 */
function kbSend(k) { UI.key('down', k); UI.key('press', k); UI.key('up', k); }

/* One keyboard is on screen at a time; its transient state (shift, page,
   T9 cycling, strip scroll) is module-local, not per-instance. */
var KB = { shift: 0, page: 0, t9k: -1, t9i: 0, t9t: 0, t9s: 0, strip: 0, stripSym: 0, stripG: null };

function kbCap(str) { return KB.shift ? str.toUpperCase() : str; }
function kbTapChar(ch) {
  kbSend(kbCap(ch));
  if (KB.shift === 1) KB.shift = 0;    /* shift-once, phone style */
  UI._dirty = true;
}

function kbKey(label, onTap, o) {
  o = o || {};
  return h('box', {
    bg: o.bg === undefined ? UI.theme.key : o.bg,
    radius: 4, h: o.h, w: o.w, vcenter: true, onTap: onTap,
    onHold: o.onHold, holdEvery: o.holdEvery, onLongPress: o.onLongPress
  }, h('text', {
    text: label, size: o.size || 1, align: 'center',
    color: o.color === undefined ? UI.theme.text : o.color
  }));
}
function kbCharRow(str, kh) {
  var ks = [];
  for (var i = 0; i < str.length; i++) {
    ks.push(kbKey(kbCap(str.charAt(i)),
      (function (c) { return function () { kbTapChar(c); }; })(str.charAt(i)),
      { h: kh }));
  }
  return ks;
}
function kbDelKey(kh, w) {
  return kbKey('DEL', function () { kbSend('Backspace'); },
    { h: kh, w: w, bg: UI.theme.panel,
      onHold: function () { kbSend('Backspace'); }, holdEvery: 120 });
}
function kbOkKey(kh, w) {
  return kbKey('OK', function () { kbSend('Enter'); }, { h: kh, w: w, bg: UI.theme.accent });
}

function kbQwerty(kh) {
  var letters = KB.page === 0;
  /* two symbol pages: #+= flips between them, so every glyph the face
     carries is typeable -- brackets, backslash, pipe, tilde, backtick */
  var sym2 = KB.page === 2;
  var r3k = kbCharRow(letters ? 'zxcvbnm' : (sym2 ? '`$&"\':;' : '_"\':;!?'), kh);
  r3k.unshift(kbKey(letters ? (KB.shift ? 'ABC' : 'abc') : (sym2 ? '123' : '#+='),
    function () {
      if (letters) KB.shift = KB.shift ? 0 : 1;
      else KB.page = sym2 ? 1 : 2;
      UI._dirty = true;
    },
    { h: kh, bg: KB.shift && letters ? UI.theme.accent : UI.theme.panel }));
  r3k.push(kbDelKey(kh));
  return [
    h('row', { gap: 2 }, kbCharRow(letters ? 'qwertyuiop' : (sym2 ? '[]{}<>()^~' : '1234567890'), kh)),
    h('row', { gap: 2 }, kbCharRow(letters ? 'asdfghjkl' : (sym2 ? '*/\\|=+-#%' : '@#$%&-+()'), kh)),
    h('row', { gap: 2 }, r3k),
    h('row', { gap: 2 }, [
      kbKey(letters ? '123' : 'abc',
        function () { KB.page = letters ? 1 : 0; UI._dirty = true; },
        { h: kh, w: em(5), bg: UI.theme.panel }),
      kbKey(',', function () { kbTapChar(','); }, { h: kh, w: em(3) }),
      kbKey('SPACE', function () { kbSend(' '); }, { h: kh }),
      kbKey('.', function () { kbTapChar('.'); }, { h: kh, w: em(3) }),
      kbOkKey(kh, em(5))
    ])
  ];
}

function kbNumbers(kh) {
  var out = [], grid = ['123', '456', '789'];
  for (var r = 0; r < 3; r++) {
    out.push(h('row', { gap: 2 }, kbCharRow(grid[r], kh)));
  }
  out.push(h('row', { gap: 2 }, [
    kbKey('.', function () { kbSend('.'); }, { h: kh, size: 2 }),
    kbKey('0', function () { kbSend('0'); }, { h: kh, size: 2 }),
    kbDelKey(kh)
  ]));
  out.push(h('row', { gap: 2 }, [kbOkKey(kh)]));
  return out;
}

/* Multi-tap: the first tap types the key's first character; tapping the
   SAME key again inside the window replaces it with the next in the
   cycle (a Backspace then the new character, through the normal editing
   path, so it works on any focused input with no special support). */
/* Key 1 carries punctuation (quotes included, phone style) and the
   space key cycles space -> @ -> - -> 0, so addresses and dashes are
   typeable without leaving the pad. */
var T9 = ['.,?!\'"1', 'abc2', 'def3', 'ghi4', 'jkl5', 'mno6', 'pqrs7', 'tuv8', 'wxyz9', ' @-0'];
/* The symbol pad, a LONG PRESS of abc away: each key multi-taps through
   a themed set, so the whole face is reachable from T9 too. */
var T9S = ['.,;:', '\'"`', '?!~', '@#&', '$%^', '-_=', '()[]', '{}<>', '*/\\|+'];
function t9Table() { return KB.t9s ? T9S : T9; }
function kbT9Tap(ki) {
  var cyc = ki === 9 ? T9[9] : t9Table()[ki];
  var now = sys.millis();
  if (KB.t9k === ki && KB.t9t > now) {
    KB.t9i = (KB.t9i + 1) % cyc.length;
    kbSend('Backspace');
  } else {
    KB.t9i = 0;
  }
  KB.t9k = ki;
  KB.t9t = now + 900;
  kbSend(kbCap(cyc.charAt(KB.t9i)));
  /* Commit = the window lapsing; shift-once survives cycling so every
     resend of the same letter keeps its case, and clears on commit. */
  UI.setTimer(function () {
    if (KB.t9k === ki && sys.millis() >= KB.t9t) {
      KB.t9k = -1;
      if (KB.shift === 1) KB.shift = 0;
      UI._dirty = true;
    }
  }, 920);
  UI._dirty = true;
}
function kbT9Key(ki, kh) {
  var sym = KB.t9s && ki !== 9;
  var cyc = ki === 9 ? T9[9] : t9Table()[ki];
  var active = KB.t9k === ki && KB.t9t > sys.millis();
  var lines;
  if (ki === 9) {
    lines = [
      h('text', { text: '0', size: 1, align: 'center', color: UI.theme.muted }),
      h('text', { text: 'SPC @-', size: 1, align: 'center' })
    ];
  } else if (sym) {
    /* the symbol pad: the cycle IS the key */
    lines = [h('text', { text: cyc, size: 1, align: 'center' })];
  } else {
    /* the LETTERS are the key; the digit is a small hint below them */
    var letters = cyc.slice(0, cyc.length - 1);
    var digit = cyc.charAt(cyc.length - 1);
    lines = [
      h('text', { text: kbCap(letters), size: 1, align: 'center' }),
      h('text', { text: digit, size: 1, align: 'center', color: UI.theme.muted })
    ];
  }
  return h('box', {
    bg: active ? UI.theme.accent : UI.theme.key, radius: 4, h: kh,
    vcenter: true, onTap: function () { kbT9Tap(ki); },
    /* hold = the key's DIGIT, phone style -- works from the symbol pad
       too, the position is the digit. Any pending cycle is left as it
       stands: hold starts fresh. */
    onLongPress: function () {
      KB.t9k = -1;
      kbSend(T9[ki].charAt(T9[ki].length - 1));
      UI._dirty = true;
    }
  }, lines);
}
function kbT9(kh) {
  var out = [];
  for (var r = 0; r < 3; r++) {
    var ks = [];
    for (var c = 0; c < 3; c++) ks.push(kbT9Key(r * 3 + c, kh));
    out.push(h('row', { gap: 2 }, ks));
  }
  out.push(h('row', { gap: 2 }, [
    kbKey(KB.t9s ? 'abc' : (KB.shift ? 'ABC' : 'abc'),
      function () {
        if (KB.t9s) KB.t9s = 0;
        else KB.shift = KB.shift ? 0 : 1;
        UI._dirty = true;
      },
      { h: kh, bg: KB.shift && !KB.t9s ? UI.theme.accent : UI.theme.panel,
        onLongPress: function () { KB.t9s = 1; UI._dirty = true; } }),
    kbT9Key(9, kh),
    kbDelKey(kh)
  ]));
  out.push(h('row', { gap: 2 }, [kbOkKey(kh)]));
  return out;
}

var STRIP_CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789.,!?@#$%&-_+()/:;\'"*=';
/* the symbol strip, a LONG PRESS of abc away: everything the face has */
var STRIP_SYMS = '.,!?@#$%&-_+()/:;\'"*=<>[]{}\\|~^\u0060';
function kbStrip(kh) {
  var adv = fadv(2);
  var cell = adv * 2;
  var chars = KB.stripSym ? STRIP_SYMS : kbCap(STRIP_CHARS);
  var contentW = chars.length * cell;
  var sideW = em(4);
  var stripW = gfx.width() - 8 - sideW * 2 - 4;   /* keyboard pad 4, row gap 2 */
  var maxOff = contentW - stripW;
  if (maxOff < 0) maxOff = 0;
  if (KB.strip > maxOff) KB.strip = maxOff;
  var strip = h('box', {
    h: kh, bg: UI.theme.key, radius: 4, clip: true, vcenter: true,
    offX: KB.strip, contentW: contentW,
    onDraw: function (phase, lx, ly, id) {
      if (phase === 0) { KB.stripG = { x0: lx, o0: KB.strip, moved: 0 }; return; }
      var g = KB.stripG;
      if (!g) return;
      var dx = lx - g.x0;
      if (dx > DRAG_SLOP || dx < -DRAG_SLOP) g.moved = 1;
      if (g.moved) {
        var no = g.o0 - dx;
        KB.strip = no < 0 ? 0 : (no > maxOff ? maxOff : no);
        UI._dirty = true;
      }
      if (phase === 2) {
        if (!g.moved) {
          var idx = Math.floor((lx + KB.strip) / cell);
          if (idx >= 0 && idx < chars.length) kbTapChar(chars.charAt(idx));
        }
        KB.stripG = null;
      }
    }
  }, h('text', { text: chars.split('').join(' '), size: 2, nowrap: true }));
  return [
    h('row', { gap: 2 }, [
      kbKey(KB.stripSym ? 'abc' : (KB.shift ? 'ABC' : 'abc'),
        function () {
          if (KB.stripSym) { KB.stripSym = 0; KB.strip = 0; }
          else KB.shift = KB.shift ? 0 : 1;
          UI._dirty = true;
        },
        { h: kh, w: sideW, bg: KB.shift && !KB.stripSym ? UI.theme.accent : UI.theme.panel,
          onLongPress: function () { KB.stripSym = 1; KB.strip = 0; UI._dirty = true; } }),
      strip,
      kbDelKey(kh, sideW)
    ]),
    h('row', { gap: 2 }, [
      kbKey('SPACE', function () { kbSend(' '); }, { h: kh }),
      kbOkKey(kh, em(6))
    ])
  ];
}

function Keyboard(p) {
  var layout = p.layout || 'qwerty';
  /* height is a HINT for the whole keyboard: keys scale to fit it given
     the layout's row count. keyH sets one key directly instead. */
  var rowsN = layout === 'strip' ? 2 : (layout === 'qwerty' ? 4 : 5);
  var kh;
  if (p.height) kh = Math.floor((p.height - 8 - (rowsN - 1) * 2) / rowsN);
  else kh = p.keyH || (flh(2) + em(1));
  if (kh < 8) kh = 8;
  var pos0 = p.position || 'inline';
  /* The panel is ~40 nodes rebuilt per keystroke without this; its real
     inputs are just these. KB.strip rebuilds per drag frame (the offset
     is a prop); everything read at DRAW time needs no dep. */
  function kbRows() {
    if (layout === 'numbers') return kbNumbers(kh);
    if (layout === 't9') return kbT9(kh);
    if (layout === 'strip') return kbStrip(kh);
    return kbQwerty(kh);
  }
  var rows = null; /* built lazily; the exclusive branch always builds fresh */
  var pos = pos0;
  /* The panel swallows taps: a press between keys must not fall through
     to whatever the overlay is covering. A DOCKED panel drops the
     padding on its docked edge, so the outermost row runs flush to the
     safe edge and owns every clamped edge press -- the tallest target
     the display can honestly offer. */
  var panel = UI.memo('_kbPanel',
    [layout, kh, pos, KB.shift, KB.page, KB.strip, KB.t9k, KB.t9i,
     KB.t9s, KB.stripSym, p.bg, gfx.width()],
    function () {
      return h('box', {
        bg: p.bg === undefined ? UI.theme.panel : p.bg, pad: 4, gap: 2,
        padB: pos === 'bottom' ? 0 : undefined,
        padT: pos === 'top' ? 0 : undefined,
        shield: true
      }, kbRows());
    });
  if (UI.exclusive()) {
    /* Full-display: a MIRROR of the focused input above the keys. Input
       state is keyed by id, so a second input node with the same id IS
       the same field -- same text, same caret; it types into the
       original. focusable={false} keeps the mirror out of the focus
       order and leaves the original's remembered position alone. */
    var xst = UI._inputs[UI._focus];
    var xp = (xst && xst.p) || {};
    /* The close key rides WITH the mirror input, full input height --
       one obvious target, no header chrome. A label line above is
       opt-in via header={true}. */
    var xsz = xp.size || 2;
    var xlh = flh(xsz) + 2;
    var xpd = Math.max(4, Math.floor(xlh / 3));
    /* The display is all the keyboard has to fill here, so the keys grow
       to use it: whatever height remains under the mirror row (and the
       opt-in header), divided among the layout's rows -- never smaller
       than the docked size, capped so a 2-row strip does not become
       comically tall. The flex spacer absorbs the rounding. */
    var xHdr = p.header && (xp.label || xp.placeholder);
    var xScr = gfx.height() - (UI.safe.inset ? UI.safe.top + UI.safe.bottom : 0);
    var xRoom = xScr - 12 - (xlh + xpd * 2) - 6 - (xHdr ? flh(1) + 2 + 6 : 0);
    var xkh = Math.floor((xRoom - 8 - (rowsN - 1) * 2) / rowsN);
    if (xkh < kh) xkh = kh;
    var xMax = (flh(2) + 2) * 3;
    if (xkh > xMax) xkh = xMax;
    var xrows;
    if (layout === 'numbers') xrows = kbNumbers(xkh);
    else if (layout === 't9') xrows = kbT9(xkh);
    else if (layout === 'strip') xrows = kbStrip(xkh);
    else xrows = kbQwerty(xkh);
    var xkids = [
      h('row', { gap: 4 }, [
        h('input', { id: UI._focus, size: xsz, password: xp.password,
                     maxLen: xp.maxLen, placeholder: xp.placeholder, label: xp.label,
                     value: xp.value, onChange: xp.onChange, onSubmit: xp.onSubmit,
                     focusable: false }),
        kbKey('x', function () { kbSend('Escape'); },
              { w: em(4), h: xlh + xpd * 2, size: 2,
                bg: UI.theme.panel, color: UI.theme.err })
      ]),
      h('box', { flex: 1 }),
      h('box', { bg: p.bg === undefined ? UI.theme.panel : p.bg, pad: 4, gap: 2,
                 shield: true }, xrows)
    ];
    if (xHdr) {
      xkids.unshift(h('text', { text: xp.label || xp.placeholder,
                                size: 1, color: UI.theme.muted }));
    }
    var sfXI = UI.safe.inset;
    return h('abs', { x: sfXI ? UI.safe.left : 0, y: sfXI ? UI.safe.top : 0,
                      w: gfx.width() - (sfXI ? UI.safe.left + UI.safe.right : 0) },
      h('box', { h: gfx.height() - (sfXI ? UI.safe.top + UI.safe.bottom : 0),
                 bg: UI.theme.bg, pad: 6, gap: 6, shield: true }, xkids));
  }
  if (pos === 'bottom' || pos === 'top') {
    /* Overlay: pinned to a screen edge, no flow space taken -- the page
       keeps its full height and the keyboard draws over it. The inset
       tells scroll-into-view how much of the screen the keyboard hides,
       so a revealed field lands above it, not under it. */
    var totalH = rowsN * kh + (rowsN - 1) * 2 + 4;  /* one padded edge: the docked side has none */
    /* Docked at the TRUE screen edge: the flush outer row plus safe-band
       hit extension means a press below (or above) it still lands on it.
       Only inset mode pulls the dock inside the safe rect. */
    var sfIns = UI.safe.inset;
    var sfKT = sfIns ? UI.safe.top : 0, sfKB = sfIns ? UI.safe.bottom : 0;
    var sfKL = sfIns ? UI.safe.left : 0, sfKR = sfIns ? UI.safe.right : 0;
    UI.inset(pos, totalH + (pos === 'top' ? sfKT : sfKB));
    return h('abs', {
      x: sfKL, y: pos === 'top' ? sfKT : gfx.height() - totalH - sfKB,
      w: gfx.width() - sfKL - sfKR
    }, panel);
  }
  return panel;
}

var UI = {
  root: null,
  state: {},
  _dirty: true,
  _hits: [],
  _scroll: {},     /* named scroll offsets, persistent across renders */
  _swipes: [],     /* scrollable zones registered by the current render */
  /* Strokes in progress, keyed by pointer id. A mouse, a keyboard-driven
     fake cursor, or a single-touch panel all just use id 0 and this behaves
     exactly as the single-`_ptr` version did; a multitouch source (a
     browser's real touch events) passes each finger's own identifier, and
     each gets independent press/drag/tap/hold tracking — nothing in the
     hit-testing or scroll-zone machinery below needed to change for this,
     since those are keyed by screen position, not by which finger is
     touching it. */
  _ptrs: {},
  /* Flings outlive the stroke that started them, so they cannot be keyed by
     pointer id — a released finger is gone. Keyed by scroll-zone name
     instead, and a list rather than one slot: two different fingers can
     leave two different zones flinging at once. */
  _flings: [],
  modal: null,     /* a component drawn over the page, owning all input */
  _listeners: {},  /* name -> [fn, ...], for on/off/emit */
  _timers: [],     /* {at, fn}, for setTimeout/clearTimeout — checked in ticker() */
  _timerSeq: 0,
  _focus: null,    /* id of the focused input, or null */
  _inputs: {},     /* per-input engine state: text, caret, scroll, nav */
  _focusables: [], /* input ids registered by the current render, paint order */
  _reveal: null,   /* input id to scroll into view after this render */
  _exclusive: false, /* keyboard should take the whole display and mirror
                        the focused input -- set by the input's `exclusive`
                        prop, or automatically when the field cannot be
                        scrolled clear of the keyboard at all */
  _frame: 0,
  _blinkPh: 0,
  _curZone: null,  /* scroll zone being drawn into, for nav bookkeeping */
  _insetT: 0,      /* screen bands covered by overlays this frame -- what */
  _insetB: 0,      /* scroll-into-view must keep a revealed field out of */
  _insetTP: 0,     /* last frame's insets: overlays draw AFTER the page, so */
  _insetBP: 0,     /* the page's own layout reads the previous frame's */
  /* Host hook: called with the focused input's id (or null on blur). This
     is how a host that can present its own keyboard -- a browser focusing
     a real <input> to summon the phone's, native code outside the JS VM
     drawing one -- knows when to show and hide it. */
  onFocusChange: null,

  /* Edge bands where the DISPLAY's touch is unreliable -- cheap panels,
     rotated controllers and round glass all have them. Set by the host or
     the app per device (UI.safe.bottom = 8).

     The DEFAULT treatment changes nothing visually: any control or
     scroll zone whose rect borders or enters a band has its TOUCH TARGET
     extended to the physical edge -- the bottom row of a keyboard
     accepts presses from below itself, an edge button grows into the
     band beside it. The display's flaky rim still reports SOMETHING for
     most presses; extension makes whatever it reports land on the thing
     the finger meant.

     safe.inset = true additionally holds the LAYOUT inside the safe rect
     (background still paints full-bleed) and snaps band touches to the
     content edge -- for panels whose rim is truly dead, or round glass
     where drawing there is pointless anyway. */
  safe: { top: 0, left: 0, bottom: 0, right: 0, inset: false },

  /* Which keys walk the focus order while an input holds focus. Both on
     by default; an app that needs Tab or the vertical arrows for itself
     turns the flag off and the key falls through to UI.onKey instead --
     as does ANY key the editor has no meaning for. */
  focusNav: { tab: true, arrows: true },
  _safeX: function (x) {
    if (!this.safe.inset) return x;
    var r = gfx.width() - 1 - this.safe.right;
    return x < this.safe.left ? this.safe.left : (x > r ? r : x);
  },
  _safeY: function (y) {
    if (!this.safe.inset) return y;
    var b = gfx.height() - 1 - this.safe.bottom;
    return y < this.safe.top ? this.safe.top : (y > b ? b : y);
  },
  /* The extended bounds of a rect for touch tests: an edge that reaches
     its safe band stretches to the physical edge of the display. */
  _safeRect: function (t) {
    var x1 = t.x, y1 = t.y, x2 = t.x + t.w, y2 = t.y + t.h;
    if (this.safe.left && x1 <= this.safe.left) x1 = 0;
    if (this.safe.top && y1 <= this.safe.top) y1 = 0;
    if (this.safe.right && x2 >= gfx.width() - this.safe.right) x2 = gfx.width();
    if (this.safe.bottom && y2 >= gfx.height() - this.safe.bottom) y2 = gfx.height();
    return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
  },

  /* A default palette. Entirely a starting point — replace UI.theme wholesale
     from an app if a different look is wanted; nothing else in this file
     reads any other source for colour. */
  theme: {
    bg: 0x000000, panel: 0x1b1e24, text: 0xffffff, muted: 0x98a1ae,
    accent: 0x4b8bf5, ok: 0x4ade80, warn: 0xfbbf24, err: 0xf87171, key: 0x212530
  },

  /* Called on a long-press fire that isn't itself repeating — the one place
     this engine wants to say "that took effect" with no pixel to point at.
     No-op unless an app wires it (e.g. to a native beep); the engine makes
     no assumption that sound, or any particular native, exists. */
  onLongPressFeedback: null,

  /**
   * Mounting is where a new script takes over — and on a device that can
   * swap its running script live (push a new bundle without rebooting,
   * which every one of the JS-eval backends here does), the JS heap is
   * NOT reset when that happens: a fresh script is eval'd into the same
   * persistent context the last one used. A timer or an event listener
   * registered by whatever was running before is exactly the danger the
   * original firmware's comment on setTimeout was pointing at — "a script
   * that may not be running" — so mount() is where a previous script's
   * pending timers and listeners get let go, rather than sitting in the
   * heap to fire into a UI that no longer expects them.
   */
  mount: function (f) {
    this.root = f;
    this._timers = [];
    this._listeners = {};
    this._dirty = true;
  },

  /* Boot boundary: return the singleton to power-on state before handing
     the UI to a DIFFERENT script. mount() alone deliberately keeps
     app-owned things (state, scroll positions, onTick/onKey) so a script
     can remount its own root; reset() is for hosts swapping scripts in one
     persistent context — an ESP32 loading a new bundle, a launcher
     switching examples. Everything app-visible goes back to nothing. */
  reset: function () {
    this.root = null;
    this.modal = null;
    this.state = {};
    this._hits = [];
    this._scroll = {};
    this._swipes = [];
    this._ptrs = {};
    this._flings = [];
    this._timers = [];
    this._listeners = {};
    this.onTick = null;
    this.onKey = null;
    this.onPatch = null;
    this.onLongPressFeedback = null;
    this._focus = null;
    this._inputs = {};
    this._memo = {};
    this._focusables = [];
    this._reveal = null;
    this._curZone = null;
    this.onFocusChange = null;
    this._dirty = true;
  },
  /* A modal is just a component drawn last. Pages open one instead of
     routing to a page, so the thing being edited stays on screen behind it
     and no page has to know it can be interrupted. */
  openModal: function (f) {
    this.modal = f;
    this._dirty = true;
  },
  closeModal: function () { this.modal = null; this._dirty = true; },
  set: function (patch) {
    for (var k in patch) this.state[k] = patch[k];
    this._dirty = true;
  },
  dirty: function () { return this._dirty; },
  /* The host calls this every frame: advance momentum, run the app's tick,
     and report dirtiness — one call, because each one crosses into the
     engine/host boundary. */
  ticker: function () {
    for (var pid in this._ptrs) {
      var hp2 = this._ptrs[pid];
      if (hp2.holdFn && hp2.far <= DRAG_SLOP && !(hp2.fired && !hp2.every)) {
        var hnow = sys.millis();
        if (hnow - hp2.at >= (hp2.fired ? hp2.every : 500)) {
          hp2.at = hnow;
          hp2.fired++;
          if (!hp2.every && this.onLongPressFeedback) this.onLongPressFeedback();
          hp2.holdFn();
        }
      }
    }

    if (this._flings.length) {
      var kept = [];
      for (var fi = 0; fi < this._flings.length; fi++) {
        var f = this._flings[fi];
        var before = this._scroll[f.key] || 0;
        var after = this._scrollTo(f.key, before + f.v);
        f.v = f.v * 0.86;
        /* Stop at the ends, or once a frame no longer moves a whole pixel. */
        if (after !== before && !(f.v < 1.2 && f.v > -1.2)) kept.push(f);
      }
      this._flings = kept;
    }

    if (this._timers.length) {
      var now = sys.millis(), due = [], remaining = [];
      for (var ti = 0; ti < this._timers.length; ti++) {
        (this._timers[ti].at <= now ? due : remaining).push(this._timers[ti]);
      }
      this._timers = remaining;
      /* Fired after the split, not during it: a timer callback that
         schedules another timer must not be able to fire in the same
         tick it was just queued from — that way lies an infinite loop
         with no host in the loop to notice. */
      for (var di = 0; di < due.length; di++) due[di].fn();
    }

    if (this._focus && this._inputs[this._focus]) {
      var bp2 = Math.floor((sys.millis() - this._inputs[this._focus].bt) / 530) % 2;
      if (bp2 !== this._blinkPh) { this._blinkPh = bp2; this._dirty = true; }
    }
    if (this.onTick) this.onTick();
    return this._dirty;
  },
  /* Host pushes JSON snapshots here; apps may define UI.onPatch to reshape. */
  patch: function (json) {
    var o = JSON.parse(json);
    if (this.onPatch && this.onPatch(o)) { this._dirty = true; return; }
    this.set(o);
  },
  _hit: function (x, y, w, hh, fn, hold, every, drawFn) {
    this._hits.push({ x: x, y: y, w: w, h: hh, fn: fn, hold: hold, every: every, draw: drawFn });
  },
  /**
   * Trim the controls registered since `from` to a viewport.
   *
   * Drawing inside a scroll box is clipped, but hit areas were not: a
   * control scrolled half under something fixed still answered across its
   * whole height. Which of the two won came down to draw order, which is
   * not a thing anyone should have to reason about.
   */
  _clipHits: function (from, x, y, w, hh) {
    var kept = [], i, t;
    for (i = 0; i < from; i++) kept.push(this._hits[i]);
    for (i = from; i < this._hits.length; i++) {
      t = this._hits[i];
      var x1 = t.x > x ? t.x : x;
      var y1 = t.y > y ? t.y : y;
      var x2 = t.x + t.w < x + w ? t.x + t.w : x + w;
      var y2 = t.y + t.h < y + hh ? t.y + t.h : y + hh;
      if (x2 <= x1 || y2 <= y1) continue;   /* scrolled fully out of sight */
      t.x = x1; t.y = y1; t.w = x2 - x1; t.h = y2 - y1;
      kept.push(t);
    }
    this._hits = kept;
  },

  /* Topmost control under a point — later-drawn wins, as with taps. The
     test uses safe-extended bounds: a control against a flaky edge band
     owns the band beside it. */
  _hitAt: function (x, y) {
    for (var i = this._hits.length - 1; i >= 0; i--) {
      var t = this._safeRect(this._hits[i]);
      if (x >= t.x && x < t.x + t.w && y >= t.y && y < t.y + t.h) return this._hits[i];
    }
    return null;
  },
  _swipeZone: function (x, y, w, hh, key, step, maxOff, minOff) {
    this._swipes.push({ x: x, y: y, w: w, h: hh, key: key, step: step, maxOff: maxOff, minOff: minOff || 0 });
  },

  render: function () {
    if (!this.root) return;
    this._hits = [];
    this._swipes = [];
    this._focusables = [];
    this._frame++;
    this._curZone = null;
    this._insetTP = this._insetT;
    this._insetBP = this._insetB;
    this._insetT = 0;
    this._insetB = 0;
    CLIP = null;
    gfx.clear(this.theme.bg);
    var sfIns = this.safe.inset;
    var sfL = sfIns ? this.safe.left : 0, sfT = sfIns ? this.safe.top : 0;
    var sfW = gfx.width() - (sfIns ? sfL + this.safe.right : 0);
    var sfH = gfx.height() - (sfIns ? sfT + this.safe.bottom : 0);
    /* inset mode pins the root to the safe height -- an app's usual
       h: gfx.height() must not push its bottom row into the dead band.
       Default mode draws exactly as before: full bleed. */
    var sfF = (sfIns && (sfT || this.safe.bottom)) ? sfH : undefined;
    draw(h(this.root, {}), sfL, sfT, sfW, sfF);
    if (this.modal) {
      /* Everything under the modal stops listening. A dialog you can press
         through is not a dialog. */
      this._hits = [];
      this._swipes = [];
      this._flings = [];
      draw(h(this.modal, {}), sfL, sfT, sfW, sfF);
    }
    if (this._reveal) this._revealFocus();
    this._dirty = false;
  },

  /* Topmost scrollable zone under a point, and lookup by name for a zone
     whose extent may have changed since the finger went down. */
  _zoneAt: function (x, y) {
    for (var i = this._swipes.length - 1; i >= 0; i--) {
      var z = this._safeRect(this._swipes[i]);
      if (x >= z.x && x < z.x + z.w && y >= z.y && y < z.y + z.h) return this._swipes[i];
    }
    return null;
  },
  _zone: function (key) {
    for (var i = 0; i < this._swipes.length; i++) {
      if (this._swipes[i].key === key) return this._swipes[i];
    }
    return null;
  },
  /* Clamp against the zone's *current* extent — content grows and shrinks
     under the finger (a list filling in, a patch arriving) and a limit
     captured at press time would let the view run off the end. */
  /* Sub-cell alignment unit for scroll offsets — a terminal backend sets it
     to its sub-pixels-per-cell so a fling can never park content on an odd
     row, where every even-aligned stroke would straddle cell boundaries. */
  scrollQuantum: 1,
  _scrollTo: function (key, off) {
    var sq = this.scrollQuantum || 1;
    if (sq > 1) off = Math.round(off / sq) * sq;
    var z = this._zone(key);
    var max = z ? z.maxOff : 0;
    var min = z ? (z.minOff || 0) : 0;
    if (off > max) off = max;
    if (off < min) off = min;
    off = Math.round(off);
    if (off !== this._scroll[key]) {
      this._scroll[key] = off;
      this._dirty = true;
    }
    return off;
  },

  /**
   * One touch sample from one contact: phase 0 press, 1 move, 2 release.
   *
   * `id` identifies which contact this is — 0 for a mouse, a keyboard-
   * driven fake cursor, or a single-touch panel; each finger's own
   * identifier for a real multitouch source. Every id is tracked
   * independently, so two fingers pressing two different controls (or
   * dragging two different scroll zones) at once both just work.
   *
   * The whole stroke arrives here because the classification belongs to
   * the UI, not to the driver: a list scrolls while the finger is still
   * down, and whether the stroke was a tap is only knowable once it ends.
   */
  pointer: function (id, phase, x, y) {
    /* A handler that returns true owns the stroke — e.g. a calibration
       screen reading raw, uncorrected controller coordinates, which must
       not be run through hit-testing. */
    if (this.onPointer && this.onPointer(id, phase, x, y)) return;
    x = this._safeX(x);
    y = this._safeY(y);

    if (phase === 0) {
      var hit = this._hitAt(x, y);
      /* onDraw controls own the whole stroke: every position, press to
         release, in the control's own coordinates. No tap, no scroll. */
      if (hit && hit.draw) {
        this._ptrs[id] = { drawFn: hit.draw, dx0: hit.x, dy0: hit.y, far: 0, x0: x, y0: y, y: y, key: null, holdFn: null, fired: 0, v: 0, t: sys.millis(), at: sys.millis(), every: 0, off0: 0 };
        hit.draw(0, x - hit.x, y - hit.y, id);
        this._dirty = true;
        return;
      }
      var grab = hit && hit.hold ? hit : null;
      var z = grab ? null : this._zoneAt(x, y);
      /* This contact catches whatever zone it lands on, if that zone is
         still gliding from a different finger's earlier fling — but a
         press somewhere else must not cancel a fling it has nothing to do
         with, which a blanket "any press stops the fling" rule would do. */
      if (z) {
        var kept = [];
        for (var fi = 0; fi < this._flings.length; fi++) {
          if (this._flings[fi].key !== z.key) kept.push(this._flings[fi]);
        }
        this._flings = kept;
      }
      this._ptrs[id] = {
        x0: x, y0: y, y: y, far: 0,
        key: z ? z.key : null,
        off0: z ? (this._scroll[z.key] || 0) : 0,
        holdFn: grab ? grab.hold : null,
        every: grab ? grab.every : 0,
        at: sys.millis(), fired: 0,
        v: 0, t: sys.millis()
      };
      return;
    }

    var p = this._ptrs[id];
    if (!p) return;
    var dx = x - p.x0, dy = y - p.y0;
    var far = (dx < 0 ? -dx : dx) + (dy < 0 ? -dy : dy);
    if (far > p.far) p.far = far;

    if (phase === 1) {
      if (p.drawFn) {
        p.drawFn(1, x - p.dx0, y - p.dy0, id);
        this._dirty = true;
        p.y = y;
        return;
      }
      if (p.key && p.far > DRAG_SLOP) {
        /* Absolute, from where the drag began: tracking deltas accumulates
           the rounding and the list drifts away from the finger. */
        this._scrollTo(p.key, p.off0 - dy);
        var now = sys.millis(), dt = now - p.t;
        if (dt > 0) {
          p.v = (p.y - y) / dt * 16;  // pixels per 16 ms frame
          p.t = now;
        }
      }
      p.y = y;
      return;
    }

    /* Release: a stroke that stayed put was a tap on where it started —
       unless holding it already did the job. */
    delete this._ptrs[id];
    if (p.drawFn) { p.drawFn(2, x - p.dx0, y - p.dy0, id); this._dirty = true; return; }
    if (p.fired) return;
    if (p.far <= DRAG_SLOP) { this.tap(p.x0, p.y0); return; }
    if (p.key && (p.v > 2 || p.v < -2)) this._flings.push({ key: p.key, v: p.v });
  },

  /**
   * A key event from something that isn't spatial — a physical or virtual
   * keyboard has no x/y to hit-test against, so it gets its own entry
   * point rather than being forced through pointer(). mjsx-core does not
   * interpret keys at all: it only relays type ('down'/'up'/'press') and
   * the key's name (a browser's own KeyboardEvent.key string — "Enter",
   * "ArrowUp", "a" — is the natural source and needs no translation to
   * reach here unchanged). What a key means is entirely up to whatever
   * sets UI.onKey; a CLI host mapping arrow keys to a fake cursor's
   * movement, for instance, does that itself and never touches this at
   * all — it only calls pointer() with the cursor's position.
   */
  key: function (type, key) {
    /* A focused input consumes the keyboard: presses edit it, and none of
       the stroke reaches UI.onKey -- an app shortcut must not fire off a
       character someone was typing into a field. */
    if (this._focus && this._inputs[this._focus]) {
      /* presses the editor gives no meaning to fall through to the app;
         down/up strokes stay swallowed while typing */
      if (type === 'press' && !this._editKey(key) && this.onKey) this.onKey(type, key);
      return;
    }
    if (this.onKey) this.onKey(type, key);
  },

  /* ---- focus: opt-out per input via focusable={false} ---- */
  /* Reserve a band of the screen as covered by an overlay (a keyboard,
     any docked panel). Cleared every render, so the thing reserving it
     just calls this while it is on screen -- the built-in Keyboard does
     for its 'top'/'bottom' positions, and a custom JSX keyboard may too. */
  inset: function (side, px) {
    if (side === 'top') { if (px > this._insetT) this._insetT = px; }
    else if (px > this._insetB) this._insetB = px;
  },
  _insetTop: function () { return this._insetT > this._insetTP ? this._insetT : this._insetTP; },
  _insetBot: function () { return this._insetB > this._insetBP ? this._insetB : this._insetBP; },
  /* Reuse a built subtree while its deps are unchanged. The engine
     memoises expand() and measure() ON NODE INSTANCES, so handing the
     SAME node back skips the component calls, the h() allocations and
     the layout math for the whole subtree -- on a small moving-GC
     engine the allocations are the expensive part of a frame. Deps are
     compared shallowly (===): list everything the subtree's build reads
     (state, sizes) AND everything its closures capture. Draw-time reads
     (an input's text, scroll offsets) need no dep -- nodes are reused,
     drawing still happens every frame. */
  _memo: {},
  memo: function (key, deps, build) {
    var m = this._memo[key];
    if (m && m.deps.length === deps.length) {
      var same = true;
      for (var i = 0; i < deps.length; i++) {
        if (m.deps[i] !== deps[i]) { same = false; break; }
      }
      if (same) return m.node;
    }
    var node = build();
    this._memo[key] = { deps: deps, node: node };
    return node;
  },
  focused: function () { return this._focus; },
  focus: function (id) {
    if (this._focus === id) return;
    this._focus = id;
    this._exclusive = false;
    var st = this._inputs[id];
    if (st) {
      st.bt = sys.millis();
      st.follow = 1;
      if (st.cur > st.text.length) st.cur = st.text.length;
      if (st.p && st.p.exclusive) this._exclusive = true;
    }
    this._reveal = id;
    this._dirty = true;
    if (this.onFocusChange) this.onFocusChange(id);
  },
  blur: function () {
    if (!this._focus) return;
    this._focus = null;
    this._exclusive = false;
    this._dirty = true;
    if (this.onFocusChange) this.onFocusChange(null);
  },
  /* Next/previous field in content order. Every input whose home still
     exists is in the cycle -- including ones scrolled out of sight, which
     is the point: Tab reaches below the fold and _revealFocus brings the
     field to it. */
  focusNext: function (dir) {
    dir = dir || 1;
    var ids = [], id2, i;
    for (id2 in this._inputs) {
      var n2 = this._inputs[id2].nav;
      if (!n2) continue;
      if (n2.zone ? this._zone(n2.zone) : n2.seen === this._frame) ids.push(id2);
    }
    if (!ids.length) return;
    var self = this;
    ids.sort(function (a, b) { return self._inputs[a].nav.cy - self._inputs[b].nav.cy; });
    var at = -1;
    for (i = 0; i < ids.length; i++) if (ids[i] === this._focus) at = i;
    this.focus(ids[((at + dir) % ids.length + ids.length) % ids.length]);
  },
  focusPrev: function () { this.focusNext(-1); },
  /* Should the keyboard take over the display? True when the focused
     input asked for it (exclusive prop) or when no amount of scrolling
     can get the field clear of the keyboard. The built-in Keyboard
     honours this; a custom JSX keyboard can read it and do the same. */
  exclusive: function () { return !!(this._exclusive && this._focus); },
  _revealFocus: function () {
    var id = this._reveal;
    this._reveal = null;
    var st = this._inputs[id];
    if (!st || !st.nav) return;
    if (!st.nav.zone) {
      /* A fixed field is visible where it is or not at all: if an overlay
         covers it, the only way to type into it is the exclusive
         full-display keyboard with its mirror. */
      if (st.nav.cy < this._insetTop() ||
          st.nav.cy + st.nav.h > gfx.height() - this._insetBot()) {
        if (!this._exclusive) { this._exclusive = true; this._dirty = true; }
      }
      return;
    }
    var z = this._zone(st.nav.zone);
    if (!z) return;
    /* nav.cy is screen y plus the zone offset at draw time -- a content
       coordinate, stable while the zone scrolls. Solve for the offsets
       that keep the field a small margin inside the viewport. */
    var off = this._scroll[st.nav.zone] || 0;
    var m = 4;
    /* the zone's viewport, minus whatever an overlay is covering -- unless
       the overlay leaves too little of it to be worth aiming for */
    var visTop = z.y > this._insetTop() ? z.y : this._insetTop();
    var gh = gfx.height() - this._insetBot();
    var visBot = z.y + z.h < gh ? z.y + z.h : gh;
    if (visBot - visTop < st.nav.h + m * 2) {
      /* the overlay leaves less viewport than the field needs: scrolling
         cannot help, the keyboard must take the display and mirror it */
      if (!this._exclusive) { this._exclusive = true; this._dirty = true; }
      return;
    }
    var lo = st.nav.cy + st.nav.h - visBot + m;
    var hi = st.nav.cy - visTop - m;
    if (hi < lo) hi = lo;
    if (off < lo) this._scrollTo(st.nav.zone, lo);
    else if (off > hi) this._scrollTo(st.nav.zone, hi);
  },

  /* Insert a string into the focused input -- the one-call convenience an
     app's own custom keyboard wants. Names like 'Backspace' go through
     UI.key('press', ...) instead; this is for literal characters. */
  type: function (str) {
    for (var i = 0; i < str.length; i++) this._editKey(str.charAt(i));
  },
  /* Returns true when the key meant something to the editor -- false
     lets key() hand it to the app instead. */
  _editKey: function (k) {
    var id = this._focus;
    var st = id && this._inputs[id];
    if (!st) return false;
    var pp = st.p || {};
    var v = st.text;
    var c = st.cur > v.length ? v.length : st.cur;
    var nv = null;
    if (k.length === 1) {
      if (!(pp.maxLen && v.length >= pp.maxLen)) {
        nv = v.slice(0, c) + k + v.slice(c);
        st.cur = c + 1;
      }
    }
    else if (k === 'Backspace') { if (c > 0) { nv = v.slice(0, c - 1) + v.slice(c); st.cur = c - 1; } }
    else if (k === 'Delete') { if (c < v.length) nv = v.slice(0, c) + v.slice(c + 1); }
    else if (k === 'ArrowLeft') st.cur = c > 0 ? c - 1 : 0;
    else if (k === 'ArrowRight') st.cur = c < v.length ? c + 1 : v.length;
    else if (k === 'Home') st.cur = 0;
    else if (k === 'End') st.cur = v.length;
    else if (k === 'Tab' || k === 'ShiftTab') {
      if (!this.focusNav.tab) return false;
      this.focusNext(k === 'Tab' ? 1 : -1);
      return true;
    }
    else if (k === 'ArrowUp' || k === 'ArrowDown') {
      if (!this.focusNav.arrows) return false;
      this.focusNext(k === 'ArrowDown' ? 1 : -1);
      return true;
    }
    else if (k === 'Enter') {
      if (pp.onSubmit) pp.onSubmit(st.text);
      this.blur();
      return true;
    }
    else if (k === 'Escape') { this.blur(); return true; }
    else return false;
    if (nv !== null) {
      st.text = nv;
      if (pp.onChange) pp.onChange(nv);
    }
    st.bt = sys.millis();
    st.follow = 1;
    this._dirty = true;
    return true;
  },
  /* The whole-stroke handler an input registers -- the same capture an
     onDraw canvas uses, but classified rather than owned outright: the
     DOMINANT AXIS at the moment the finger leaves the tap slop decides.
     Mostly vertical hands the stroke to the field's enclosing scroll
     zone (fling included), so a form full of fields still scrolls no
     matter where the finger lands. Mostly horizontal scrolls the
     field's own overflowing text; press-and-hold then drag walks the
     caret; a stroke that stayed put was a tap, placing the caret. Focus
     happens on tap or hold only -- a scroll passing over a field must
     not focus it and summon a keyboard. */
  _inputStroke: function (iid) {
    var self = this;
    return function (phase, lx, ly, pid) {
      var st = self._inputs[iid];
      if (!st || !st.geom) return;
      var gm = st.geom;
      var zn = st.nav && st.nav.zone;
      if (phase === 0) {
        st.g = { x0: lx, y0: ly, o0: st.sx, t0: sys.millis(), mode: 0,
                 zo0: zn ? (self._scroll[zn] || 0) : 0,
                 ly: ly, lt: sys.millis(), v: 0 };
        /* a press catches the zone if it is still gliding, like any
           other press inside it would */
        if (zn) {
          var kept = [];
          for (var fi = 0; fi < self._flings.length; fi++) {
            if (self._flings[fi].key !== zn) kept.push(self._flings[fi]);
          }
          self._flings = kept;
        }
        return;
      }
      var g = st.g;
      if (!g) return;
      var dxs = lx - g.x0, dys = ly - g.y0;
      function place() {
        var ci = Math.round((lx - gm.pad + st.sx) / gm.adv);
        var n = st.text.length;
        st.cur = ci < 0 ? 0 : (ci > n ? n : ci);
        st.bt = sys.millis();
        st.follow = 1;
      }
      if (g.mode === 0) {
        if (sys.millis() - g.t0 >= 400) { g.mode = 2; self.focus(iid); }
        else if (dxs > DRAG_SLOP || dxs < -DRAG_SLOP ||
                 dys > DRAG_SLOP || dys < -DRAG_SLOP) {
          var ax = dxs < 0 ? -dxs : dxs, ay = dys < 0 ? -dys : dys;
          if (ay > ax && zn) g.mode = 3;
          else if (st.text.length * gm.adv > gm.w - gm.pad * 2) g.mode = 1;
          else { g.mode = 2; self.focus(iid); }
        }
      }
      if (g.mode === 1) {
        var ns = g.o0 - dxs;
        var mx = st.text.length * gm.adv - (gm.w - gm.pad * 2);
        if (mx < 0) mx = 0;
        st.sx = ns < 0 ? 0 : (ns > mx ? mx : ns);
        st.follow = 0;
      } else if (g.mode === 2) place();
      else if (g.mode === 3) {
        /* absolute from the press, exactly as pointer() scrolls a zone --
           deltas would accumulate rounding and drift */
        self._scrollTo(zn, g.zo0 - dys);
        var nw = sys.millis(), dt = nw - g.lt;
        if (dt > 0) { g.v = (g.ly - ly) / dt * 16; g.lt = nw; }
        g.ly = ly;
      }
      if (phase === 2) {
        if (g.mode === 0) { self.focus(iid); place(); }
        else if (g.mode === 3 && (g.v > 2 || g.v < -2)) {
          self._flings.push({ key: zn, v: g.v });
        }
        st.g = null;
      }
    };
  },

  /**
   * Named async events — buttons, an accelerometer sample, a magnetometer
   * reading, anything a native module on any platform wants to report
   * whenever it has something, not on a fixed schedule.
   *
   * This is NOT an event loop, and does not try to be one: MicroQuickJS has
   * no Promise, no real timers, no microtask queue, deliberately, to stay
   * small enough for a chip. The actual asynchronicity — polling an I2C
   * sensor, waiting on a GPIO interrupt, a browser's own DeviceMotionEvent
   * — happens natively, in whatever concurrency model the host already
   * has (a FreeRTOS task on ESP32, a real async API on Pi/desktop/browser).
   * All this does is give that native side ONE call per event name instead
   * of every source having to invent its own delivery mechanism — the same
   * relationship pointer() has to touch input, generalized to anything
   * that isn't spatial.
   *
   * `emit` is meant to be called by the host, on its own schedule — a
   * tick-drained ring buffer on ESP32 (the same pattern the touch/pointer
   * queue already uses to cross out of a FreeRTOS task), a direct native
   * callback everywhere else, since only the embedded target needs to
   * cross a thread boundary to reach the engine at all.
   */
  on: function (name, fn) {
    if (!this._listeners[name]) this._listeners[name] = [];
    this._listeners[name].push(fn);
  },
  off: function (name, fn) {
    var l = this._listeners[name];
    if (!l) return;
    for (var i = l.length - 1; i >= 0; i--) if (l[i] === fn) l.splice(i, 1);
  },
  emit: function (name, data) {
    var l = this._listeners[name];
    if (!l) return;
    /* Copied before iterating: a listener unsubscribing itself (or another
       listener for the same name) mid-emit must not skip or double-fire a
       neighbour — splicing the live array while walking it would do
       exactly that. */
    var snapshot = l.slice();
    for (var i = 0; i < snapshot.length; i++) snapshot[i](data);
  },

  /**
   * A timer, entirely in JS on top of the tick the host already drives —
   * no engine change needed, since ticker() already runs on a schedule.
   * Deliberately not named `setTimeout`: that name means something
   * different and more precise on backends that DO have a real one (Node,
   * a browser), and shadowing it would make code that works on one
   * backend silently behave differently on another. This fires no more
   * often than the host's own tick rate allows — fine for UI purposes
   * (debouncing, a delayed dismiss, a retry), not a promise of anything
   * more precise than that.
   */
  setTimer: function (fn, ms) {
    var id = ++this._timerSeq;
    this._timers.push({ id: id, at: sys.millis() + ms, fn: fn });
    return id;
  },
  clearTimer: function (id) {
    for (var i = 0; i < this._timers.length; i++) {
      if (this._timers[i].id === id) { this._timers.splice(i, 1); return; }
    }
  },

  /* Ramer-Douglas-Peucker: drop every point closer than eps to the chord
     of its span. A freehand stroke recorded at pointer-move rate keeps its
     shape with a fraction of the points - run it once when the stroke
     ends, not per frame. */
  simplifyPath: function (pts, eps) {
    if (!pts || pts.length < 3) return pts;
    var keep = [];
    for (var ki = 0; ki < pts.length; ki++) keep.push(false);
    keep[0] = keep[pts.length - 1] = true;
    var stack = [[0, pts.length - 1]];
    while (stack.length) {
      var seg = stack.pop();
      var a = seg[0], b = seg[1];
      if (b - a < 2) continue;
      var ax = pts[a].x, ay = pts[a].y;
      var dx = pts[b].x - ax, dy = pts[b].y - ay;
      var len2 = dx * dx + dy * dy;
      var maxD = -1, maxI = -1;
      for (var i = a + 1; i < b; i++) {
        var t = len2 ? ((pts[i].x - ax) * dx + (pts[i].y - ay) * dy) / len2 : 0;
        if (t < 0) t = 0;
        if (t > 1) t = 1;
        var qx = ax + dx * t - pts[i].x, qy = ay + dy * t - pts[i].y;
        var d = qx * qx + qy * qy;
        if (d > maxD) { maxD = d; maxI = i; }
      }
      if (maxI >= 0 && maxD > eps * eps) {
        keep[maxI] = true;
        stack.push([a, maxI]);
        stack.push([maxI, b]);
      }
    }
    var out = [];
    for (var oi = 0; oi < pts.length; oi++) if (keep[oi]) out.push(pts[oi]);
    return out;
  },

  /* Step-scroll a zone. dir: 1 = towards the end of the content, -1 = back
     towards the start. Useful from a keyboard/test harness that wants "move
     this list one notch" without a real stroke. */
  swipe: function (x, y, dir) {
    var z = this._zoneAt(x, y);
    if (!z) return false;
    this._scrollTo(z.key, (this._scroll[z.key] || 0) + dir * z.step);
    return true;
  },

  /* Scroll the zone under a point by an exact pixel delta — the smooth
     counterpart to swipe()'s zone-sized notches. This is what a mouse wheel
     or a trackpad wants: many small nudges, not page jumps. */
  scrollBy: function (x, y, dy) {
    x = this._safeX(x);
    y = this._safeY(y);
    var z = this._zoneAt(x, y);
    if (!z) return false;
    this._scrollTo(z.key, (this._scroll[z.key] || 0) + dy);
    return true;
  },

  /* Later-drawn wins, so overlays shadow what they cover. Handlers are
     passed the position *within* the control, which is what lets a text
     field put the caret where the finger landed. */
  tap: function (x, y) {
    for (var i = this._hits.length - 1; i >= 0; i--) {
      var t = this._hits[i];
      var r = this._safeRect(t);
      if (x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h) {
        if (t.shield) {
          /* A shield's surface has no dead spots: the press goes to the
             NEAREST control on top of it (its children register after
             it), within a small reach so genuinely empty stretches stay
             inert. Between two keys the nearer one wins -- a keyboard
             has no gaps from a touch point of view. */
          var best = null, bd = 13 * 13, j, c, dx, dy, d2;
          for (j = i + 1; j < this._hits.length; j++) {
            c = this._hits[j];
            if (!c.fn || c.shield) continue;
            dx = x < c.x ? c.x - x : (x >= c.x + c.w ? x - (c.x + c.w - 1) : 0);
            dy = y < c.y ? c.y - y : (y >= c.y + c.h ? y - (c.y + c.h - 1) : 0);
            d2 = dx * dx + dy * dy;
            if (d2 < bd) { bd = d2; best = c; }
          }
          if (best) best.fn(x - best.x, y - best.y);
          else if (t.fn) t.fn(x - t.x, y - t.y);
          return true;
        }
        if (t.fn) t.fn(x - t.x, y - t.y);
        return true;
      }
    }
    return false;
  }
};

/* Loadable as a flat eval (MicroQuickJS: h/UI/etc. land as globals) or as a
   CommonJS module (Node/Bun: require('mjsx') for the same objects). Both
   forms see the identical ES5 source — nothing here branches on the host. */
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    h: h, UI: UI, FONT: FONT, em: em, Button: Button, Swatch: Swatch, Modal: Modal, Keyboard: Keyboard,
    measure: measure, draw: draw, fitText: fitText, textLines: textLines
  };
}
