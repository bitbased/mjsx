/*
 * Bitmap-to-stroke vectorizer: the HD text renderer's source of truth.
 *
 * Instead of a separately designed vector face (which inevitably drifts off
 * the bitmap's grid and reads as a different font), each glyph's strokes
 * are DERIVED from its bitmap: maximal horizontal and vertical pixel runs
 * become segments through the exact pixel centres, staircase leftovers
 * become 45-degree diagonal segments, and lone pixels become dots. Drawn
 * with a one-pixel round pen the result has the identical geometry, size
 * and grid as the bitmap — the only differences are the flourishes:
 * rounded caps and joins, and true diagonals where the bitmap staircases.
 *
 * Returns { s: [ [x0,y0,x1,y1], ... ], d: [ [x,y], ... ] } in glyph-pixel
 * units, coordinates at pixel centres.
 */

function vectorize(rows, w, h) {
  function ink(x, y) {
    if (x < 0 || y < 0 || x >= w || y >= h) return 0;
    return (rows[y] >> (w - 1 - x)) & 1;
  }
  var covered = [];
  for (var i = 0; i < w * h; i++) covered.push(false);
  function cov(x, y) { return covered[y * w + x]; }
  function setCov(x, y) { covered[y * w + x] = true; }

  var segs = [], dots = [];
  var x, y, x0, y0, len;

  /* horizontal runs */
  for (y = 0; y < h; y++) {
    for (x = 0; x < w;) {
      if (!ink(x, y)) { x++; continue; }
      x0 = x;
      while (ink(x + 1, y)) x++;
      len = x - x0 + 1;
      if (len >= 2) {
        segs.push([x0 + 0.5, y + 0.5, x + 0.5, y + 0.5]);
        for (var cx = x0; cx <= x; cx++) setCov(cx, y);
      }
      x++;
    }
  }
  /* vertical runs */
  for (x = 0; x < w; x++) {
    for (y = 0; y < h;) {
      if (!ink(x, y)) { y++; continue; }
      y0 = y;
      while (ink(x, y + 1)) y++;
      len = y - y0 + 1;
      if (len >= 2) {
        segs.push([x + 0.5, y0 + 0.5, x + 0.5, y + 0.5]);
        for (var cy = y0; cy <= y; cy++) setCov(x, cy);
      }
      y++;
    }
  }
  /* diagonal runs over pixels neither an H nor a V run claimed — these are
     the staircases; both slopes. */
  var dirs = [[1, 1], [-1, 1]];
  for (var di = 0; di < dirs.length; di++) {
    var dx = dirs[di][0], dy = dirs[di][1];
    for (y = 0; y < h; y++) {
      for (x = 0; x < w; x++) {
        if (!ink(x, y) || cov(x, y)) continue;
        /* only start at a chain head */
        if (ink(x - dx, y - dy) && !cov(x - dx, y - dy)) continue;
        var ex = x, ey = y, n = 1;
        while (ink(ex + dx, ey + dy) && !cov(ex + dx, ey + dy)) { ex += dx; ey += dy; n++; }
        if (n >= 2) {
          segs.push([x + 0.5, y + 0.5, ex + 0.5, ey + 0.5]);
          var px2 = x, py2 = y;
          for (var k = 0; k < n; k++) { setCov(px2, py2); px2 += dx; py2 += dy; }
        }
      }
    }
  }
  /* Diagonal strokes extend one 45-degree step into adjacent ink, so a
     leg sampled as a short stair (N's middle, K's legs, R's leg) attaches
     to the stem the bitmap implies it meets — deterministic, same angle
     the stroke already has. */
  for (var di2 = 0; di2 < segs.length; di2++) {
    var sg2 = segs[di2];
    var sdx = sg2[2] - sg2[0], sdy = sg2[3] - sg2[1];
    if (sdx === 0 || sdy === 0) continue;
    var ux = sdx > 0 ? 1 : -1, uy = sdy > 0 ? 1 : -1;
    /* forward end */
    var fx = Math.floor(sg2[2]) + ux, fy = Math.floor(sg2[3]) + uy;
    if (ink(fx, fy) && cov(fx, fy)) { sg2[2] = fx + 0.5; sg2[3] = fy + 0.5; }
    /* backward end */
    var bx = Math.floor(sg2[0]) - ux, by = Math.floor(sg2[1]) - uy;
    if (ink(bx, by) && cov(bx, by)) { sg2[0] = bx + 0.5; sg2[1] = by + 0.5; }
  }

  /* whatever is still uncovered is a dot */
  for (y = 0; y < h; y++) {
    for (x = 0; x < w; x++) {
      if (ink(x, y) && !cov(x, y)) dots.push([x + 0.5, y + 0.5]);
    }
  }

  /* Corner connectors: where two stroke ends (or dots) sit EXACTLY
     diagonal-adjacent with an empty corner cell between them, join them
     with a 45-degree stroke. Deterministic and uniform — this is what
     closes O/8/D bowls into consistent octagonal corners and gives the
     comma its tail, without inventing arbitrary angles anywhere. */
  var pts = [];
  for (var pi = 0; pi < segs.length; pi++) {
    pts.push([segs[pi][0], segs[pi][1]]);
    pts.push([segs[pi][2], segs[pi][3]]);
  }
  var dotUsed = [];
  for (pi = 0; pi < dots.length; pi++) { pts.push(dots[pi]); dotUsed.push(false); }
  var segN = segs.length * 2;
  for (var ai = 0; ai < pts.length; ai++) {
    for (var bi = ai + 1; bi < pts.length; bi++) {
      /* both ends of the same segment can never be diagonal-adjacent
         except for a 45 stub, which needs no connector */
      if (ai < segN && bi < segN && (ai >> 1) === (bi >> 1)) continue;
      var adx = pts[bi][0] - pts[ai][0], ady = pts[bi][1] - pts[ai][1];
      if (Math.abs(Math.abs(adx) - 1) > 0.01 || Math.abs(Math.abs(ady) - 1) > 0.01) continue;
      /* the two corner cells of the diagonal step */
      var c1x = Math.floor(pts[ai][0] + adx), c1y = Math.floor(pts[ai][1]);
      var c2x = Math.floor(pts[ai][0]), c2y = Math.floor(pts[ai][1] + ady);
      if (ink(c1x, c1y) && ink(c2x, c2y)) continue; /* solid corner: already joined by ink */
      segs.push([pts[ai][0], pts[ai][1], pts[bi][0], pts[bi][1]]);
      if (ai >= segN) dotUsed[ai - segN] = true;
      if (bi >= segN) dotUsed[bi - segN] = true;
    }
  }
  var keptDots = [];
  for (pi = 0; pi < dots.length; pi++) if (!dotUsed[pi]) keptDots.push(dots[pi]);

  return { s: segs, d: keptDots };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { vectorize: vectorize };
}
