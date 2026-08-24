/*
 * SVG-style filled paths, even-odd rule. The pentagram is one
 * self-intersecting subpath - alternating fill leaves the inner pentagon
 * open, exactly as fill-rule=evenodd does. The donut is two concentric
 * ring subpaths in ONE path - the inner ring flips the parity back to
 * empty, so the hole is a hole. Stroke and fill compose: fill first,
 * outline on top.
 */
function ngon(cx, cy, r, n, rot, step) {
  var pts = [];
  for (var i = 0; i < n; i++) {
    var a = rot + (i * (step || 1) * 2 * Math.PI) / n;
    pts.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
  }
  return pts;
}

function App() {
  var star = ngon(60, 62, 42, 5, -Math.PI / 2, 2); /* step 2 = pentagram */
  var donut = [ngon(175, 62, 40, 24, 0), ngon(175, 62, 20, 24, 0)];
  var arrow = [
    { x: 30, y: 150 }, { x: 120, y: 150 }, { x: 120, y: 132 },
    { x: 165, y: 165 }, { x: 120, y: 198 }, { x: 120, y: 180 }, { x: 30, y: 180 }
  ];
  var blob = ngon(200, 178, 34, 7, 0.3);

  return (
    <box h={gfx.height()} pad={em(0.75)} gap={em(0.5)}>
      <text text="SHAPES - even-odd fill" size={1} align="center" color={0x8fb8ff} />
      <box flex={1}>
        <path pts={star} fill={0xffcc44} color={0xdd6644} w={2} />
        <path pts={donut} fill={0x44dd88} />
        <path pts={arrow} fill={0x66aaff} color={0xffffff} w={1} />
        <path pts={blob} fill={0x8855cc} color={0xcfa8ff} w={3} />
      </box>
    </box>
  );
}

UI.mount(App);
