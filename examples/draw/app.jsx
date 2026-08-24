/*
 * Freehand drawing with tools - the onDraw capture control in action.
 * The canvas owns every stroke that starts inside it (press/move/release,
 * local coordinates, per-pointer id so multitouch draws independent
 * shapes); palette, tools and CLEAR stay ordinary tappable controls, and
 * the width slider is its own capture area. Shapes drag with LIVE
 * preview: rect and circle resize until release, pen simplifies its
 * points (Ramer-Douglas-Peucker) when the stroke ends. Everything renders
 * as path nodes - the circle is a 24-gon path, so stroke width and round
 * joins work the same for every tool.
 */
function shapePts(sh) {
  if (sh.tool === 'pen') return sh.pts;
  var a = sh.a, b = sh.b;
  if (sh.tool === 'line') return [a, b];
  if (sh.tool === 'rect') return [a, { x: b.x, y: a.y }, b, { x: a.x, y: b.y }];
  /* circle: centre a, radius to b, as a 24-gon */
  var dx = b.x - a.x, dy = b.y - a.y;
  var r = Math.sqrt(dx * dx + dy * dy);
  var pts = [];
  for (var i = 0; i < 24; i++) {
    var an = (i * 2 * Math.PI) / 24;
    pts.push({ x: a.x + Math.cos(an) * r, y: a.y + Math.sin(an) * r });
  }
  return pts;
}

function App() {
  var strokes = UI.state.strokes || [];
  var sc = UI.state.sc === undefined ? 0x44dd88 : UI.state.sc;   /* stroke colour, null = none */
  var fc = UI.state.fc === undefined ? null : UI.state.fc;       /* fill colour, null = none */
  var slot = UI.state.slot || 'sc';                              /* which slot the palette edits */
  var tool = UI.state.tool || 'pen';

  var marks = [];
  for (var si = 0; si < strokes.length; si++) {
    var st = strokes[si];
    var closed = st.tool === 'rect' || st.tool === 'circle';
    marks.push(<path pts={shapePts(st)}
                     color={st.sc === null ? undefined : st.sc}
                     w={st.w || 2}
                     close={closed}
                     fill={st.fc === null ? undefined : st.fc} />);
  }

  var previewC = sc !== null ? sc : (fc !== null ? fc : 0x555555);
  var tools = ['pen', 'line', 'rect', 'circle'];
  var toolBtns = [];
  for (var ti = 0; ti < tools.length; ti++) {
    toolBtns.push(
      <Button label={tools[ti].toUpperCase()} size={1} pad={em(0.4)}
              bg={tools[ti] === tool ? 0x2e4a37 : undefined}
              color={tools[ti] === tool ? 0x9fe8b9 : undefined}
              onTap={(function (t) { return function () { UI.set({ tool: t }); }; })(tools[ti])} />
    );
  }


  /* slot chips: which colour the palette edits - S(troke) or F(ill).
     The chip shows its slot's current colour; X in the palette sets the
     active slot to transparent. */
  function chip(label, key, val) {
    return (
      <box w={em(2.2)} h={em(2.2)} bg={val === null ? 0x14161b : val} radius={4}
           border={slot === key ? 0xffffff : 0x3a4152} borderW={slot === key ? 2 : 1}
           onTap={function () { UI.set({ slot: key }); }}>
        <text text={val === null ? label + 'x' : label} size={1} align="center"
              color={val === null || val === 0x000000 || val === 0xdd6644 ? 0xaaaaaa : 0x222222} />
      </box>
    );
  }
  var colors = [0x44dd88, 0x66aaff, 0xffcc44, 0xdd6644, 0xffffff, 0x000000];
  var active = slot === 'sc' ? sc : fc;
  var pal = [chip('S', 'sc', sc), chip('F', 'fc', fc)];
  for (var ci = 0; ci < colors.length; ci++) {
    pal.push(
      <box w={em(2)} h={em(2.2)} bg={colors[ci]} radius={4}
           border={colors[ci] === active ? 0xffffff : 0x3a4152} borderW={colors[ci] === active ? 2 : 1}
           onTap={(function (c) { return function () { var o = {}; o[UI.state.slot || 'sc'] = c; UI.set(o); }; })(colors[ci])} />
    );
  }
  pal.push(
    <box w={em(2)} h={em(2.2)} bg={0x14161b} radius={4}
         border={active === null ? 0xffffff : 0x3a4152} borderW={active === null ? 2 : 1}
         onTap={function () { var o = {}; o[UI.state.slot || 'sc'] = null; UI.set(o); }}>
      <text text="x" size={1} align="center" color={0xdd6644} />
    </box>
  );

  return (
    <box h={gfx.height()}>
      <box bg={0x223048} pad={em(0.5)} h={em(2.6)}>
        <text text={'DRAW - ' + strokes.length + ' shapes'} size={1} align="center" color={0x8fb8ff} />
      </box>

      <box flex={1} bg={0x14161b}
           onDraw={function (phase, x, y, id) {
             var st2 = UI.state.strokes || [];
             var live = UI.state.live || {};
             var tl = UI.state.tool || 'pen';
             if (phase === 0) {
               live[id] = st2.length;
               var sh = { tool: tl,
                          sc: UI.state.sc === undefined ? 0x44dd88 : UI.state.sc,
                          fc: UI.state.fc === undefined ? null : UI.state.fc,
                          w: UI.state.width || 2 };
               if (tl === 'pen') sh.pts = [{ x: x, y: y }];
               else { sh.a = { x: x, y: y }; sh.b = { x: x, y: y }; }
               st2 = st2.concat([sh]);
             } else if (live[id] !== undefined && st2[live[id]]) {
               var cur = st2[live[id]];
               if (cur.tool === 'pen') {
                 var last = cur.pts[cur.pts.length - 1];
                 var dx = x - last.x, dy = y - last.y;
                 if (dx * dx + dy * dy >= 4 || phase === 2) cur.pts.push({ x: x, y: y });
                 if (phase === 2) cur.pts = UI.simplifyPath(cur.pts, 1.4);
               } else {
                 cur.b = { x: x, y: y }; /* live resize until release */
               }
               if (phase === 2) delete live[id];
             }
             UI.set({ strokes: st2, live: live });
           }}>
        {marks}
      </box>

      <box bg={0x223048} pad={em(0.5)} h={em(9)} gap={em(0.4)}>
        <row gap={em(0.4)}>{toolBtns}</row>
        <row gap={em(0.5)}>{pal}</row>
        <box bg={0x14161b} radius={6} h={em(1.8)} pad={em(0.25)} hitPad={4} vcenter={true}
             onDraw={function (phase, x) {
               var trackW = gfx.width() - em(1);
               var w2 = 1 + Math.max(0, Math.min(1, x / trackW)) * 7;
               UI.set({ width: Math.round(w2) });
             }}>
          <box w={Math.max(em(0.8), Math.round((((UI.state.width || 2) - 1) / 7) * (gfx.width() - em(1.5))))}
               bg={previewC} radius={2} h={UI.state.width || 2} />
        </box>
      </box>
    </box>
  );
}

UI.mount(App);
