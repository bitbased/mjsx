# Examples

Every example is a single flat `app.jsx` written against the ambient
globals a device provides (`h`, `UI`, `gfx`, `sys`) — no imports, no build
step. Each runs unmodified under any backend.

The images below live in `out/gallery/`, which is gitignored — on a fresh
clone they don't exist yet. Regenerate them with `bun run gallery`
(`bun scripts/render-examples.mjs`), which renders every example headlessly
through the pure-js backend at 240x280. Examples that gate on device
natives (camera, wifi, screen, canvas, gpio, i2c) render their
no-hardware
fallback, which is what you'd see developing them on a desktop anyway.

Apps bound to one person's hardware live in `local-examples/` instead — a
gitignored sibling with the same shape. The bundler and the pusher pick it
up automatically, so those apps reach the device without reaching the repo,
and a local name shadows a shipped one.

| Example | What it shows | |
|---|---|---|
| [hello](hello/) | The smallest real mjsx app: a panel, a border, some centred text. | ![](../out/gallery/hello.png) |
| [counter](counter/) | Tap the button, the count changes, the screen redraws to match — state → `UI.set` → full redraw, no reconciler. | ![](../out/gallery/counter.png) |
| [fonts](fonts/) | The active font at sizes 1–3 plus the glyph repertoire; which font is active belongs to the host, and `em()` spacing follows its metrics. | ![](../out/gallery/fonts.png) |
| [shapes](shapes/) | SVG-style filled paths, even-odd rule: a self-intersecting pentagram, a two-ring donut whose hole is a hole, stroke over fill. | ![](../out/gallery/shapes.png) |
| [layers](layers/) | Layering / scrolling / cropping torture test: fixed header and footer, a flex scroll region, overlapping abs boxes, a floating action button, a modal that owns all input. | ![](../out/gallery/layers.png) |
| [sensors](sensors/) | Every motion signal the host has, three ways: a bubble LEVEL with a tilting horizon, a rolling TRACE of each axis, and the DATA behind them — accel, gyro, temperature, and a magnetometer when one is wired. | ![](../out/gallery/sensors.png) |
| [input](input/) | Text input, every way in at once: physical keyboard, touch caret placement and drag-scroll, and four virtual keyboard layouts (QWERTY, T9, number pad, STRIP). | ![](../out/gallery/input.png) |
| [draw](draw/) | Freehand drawing with tools — the `onDraw` capture control in action: per-pointer strokes, live shape preview, point simplification on release. | ![](../out/gallery/draw.png) |
| [canvas](canvas/) | Draw's little sibling restructured around `sys.canvas`: live strokes preview as ordinary ops, then commit into a canvas source so a hundred strokes cost one blit. | ![](../out/gallery/canvas.png) |
| [camera](camera/) | The camera as canvas sources: a live preview frame and full-frame snapshots, blitted by the UI, arriving async from the module. | ![](../out/gallery/camera.png) |
| [screen](screen/) | Screen settings: brightness, sleep timeout, and what sleeping means; the natives do the real work, this view is just state and taps. | ![](../out/gallery/screen.png) |
| [wifi](wifi/) | WiFi setup in JSX — the native settings page's job done by a script, polling the async `net.*` natives on its tick. | ![](../out/gallery/wifi.png) |
| [gpio](gpio/) | Direct pin access through `sys.gpio`: read (INPUT_PULLUP), drive high/low, ADC; refused display/touch pins shown as -1. | ![](../out/gallery/gpio.png) |
| [i2c](i2c/) | Bus scan 8..119 and register peek through `sys.i2c` — the bridge's `reg` command as a UI. | ![](../out/gallery/i2c.png) |
| [asteroids](asteroids/) | A real-time game: a fixed 16 ms step read from `sys.millis()`, a torus world that wraps at the rim on round glass, and one whole-stroke pointer handler that steers toward your finger. | ![](../out/gallery/asteroids.png) |
| [clock](clock/) | Four faces, three ways to know the time: an HTTP `Date` header through `net.fetch`, the RTC at 0x51 through `sys.i2c`, or a stored anchor that drifts. Swipes change face, a long press sets it. | ![](../out/gallery/clock.png) |
