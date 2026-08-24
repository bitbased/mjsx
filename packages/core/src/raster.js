/*
 * Shared rounded-rectangle rasterization for backends that draw into their
 * own pixel buffer (pure-js, terminal, sdl-through-pure-js). Backends pass
 * their own primitive callbacks so this file stays buffer-agnostic:
 *
 *   fillRoundRect(fill, x, y, w, h, r)      fill(x, y, w, h) fills a rect
 *   strokeRoundRect(px, line, x, y, w, h, r)  px(x, y) plots, line() strokes
 *
 * The fill is scanline-based: a solid middle band, then per-row insets from
 * the corner circle — no seams, no overdraw dependence. The stroke is four
 * straight edges plus midpoint-algorithm quarter arcs. The radius clamps to
 * half the short side, so oversize radii degrade to a stadium, exactly like
 * the sim's display mask.
 */

function clampR(r, w, h) {
  var m = Math.floor(Math.min(w, h) / 2);
  r = Math.round(r);
  return r > m ? m : r;
}

function fillRoundRect(fill, x, y, w, h, r) {
  r = clampR(r || 0, w, h);
  if (r <= 0) { fill(x, y, w, h); return; }
  if (h > 2 * r) fill(x, y + r, w, h - 2 * r);
  for (var i = 0; i < r; i++) {
    var dy = r - i - 0.5;
    var dx = Math.sqrt(r * r - dy * dy);
    var inset = r - Math.round(dx);
    fill(x + inset, y + i, w - 2 * inset, 1);
    fill(x + inset, y + h - 1 - i, w - 2 * inset, 1);
  }
}

function strokeRoundRect(px, line, x, y, w, h, r) {
  r = clampR(r || 0, w, h);
  if (r <= 0) {
    line(x, y, x + w - 1, y);
    line(x, y + h - 1, x + w - 1, y + h - 1);
    line(x, y, x, y + h - 1);
    line(x + w - 1, y, x + w - 1, y + h - 1);
    return;
  }
  line(x + r, y, x + w - 1 - r, y);
  line(x + r, y + h - 1, x + w - 1 - r, y + h - 1);
  line(x, y + r, x, y + h - 1 - r);
  line(x + w - 1, y + r, x + w - 1, y + h - 1 - r);
  /* Quarter arcs, midpoint circle: (a, b) walks one octant, mirrored into
     the other to cover the quadrant, mapped onto all four corner centres. */
  var cx0 = x + r, cy0 = y + r, cx1 = x + w - 1 - r, cy1 = y + h - 1 - r;
  var a = r, b = 0, err = 1 - r;
  while (a >= b) {
    px(cx1 + a, cy1 + b); px(cx1 + b, cy1 + a); /* bottom-right */
    px(cx1 + a, cy0 - b); px(cx1 + b, cy0 - a); /* top-right */
    px(cx0 - a, cy1 + b); px(cx0 - b, cy1 + a); /* bottom-left */
    px(cx0 - a, cy0 - b); px(cx0 - b, cy0 - a); /* top-left */
    b++;
    if (err < 0) err += 2 * b + 1;
    else { a--; err += 2 * (b - a) + 1; }
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { fillRoundRect: fillRoundRect, strokeRoundRect: strokeRoundRect };
}
