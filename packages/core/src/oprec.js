/*
 * Draw-op recording: the frame as DATA rather than as pixels.
 *
 * The engine is only ten calls wide, so a frame can be captured as the
 * list of those calls instead of the bitmap they happen to produce. That
 * list is resolution-independent: replay it into a backend built at a
 * higher dpr and the text is drawn with the HD glyph faces rather than a
 * blurry upscale of a small bitmap, which is the whole reason to keep it.
 *
 * This is not new machinery — the HTTP mirror has recorded ops since it
 * was written, and the browser already replays them sharper than the
 * device drew them ("HD" in that page). It lived inside the mirror,
 * though, so nothing else could use it. Now it is one module: the mirror
 * records with it, the screenshot harness embeds the result in the PNG it
 * writes, and a replayer can re-render any of it at any scale.
 *
 * THE FORMAT. A compact array per call, because a frame is thousands of
 * them and the field names would dwarf the data:
 *   ['C', colour]                          clear
 *   ['r', x, y, w, h, colour, radius]      rect
 *   ['f', x, y, w, h, colour, radius]      frect
 *   ['c', x, y, r, colour, filled]         circle
 *   ['l', x0, y0, x1, y1, colour]          line
 *   ['t', x, y, size, colour, string]      text
 *   ['x', x, y, w, h]                      clip
 *   ['X']                                  unclip
 *   ['p', polys, colour, rule]             poly   (optional in a backend)
 *   ['b', id, x, y, w, h, gen]             blit   (optional in a backend)
 * Colours are 0xRRGGBB. Coordinates are LOGICAL pixels — the frame's own
 * space — and stay that way through a replay; see opReplay on why.
 */

function opRecord(real) {
  var ops = [];

  function wrap(g) {
    var out = {
      clear: function (c) { ops.push(['C', c]); g.clear(c); },
      rect: function (x, y, w, h, c, r) { ops.push(['r', x, y, w, h, c, r || 0]); g.rect(x, y, w, h, c, r); },
      frect: function (x, y, w, h, c, r) { ops.push(['f', x, y, w, h, c, r || 0]); g.frect(x, y, w, h, c, r); },
      circle: function (x, y, rr, c, fill) { ops.push(['c', x, y, rr, c, fill ? 1 : 0]); g.circle(x, y, rr, c, fill); },
      line: function (x0, y0, x1, y1, c) { ops.push(['l', x0, y0, x1, y1, c]); g.line(x0, y0, x1, y1, c); },
      text: function (x, y, s, c, str) { ops.push(['t', x, y, s, c, String(str)]); g.text(x, y, s, c, str); },
      clip: function (x, y, w, h) { ops.push(['x', x, y, w, h]); g.clip(x, y, w, h); },
      unclip: function () { ops.push(['X']); g.unclip(); },
      width: function () { return g.width(); },
      height: function () { return g.height(); }
    };
    /* Optional calls are wrapped only when the backend has them, so a
       recorder never invents a capability the core would then use. */
    if (g.poly) {
      out.poly = function (polys, c, rule) { ops.push(['p', polys, c, rule]); g.poly(polys, c, rule); };
    }
    if (g.blit) {
      out.blit = function (id, x, y, w, h, gen) {
        ops.push(['b', id, x, y, w, h, gen]);
        g.blit(id, x, y, w, h, gen);
      };
    }
    return out;
  }

  return {
    gfx: wrap(real),
    /* the ops since the last take(), and reset */
    take: function () { var o = ops; ops = []; return o; },
    peek: function () { return ops; }
  };
}

/* Replay ops into any gfx.
 *
 * ONE-TO-ONE, deliberately. The coordinates are NOT scaled: fidelity is
 * the backend's business, not the replayer's. Create the backend at a
 * higher `dpr` and the same op list is rasterised with the HD glyph faces
 * and sub-pixel geometry the font system already has, which is a real
 * re-render. Multiplying the coordinates here instead would move the
 * layout onto a different rounding grid and quietly draw a DIFFERENT
 * picture — close enough to look right and wrong where it matters.
 *
 * This is the mirror's method, which is the one that has been proving
 * itself against real panels: its HD button re-renders the last frame by
 * rebuilding the backend at a new dpr and replaying, and HD:OFF is the
 * same call at dpr 1. That page now calls this function rather than
 * carrying its own copy of the switch.
 */
function opReplay(ops, gfx) {
  for (var i = 0; i < ops.length; i++) {
    var o = ops[i];
    switch (o[0]) {
      case 'C': gfx.clear(o[1]); break;
      case 'r': gfx.rect(o[1], o[2], o[3], o[4], o[5], o[6]); break;
      case 'f': gfx.frect(o[1], o[2], o[3], o[4], o[5], o[6]); break;
      case 'c': gfx.circle(o[1], o[2], o[3], o[4], !!o[5]); break;
      case 'l': gfx.line(o[1], o[2], o[3], o[4], o[5]); break;
      case 't': gfx.text(o[1], o[2], o[3], o[4], o[5]); break;
      case 'x': gfx.clip(o[1], o[2], o[3], o[4]); break;
      case 'X': gfx.unclip(); break;
      case 'p': if (gfx.poly) gfx.poly(o[1], o[2], o[3]); break;
      case 'b': if (gfx.blit) gfx.blit(o[1], o[2], o[3], o[4], o[5], o[6]); break;
    }
  }
  /* a frame that ended inside a clip would leave the next one clipped */
  gfx.unclip();
}

/* The rectangles a frame drew, for a debug overlay: every op that has a
   box, as {x,y,w,h,kind}. The mirror draws these over the picture; a
   documentation figure can do the same without re-running the app. */
function opBoxes(ops) {
  var out = [];
  for (var i = 0; i < ops.length; i++) {
    var o = ops[i];
    if (o[0] === 'r' || o[0] === 'f') {
      out.push({ x: o[1], y: o[2], w: o[3], h: o[4], kind: o[0] === 'f' ? 'fill' : 'stroke' });
    } else if (o[0] === 'x') {
      out.push({ x: o[1], y: o[2], w: o[3], h: o[4], kind: 'clip' });
    } else if (o[0] === 'c') {
      out.push({ x: o[1] - o[3], y: o[2] - o[3], w: o[3] * 2, h: o[3] * 2, kind: 'circle' });
    }
  }
  return out;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { record: opRecord, replay: opReplay, boxes: opBoxes };
}
