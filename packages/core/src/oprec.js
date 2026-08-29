/*
 * Draw-op recording: the frame as DATA rather than as pixels.
 *
 * The engine is only ten calls wide, so a frame can be captured as the
 * list of those calls instead of the bitmap they happen to produce. That
 * list is resolution-independent: replay it at 4x and the text is drawn
 * with a 4x font rather than a blurry upscale of a small one, which is
 * the whole reason to keep it.
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
 * Colours are 0xRRGGBB. Coordinates are in the recorded frame's own pixel
 * space; a replayer scales them.
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

/* Replay ops into any gfx, optionally scaled. Text is redrawn at
   size * scale rather than magnified, which is the point of keeping ops
   instead of pixels. Coordinates round after scaling so a 2x replay lands
   on whole pixels. */
function opReplay(ops, gfx, scale) {
  var s = scale || 1;
  function S(v) { return Math.round(v * s); }
  for (var i = 0; i < ops.length; i++) {
    var o = ops[i];
    switch (o[0]) {
      case 'C': gfx.clear(o[1]); break;
      case 'r': gfx.rect(S(o[1]), S(o[2]), S(o[3]), S(o[4]), o[5], S(o[6])); break;
      case 'f': gfx.frect(S(o[1]), S(o[2]), S(o[3]), S(o[4]), o[5], S(o[6])); break;
      case 'c': gfx.circle(S(o[1]), S(o[2]), S(o[3]), o[4], !!o[5]); break;
      case 'l': gfx.line(S(o[1]), S(o[2]), S(o[3]), S(o[4]), o[5]); break;
      case 't': gfx.text(S(o[1]), S(o[2]), o[3] * s, o[4], o[5]); break;
      case 'x': gfx.clip(S(o[1]), S(o[2]), S(o[3]), S(o[4])); break;
      case 'X': gfx.unclip(); break;
      case 'p':
        if (gfx.poly) {
          var polys = [];
          for (var pi = 0; pi < o[1].length; pi++) {
            var ring = o[1][pi], outRing = [];
            for (var vi = 0; vi < ring.length; vi++) {
              outRing.push({ x: ring[vi].x * s, y: ring[vi].y * s });
            }
            polys.push(outRing);
          }
          gfx.poly(polys, o[2], o[3]);
        }
        break;
      case 'b':
        if (gfx.blit) gfx.blit(o[1], S(o[2]), S(o[3]), S(o[4]), S(o[5]), o[6]);
        break;
    }
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { record: opRecord, replay: opReplay };
}
