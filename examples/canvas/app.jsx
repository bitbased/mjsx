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
/* The drawing area's height, decided ONCE: the canvas source is allocated
   at exactly the size the canvas element is drawn at. When those two
   disagree the blit stretches, and a stroke committed after its preview
   lands somewhere other than where it was drawn -- which is what happened
   the moment the round layout gave the canvas the whole circle while the
   source was still sized for a toolbar that round does not have. */
var AREA_H = (typeof UI !== 'undefined' && UI.isRound && UI.isRound())
  ? gfx.height() : gfx.height() - 40;

var HAVE_CV = typeof sys !== 'undefined' && typeof sys.canvasTarget === 'function' &&
              typeof gfx.blit === 'function' && sys.canvas(0, gfx.width(), AREA_H) === 1;

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
  /* Round glass: the canvas is the WHOLE circle and the controls ride the
     rim on an ArcFooter, so nothing square is cut off and no strip of
     drawing surface is spent on a toolbar. AREA_H is shared with the
     source allocation above -- they must never disagree. */
  var round = UI.isRound();
  var areaH = AREA_H;

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
  /* DIRECT: no live polyline layer -- every move rasterizes its segment
     straight into the canvas, and the frame is just the blit */
  chips.push(h(Button, {
    label: 'DIRECT', size: 1, pad: em(0.5),
    bg: UI.state.direct ? UI.theme.accent : UI.theme.panel,
    onTap: function () { UI.set({ direct: UI.state.direct ? 0 : 1 }); }
  }));

  /* The same controls as items on the arc: round swatches climb the rim
     happily (a circle has no orientation to get wrong), and the two word
     buttons sit nearest bottom-centre where the chord is widest. */
  var arcItems = [];
  arcItems.push({ w: 40, h: 22, node: h(Button, {
    label: 'CLR', size: 1, pad: em(0.25), w: 40, h: 22, bg: UI.theme.panel,
    onTap: function () { clearCanvas(); }
  }) });
  for (var ai = 0; ai < COLORS.length; ai++) {
    arcItems.push({ w: 24, h: 24, node: h('box', {
      w: 24, h: 24, radius: 12, bg: COLORS[ai], hitPad: 4,
      border: color === COLORS[ai] ? 0xffffff : 0x333a46, borderW: 2,
      onTap: (function (c2) { return function () { UI.set({ color: c2 }); }; })(COLORS[ai])
    }) });
  }
  arcItems.push({ w: 46, h: 22, node: h(Button, {
    label: 'DIR', size: 1, pad: em(0.25), w: 46, h: 22,
    bg: UI.state.direct ? UI.theme.accent : UI.theme.panel,
    onTap: function () { UI.set({ direct: UI.state.direct ? 0 : 1 }); }
  }) });

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
             if (UI.state.direct && HAVE_CV) {
               /* straight into the bitmap, one segment per move */
               var lp = UI.state._dl;
               var pt = { x: x, y: y };
               sys.canvasTarget(0);
               strokeInto(lp && phase !== 0 ? [lp, pt] : [pt], color, 4);
               sys.canvasTarget(-1);
               UI.set({ _dl: phase === 2 ? null : pt,
                        liveTick: (UI.state.liveTick || 0) + 1 });
               return;
             }
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
      {round
        ? h(ArcFooter, { items: arcItems, spread: 150, inset: 10 })
        : h('row', { h: 40, pad: 6, gap: 8, bg: UI.theme.panel }, chips)}
    </box>
  );
}

UI.mount(App);
