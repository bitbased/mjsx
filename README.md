# mjsx

JSX for microcontrollers, Raspberry Pi, desktop, and the browser — one core,
several backends. Ported from a working ESP32 firmware's UI engine
(`filament-rfid`'s `ui.js`), generalized so nothing about it assumes a
specific board, a specific engine, or a specific way of turning a draw call
into pixels.

## The idea

`packages/core/src/mjsx.js` is the entire portable engine: `h()`, layout
(`measure`/`draw`, width-in height-out, no VDOM, no reconciler — a dirty
frame just redraws), hit-testing (registered at the exact rect a control was
drawn at, so it can't drift from what's on screen), and the touch/pointer
state machine (drag-slop, scroll, fling, long-press). It's written in the
ES5-safe MicroQuickJS subset deliberately, so the same file runs unmodified
on a chip's embedded interpreter or a browser's own engine.

It assumes exactly ten native calls exist — `gfx.clear/rect/frect/circle/
line/text/clip/unclip/width/height` — plus `sys.millis`. That's the whole
native-api. A **backend** is whatever realizes those ten calls: real pixels,
a structured op-list over a wire, ANSI escape codes, a browser canvas.
Nothing above that line changes per backend.

## What's here, and how sure you can be about it

| Backend | Status | Proof |
|---|---|---|
| `backends/pure-js` | **Verified** | Real PPM/PNG output; a simulated tap genuinely flows through `UI.pointer → hit-test → onTap → UI.set → dirty → render` and the second frame shows the new state. |
| `backends/esp32` | **Verified compile, not flashed** | MicroQuickJS + mjsx's trimmed native-api + glue.c compile cleanly for ESP32-S3 (427 KB flash, 20 KB RAM). `gfxN*` currently logs to Serial — a real panel driver (ported from `panel_st7796.h`) is the next step; nothing above that layer changes when it lands. |
| `backends/wasm` | **Verified, runs** | The *same* engine C source, compiled via Docker + Emscripten. Ran under Node: `mjsxInit()` → `mjsxEval()` executed real JS through the actual interpreter and round-tripped `gfx.*` calls back into JS via `EM_JS`. This is engine parity, not a reimplementation — a script that runs here ran through the identical bytecode a chip would run it through. |
| `backends/terminal` | **Verified** | Shapes render as true near-square pixels (two vertical sub-pixels per character cell via the upper-half-block glyph, independent fg/bg colour); text is the terminal's own font, not sub-pixel art. The counter example's tap-to-`COUNT: 1` proof holds here too. |

## Why the backends look so different and share so much

Every backend implements the same ten functions and nothing else is
special-cased per target:

- **pure-js**: `gfx.frect` writes into an RGBA buffer.
- **esp32/wasm**: `gfx.frect` is a C function (`gfxNRect`) — real panel SPI
  writes on device, an `EM_JS` call into JS on wasm.
- **terminal**: `gfx.frect` writes into a sub-pixel buffer flushed as ANSI.

A **stream backend** (planned, not built yet) is the same idea pointed at a
wire instead of a local surface: each call appends a compact op
(`['F',x,y,w,h,color,radius]`) instead of touching anything locally, and a
`flush()` — the same place `gfxNFlush()`/`toPPM()` sit today — serializes
the frame's ops over WebSocket or serial. The receiving end doesn't need a
new protocol; it's just another backend replaying those ten calls against
its *own* local surface. This is what lets a device push a UI into a
browser tab (or the reverse) for a fraction of what streaming a compressed
framebuffer costs, and — since a receiving browser needs no special
privilege to run the same code — gives an "isolated in an iframe" story for
free.

## Known limitations, stated rather than hidden

- **`FONT.advance`/`FONT.lineH` are a backend concession.** mjsx-core
  defaults to a 6px/char bitmap-font metric because that's what the
  original device used. A backend whose "pixels" aren't real pixels (the
  terminal, where 1 unit is meant to be 1 character column) overrides
  `core.FONT` after requiring it — see `backends/terminal/src/run.js`. This
  is a documented override point, not a special case bolted on.
- **Examples authored with fixed pixel dimensions won't fit every canvas
  size without scaling.** `examples/hello` uses `h={80}`, sized for a
  ~240×280 device; run it in a 60-column terminal and content runs off the
  bottom — not a backend bug, the same problem the ESP32 firmware's
  viewport (`sys.view(scale, inset, shiftX, shiftY)`) exists to solve. That
  transform hasn't been ported into this repo yet.
- **Yoga (real flexbox) was deliberately not built.** Its cost is per
  layout pass, not fixed — flash/RAM were never the objection — but it's a
  genuinely different layout algorithm (two-dimensional constraint solving,
  not width-in/height-out), it has no answer for scrolling, and its C++20
  requirement is an unverified toolchain risk on the Arduino/Xtensa
  compiler specifically. If it's ever added, it's a second, sibling
  layout-phase implementation behind the same `Element → Frame` contract,
  not a fork of mjsx-core.

## Running the examples

```
bun backends/pure-js/src/run.js examples/hello/app.jsx out/hello.ppm
bun backends/terminal/src/run.js examples/counter/app.jsx
```

The ESP32 target builds via `arduino-cli` against
`backends/esp32/firmware/hello-mjsx/`; the WASM target builds via
`docker build` against `backends/wasm/`. Regenerate the stdlib tables
(`backends/esp32/tools/gen-stdlib.sh`) only if `native_api.c`'s native-api
surface changes — the generated headers are committed.
