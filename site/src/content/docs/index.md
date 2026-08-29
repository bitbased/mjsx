---
title: "mjsx"
description: "JSX for microcontrollers, Raspberry Pi, desktop and the browser."
---
<!-- GENERATED from docs/README.md by scripts/docs-sync.mjs. Edit that file. -->mjsx is a JSX UI engine small enough to run on a microcontroller.
`packages/core/src/mjsx.js` is the whole portable engine — `h()`, layout
(width-in, height-out, no VDOM), hit testing, the pointer state machine,
text input with virtual keyboards, and modals — written in the ES5 subset
MicroQuickJS accepts, so the same file runs unmodified on a chip, in a
terminal, in a browser tab and in a native window. **The contract is ten
`gfx` calls plus `sys.millis()`** — `clear`, `rect`, `frect`, `circle`,
`line`, `text`, `clip`, `unclip`, `width`, `height` — and a backend is
whatever realizes those ten; nothing above that line changes per target.

New here, go to [getting-started.md](/getting-started). Writing a
backend, go to [contract.md](/contract).

## What it looks like

![](/img/ex-hello-lcd35.png)

<a class="run-example" href="/play/#ex=hello&shape=lcd35">▶ Run <code>hello</code> in the simulator</a>

*`examples/hello` on the 3.5" panel — a padded box, a bordered panel,
centred text. Every unit is `em()`, so the same source lays out against
whatever font the host draws with.*

```jsx
<box bg={UI.theme.panel} radius={8} border={UI.theme.accent} borderW={2}
     pad={em(1.5)}>
  <text text="Hello mjsx!" size={2} color={UI.theme.text} align="center" />
</box>
```

![](/img/ex-counter-lcd35.png)

<a class="run-example" href="/play/#ex=counter&shape=lcd35">▶ Run <code>counter</code> in the simulator</a>

*`examples/counter` — the whole state model in one screen: a tap calls
`UI.set`, the frame is marked dirty, and the next render redraws
everything. There is no reconciler to explain.*

```jsx
<Button label="+1" size={2}
        onTap={function () { UI.set({ count: count + 1 }); }} />
```

![](/img/ex-layers-lcd35.png)

<a class="run-example" href="/play/#ex=layers&shape=lcd35">▶ Run <code>layers</code> in the simulator</a>

*`examples/layers` — the layering torture test. Look at what does not
scroll: the header, the `badge` sitting over its right end, the floating
`+0` button, and the footer. The list crops between them, and the footer's
MODAL button raises a panel that takes all input while it is up.*

```jsx
<box flex={1} scroll="main" pad={em(0.75)} gap={em(0.5)}>
  {kids}
</box>
```

![](/img/kb-auto-round128.png)

*The built-in keyboard on round glass. Every row is inset to the chord at
its own height — the trapezoid — so the outer keys stay on the glass, and
`auto` measures the chord where the bottom rows sit (154px across a 240px
circle, not 240) before deciding it can only fit T9.*

```jsx
h(Keyboard, { layout: kb, position: pos, height: Math.floor(gfx.height() / 2.6) })
```

![](/img/ex-draw-lcd35.png)

<a class="run-example" href="/play/#ex=draw&shape=lcd35">▶ Run <code>draw</code> in the simulator</a>

*`examples/draw` on square glass: the tool row and the palette sit in an
ordinary footer across the bottom edge.*

![](/img/ex-draw-round128.png)

<a class="run-example" href="/play/#ex=draw&shape=round128">▶ Run <code>draw</code> in the simulator</a>

*The same file on the round board: when `UI.isRound()` is true the toolbar
moves onto the rim, each item pulled in from the boundary by its own size
and left upright.*

```jsx
{h(ArcFooter, { items: items, spread: 150, inset: 10 })}
```

## Documentation, by what you are trying to do

### Start here

| Page | The question it answers |
|---|---|
| [getting-started.md](/getting-started) | Install, run an example in a window and in the terminal, write a first app, push it to a board. |
| [../examples/README.md](../examples/README.md) | The fourteen shipped examples and what each one demonstrates. Every one is a single flat `app.jsx` with no imports and no build step. |

![](/img/ex-hello-lcd147.png)

<a class="run-example" href="/play/#ex=hello&shape=lcd147">▶ Run <code>hello</code> in the simulator</a>

*The same `examples/hello` source on the 1.47" panel (172x320). Nothing in
the file changed; the layout is measured against the glass it is given.*

### Building a UI

| Page | The question it answers |
|---|---|
| [ui.md](/ui) | The app-author API: `h()` and JSX, every element and its props, `UI.state`/`UI.set`/`UI.memo`, the pointer model, keys and focus, timers, `configStorage`, safe insets. |
| [layout.md](/layout) | How `box`, `row`, flex weights, `abs`, `clip`/`offX` and scroll zones actually place things — width-in, height-out, and where the pixels end up. |
| [fonts.md](/fonts) | Which face draws at which size, what `em()` snaps to, and why text measurement is a shared responsibility between core and backend. |

![](/img/layout-row-lcd35.png)

*`row`: children side by side — an even split, a fixed `w` with the rest
sharing the remainder, and a pinned-height row where boxes stretch and
text centres.*

![](/img/layout-scroll-mid-lcd35.png)

*A scroll zone 220px down its content. Drawing and hit areas both move,
and the offset persists across renders because it lives under the zone's
name in `UI._scroll`.*

![](/img/font-auto-lcd35.png)

*The `auto` font ladder: every text size picks the sharpest native face
that fits it — 4x6 at size 1, 6x8 at size 2, 12x16 at size 3.*

```jsx
<text text={'1EM = ' + em(1) + 'PX'} size={1} align="center" color={UI.theme.muted} />
```

### Components

| Page | The question it answers |
|---|---|
| [components.md](/components) | The ready-made components — `Button`, `input`, `Keyboard`, `ArcFooter` — every prop, and the fact that all of them are built from the same `box`/`row`/`text`/`abs` any app has. |
| [keyboards.md](/keyboards) | The four layouts plus `auto`: how a layout is chosen from the width the keys actually get, shift and the symbol pages, T9 multi-tap, docking versus taking the whole display. |
| [input.md](/input) | The text field: focus and caret, `password`, `maxLen`, overflow, where the keyboard goes, and how the mirrored field in exclusive mode is the same field. |

![](/img/comp-button-lcd35.png)

*`Button`: the default key colour, theme colours passed as `bg`, and a
small button whose `hitPad` grows the touch target past the paint (the
outlined box).*

![](/img/kb-qwerty-lcd35.png)

*A named layout is honoured exactly, however cramped — QWERTY docked on
320px of glass. A stated preference is a decision, not a suggestion.*

![](/img/input-focused-lcd35.png)

*A focused field: accent border, caret at the insertion point,
placeholder gone. The engine owns text, caret and horizontal scroll per
`id`, so the app's render stays a pure description.*

```jsx
<input id={p.id} size={p.size || 2} placeholder={p.placeholder}
       password={p.password} maxLen={p.maxLen}
       label={p.label} exclusive={p.exclusive}
       onSubmit={function (v) { UI.set({ last: p.label + ': ' + v }); }} />
```

### Designing for a device

| Page | The question it answers |
|---|---|
| [devices.md](/devices) | The four-board ESP32-S3 fleet: which flag builds which board, first flash over chunked USB, every flash after that over OTA, WiFi provisioning, and the push → screenshot → tap loop. |
| [Figures and screenshots](/shots) | How every picture here was made, and how to reproduce or re-render one. |
| [round.md](/round) | Round glass: safe insets, the chord a row can actually use, footers that follow the rim, and the extra scroll range at the end of every zone. |
| [shapes.md](/shapes) | One screen on every shape in the fleet, side by side: the same focused `examples/input` on round, portrait, narrow-portrait, landscape and large-landscape glass, with what each shape changed. |

![](/img/round-page-lcd35.png)

*One page on square glass: full-bleed rows, the `ArcFooter` riding the
bottom edge.*

![](/img/round-page-round128.png)

*The identical source on round glass. `UI.safe.inset` holds the rows
inside the chord, the footer follows the rim, and the corners stay empty
because they do not exist.*

```jsx
var round = UI.isRound();
```

### Hardware

| Page | The question it answers |
|---|---|
| [hardware-api.md](/hardware-api) | `sys.gpio(pin, op, value)` and `sys.i2c(addr, reg, value)` on the ESP32 bridge firmware — what each op does, which pins the firmware refuses, and why there is no `sys.uart`. |
| [sensors.md](/sensors) | Reading motion and the rest of the board from a script: what the host offers, how an app checks before calling, and what it shows when the hardware is not there. |

![](/img/ex-gpio-lcd35.png)

<a class="run-example" href="/play/#ex=gpio&shape=lcd35">▶ Run <code>gpio</code> in the simulator</a>

*`examples/gpio` under a backend with no pin natives. The app checks
first and draws its own labelled fallback rather than throwing.*

```js
var HAVE = typeof sys !== 'undefined' && typeof sys.gpio === 'function';
```

![](/img/ex-sensors-lcd35.png)

<a class="run-example" href="/play/#ex=sensors&shape=lcd35">▶ Run <code>sensors</code> in the simulator</a>

*`examples/sensors` — accelerometer, gyro and temperature three ways
(bubble level, rolling trace, raw data). Simulated here, and the app says
so on the screen.*

![](/img/ex-screen-lcd35.png)

<a class="run-example" href="/play/#ex=screen&shape=lcd35">▶ Run <code>screen</code> in the simulator</a>

*`examples/screen` — brightness, render scale, rotation and the sleep
timeout as ordinary state and taps; the natives do the real work, and the
footer says `demo mode - no panel to control here` when they are absent.*

![](/img/ex-wifi-lcd35.png)

<a class="run-example" href="/play/#ex=wifi&shape=lcd35">▶ Run <code>wifi</code> in the simulator</a>

*`examples/wifi` — the native provisioning page's job done by a script,
polling the async `net.*` natives on its tick. Same fallback rule: `demo
mode - no radio here`, with a canned scan list rather than an empty one.*

![](/img/ex-camera-lcd35.png)

<a class="run-example" href="/play/#ex=camera&shape=lcd35">▶ Run <code>camera</code> in the simulator</a>

*`examples/camera` treats the camera as a canvas source, blitted by the
UI. No backend in this tree implements `gfx.blit` ([consistency.md](/consistency)),
so what the shot shows is the checked fallback — `no camera module here`
and a crossed placeholder where the preview would be.*

![](/img/ex-canvas-lcd35.png)

<a class="run-example" href="/play/#ex=canvas&shape=lcd35">▶ Run <code>canvas</code> in the simulator</a>

*`examples/canvas` — `examples/draw` restructured around `sys.canvas`, so
a hundred committed strokes cost one blit instead of a hundred ops. The
palette and CLEAR/DIRECT row is the whole chrome; the field above it is
the canvas, empty until something is drawn on it.*

### Reference

| Page | The question it answers |
|---|---|
| [contract.md](/contract) | The ten `gfx` calls and `sys.millis()` in full, the optional natives (`poly`, `blit`, `store`/`fetch`, font metrics), the host-declared `round` key, and how a backend drives the loop. |
| [consistency.md](/consistency) | What each backend in this tree *actually* implements, measured against the contract — a call-by-call matrix and fourteen ranked divergences, each read out of the named source file. |

![](/img/ex-shapes-lcd35.png)

<a class="run-example" href="/play/#ex=shapes&shape=lcd35">▶ Run <code>shapes</code> in the simulator</a>

*`examples/shapes` — SVG-style filled paths under the even-odd rule.
`gfx.poly` is optional: a backend that has it rasterizes at device
resolution, and the core scanline-fills through `frect` when it does not.*

![](/img/comp-swatch-lcd35.png)

*`UI.theme` — the colours every built-in component reads: eight named
swatches, and `bg`, the ninth, is the black they are drawn on. Colours
are 24-bit `0xRRGGBB` throughout the API and each backend converts to its
own depth, so an app must not compare exact colours across backends.*

```js
theme: {
  bg: 0x000000, panel: 0x1b1e24, text: 0xffffff, muted: 0x98a1ae,
  accent: 0x4b8bf5, ok: 0x4ade80, warn: 0xfbbf24, err: 0xf87171, key: 0x212530
},
```

### Contributing

| Page | The question it answers |
|---|---|
| [../CONTRIBUTING.md](../CONTRIBUTING.md) | The one hard rule (the core file stays in the MicroQuickJS ES5 subset), how to add an example, and how to add a backend. |

![](/img/ex-hello-round128.png)

<a class="run-example" href="/play/#ex=hello&shape=round128">▶ Run <code>hello</code> in the simulator</a>

*Adding an example is a directory under `examples/` with an `app.jsx` in
it — and then every backend renders it unchanged. This is `examples/hello`
on the round board: nothing in the file knows, which is why the panel's
top corners cross the rim.*

```
bun backends/pure-js/src/run.js examples/yours/app.jsx out/yours.ppm
bun backends/terminal/src/run.js examples/yours/app.jsx
```

## By device

The fleet is four Waveshare ESP32-S3 touch-LCD boards, selected at build
time (`docs/devices.md`). Below is `examples/layers` — the same source,
no per-board branches — on each of them, plus a desktop window.

| Flag | Board | Panel | Touch |
|---|---|---|---|
| (default) | ESP32-S3-Touch-LCD-1.69 | 240x280 ST7789V2 | CST816T |
| `--b35` | ESP32-S3-Touch-LCD-3.5 | 320x480 ST7796 | FT6336 |
| `--b147` | ESP32-S3-Touch-LCD-1.47 | 172x320 JD9853 | AXS5106L |
| `--b128` | ESP32-S3-Touch-LCD-1.28 (round) | 240x240 GC9A01 | CST816S |

![](/img/ex-layers-lcd169.png)

<a class="run-example" href="/play/#ex=layers">▶ Run <code>layers</code> in the simulator</a>

*The 1.69" board's panel, shown landscape at 280x240. Seven rows fit
between the header and the footer, and the wrapped paragraph settles on
two lines.*

![](/img/ex-layers-lcd35.png)

<a class="run-example" href="/play/#ex=layers&shape=lcd35">▶ Run <code>layers</code> in the simulator</a>

*The 3.5" board, 320x480 — the roomy one. Fourteen rows fit and the list
still runs out before the viewport does; the wrapped paragraph needs two
lines. 320px is comfortably past the 220px where the keyboard's `auto`
switches to QWERTY.*

![](/img/ex-layers-lcd147.png)

<a class="run-example" href="/play/#ex=layers&shape=lcd147">▶ Run <code>layers</code> in the simulator</a>

*The 1.47" board, 172x320 — the narrow one. Same rows, same strings: the
wrapped paragraph now needs three lines, and the badge crowds the header
line into a truncation. Ten keyboard columns do not fit here at any
height, and a docked keyboard's keys would land under 30px, so text entry
takes the whole display instead.*

![](/img/ex-layers-round128.png)

<a class="run-example" href="/play/#ex=layers&shape=round128">▶ Run <code>layers</code> in the simulator</a>

*The round 1.28" board, 240x240 — and the useful failure. `examples/layers`
is a square-glass app and does not ask; the rows stay full-bleed
rectangles, so the ends of the header and the corners of every row fall
past the rim. Round glass is a host-declared fact the layout has to read
(`UI.isRound()`) — the same page written to ask is the round-page pair
under "Designing for a device" above, and [round.md](/round) is how.*

![](/img/ex-layers-wide.png)

<a class="run-example" href="/play/#ex=layers">▶ Run <code>layers</code> in the simulator</a>

*And the same file again in a 480x320 desktop window, where development
actually happens.*

The round board is also the constrained one — 2MB quad PSRAM, a 1MB JS
heap cap, and a CH343 UART bridge that needs chunked serial writes. Each
of those cost real debugging, and [devices.md](/devices) records why.
