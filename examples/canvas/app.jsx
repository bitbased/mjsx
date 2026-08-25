/*
 * Freehand drawing with a CANVAS SOURCE backing - draw's little sibling,
 * restructured around sys.canvas. The live stroke renders as ordinary
 * ops (fast, smooth, previewed OVER the bitmap); on release it is
 * committed into canvas 0 and vanishes from the op stream entirely, so
 * a hundred strokes cost the same as none: one blit op per frame. The
 * remote sees the committed pixels arrive in-band as a JPEG keyed by
 * the canvas generation.
 *
 * Hosts without the natives keep strokes as paths, draw-style, so the
 * example stays developable anywhere.
 */
var HAVE_CV = typeof sys !== 'undefined' && typeof sys.canvasTarget === 'function' &&
              typeof gfx.blit === 'function' && sys.canvas(0, gfx.width(), gfx.height() - 40) === 1;

var BG = 0x10141b;

function clearCanvas() {
  if (!HAVE_CV) { UI.set({ strokes: [] }); return; }
  sys.canvasTarget(0);
  gfx.clear(BG);
  sys.canvasTarget(-1);
  UI.set({ cleared: (UI.state.cleared || 0) + 1 });
}
if (HAVE_CV) clearCanvas();

/* round-join thick stroke out of public gfx: segment quads + joint dots */
function strokeInto(pts, color, w) {
  var r = w / 2;
  for (var i = 0; i < pts.length; i++) {
    var p = pts[i];
    gfx.circle(Math.round(p.x), Math.round(p.y), Math.max(1, Math.round(r)), color, 1);
    if (i === 0) continue;
    var a = pts[i - 1], dx = p.x - a.x, dy = p.y - a.y;
    var len = Math.sqrt(dx * dx + dy * dy);
    if (len < 0.01) continue;
    var nx = (-dy / len) * r, ny = (dx / len) * r;
    gfx.poly([[{ x: a.x + nx, y: a.y + ny }, { x: p.x + nx, y: p.y + ny },
               { x: p.x - nx, y: p.y - ny }, { x: a.x - nx, y: a.y - ny }]], color, 'nonzero');
  }
}

function commit(st) {
  if (!HAVE_CV) {
    var ss = (UI.state.strokes || []).slice();
    ss.push(st);
    UI.set({ strokes: ss });
    return;
  }
  sys.canvasTarget(0);
  strokeInto(st.pts, st.color, st.w);
  sys.canvasTarget(-1);   /* gen bump: the blit repaints, the JPEG re-sends */
}

var COLORS = [0x44dd88, 0xff6b6b, 0x4a9dff, 0xffd166, 0xffffff];

function App() {
  var color = UI.state.color === undefined ? COLORS[0] : UI.state.color;
  var live = UI.state.liveStroke || null;
  var areaH = gfx.height() - 40;

  var chips = [];
  for (var i = 0; i < COLORS.length; i++) {
    chips.push(h('box', {
      w: 26, h: 26, radius: 13, bg: COLORS[i],
      border: color === COLORS[i] ? 0xffffff : 0x333a46, borderW: 2,
      onTap: (function (c2) { return function () { UI.set({ color: c2 }); }; })(COLORS[i])
    }));
  }
  chips.push(h(Button, {
    label: 'CLEAR', size: 1, pad: em(0.5), bg: UI.theme.panel,
    onTap: function () { clearCanvas(); }
  }));

  var layers = [
    HAVE_CV
      ? h('canvas', { src: 0, w: gfx.width(), h: areaH })
      : h('box', { w: gfx.width(), h: areaH, bg: BG },
          (UI.state.strokes || []).map(function (st) {
            return h('path', { pts: st.pts, color: st.color, w: st.w });
          }))
  ];
  if (live) {
    layers.push(h('abs', { x: 0, y: 0 },
      h('path', { pts: live.pts, color: live.color, w: live.w })));
  }

  return (
    <box h={gfx.height()}>
      <box h={areaH} clip={true}
           onDraw={function (phase, x, y, id) {
             var st = UI.state.liveStroke;
             if (phase === 0) {
               UI.set({ liveStroke: { pts: [{ x: x, y: y }], color: color, w: 4 } });
             } else if (st) {
               st.pts.push({ x: x, y: y });
               if (phase === 2) {
                 commit(st);
                 UI.set({ liveStroke: null });
               } else {
                 UI.set({ liveTick: (UI.state.liveTick || 0) + 1 });
               }
             }
           }}>
        {h('box', {}, layers)}
      </box>
      <row h={40} pad={6} gap={8} bg={UI.theme.panel}>
        {chips}
      </row>
    </box>
  );
}

UI.mount(App);
