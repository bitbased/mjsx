# The simulator

Pick an example, edit it, and it re-runs on the panel beside it. Click and
drag on the glass; type into it. It is running here, on this page.

<!-- simulator: counter -->

It is not a preview or a mock-up. It loads the real engine
(`packages/core/src/mjsx.js`), the real rasterizer every documentation
figure is drawn with (`backends/pure-js`), and the real JSX transpiler
(`packages/core/src/jsx.js`) that turns `<box>` into `h('box', …)` when a
bundle is pushed to a chip. What the canvas shows is a framebuffer: bitmap
glyphs, Bresenham lines, scanline fills. It looks like the panel because
it *is* the panel's rasterizer, running in a different place.

Every figure of an example in these docs carries a link under it that opens
that example on that panel.

## What you can do with it

- **Edit and watch.** Typing re-runs the app half a second after you stop.
  The last good frame stays on the glass while a syntax error is on screen,
  because a blank rectangle is a worse thing to debug against.
- **Touch it.** Click and drag on the panel; that is a real event going
  into `UI.pointer`, the same call the HTTP mirror and the SDL simulator
  make. Scrolling works. So do momentum and long-press.
- **Type into it.** Click the glass first — while it has focus, keys go to
  the app through `UI.type` and `UI.key`, so a focused text field behaves
  the way it does on hardware. Keys typed in the editor never reach the
  app.
- **Change panels.** All the shapes the project tests against, round glass
  included. `UI.isRound()` is seeded exactly as a firmware seeds it, so
  round-aware layouts do the round thing.
- **Zoom.** 2× and 3× are genuine re-renders at a higher `dpr`, not a
  magnified bitmap — the same mechanism as the figure viewer's HD modes.
  Layout and hit boxes stay logical; only the buffer grows.

## Sharing a link

The hash carries the state:

```
/play/#ex=counter                     an example
/play/#ex=input&shape=round128        …on a particular panel
/play/#code=<base64url>               your edited source
```

**Copy link** picks the right one: the example if you have not changed it,
your source if you have. Following a link while the simulator is already
open reloads it rather than doing nothing.

## What it cannot do

A browser has none of the device natives, so `sensors`, `gpio`, `i2c`,
`camera` and `wifi` draw their own labelled fallbacks. That fallback is
part of each example — the honest thing to show when the hardware is
absent — and not a failure of the simulator. To drive real sensors, run the
example on a board, or use the [HTTP mirror](/devices/) to put a real
device's screen in a browser.

The engine here is JavaScript, not MicroQuickJS. The dialect is enforced
separately, by `bun run lint` and by the wasm parity tests, which run the
core and every example through the same bytecode interpreter a chip does.
So the simulator tells you what your UI *looks like and does*; the linter
and the parity suite tell you whether a chip will accept it.

## Running it locally

```
bun run site          # dev server, live reload; prints every URL worth opening
bun run site:preview  # build once and serve the real static output
```

The simulator's bundle is built by `scripts/build-play.mjs`, which also
writes `examples.json` — the example sources, read straight from
`examples/*/app.jsx` so the page can never drift from the repo.
