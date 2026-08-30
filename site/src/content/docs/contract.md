---
title: "The backend contract"
description: "The ten gfx calls a backend must provide."
---
<!-- GENERATED from docs/contract.md by scripts/docs-sync.mjs. Edit that file. -->mjsx-core (`packages/core/src/mjsx.js`) draws through two globals a backend
supplies before the core loads: `gfx` and `sys`. It assumes ten `gfx` calls
and one `sys` call exist, and nothing else. Everything below is what the
core actually invokes, verified against the source.

Coordinates are pixels. Colours are 24-bit `0xRRGGBB` everywhere; the
backend converts to its own depth (5-6-5 on the panels, RGB bytes in the
pure-js buffer). The conversion is *not* lossless on every host and an
app must not compare exact colours across backends: the terminal emits
true-colour SGR only when `COLORTERM` says the terminal can take it and
otherwise quantises to the xterm-256 cube
(`backends/terminal/src/backend.js`), and the glass emulator quantises
its anti-aliased text and corners through RGB565 to match the panel.

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
`backends/pure-js/src/backend.js`. "Exactly" is literal — that table has
ten `gfx` entries and six `sys` entries and nothing else, so the in-tree
ESP32 target has no `poly` and no `blit`; the device-side ones come from
the out-of-tree firmware plus `backends/esp32/tools/device-shim.js`.

`examples/shapes` exercises every one of those calls in a single frame, so
a new backend has one page to compare its output against:

<div class="shapes">
  <input type="radio" name="sw-ex-shapes-0" id="sw-ex-shapes-0-0">
  <label for="sw-ex-shapes-0-0">
    <img src="/img/ex-shapes-round128.png" alt="">
    round<br>240×240
  </label>
  <input type="radio" name="sw-ex-shapes-0" id="sw-ex-shapes-0-1">
  <label for="sw-ex-shapes-0-1">
    <img src="/img/ex-shapes-lcd147.png" alt="">
    portrait<br>172×320
  </label>
  <input type="radio" name="sw-ex-shapes-0" id="sw-ex-shapes-0-2">
  <label for="sw-ex-shapes-0-2">
    <img src="/img/ex-shapes-lcd169.png" alt="">
    landscape<br>280×240
  </label>
  <input type="radio" name="sw-ex-shapes-0" id="sw-ex-shapes-0-3" checked>
  <label for="sw-ex-shapes-0-3">
    <img src="/img/ex-shapes-lcd35.png" alt="">
    portrait<br>320×480
  </label>
  <div class="shape-panels">
    <figure>
      <img src="/img/ex-shapes-round128.png" alt="examples/shapes — SVG-style filled paths, even-odd rule.">
      <figcaption><strong>Round, 240×240.</strong> examples/shapes — SVG-style filled paths, even-odd rule. <a class="run-example" href="/play/#ex=shapes&amp;shape=round128">▶ Run it</a></figcaption>
    </figure>
    <figure>
      <img src="/img/ex-shapes-lcd147.png" alt="examples/shapes — SVG-style filled paths, even-odd rule.">
      <figcaption><strong>Portrait, 172×320.</strong> examples/shapes — SVG-style filled paths, even-odd rule. <a class="run-example" href="/play/#ex=shapes&amp;shape=lcd147">▶ Run it</a></figcaption>
    </figure>
    <figure>
      <img src="/img/ex-shapes-lcd169.png" alt="examples/shapes — SVG-style filled paths, even-odd rule.">
      <figcaption><strong>Landscape, 280×240.</strong> examples/shapes — SVG-style filled paths, even-odd rule. <a class="run-example" href="/play/#ex=shapes">▶ Run it</a></figcaption>
    </figure>
    <figure>
      <img src="/img/ex-shapes-lcd35.png" alt="examples/shapes — SVG-style filled paths, even-odd rule.">
      <figcaption><strong>Portrait, 320×480.</strong> examples/shapes — SVG-style filled paths, even-odd rule. <a class="run-example" href="/play/#ex=shapes&amp;shape=lcd35">▶ Run it</a></figcaption>
    </figure>
  </div>
</div>

For where each backend in this repo actually lands against the surface
below — including where one does not honour it — see
[`consistency.md`](/consistency).

## Optional

The core probes for these with `typeof` / presence checks and works
without them:

- **`sys.store(key, value)` / `sys.fetch(key)`** — a persistent string
  key/value store, the backing for `configStorage` (see below).
  `fetch` returns the stored string, or `''` for a missing key. On the
  device this is NVS ("the app's settings survive a power cycle").
  Without them `configStorage` falls back to `localStorage` (prefixed
  `mjsx.`) and then to plain memory.

  **Provide both or neither.** `configStorage` binds on
  `typeof sys.fetch === 'function'`, so a *present but stubbed* pair is
  worse than an absent one: it wins the check and the `localStorage` /
  memory fallbacks never run, which turns every `set` into a silent drop
  and every `get` into its default — within one session, not just across
  power cycles. One host in this tree does exactly that today: the
  `hello-mjsx` firmware's `sysNStore` / `sysNFetch`
  (`backends/esp32/firmware/hello-mjsx/hello-mjsx.ino` l.49-50), so
  `configStorage` — and therefore `UI.isRound()` — cannot work on it. The
  terminal backend had the same defect and was fixed; it now keeps a
  session `storeMap`. See `docs/consistency.md` (D1).
- **`net.fetch(url, opts)` / `net.fetchState()` / `net.fetchBody()`** — an
  HTTP request from a script, async in the `net.scan`/`net.results` style:
  start, then poll. Sandboxed behind an allowlist and **off by default**, so
  a host that implements it does not become an open proxy for whatever
  script is pushed to it. Only the ESP32 bridge firmware has these today; no
  JS backend in this tree implements them, and every caller gates on
  `typeof net.fetch === 'function'`. The size caps and the reasoning behind
  them are in [hardware-api.md](/hardware-api).

- **`gfx.poly(polys, color, rule)`** — fill polygons given as a list of
  point-lists (`{x, y}` floats, logical coordinates), `rule` is
  `'nonzero'` or `'evenodd'`. When present, the `path` element hands its
  stroke outlines and fills here so the backend can rasterize at device
  resolution; when absent the core scanline-fills through `frect` itself.
  That signature is the one the *core* calls. The ESP32 device path is
  not the same shape: `backends/esp32/tools/device-shim.js` re-encodes
  the rings into a base-127 packed string and hands *that* to the
  firmware's native `poly`, precisely so a whole polygon crosses the
  JS/C boundary as one value. A JS backend takes arrays; a native one
  takes the packed string. The shim is the only translator.
- **`gfx.blit(src, x, y, w, h)`** — composite external pixels (a camera
  frame, a bitmap) for the `canvas` element. Backends without it get a
  crossed placeholder frame instead. No backend in this repo implements
  it: every in-tree host draws the placeholder, and the only real `blit`
  is the one `device-shim.js` passes through when the firmware under it
  has one.
- **`sys.beep(ok)` / `sys.tone(hz, ms)` / `sys.exit()`** — declared in the
  ESP32 native-api for apps; the core itself never calls them.
- **Font metrics** — the core defaults to a fixed-width bitmap metric
  (`FONT.advance = 6`, `FONT.lineH = 8`, scaled linearly by size). A
  backend whose font differs overrides `FONT` after requiring the core:
  `advance`, `lineH`, `quantum` (the alignment unit `em()` snaps to), and
  `pick(size)` (per-size real metrics, the ladder picker from `fonts.js`).
  `UI.scrollQuantum` similarly aligns scroll offsets — the terminal
  backend sets both (`backends/terminal/src/run.js`).

  This is a **runner** responsibility, not a backend one, and it is easy
  to forget: the pure-js backend reports its metrics as `backend.font`
  but `backends/pure-js/src/run.js` and `backends/http/src/server.js` do
  not copy them onto `FONT`, so layout measures with the linear default
  (advance 6/size) while the rasterizer draws the ladder font (advance 7
  at size 2). Centred and right-aligned text is visibly displaced as a
  result. `backends/sdl/src/run.js` shows the three lines to copy
  (l.68-70). See
  `docs/consistency.md` (D2).

## Host-declared facts

The host tells the app about the glass through `configStorage`:

- **`round`** — `'1'` means round glass. `UI.isRound()` reads it once
  (`configStorage.get('round', '0') === '1'`) and caches the answer.
  A firmware seeds the key through `sys.store`; web and sim leave it
  unset, so the answer defaults to square. Nothing in `backends/` writes
  the key — the sim's `--circle` / `SHAPE:CIR` is a *window mask only*,
  so the sim previews round glass while the app still lays out square.
  A host that wants the round layouts must set the key itself, before the
  first `UI.isRound()` call, because the answer is cached from then on.

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

One asymmetry to know about when writing an app that must run both ways:
the CommonJS form makes those names *exports*, and a runner has to put
them back on `globalThis` by hand. Every runner in this tree wires `h`,
`UI`, `Button`, `Swatch`, `em`, `Modal`, `Keyboard` and `ArcFooter` — and
only the three terminal runners also wire `configStorage`. So an app that
reads `configStorage` bare works on device and under `backends/terminal/**`,
and throws `ReferenceError` under `backends/pure-js/src/run.js`,
`backends/http/src/server.js`, `backends/sdl/src/run.js`,
`backends/sdl/src/sim.js` and `test/load.js`. Until those five are fixed,
either add the line yourself or reach it through the module. See
`docs/consistency.md` (D3).

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
