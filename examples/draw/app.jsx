/*
 * Freehand drawing - the onDraw control in action. The canvas box owns
 * every stroke that starts inside it (press/move/release in its own local
 * coordinates); the palette and CLEAR button stay ordinary tappable
 * controls. Strokes live in UI.state and render as plain <line> marks
 * inside the canvas box - immediate mode all the way down: the whole
 * picture redraws from state every dirty frame, like everything else.
 */
function App() {
  var strokes = UI.state.strokes || [];
  var color = UI.state.color || 0x44dd88;

  var marks = [];
  var totalPts = 0;
  for (var si = 0; si < strokes.length; si++) {
    var st = strokes[si];
    totalPts += st.pts.length;
    marks.push(<path pts={st.pts} color={st.color} w={st.w || 2} />);
  }

  var colors = [0x44dd88, 0x66aaff, 0xffcc44, 0xdd6644, 0xffffff];
  var pal = [];
  for (var ci = 0; ci < colors.length; ci++) {
    pal.push(
      <box w={em(2.2)} h={em(2.2)} bg={colors[ci]} radius={4}
           border={colors[ci] === color ? 0xffffff : undefined} borderW={2}
           onTap={(function (c) { return function () { UI.set({ color: c }); }; })(colors[ci])} />
    );
  }
  pal.push(
    <Button label="CLEAR" size={1} pad={em(0.5)}
            onTap={function () { UI.set({ strokes: [] }); }} />
  );

  return (
    <box h={gfx.height()}>
      <box bg={0x223048} pad={em(0.6)} h={em(2.8)}>
        <text text={'DRAW - ' + strokes.length + ' strokes, ' + totalPts + ' pts'} size={1} align="center" color={0x8fb8ff} />
      </box>

      {/* the canvas: owns strokes via onDraw, in local coordinates. The
          pointer id keys each finger to ITS stroke, so real multitouch
          draws independent lines instead of rubber-banding between
          fingers. */}
      <box flex={1} bg={0x14161b}
           onDraw={function (phase, x, y, id) {
             var st2 = UI.state.strokes || [];
             var live = UI.state.live || {};
             if (phase === 0) {
               live[id] = st2.length;
               st2 = st2.concat([{ color: UI.state.color || 0x44dd88,
                                   w: UI.state.width || 2,
                                   pts: [{ x: x, y: y }] }]);
             } else if (live[id] !== undefined && st2[live[id]]) {
               var cur = st2[live[id]];
               var last = cur.pts[cur.pts.length - 1];
               var dx = x - last.x, dy = y - last.y;
               if (dx * dx + dy * dy >= 4 || phase === 2) cur.pts.push({ x: x, y: y });
               if (phase === 2) {
                 /* simplify once, when the stroke ends - same shape, a
                    fraction of the points */
                 cur.pts = UI.simplifyPath(cur.pts, 1.4);
                 delete live[id];
               }
             }
             UI.set({ strokes: st2, live: live });
           }}>
        {marks}
      </box>

      {/* a slider is the same capture story as the canvas: its onDraw owns
          the drag, so sliding never scrolls or taps anything else */}
      <box bg={0x223048} pad={em(0.5)} h={em(6)} gap={em(0.5)}>
        <row gap={em(0.5)}>{pal}</row>
        {/* the fill IS the preview: its height is the literal stroke width,
            drawn in the current colour */}
        <box bg={0x14161b} radius={6} h={em(1.8)} pad={em(0.25)} hitPad={4} vcenter={true}
             onDraw={function (phase, x) {
               var trackW = gfx.width() - em(1);
               var w2 = 1 + Math.max(0, Math.min(1, x / trackW)) * 7;
               UI.set({ width: Math.round(w2) });
             }}>
          <box w={Math.max(em(0.8), Math.round((((UI.state.width || 2) - 1) / 7) * (gfx.width() - em(1.5))))}
               bg={color} radius={2} h={UI.state.width || 2} />
        </box>
      </box>
    </box>
  );
}

UI.mount(App);
