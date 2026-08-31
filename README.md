# mjsx

JSX for microcontrollers, terminals, and the browser — one core, several
backends. It began as a working ESP32 firmware's UI engine and was
generalized so nothing about it assumes a specific board, a specific engine,
or a specific way of turning a draw call into pixels. The firmware that runs
it is here too — `backends/esp32/firmware/mjsx-board/`, buildable from this
repo alone.

## Quickstart

No dependencies. Install [bun](https://bun.sh), clone, and:

```
bun install
bun run examples                  # example picker, rendered in your terminal
```

Arrow keys move a cursor, enter taps, Esc backs out, q quits. Headless (no
tty needed), the same engine renders to an image file:

```
bun run example:hello             # writes out/hello.ppm, 240x280
```

Other one-liners: `bun run sim` (native window, needs SDL2 — the only native
dependency in the repo), `bun run example:sensors` (serves a live UI to a
browser tab over WebSocket).

## The idea

`packages/core/src/mjsx.js` is the entire portable engine: `h()`, layout
(`measure`/`draw`, width-in height-out, no VDOM, no reconciler — a dirty
frame just redraws), hit-testing (registered at the exact rect a control was
drawn at, so it can't drift from what's on screen), the touch/pointer state
machine (drag-slop, scroll, fling, long-press), text input with virtual
keyboards, and modals. It's written in the ES5-safe MicroQuickJS subset
deliberately, so the same file runs unmodified on a chip's embedded
interpreter or a browser's own engine.

It assumes exactly ten native calls exist — `gfx.clear/rect/frect/circle/
line/text/clip/unclip/width/height` — plus `sys.millis`. That's the whole
native-api. A **backend** is whatever realizes those ten calls: real pixels,
a structured op-list over a wire, ANSI escape codes, a browser canvas.
Nothing above that line changes per backend. The contract is written down in
[docs/contract.md](docs/contract.md).

## What's here

| Backend | What it is |
|---|---|
| `backends/pure-js` | Headless rasterizer into an RGBA buffer; writes PPM/PNG. The reference implementation, and the renderer the http and sdl backends draw with. |
| `backends/terminal` | True near-square pixels in a terminal (two sub-pixels per character cell via the half-block glyph); text is the terminal's own font. `run.js` renders once, `interactive.js` is a real raw-mode CLI app, `launcher.js` is the picker. |
| `backends/sdl` | Device simulator in a native window (optional SDL2): square, rounded-corner, and round-display masks, size presets for the real panels, an HD sub-pixel mode, and host-font text. |
| `backends/http` | The UI in a browser tab over HTTP/WebSocket — pixels out, real input back, including genuine per-finger multitouch. |
| `backends/esp32` | The real thing. See below. |
| `backends/wasm` | The same MicroQuickJS engine C source compiled via Emscripten (Docker build, not on the happy path): engine parity for testing, not a reimplementation. |

## The ESP32 backend

Two halves. `backends/esp32/firmware/hello-mjsx` is a minimal reference
firmware — MicroQuickJS plus the ten-call glue, compiled with `arduino-cli`,
`gfx.*` logging to Serial — showing exactly where a panel driver plugs in.

The half that runs daily is `backends/esp32/tools/push-examples.mjs`: the
bridge firmware this engine was ported from already speaks mjsx's world, so
the core, a small device shim, and every example bundle into plain JS and
push to a board over TCP — no reflash. That firmware updates itself over
OTA, and drives a real four-board fleet: a 1.69" 240x280, a 3.5" 320x480, a
1.47" 172x320, and a round 1.28" 240x240 (GC9A01). On device the examples
use canvas sources (live camera preview and snapshots blitted as single
ops), the framework's on-device keyboards (QWERTY, T9, number pad, and a
one-row strip for tiny screens), round-display-aware layout (`UI.isRound()`,
safe bands for panels whose touch layer misses the edges), and an op
recorder that mirrors the screen into a browser via a `/remote` page.
The mjsx CLI at `packages/cli` (`bun packages/cli/bin/mjsx.js`) wraps
push, OTA, WiFi provisioning, and fleet fan-out.
[docs/devices.md](docs/devices.md) covers the device side.

## Why the backends look so different and share so much

Every backend implements the same ten functions and nothing else is
special-cased per target:

- **pure-js**: `gfx.frect` writes into an RGBA buffer.
- **esp32/wasm**: `gfx.frect` is a C function (`gfxNRect`) — real panel
  writes on device, an `EM_JS` call into JS on wasm.
- **terminal**: `gfx.frect` writes into a sub-pixel buffer flushed as ANSI.

A **stream backend** is the same idea pointed at a wire instead of a local
surface: each call appends a compact op instead of touching anything
locally, and a flush serializes the frame's ops. Both directions exist in
early form: the http backend streams the pure-js backend's pixel buffer to a
browser (ops are the natural next step, and it says so in its header), and
the ESP32 device shim records each frame as compact JSON ops for the
`/remote` mirror page. The receiving end doesn't need a new protocol; it's
just another backend replaying those ten calls against its own local
surface.

## Known limitations, stated rather than hidden

- **`FONT.advance`/`FONT.lineH` are a backend concession.** mjsx-core
  defaults to a bitmap-font metric because that's what the original device
  used. A backend whose "pixels" aren't real pixels (the terminal, where 1
  unit is meant to be 1 character column) overrides `core.FONT` after
  requiring it — see `backends/terminal/src/run.js`. This is a documented
  override point, not a special case bolted on.
- **Examples authored with fixed pixel dimensions won't fit every canvas
  size without scaling.** `examples/hello` is sized for a ~240x280 panel;
  run it in a 60-column terminal and content runs off the bottom. The sim's
  size presets exist for exactly this; a general viewport transform hasn't
  been ported into the core.
- **Yoga (real flexbox) was deliberately not built.** Its cost is per
  layout pass, not fixed — flash/RAM were never the objection — but it's a
  genuinely different layout algorithm (two-dimensional constraint solving,
  not width-in/height-out), it has no answer for scrolling, and its C++20
  requirement is an unverified toolchain risk on the Arduino/Xtensa
  compiler specifically. If it's ever added, it's a second, sibling
  layout-phase implementation behind the same `Element → Frame` contract,
  not a fork of mjsx-core.

## Docs and examples

- [docs/README.md](docs/README.md) — **the documentation index**: every
  page grouped by what you are trying to do, with a picture of each area
- [docs/getting-started.md](docs/getting-started.md) — clone to a UI on
  real glass
- [examples/README.md](examples/README.md) — the example gallery

The index carries the per-page breakdown, so it is the one link to follow
rather than a second list here that drifts out of date.

## Project status

A hobby project, open-sourced as-is. Not on npm yet (`"private": true` is
deliberate); pin to the repo if you use it. MIT licensed. Contributions
welcome — see [CONTRIBUTING.md](CONTRIBUTING.md).
