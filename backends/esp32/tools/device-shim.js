/* ---- device shim: runs right after mjsx-core on the bridge board ----
 *
 * Adaptations for the host, all pure JS:
 *  - The firmware's UI thread delivers touch as pointer(phase, x, y) —
 *    one contact, no id. mjsx-core's pointer is (id, phase, x, y); wrap
 *    it so the 3-arg form is contact 0 and a 4-arg call still works.
 *  - The panel's touch layer misses a band at each edge. mjsx-core's
 *    safe bands (default mode: touch-target extension, no visual
 *    change) are exactly the tool.
 *  - An op RECORDER for the /remote page: while armed, renders go
 *    through a wrapper that forwards every gfx call to the native
 *    object AND keeps the frame as JSON. /ops arms it by calling
 *    __OPSGET() (via the firmware's eval path); five quiet seconds
 *    disarm it, so an unwatched board pays nothing.
 *  - Keys arrive as {"___key": name} through the patch queue (the /key
 *    endpoint and the BOOT button both use it): Escape blurs a focused
 *    input (the core does that) or exits to the menu; AppHome always
 *    exits to the menu; everything else is a normal key press.
 */
(function () {
  var corePtr = UI.pointer;
  UI.pointer = function (a, b, c, d) {
    if (d === undefined) return corePtr.call(UI, 0, a, b, c);
    return corePtr.call(UI, a, b, c, d);
  };
  UI.safe.top = 24;
  UI.safe.bottom = 25;
})();

var EXAMPLES = [];

/* ---- gfx wrapper: poly + op recorder ----
 *
 * The native gfx has no poly, so bare, mjsx-core scanline-fills every
 * path into HUNDREDS of 1px frect rows -- correct on glass, ruinous in
 * an op stream (a circle cost ~8KB of JSON). This wrapper is the global
 * gfx permanently: it adds poly (core then hands over whole polygons,
 * rasterized here with the same scanline the core would have used, via
 * native frect spans), and while the /remote recorder is armed it logs
 * each call -- a shape as ONE compact op. JSON is built HERE, in
 * MicroQuickJS; the firmware only ferries the finished string.
 */
/* ---- console ----------------------------------------------------------
 *
 * MicroQuickJS has no console, so a line of debugging that works on every
 * desktop host threw "TypeError: not a function" on the one host you cannot
 * attach a debugger to. createLog (packages/core/src/log.js, bundled just
 * above this file) is the same implementation the simulator uses, so a line
 * formats identically wherever it is read.
 *
 * All three sinks are reachable from here:
 *   buffer  the ring inside createLog, read back with `mjsxLog.since(n)`
 *           through the firmware's eval path — that is `mjsx logs <ip>`
 *   serial  sys.log, the one destination a script cannot reach itself
 *   ops     straight into __O, so a console line arrives in the same frame
 *           as the drawing it describes and the /remote mirror shows both
 *
 * The set is read from configStorage at boot, so it is changeable on a
 * running board without a rebuild, and defaults to buffer alone: a board
 * with nobody watching should not be paying to format strings onto a wire.
 */
var mjsxLog = createLog({
  sinks: configStorage.get('log', 'buffer'),
  max: 120,                       /* a ring, on a chip: bounded on purpose */
  write: function (t) {
    if (typeof sys !== 'undefined' && typeof sys.log === 'function') sys.log(t);
  },
  emit: function (level, text) {
    if (__REC) __O.push('["L",' + JSON.stringify(level) + ',' + JSON.stringify(text) + ']');
  }
});
var console = mjsxLog.console;

var __NGFX = gfx;
var __O = [];
var __REC = false;
var __OPS = '';
var __RECAT = -1000000;

function __r10(v) { return Math.round(v * 10) / 10; }

/* the same even-odd / nonzero scanline fill the core and the pure-js
   backend use -- identical crossings, identical Math.round spans, so
   glass and browser land on identical pixels */
function __fillPoly(polys, colr, rule) {
  var nonzero = rule === 'nonzero';
  var minY = 1000000, maxY = -1000000, e = [];
  for (var pi = 0; pi < polys.length; pi++) {
    var ring = polys[pi];
    for (var vi = 0; vi < ring.length; vi++) {
      var a = ring[vi], b = ring[(vi + 1) % ring.length];
      if (a[1] !== b[1]) e.push([a[0], a[1], b[0], b[1], a[1] < b[1] ? 1 : -1]);
      if (a[1] < minY) minY = a[1];
      if (a[1] > maxY) maxY = a[1];
    }
  }
  for (var sy = Math.floor(minY); sy <= Math.ceil(maxY); sy++) {
    var cy = sy + 0.5, xs = [];
    for (var ei = 0; ei < e.length; ei++) {
      var ed = e[ei];
      var lo = ed[1] < ed[3] ? ed[1] : ed[3];
      var hi = ed[1] < ed[3] ? ed[3] : ed[1];
      if (cy >= lo && cy < hi) {
        xs.push([ed[0] + (ed[2] - ed[0]) * (cy - ed[1]) / (ed[3] - ed[1]), ed[4]]);
      }
    }
    xs.sort(function (q, w) { return q[0] - w[0]; });
    if (nonzero) {
      var wind = 0, openX = 0;
      for (var xi = 0; xi < xs.length; xi++) {
        var was = wind !== 0;
        wind += xs[xi][1];
        if (!was && wind !== 0) openX = xs[xi][0];
        else if (was && wind === 0) {
          var f0 = Math.round(openX), t0 = Math.round(xs[xi][0]);
          if (t0 > f0) __NGFX.frect(f0, sy, t0 - f0, 1, colr, 0);
        }
      }
    } else {
      for (var xp = 0; xp + 1 < xs.length; xp += 2) {
        var f1 = Math.round(xs[xp][0]), t1 = Math.round(xs[xp + 1][0]);
        if (t1 > f1) __NGFX.frect(f1, sy, t1 - f1, 1, colr, 0);
      }
    }
  }
}

gfx = {
  clear: function (c) {
    if (__REC) __O.push('["C",' + (c | 0) + ']');
    __NGFX.clear(c);
  },
  rect: function (x, y, w, h, c, r) {
    if (__REC) __O.push('["r",' + (x | 0) + ',' + (y | 0) + ',' + (w | 0) + ',' + (h | 0) + ',' + (c | 0) + ',' + ((r || 0) | 0) + ']');
    __NGFX.rect(x, y, w, h, c, r);
  },
  frect: function (x, y, w, h, c, r) {
    if (__REC) __O.push('["f",' + (x | 0) + ',' + (y | 0) + ',' + (w | 0) + ',' + (h | 0) + ',' + (c | 0) + ',' + ((r || 0) | 0) + ']');
    __NGFX.frect(x, y, w, h, c, r);
  },
  circle: function (x, y, r, c, fill) {
    if (__REC) __O.push('["c",' + (x | 0) + ',' + (y | 0) + ',' + (r | 0) + ',' + (c | 0) + ',' + (fill ? 1 : 0) + ']');
    __NGFX.circle(x, y, r, c, fill);
  },
  line: function (x0, y0, x1, y1, c) {
    if (__REC) __O.push('["l",' + (x0 | 0) + ',' + (y0 | 0) + ',' + (x1 | 0) + ',' + (y1 | 0) + ',' + (c | 0) + ']');
    __NGFX.line(x0, y0, x1, y1, c);
  },
  text: function (x, y, sz, c, str) {
    if (__REC) __O.push('["t",' + (x | 0) + ',' + (y | 0) + ',' + (sz | 0) + ',' + (c | 0) + ',' + JSON.stringify('' + str) + ']');
    __NGFX.text(x, y, sz, c, str);
  },
  clip: function (x, y, w, h) {
    if (__REC) __O.push('["x",' + (x | 0) + ',' + (y | 0) + ',' + (w | 0) + ',' + (h | 0) + ']');
    __NGFX.clip(x, y, w, h);
  },
  unclip: function () {
    if (__REC) __O.push('["X"]');
    __NGFX.unclip();
  },
  /* canvas sources: pass straight through -- the NATIVE records op 10
     itself (with the source generation), and pixels travel in-band as
     op 11 chunks, so the JS JSON recorder has nothing to add */
  blit: __NGFX.blit ? function (id, x, y, w, h) { __NGFX.blit(id, x, y, w, h); } : undefined,
  poly: function (polys, c, rule) {
    /* mjsx-core's geometry cache hands the SAME rings array back every
       frame for an unchanged shape -- so both the rounded copy and the
       PACKED form (base-127 chars the firmware decodes with one C
       pointer walk instead of per-point property gets) are computed
       once and stamped onto it. That one string per cached shape is
       what keeps a canvas full of finished strokes cheap. */
    var rr = polys.__rr;
    if (!rr) {
      rr = [];
      for (var pi = 0; pi < polys.length; pi++) {
        var ring = [];
        for (var vi = 0; vi < polys[pi].length; vi++) {
          ring.push([__r10(polys[pi][vi].x), __r10(polys[pi][vi].y)]);
        }
        rr.push(ring);
      }
      polys.__rr = rr;
      if (__NGFX.poly) {
        var chars = [String.fromCharCode(rr.length + 1)];
        for (var ci = 0; ci < rr.length; ci++) {
          var n = rr[ci].length;
          chars.push(String.fromCharCode(Math.floor(n / 127) + 1, (n % 127) + 1));
          for (var ck = 0; ck < n; ck++) {
            var vx = Math.round(rr[ci][ck][0] * 10) + 1000000;
            var vy = Math.round(rr[ci][ck][1] * 10) + 1000000;
            if (vx < 0) vx = 0;
            if (vy < 0) vy = 0;
            chars.push(String.fromCharCode(
              Math.floor(vx / 16129) + 1, Math.floor(vx / 127) % 127 + 1, vx % 127 + 1,
              Math.floor(vy / 16129) + 1, Math.floor(vy / 127) % 127 + 1, vy % 127 + 1));
          }
        }
        polys.__pk = chars.join('');
      }
    }
    if (__REC) {
      /* the JSON form is as cacheable as the packed one */
      if (!polys.__pj) polys.__pj = JSON.stringify(rr);
      __O.push('["p",' + polys.__pj + ',' + (c | 0) + ',"' + (rule === 'nonzero' ? 'nonzero' : 'evenodd') + '"]');
    }
    if (__NGFX.poly) {
      __NGFX.poly(polys.__pk, c, rule);
    } else {
      __fillPoly(rr, c, rule);
    }
  },
  width: function () { return __NGFX.width(); },
  height: function () { return __NGFX.height(); }
};

(function () {
  var coreRender = UI.render;
  UI.render = function () {
    if (sys.millis() - __RECAT < 5000) {
      __REC = true;
      __O.length = 0;
      coreRender.call(UI);
      __OPS = '{"w":' + __NGFX.width() + ',"h":' + __NGFX.height() + ',"ops":[' + __O.join(',') + ']}';
      __O.length = 0;
      __REC = false;
    } else {
      __REC = false;
      coreRender.call(UI);
    }
  };
})();

function __OPSGET() {
  var arming = sys.millis() - __RECAT >= 5000;
  __RECAT = sys.millis();
  if (arming) UI._dirty = true;  /* record a frame right away */
  return __OPS;
}

/* ---- key routing through the patch queue ---- */
var __FEED = {};   /* last patch per state key -- see __replayFeed */
function __replayFeed() {
  /* UI.reset() (menu return, example switch) wipes UI.state, but the
     firmware feeds dedup on THEIR last-sent copy and will not resend
     until the physical state changes -- so the printer panel (or any
     module feed) would sit empty after navigation. The shim remembers
     the newest patch per top-level key and replays them after every
     reset; pure JS, no firmware resync needed. */
  for (var k in __FEED) UI.patch(__FEED[k]);
}
(function () {
  var corePatch = UI.patch;
  UI.patch = function (json) {
    if (json && ('' + json).indexOf('"___key"') >= 0) {
      var k = JSON.parse(json).___key;
      if (k === 'AppHome') { if (typeof _menu === 'function') _menu(); return; }
      if (k === 'Escape' && !UI.focused()) { if (typeof _menu === 'function') _menu(); return; }
      UI.key('down', k);
      UI.key('press', k);
      UI.key('up', k);
      return;
    }
    try {
      var o = JSON.parse('' + json);
      for (var fk in o) __FEED[fk] = json;
    } catch (e) {}
    return corePatch.call(UI, json);
  };
})();
