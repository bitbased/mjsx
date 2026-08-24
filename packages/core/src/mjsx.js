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

/* Truncate to a width, marking the cut. Assumes no ellipsis glyph, so three
   dots stand in for one — matches every bitmap font this has run against. */
function fitText(str, size, availW) {
  var s = '' + str;
  var maxChars = Math.floor(availW / (FONT.advance * size));
  if (s.length <= maxChars) return s;
  if (maxChars <= 3) return s.substring(0, maxChars);
  return s.substring(0, maxChars - 3) + '...';
}

function textLines(str, size, availW) {
  var s = '' + str;
  var maxChars = Math.floor(availW / (FONT.advance * size));
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
    return lines.length * (FONT.lineH * size + 2) - 2;
  }
  if (t === 'spacer') return p.h || 6;
  if (t === 'pbar') return p.h || 12;
  if (t === 'circle') return (p.r || 5) * 2;
  if (t === 'abs') return 0;  /* drawn at its own coordinates; owns no space */
  /* A line is a mark, not a block: it takes no height and its endpoints are
     offsets from wherever the flow has got to. A box with a fixed height and
     lines inside it is therefore a plotting area, with no new concept
     needed. */
  if (t === 'line') return 0;
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
      if (p.align === 'center') tx = x + Math.floor((availW - lines[li].length * FONT.advance * size) / 2);
      if (p.align === 'right') tx = x + availW - lines[li].length * FONT.advance * size;
      gfx.text(tx, ty, size, color, lines[li]);
      ty += FONT.lineH * size + 2;
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
    gfx.line(x + (p.x1 || 0), y + (p.y1 || 0), x + (p.x2 || 0), y + (p.y2 || 0), lc);
    if (p.w > 1) {
      /* No thickness in the native call, so a heavier line is a second one
         alongside — offset across the shorter axis, where it shows. */
      var steep = Math.abs((p.y2 || 0) - (p.y1 || 0)) > Math.abs((p.x2 || 0) - (p.x1 || 0));
      var ox = steep ? 1 : 0, oy = steep ? 0 : 1;
      gfx.line(x + (p.x1 || 0) + ox, y + (p.y1 || 0) + oy,
               x + (p.x2 || 0) + ox, y + (p.y2 || 0) + oy, lc);
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
    if (p.onTap || p.onLongPress) {
      UI._hit(x - hp(p), y - hp(p), availW + hp(p) * 2, hgt + hp(p) * 2,
              p.onTap, p.onHold || p.onLongPress,
              p.onHold ? (p.holdEvery || 320) : 0);
    }
  } else {
    /* box — or a scroll viewport when `scroll` names an offset and `h` fixes
       the height */
    var pl = padL(p), pr = padR(p);
    var gap3 = p.gap === undefined ? 4 : p.gap;
    if (p.bg !== undefined) gfx.frect(x, y, availW, hgt, p.bg, p.radius || 0);
    if (p.border !== undefined) {
      /* Nested rectangles, because the native call draws one pixel. */
      var bw = p.borderW || 1;
      for (var q = 0; q < bw; q++) {
        var rr = (p.radius || 0) - q;
        gfx.rect(x + q, y + q, availW - q * 2, hgt - q * 2, p.border, rr > 0 ? rr : 0);
      }
    }

    var boxH = forcedH || p.h;

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
    if (p.onTap || p.onLongPress) {
      UI._hit(x - hp(p), y - hp(p), availW + hp(p) * 2, hgt + hp(p) * 2,
              p.onTap, p.onHold || p.onLongPress,
              p.onHold ? (p.holdEvery || 320) : 0);
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
  _hit: function (x, y, w, hh, fn, hold, every) {
    this._hits.push({ x: x, y: y, w: w, h: hh, fn: fn, hold: hold, every: every });
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
    h: h, UI: UI, FONT: FONT, em: em, Button: Button, Swatch: Swatch,
    measure: measure, draw: draw, fitText: fitText, textLines: textLines
  };
}
