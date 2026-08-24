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
    var lines = p.wrap ? textLines(p.text, size, availW - 0) : [fitText(p.text, size, availW)];
    return lines.length * (flh(size) + 2) - 2;
  }
  if (t === 'spacer') return p.h || 6;
  if (t === 'pbar') return p.h || 12;
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
    var lines = p.wrap ? textLines(p.text, size, availW) : [fitText(p.text, size, availW)];
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
    /* A polyline stroke, and optionally an SVG-style filled shape.
       `pts` is a point list, or a list of point lists (subpaths). `fill`
       scanline-fills with the EVEN-ODD rule - alternating spans, so
       self-intersecting shapes and multi-subpath holes (a donut) fill the
       way SVG's fill-rule=evenodd does - decomposed into 1px frect spans,
       which is all the native contract needs. `close` strokes the closing
       segment of each subpath (filling implies closed GEOMETRY either
       way). Stroke thickness works like the line mark (w parallel lines)
       with filled discs at points for rounded joins and caps; true miter
       joins would need polygon stroking the contract does not have. */
    var subs5 = (p.pts && p.pts.length && p.pts[0] && p.pts[0].length !== undefined) ? p.pts : [p.pts || []];
    var pc5 = p.color === undefined ? UI.theme.muted : p.color;
    var pw5 = p.w || 1;
    if (p.fill !== undefined) {
      var minY5 = 1e9, maxY5 = -1e9, e5 = [];
      for (var sp5 = 0; sp5 < subs5.length; sp5++) {
        var sq5 = subs5[sp5];
        for (var se5 = 0; se5 < sq5.length; se5++) {
          var pA5 = sq5[se5], pB5 = sq5[(se5 + 1) % sq5.length];
          if (pA5.y !== pB5.y) e5.push([pA5.x, pA5.y, pB5.x, pB5.y]);
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
            xs5.push(ed5[0] + (ed5[2] - ed5[0]) * (cy5 - ed5[1]) / (ed5[3] - ed5[1]));
          }
        }
        xs5.sort(function (a5, b5) { return a5 - b5; });
        for (var xp5 = 0; xp5 + 1 < xs5.length; xp5 += 2) {
          var fx5 = Math.round(xs5[xp5]), tx5 = Math.round(xs5[xp5 + 1]);
          if (tx5 > fx5) gfx.frect(x + fx5, y + sy5, tx5 - fx5, 1, p.fill, 0);
        }
      }
    }
    for (var sp6 = 0; sp6 < subs5.length; sp6++) {
      var pts5 = subs5[sp6];
      var segN5 = (p.close || p.fill !== undefined) && pts5.length > 2 ? pts5.length : pts5.length - 1;
      if (p.color !== undefined || p.fill === undefined) {
        for (var pi5 = 0; pi5 < segN5; pi5++) {
          var ax5 = pts5[pi5].x, ay5 = pts5[pi5].y;
          var bx5 = pts5[(pi5 + 1) % pts5.length].x, by5 = pts5[(pi5 + 1) % pts5.length].y;
          var steep5 = Math.abs(by5 - ay5) > Math.abs(bx5 - ax5);
          var ox5 = steep5 ? 1 : 0, oy5 = steep5 ? 0 : 1;
          for (var lq5 = 0; lq5 < pw5; lq5++) {
            var lo5 = lq5 - ((pw5 - 1) >> 1);
            gfx.line(x + ax5 + ox5 * lo5, y + ay5 + oy5 * lo5,
                     x + bx5 + ox5 * lo5, y + by5 + oy5 * lo5, pc5);
          }
        }
        if (pw5 >= 3) {
          var jr5 = pw5 >> 1;
          for (var pj5 = 0; pj5 < pts5.length; pj5++) {
            gfx.circle(x + pts5[pj5].x, y + pts5[pj5].y, jr5, pc5, true);
          }
        } else if (pts5.length === 1) {
          gfx.line(x + pts5[0].x, y + pts5[0].y, x + pts5[0].x, y + pts5[0].y, pc5);
        }
      }
    }
    return 0;
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

    /* clip: confine the children's draws (and hit areas) to this box —
       what a canvas-like region needs so captured strokes recorded past
       its edges cannot paint over the neighbours. Scroll viewports clip
       already; the native clip is a single rect, not a stack, so nesting
       clips inside one another is not supported. */
    var clipHits0 = -1;
    if (p.clip && !p.scroll) {
      clipHits0 = UI._hits.length;
      gfx.clip(x, y, availW, hgt);
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
      var off = UI._scroll[p.scroll] || 0;
      if (off > maxOff) off = maxOff;
      if (off < 0) off = 0;
      UI._scroll[p.scroll] = off;

      /* The clip makes partially-visible rows end at the box edge instead of
         spilling over the neighbours — and the hit areas are trimmed to
         match once the children have registered theirs. */
      var hits0 = UI._hits.length;
      gfx.clip(x, y, availW, boxH);
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
      gfx.unclip();
      UI._clipHits(hits0, x, y, availW, boxH);
      /* The viewport is a swipe target; a fixed step, or its own height. */
      UI._swipeZone(x, y, availW, boxH, p.scroll,
                    p.step === 'page' ? (boxH - padT(p) - padB(p)) : (p.step || 40), maxOff);
    } else if (boxH) {
      /* A pinned height makes this a flex column: children marked `flex` (or
         flex:N) split whatever the fixed-height children leave over. */
      var innerW = availW - pl - pr;
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
          draw(kf, x + pl, fy, innerW);   /* marks draw where the flow is */
          continue;
        }
        if (drewF) fy += gap3;
        drewF = true;
        if (fl2 > 0) {
          var share = Math.floor(leftover * fl2 / flexTotal);
          draw(kf, x + pl, fy, innerW, share);
          fy += share;
        } else {
          fy += draw(kf, x + pl, fy, innerW);
        }
      }
    } else {
      var by = y + padT(p), drewB = false;
      for (var bi = 0; bi < node.kids.length; bi++) {
        if (measure(node.kids[bi], availW - pl - pr) === 0) {
          draw(node.kids[bi], x + pl, by, availW - pl - pr);
          continue;
        }
        if (drewB) by += gap3;
        drewB = true;
        by += draw(node.kids[bi], x + pl, by, availW - pl - pr);
      }
    }
    if (clipHits0 >= 0) {
      gfx.unclip();
      UI._clipHits(clipHits0, x, y, availW, hgt);
    }

    if (p.onTap || p.onLongPress || p.onDraw) {
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

  /* Topmost control under a point — later-drawn wins, as with taps. */
  _hitAt: function (x, y) {
    for (var i = this._hits.length - 1; i >= 0; i--) {
      var t = this._hits[i];
      if (x >= t.x && x < t.x + t.w && y >= t.y && y < t.y + t.h) return t;
    }
    return null;
  },
  _swipeZone: function (x, y, w, hh, key, step, maxOff) {
    this._swipes.push({ x: x, y: y, w: w, h: hh, key: key, step: step, maxOff: maxOff });
  },

  render: function () {
    if (!this.root) return;
    this._hits = [];
    this._swipes = [];
    gfx.clear(this.theme.bg);
    draw(h(this.root, {}), 0, 0, gfx.width(), gfx.height());
    if (this.modal) {
      /* Everything under the modal stops listening. A dialog you can press
         through is not a dialog. */
      this._hits = [];
      this._swipes = [];
      this._flings = [];
      draw(h(this.modal, {}), 0, 0, gfx.width(), gfx.height());
    }
    this._dirty = false;
  },

  /* Topmost scrollable zone under a point, and lookup by name for a zone
     whose extent may have changed since the finger went down. */
  _zoneAt: function (x, y) {
    for (var i = this._swipes.length - 1; i >= 0; i--) {
      var z = this._swipes[i];
      if (x >= z.x && x < z.x + z.w && y >= z.y && y < z.y + z.h) return z;
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
    if (off > max) off = max;
    if (off < 0) off = 0;
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
    if (this.onKey) this.onKey(type, key);
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
      if (x >= t.x && x < t.x + t.w && y >= t.y && y < t.y + t.h) {
        t.fn(x - t.x, y - t.y);
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
    h: h, UI: UI, FONT: FONT, em: em, Button: Button, Swatch: Swatch, Modal: Modal,
    measure: measure, draw: draw, fitText: fitText, textLines: textLines
  };
}
