/*
 * Bitmap-to-stroke vectorizer: the HD text renderer's source of truth.
 *
 * Strokes are DERIVED from each glyph's bitmap, so HD text keeps the exact
 * grid, size and letterforms of the pixel font — the renderer only adds
 * what the bitmap could not express:
 *
 *   1. long horizontal/vertical runs      -> straight strokes
 *   2. chains of short runs whose centres -> ONE slanted stroke, at the
 *      drift row by row (stairs)             stairs' true slope (V legs,
 *                                            S spines, % slashes)
 *   3. stroke ends within ~1.4px          -> welded to a shared point, so
 *                                            joins connect (A's apex,
 *                                            corner meets) instead of
 *                                            leaving notches
 *   4. a lone pixel near a stroke end     -> a short tick stroke (the flag
 *                                            of 1, Q's tail); other lone
 *                                            pixels stay dots
 *
 * Returns { s: [ [x0,y0,x1,y1], ... ], d: [ [x,y], ... ] } in glyph-pixel
 * units, coordinates at pixel centres.
 */

var WELD_R = 1.45;   /* endpoint fuse radius: catches the 1.41 diagonal, not the 2.0 parallel-bar gap */
var CHAIN_DX = 1.25; /* max centre drift between stair rows: real slopes in these
   fonts drift at most 1px/row — 1.5 jumps stitch opposite sides of a small
   bowl (the 4x6 8 and 9) into false slashes */

function vectorize(rows, w, h) {
  function ink(x, y) {
    if (x < 0 || y < 0 || x >= w || y >= h) return 0;
    return (rows[y] >> (w - 1 - x)) & 1;
  }
  var covered = [];
  for (var ci = 0; ci < w * h; ci++) covered.push(false);
  function cov(x, y) { return covered[y * w + x]; }
  function setCov(x, y) { covered[y * w + x] = true; }

  var segs = [], dots = [];
  var x, y, x0, y0, len;

  /* 1. long straight runs (3+) */
  for (y = 0; y < h; y++) {
    for (x = 0; x < w;) {
      if (!ink(x, y)) { x++; continue; }
      x0 = x;
      while (ink(x + 1, y)) x++;
      len = x - x0 + 1;
      if (len >= 3) {
        segs.push([x0 + 0.5, y + 0.5, x + 0.5, y + 0.5]);
        for (var hx = x0; hx <= x; hx++) setCov(hx, y);
      }
      x++;
    }
  }
  for (x = 0; x < w; x++) {
    for (y = 0; y < h;) {
      if (!ink(x, y)) { y++; continue; }
      y0 = y;
      while (ink(x, y + 1)) y++;
      len = y - y0 + 1;
      if (len >= 3) {
        var free = 0;
        for (var vy = y0; vy <= y; vy++) if (!cov(x, vy)) free++;
        if (free >= 2) {
          segs.push([x + 0.5, y0 + 0.5, x + 0.5, y + 0.5]);
          for (vy = y0; vy <= y; vy++) setCov(x, vy);
        }
      }
      y++;
    }
  }

  /* 2. stair chains: uncovered short horizontal runs per row, chained while
     their centres drift consistently -> one slanted stroke. */
  var shorts = [];
  for (y = 0; y < h; y++) {
    for (x = 0; x < w;) {
      if (!ink(x, y) || cov(x, y)) { x++; continue; }
      x0 = x;
      while (ink(x + 1, y) && !cov(x + 1, y)) x++;
      shorts.push({ y: y, x0: x0, x1: x, cx: (x0 + x) / 2 + 0.5, used: false });
      x++;
    }
  }
  for (var si = 0; si < shorts.length; si++) {
    var head = shorts[si];
    if (head.used) continue;
    var chain = [head];
    var dir = 0;
    var cur = head;
    for (;;) {
      var next = null;
      for (var sj = 0; sj < shorts.length; sj++) {
        var cand = shorts[sj];
        if (cand.used || cand === cur || cand.y !== cur.y + 1) continue;
        var dx = cand.cx - cur.cx;
        if (Math.abs(dx) > CHAIN_DX) continue;
        var sgn = dx > 0.01 ? 1 : (dx < -0.01 ? -1 : 0);
        if (dir !== 0 && sgn !== 0 && sgn !== dir) continue;
        if (!next || Math.abs(dx) < Math.abs(next.cx - cur.cx)) next = cand;
      }
      if (!next) break;
      var d2 = next.cx - cur.cx;
      if (dir === 0 && Math.abs(d2) > 0.01) dir = d2 > 0 ? 1 : -1;
      chain.push(next);
      cur = next;
    }
    if (chain.length >= 2) {
      for (var mk = 0; mk < chain.length; mk++) {
        chain[mk].used = true;
        for (var px2 = chain[mk].x0; px2 <= chain[mk].x1; px2++) setCov(px2, chain[mk].y);
      }
      segs.push([chain[0].cx, chain[0].y + 0.5, chain[chain.length - 1].cx, chain[chain.length - 1].y + 0.5]);
    }
  }
  /* unchained shorts: length-2 stubs stay tiny bars, singles become dots */
  for (si = 0; si < shorts.length; si++) {
    var sr = shorts[si];
    if (sr.used) continue;
    for (var px3 = sr.x0; px3 <= sr.x1; px3++) setCov(px3, sr.y);
    if (sr.x1 > sr.x0) segs.push([sr.x0 + 0.5, sr.y + 0.5, sr.x1 + 0.5, sr.y + 0.5]);
    else dots.push([sr.x0 + 0.5, sr.y + 0.5]);
  }

  /* 3. weld nearby stroke ends into a shared point so joins connect — but
     ONLY across real gaps. An endpoint that already lies on the other
     stroke (a T-junction like I's stem meeting its bar) is connected as it
     is; welding it would bend both strokes. */
  function ptSegDist(px4, py4, sg) {
    var vx = sg[2] - sg[0], vy = sg[3] - sg[1];
    var ll = vx * vx + vy * vy;
    var t = ll ? ((px4 - sg[0]) * vx + (py4 - sg[1]) * vy) / ll : 0;
    if (t < 0) t = 0; if (t > 1) t = 1;
    var qx = sg[0] + vx * t - px4, qy = sg[1] + vy * t - py4;
    return Math.sqrt(qx * qx + qy * qy);
  }
  var ends = [];
  for (si = 0; si < segs.length; si++) { ends.push([segs[si], 0]); ends.push([segs[si], 2]); }
  for (var ei = 0; ei < ends.length; ei++) {
    for (var ej = ei + 1; ej < ends.length; ej++) {
      var A = ends[ei], B = ends[ej];
      if (A[0] === B[0]) continue;
      var ax = A[0][A[1]], ay = A[0][A[1] + 1];
      var bx = B[0][B[1]], by = B[0][B[1] + 1];
      var dx2 = ax - bx, dy2 = ay - by;
      if (dx2 * dx2 + dy2 * dy2 > WELD_R * WELD_R || (dx2 === 0 && dy2 === 0)) continue;
      if (ptSegDist(ax, ay, B[0]) < 0.6 || ptSegDist(bx, by, A[0]) < 0.6) continue; /* already touching */
      var mx = (ax + bx) / 2, my = (ay + by) / 2;
      A[0][A[1]] = mx; A[0][A[1] + 1] = my;
      B[0][B[1]] = mx; B[0][B[1] + 1] = my;
    }
  }

  /* 4. a dot beside a stroke end becomes a connected tick. */
  var keptDots = [];
  for (var di = 0; di < dots.length; di++) {
    var dot = dots[di];
    var bestEnd = null, bestD = WELD_R * WELD_R;
    for (ei = 0; ei < ends.length; ei++) {
      var ex = ends[ei][0][ends[ei][1]], ey = ends[ei][0][ends[ei][1] + 1];
      var ddx = ex - dot[0], ddy = ey - dot[1];
      var dd = ddx * ddx + ddy * ddy;
      if (dd > 0.01 && dd < bestD) { bestD = dd; bestEnd = [ex, ey]; }
    }
    var touching = false;
    for (si = 0; si < segs.length; si++) {
      if (ptSegDist(dot[0], dot[1], segs[si]) < 0.6) { touching = true; break; }
    }
    if (touching) keptDots.push(dot);
    else if (bestEnd) segs.push([bestEnd[0], bestEnd[1], dot[0], dot[1]]);
    else keptDots.push(dot);
  }

  return { s: segs, d: keptDots };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { vectorize: vectorize };
}
