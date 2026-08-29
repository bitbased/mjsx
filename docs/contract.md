# The backend contract

mjsx-core (`packages/core/src/mjsx.js`) draws through two globals a backend
supplies before the core loads: `gfx` and `sys`. It assumes ten `gfx` calls
and one `sys` call exist, and nothing else. Everything below is what the
core actually invokes, verified against the source.

Coordinates are pixels. Colours are 24-bit `0xRRGGBB` everywhere; the
backend converts to its own depth (5-6-5 on the panels, RGB bytes in the
pure-js buffer).

## The ten calls

| Call | Meaning |
|---|---|
| `gfx.clear(color)` | Fill the whole surface. Start of every frame. |
| `gfx.rect(x, y, w, h, color, radius)` | 1px outline, optionally rounded. `radius` may be 0. |
| `gfx.frect(x, y, w, h, color, radius)` | Filled rect, optionally rounded. The workhorse call. |
| `gfx.circle(x, y, r, color, filled)` | Centre, radius, boolean `filled`. |
| `gfx.line(x0, y0, x1, y1, color)` | 1px line. The core draws thick lines as parallel 1px lines itself. |
| `gfx.text(x, y, size, color, str)` | Draw `str` at integer size multiplier `size`, top-left origin. The core never rasterizes a glyph; font choice is entirely the backend's. |
| `gfx.clip(x, y, w, h)` | Set THE clip rect. A single rect, not a stack — the core intersects nested clips itself (`pushClip`/`popClip`) and always hands you one honest rect. |
| `gfx.unclip()` | Remove the clip rect. |
| `gfx.width()` | Logical surface width in pixels. |
| `gfx.height()` | Logical surface height. |

Plus:

| Call | Meaning |
|---|---|
| `sys.millis()` | Monotonic clock, milliseconds. Drives timers, cursor blink, long-press, fling velocity. |

That is the whole required surface. The ESP32 stdlib definition
(`backends/esp32/engine/native_api.c`) declares exactly these tables; the
same names bind to C functions there and to plain JS functions in
`backends/pure-js/src/backend.js`.

## Optional

The core probes for these with `typeof` / presence checks and works
without them:

- **`sys.store(key, value)` / `sys.fetch(key)`** — a persistent string
  key/value store, the backing for `configStorage` (see below).
  `fetch` returns the stored string, or `''` for a missing key. On the
  device this is NVS ("the app's settings survive a power cycle"); the
  `hello-mjsx` firmware in this repo currently stubs both to no-ops.
  Without them `configStorage` falls back to `localStorage` (prefixed
  `mjsx.`) and then to plain memory.
- **`gfx.poly(polys, color, rule)`** — fill polygons given as a list of
  point-lists (`{x, y}` floats, logical coordinates), `rule` is
  `'nonzero'` or `'evenodd'`. When present, the `path` element hands its
  stroke outlines and fills here so the backend can rasterize at device
  resolution; when absent the core scanline-fills through `frect` itself.
- **`gfx.blit(src, x, y, w, h)`** — composite external pixels (a camera
  frame, a bitmap) for the `canvas` element. Backends without it get a
  crossed placeholder frame instead.
- **`sys.beep(ok)` / `sys.tone(hz, ms)` / `sys.exit()`** — declared in the
  ESP32 native-api for apps; the core itself never calls them.
- **Font metrics** — the core defaults to a fixed-width bitmap metric
  (`FONT.advance = 6`, `FONT.lineH = 8`, scaled linearly by size). A
  backend whose font differs overrides `FONT` after requiring the core:
  `advance`, `lineH`, `quantum` (the alignment unit `em()` snaps to), and
  `pick(size)` (per-size real metrics, the ladder picker from `fonts.js`).
  `UI.scrollQuantum` similarly aligns scroll offsets — the terminal
  backend sets both (`backends/terminal/src/run.js`).

## Host-declared facts

The host tells the app about the glass through `configStorage`:

- **`round`** — `'1'` means round glass. `UI.isRound()` reads it once
  (`configStorage.get('round', '0') === '1'`) and caches the answer.
  A firmware seeds the key through `sys.store`; web and sim leave it
  unset, so the answer defaults to square.

## Driving the engine

A backend also owns the loop. The pure-js runner
(`backends/pure-js/src/run.js`) is the minimal wiring:

```js
var backend = require('./backend.js').createPureJsBackend(W, H);
globalThis.gfx = backend.gfx;
globalThis.sys = backend.sys;
var core = require('../../../packages/core/src/mjsx.js');
globalThis.h = core.h;
globalThis.UI = core.UI;
// ...load the app, which calls UI.mount(...)
UI.render();
```

On a live target, tick on an interval: call `UI.ticker()` (it advances
flings, timers and long-press repeats, and returns dirtiness), and when
it — or `UI.dirty()` — says so, call `UI.render()` and present the
surface. Feed input with `UI.pointer(id, phase, x, y)` and
`UI.key(type, key)`; see `docs/ui.md`.

Under MicroQuickJS the core is eval'd flat and `h`/`UI`/`configStorage`
land as globals; under Node/Bun it is also loadable as a CommonJS module.
Same file, no branching on the host.

## Worked example

The pure-js backend's `frect`, trimmed of its device-compat and
text-capture branches (`backends/pure-js/src/backend.js`):

```js
frect: function (x, y, ww, hh, color, radius) {
  var rgb = toRGB(color);
  raster.fillRoundRect(
    function (fx, fy, fw, fh) { fillRect(fx, fy, fw, fh, rgb); },
    x * dpr, y * dpr, ww * dpr, hh * dpr, (radius || 0) * dpr);
}
```

A minimal new backend is ten functions of this size, `sys.millis`, and a
loop that calls `ticker`/`render`.
