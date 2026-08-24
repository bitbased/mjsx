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
  /* whatever is still uncovered is a dot */
  for (y = 0; y < h; y++) {
    for (x = 0; x < w; x++) {
      if (ink(x, y) && !cov(x, y)) dots.push([x + 0.5, y + 0.5]);
    }
  }
  return { s: segs, d: dots };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { vectorize: vectorize };
}
