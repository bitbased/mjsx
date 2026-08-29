# Cross-backend consistency audit

What each backend in this tree *actually* implements, measured against
`docs/contract.md` and against what `packages/core/src/mjsx.js` actually
calls. Every cell below was read out of the named source file (or run);
nothing here is inferred from a comment.

Audited against the working tree on top of commit `96bc60e`. The tree
moved during the audit — other work landed in `backends/terminal`,
`backends/http`, `backends/sdl/src/sim.js`, `packages/cli` and `test/`
while it was in progress — so every finding below was **re-checked against
the current files** before being written down, and the two that were
partly fixed underneath it say so. `bun test` is green (189 pass / 1 skip
across 6 files as of this writing; the suite grew during and after the
audit); none of the divergences below are caught by it except where noted.

## What the core actually asks for

Counted from `packages/core/src/mjsx.js`:

| Symbol | Call sites | Notes |
|---|---|---|
| `gfx.height` | 16 | |
| `gfx.width` | 13 | |
| `gfx.frect` | 11 | includes the no-`poly` scanline fallback (l.422, l.428) |
| `gfx.poly` | 7 | 4 are `if (gfx.poly)` presence checks |
| `gfx.line` | 7 | |
| `gfx.text` | 5 | |
| `gfx.rect` | 5 | |
| `gfx.circle` | 4 | |
| `gfx.clip` | 3 | l.262, l.267 (`pushClip`/`popClip`) |
| `gfx.blit` | 3 | all inside the `canvas` node, guarded by `typeof` (l.304) |
| `gfx.unclip` | 2 | |
| `gfx.clear` | 2 | |
| `sys.millis` | 21 | |
| `sys.store` / `sys.fetch` | 3 / 3 | only via `configStorage` (l.2260–2287) |

The core calls **nothing else**. `sys.beep`, `sys.tone`, `sys.exit` are
never invoked by the core on any path — confirmed by grep over the whole
file. They exist for apps.

## The gfx surface

The surfaces audited. "esp32 (tree)" is
`backends/esp32/engine/native_api.c` + `glue.c` +
`firmware/hello-mjsx/hello-mjsx.ino`, the only ESP32 target whose
implementation is in this repo. "esp32 (shim)" is that native surface as
re-wrapped by `backends/esp32/tools/device-shim.js` for the out-of-tree
filament-rfid firmware.

Throughout this page, **yes** means present and behaving as the contract
describes, **no** means absent, and **partial** means present but not
equivalent.

### The eight drawing calls

`clear`, `rect`, `frect`, `circle`, `line`, `text`, `clip` and `unclip` are
present and behave as the contract describes on **every surface listed
above**. That is stated once rather than as seventy-two cells saying "yes".

What varies is *how* each surface realises them — and that is a property of
the surface, not of the call, so it is one row each:

| Surface | Realised as |
|---|---|
| `pure-js` | its own scanline rasterizer — the reference implementation |
| `glass` | the same rasterizer, used as a pixel twin behind another backend |
| `terminal` | half-block cells |
| `http/server` | delegates to `pure-js` |
| `http/mirror` recorder | forwards to the real `gfx` and records the op |
| `sdl` | delegates to `pure-js`, then blits the buffer to the window |
| `wasm` | calls into `mjsxGfx`, the host object MicroQuickJS sees |
| `esp32` (tree) | `Serial.printf` — `hello-mjsx` logs the calls; it is a bring-up sketch, not a display driver |
| `esp32` (shim) | forwards to `__NGFX` |

### What `width` and `height` report

Both are present everywhere. Only the answer differs:

| Surface | Reports |
|---|---|
| `pure-js`, `glass` | the **logical** size, not the buffer's — the two differ at `dpr > 1` |
| `terminal` | width from `cols/xSub`; height in **sub-pixel rows**, which is *not* `backend.height` |
| `wasm` | 240 × 280 defaults |
| `esp32` (tree) | **hard-coded** 240 × 280 |
| `http/server`, `sdl` | the panel's own size (via `pure-js`) |
| `http/mirror`, `esp32` (shim) | whatever the wrapped surface says |

### `poly` and `blit` — the two that actually diverge

These are the only rows of the old matrix that carried information:

| Surface | `poly` | `blit` |
|---|---|---|
| `pure-js`, `glass`, `http/server`, `sdl` | yes | no |
| `http/mirror` recorder | only if the real `gfx` has it | no — **dropped** |
| `terminal`, `wasm`, `esp32` (tree) | **no** | no |
| `esp32` (shim) | partial — **packed string**, else a JS fallback | partial — conditional passthrough |

Where `poly` is absent the core falls back to scanline `frect`
(`mjsx.js` l.422, l.428), which is why its four call sites are guarded by
`if (gfx.poly)`.

Verified by enumerating the live objects (`typeof … === 'function'` over
each constructed `gfx`), not by reading declarations:

```
pure-js   gfx: circle,clear,clip,frect,height,line,poly,rect,text,unclip,width
glass     gfx: circle,clear,clip,frect,height,line,poly,rect,text,unclip,width
terminal  gfx: circle,clear,clip,frect,height,line,rect,text,unclip,width
recorder  gfx: circle,clear,clip,frect,height,line,poly,rect,text,unclip,width   (blit: undefined)
```

**No backend in this repo implements `blit`.** Every in-tree host draws
the `canvas` node's crossed placeholder (`mjsx.js` l.307–309). The only
real `blit` is assumed by `device-shim.js` l.133
(`__NGFX.blit ? … : undefined`) against firmware that is not in this tree.

## The sys surface

**`glass` has no `sys` at all.** `createGlassBackend` returns
`{ gfx, raw, w, h }` — no `sys` key (`backends/pure-js/src/backend.js`
l.904). It is only ever used as a pixel twin behind another backend's
`sys`, but nothing in the code says so and nothing stops a caller wiring it
as a whole backend, where the first `sys.millis()` throws. Everything below
is about the surfaces that do have one.

### Time and storage

| Surface | `millis` | `store` / `fetch` |
|---|---|---|
| `pure-js` | `Date.now() - start` | in-memory `storeMap` |
| `terminal` | `Date.now() - start` | in-memory (fixed mid-audit) |
| `sdl`, `http` | via `pure-js` | via `pure-js` |
| `wasm` | `emscripten_get_now()` | `localStorage`, **unprefixed** |
| `esp32` (tree) | `(long)millis()` — **32-bit, wraps at ~49.7 days** | partial: `store` is a **no-op stub**, `fetch` **always returns `''`**, 1024-byte cap |

Two things follow. Storage is **per-process and forgotten on exit** on
every JS host — nothing here writes to disk, so a `configStorage` value set
in one run is gone in the next. And on `wasm` the keys are unprefixed, so
two mjsx pages served from the same origin share one namespace and will
overwrite each other.

### Sound and exit

`beep`, `tone` and `exit` are **no-ops on every surface in this tree**,
with exactly one exception: `terminal`'s `beep` writes BEL (`\x07`). They
exist for apps; the core never calls any of them.

## FONT metrics wiring (per entry point, not per backend)

This is the biggest live divergence. The backend and the core must agree
on advance/line height; four entry points sync them and two do not.

| Entry point | sets `FONT.advance/lineH` | sets `FONT.pick` | sets `FONT.quantum` | sets `UI.scrollQuantum` |
|---|---|---|---|---|
| `backends/terminal/src/run.js` | yes | yes | yes | yes |
| `backends/terminal/src/interactive.js` | yes | yes | yes | yes |
| `backends/terminal/src/launcher.js` | yes | yes | yes | yes |
| `backends/sdl/src/run.js` | yes | yes | — (default 1) | — (default 1) |
| `backends/sdl/src/sim.js` (`freshCore`, `rebuild`) | yes | yes | — | — |
| `backends/pure-js/src/run.js` | no | no | no | no |
| `backends/http/src/server.js` | no | no | no | no |
| `test/load.js` (`fresh`) | no | no | no | no |
| `backends/wasm/glue.c` | no (host's job; no in-tree host) | no | no | no |
| `backends/esp32/**` | no (firmware font is 5x7-class) | no | no | no |

The gap, measured:

```
backend.font            = {advance: 5, lineH: 8, pick: true}
core.FONT after run.js  = {advance: 6, lineH: 8, pick: false}

pickFont(1) -> 4x6  x1  advance  5  lineH  8   vs core default advance  6  lineH  8
pickFont(2) -> 6x8  x1  advance  7  lineH 10   vs core default advance 12  lineH 16
pickFont(3) -> 12x16 x1 advance 13  lineH 18   vs core default advance 18  lineH 24
pickFont(4) -> 16x24 x1 advance 17  lineH 26   vs core default advance 24  lineH 32
```

The visible consequence, measured by rendering `h('text', {text:'HELLO',
size:2, align:'center'})` on a 240-wide surface and taking the ink extent:

```
FONT left at core default (pure-js run.js, http server.js): ink 90..122, mid 106.0
FONT synced to backend    (sdl run.js, terminal)          : ink 102..134, mid 118.0
panel centre                                              : 119.5
```

Centred size-2 text lands **13.5px left of centre** under the unsynced
runners and 1.5px left under the synced ones. `align:'right'` is off by
the same amount in the other direction, and `fitText` truncates far later
than the glyphs need. The committed golden hashes
(`test/golden/hashes.json`) were seeded through the unsynced path, so
they encode the mismatch.

## Divergences, ranked

### D1 — `sys.store`/`sys.fetch` stubs defeat the fallback chain, silently

**Severity: High** (was Critical; the terminal half was fixed mid-audit).

`configStorage` (`mjsx.js` l.2263, l.2277) binds on
`typeof sys.fetch === 'function'`, so a *present but stubbed* pair
short-circuits the `localStorage` and `_mem` fallbacks the contract
promises. Every `configStorage.set` is dropped and every `get` returns
its default — including within a single session, which reads as an app
bug rather than a missing native.

**Terminal: now fixed.** `terminal/src/backend.js` used to ship
`store: function () {}, fetch: function () { return ''; }`; it now keeps a
session `storeMap`. Re-measured on the current tree:

```
terminal: after set('round','1'), get = "1"   isRound() = true
terminal: typeof sys.store/fetch = function function
terminal: typeof localStorage = undefined
```

**Still open on the device.**
`backends/esp32/firmware/hello-mjsx/hello-mjsx.ino` l.49–50 are unchanged:

```c
void sysNStore(const char *k, int klen, const char *v, int vlen) { (void)k; … }
int  sysNFetch(const char *k, int klen, char *out, int cap) { … out[0] = 0; return 0; }
```

Those are bound into the stdlib by `native_api.c`, so on that firmware
`configStorage` is a black hole and `UI.isRound()` can never be true —
on the one host class where round glass actually exists.

*Remedy: back the sketch's `sysNStore`/`sysNFetch` with NVS (`Preferences`),
or drop the two entries from the `js_sys[]` table for a storage-less build
so `configStorage` falls through to `_mem` as designed.*

### D2 — pure-js and http runners leave `FONT` at the linear default

**Severity: High.** `backends/pure-js/src/run.js` and
`backends/http/src/server.js` never copy `backend.font` onto `core.FONT`,
while their backend rasterizes through the `pickFont` ladder. Layout
reserves 12px/char at size 2; the glyph is 7px. Measurements above.
`scripts/render-examples.mjs` drives `run.js`, so the whole committed
gallery (`out/gallery/*.png`) is rendered with mis-centred text.
`test/load.js` inherits the same gap, so the tests cannot see it — and
the golden matrix that grew during this audit (45 hashes across three
shapes, `test/golden/matrix.js`) is seeded through that same unsynced
loader, which locks the mismatch in.

*Remedy: add the `core.FONT.advance/lineH/pick = backend.font.*` lines
that `backends/sdl/src/run.js` l.68–70 already has to
`backends/pure-js/src/run.js`, `backends/http/src/server.js` and
`test/load.js`, then reseed with `bun test/golden/regen.mjs` and re-render
the gallery. Do it in one change: the goldens move, and a reseed that
also carries an unrelated pixel change is unreviewable.*

### D3 — `configStorage` is not a global on most JS runners

**Severity: High** (the three terminal runners were fixed mid-audit; five
entry points remain).

`mjsx.js` exports `configStorage` from `module.exports` (l.2296), and
under MicroQuickJS's flat eval it is a plain global. A runner that wires
`h, UI, Button, Swatch, em, Modal, Keyboard` onto `globalThis` and omits
`configStorage` turns device-authored code that names it bare into a
crash:

```
var v = configStorage.get('x','dflt');
ReferenceError: configStorage is not defined
```

Current state (`grep -c globalThis.configStorage`):

| Runner | wires it |
|---|---|
| `backends/terminal/src/run.js` | yes (added mid-audit) |
| `backends/terminal/src/interactive.js` | yes (added mid-audit) |
| `backends/terminal/src/launcher.js` | yes (added mid-audit) |
| `backends/pure-js/src/run.js` | no |
| `backends/http/src/server.js` | no |
| `backends/sdl/src/run.js` | no |
| `backends/sdl/src/sim.js` | no |
| `test/load.js` | no |

`examples/camera/app.jsx` l.21 names it bare; it survives today only
because the reference sits inside `if (HAVE_CAM)`, which is false
wherever `sys.mods` is absent. The sim is the host most likely to be
handed a device app, and it is on the `no` list. `docs/ui.md` documents
`configStorage` with no host caveat.

*Remedy: add `globalThis.configStorage = core.configStorage;` to the
remaining four runners (in `sim.js` it belongs in `freshCore()`, beside
the other seven) and to `test/load.js`.*

### D4 — the sim's round-glass mask never reaches `UI.isRound()`

**Severity: High.** `backends/sdl/src/sim.js` `--circle` / the `SHAPE:CIR`
toolbar button set a *window mask* (`window.js` l.193) and nothing else;
`backends/sdl/src/run.js --circle` likewise. Nothing anywhere in
`backends/` calls `configStorage.set('round', …)` — grep confirms zero
hits. So the sim shows round glass while `UI.isRound()` returns false, and
every round adaptation the core has (quarter-screen overscroll,
`mjsx.js` l.755; the round layout branch at l.896;
`examples/draw/app.jsx` l.156; `device-menu.js` l.53) stays off in the
one place built to preview it.

The mechanism itself works and is now exercised: `test/golden/matrix.js`
l.89 seeds `t.backend.sys.store('round', '1')` before requiring the
example, and comments it as "what a firmware seeds". So the golden matrix
covers round layouts while the *interactive* previewer cannot show them.

*Remedy: in `sim.js`'s `freshCore()` and in `sdl/run.js`, call
`core.configStorage.set('round', mask === 'circle' ? '1' : '0')` before
mounting — and, since `isRound()` caches, clear `UI._round` in
`rebuild()` so the SHAPE button re-reads it.*

### D5 — `gfx.poly`'s device signature is not the documented one

**Severity: Medium.** The contract documents
`gfx.poly(polys, color, rule)` with `polys` a list of `{x, y}` point
lists. The core calls it that way (`mjsx.js` l.389). But
`device-shim.js` l.175–179 calls the native as
`__NGFX.poly(polys.__pk, c, rule)` — `__pk` is a base-127 **packed
string** built at l.153–167. So a firmware's native `poly` takes a
string; a JS backend's takes arrays. Two incompatible things share one
name, and the contract documents only one of them.

*Remedy: name the native op distinctly (e.g. `gfx.polyPacked`) or state
the packed-string encoding in `docs/contract.md` as the native-side
variant; the shim is the only translator and nothing declares that.*

### D6 — the mirror recorder drops `blit`

**Severity: Medium.** `http/src/mirror.js` `createRecorder` (l.26–41)
wraps ten calls plus `poly`, and has no `blit` entry — so a recorder
placed over a backend that *does* have `blit` produces a `gfx` where
`typeof gfx.blit === 'function'` is false, and the core silently falls
back to the crossed placeholder. Harmless today (nothing in-tree has
`blit`), a silent regression the day the sim gains one. The recorder is
installed as the global `gfx` whenever `sim.js --http` is used
(l.198–202).

*Remedy: mirror `poly`'s pattern — `blit: real.blit ? function (...) {…}
: undefined` — and add a `['b', …]` op the mirror page can ignore.*

### D7 — `terminal` char mode draws all text at size 1

**Severity: Medium.** In `mode: 'char'`, `backend.js` l.127 records
`{x, y, size, color, str}` but `toAnsi` (l.199–233) never reads `t.size`:
every string is stamped one cell per character on one row. `run.js`
correspondingly sets `FONT.advance = 1, lineH = 1` — but `fadv(size)` is
`FONT.advance * size`, so a size-2 label is *laid out* two cells per
character and two rows tall and *drawn* one and one. Layout and ink
disagree by exactly the size multiplier.

*Remedy: either scale the char-mode stamp (repeat/space the glyphs) or set
`FONT.pick = function () { return {advance: 1, lineH: 1}; }` in char mode
so layout stops scaling with size.*

### D8 — pointer/key delivery differs sharply per entry point

**Severity: Medium.** Nothing is wrong per host, but "the same app" gets
materially different input depending on where it runs:

Two entry points take **no input at all** — `pure-js/run.js` renders once
(plus an optional `demo()`) and `terminal/run.js` is render-only, sweeping
with `--frames=N`. They are omitted from both tables below.

**Pointer:**

| Entry point | press / drag / release | multi-touch | wheel → `scrollBy` |
|---|---|---|---|
| `terminal/interactive.js` | partial — **press+release only** (l.139–140), no drag | no — id `0` | no |
| `terminal/launcher.js` | yes — SGR mouse 0/1/2 (l.218–219) | no — one `'mouse'` | yes (l.213) |
| `http/server.js` | yes | yes — real `touch.identifier` | **no wheel handler at all** |
| `http/mirror.js` (sim `--http`) | yes | yes | yes (l.218, l.283) |
| `sdl/run.js` | yes | no — one `'mouse'` | yes (l.84) |
| `sdl/sim.js` | yes | no in-window; yes via `web:` ids | yes |
| `esp32` (shim) | yes — 3-arg → id `0` adapter (l.22–25) | no — single contact | — |

**Keys:**

| Entry point | key down / press / up | composed text (shift, IME) |
|---|---|---|
| `terminal/interactive.js` | yes — all three per byte | no — raw bytes |
| `terminal/launcher.js` | yes | no — raw bytes |
| `http/server.js` | yes, + hidden OSK | yes — `beforeinput` |
| `http/mirror.js` | yes, + OSK | yes |
| `sdl/run.js` | yes | no — **`'text'` event ignored** |
| `sdl/sim.js` | yes | yes (l.434–438) |
| `esp32` (shim) | yes — via `___key` patch | — |

Two concrete gaps: `sdl/run.js` receives SDL `TEXTINPUT` from
`window.js` l.315 and never handles it, so no capital letter or symbol can
be typed into a focused input there (`sim.js` does handle it);
`http/server.js` has no `wheel` listener and no `wheel` branch in its
websocket handler, so scroll zones are drag-only in that backend while
its sibling `mirror.js` supports it.

*Remedy: copy `sim.js`'s `'text'` branch into `sdl/run.js`; copy
`mirror.js`'s wheel listener + `msg.t === 'wheel'` branch into
`http/server.js`.*

### D9 — colour depth is converted three different ways, one undocumented

**Severity: Low.** The contract says "24-bit `0xRRGGBB` everywhere; the
backend converts to its own depth (5-6-5 on the panels, RGB bytes in the
pure-js buffer)". Actually realized:

- pure-js: `toRGB` → 8:8:8 bytes (l.79–81).
- glass emulator: **quantises to RGB565 and back** on the AA text/corner
  paths (l.752, l.770–775, l.800, l.820) to match the panel; the plain
  paths inherit the inner pure-js 8:8:8. Two depths in one backend.
- terminal: 24-bit SGR **only when `COLORTERM` matches `truecolor|24bit`**
  (l.151); otherwise everything is quantised to the xterm-256 cube
  (`to256`, l.152–159). Terminal.app therefore renders a different palette
  from iTerm2. Not mentioned in the contract.
- wasm/esp32: passed through as `unsigned` to the host.

*Remedy: state the 256-colour path in `docs/contract.md` (done — see
Colours) so a backend author knows exact-colour comparison is not portable.*

### D10 — `mjsxRenderTick` returns eval success, not dirtiness

**Severity: Low.** `backends/wasm/glue.c` l.191–197: the comment says
"Returns whether the ticker reported dirty" and the body is
`return mjsxEval("if (UI.ticker()) UI.render();")`, which returns
`!JS_IsException(v)` — i.e. 1 on every successful tick, dirty or not. A
host throttling on the return value never throttles.

*Remedy: eval `"UI.ticker()"` and marshal its boolean, or rename the
export and fix the comment.*

### D11 — the wasm backend has no in-tree pixel host

**Severity: Low.** `glue.c` routes every `gfx` call to
`globalThis.mjsxGfx` and no-ops when it is absent (l.82–98); `gfxNW`/
`gfxNH` then answer 240×280. Nothing in this repo defines `mjsxGfx` —
grep finds it only inside `glue.c` and the prebuilt `dist/mjsx.js`. So
the wasm target is an engine-parity harness that draws nothing until an
embedder supplies a surface, which the README implies but the contract
does not.

*Remedy: ship a ten-line `mjsxGfx` shim (canvas or op-log) next to
`dist/`, or say plainly in the wasm README that a host surface is
required.*

### D12 — `sys.store`/`fetch` key namespaces differ between web hosts

**Severity: Low.** `wasm/glue.c` l.104–110 reads and writes
`localStorage` with the **raw key**; the core's own browser fallback
(`mjsx.js` l.2269, l.2282) uses the `mjsx.` prefix. Two web hosts, same
browser, two different storage namespaces for the same `configStorage`
key — a value written by one is invisible to the other.

*Remedy: prefix the wasm glue's keys with `mjsx.` to match the core's
fallback.*

### D13 — `fontMeta()` only covers sizes 1–4

**Severity: Low.** `sdl/src/sim.js` l.206–215 builds the mirror's per-size
metric table for `z = 1..4`. `mirror.js` l.83 and l.182 fall back to
`{adv: 6*size, lh: 10*size}` for anything else — a metric that matches
neither the ladder nor the core's `8*size` line height. Latent: examples
only use sizes 1 and 2.

*Remedy: derive the loop bound from the ops actually sent, or make the
client fallback `FONT.advance*size / FONT.lineH*size`.*

### D14 — `sdl/run.js` copies the framebuffer every frame

**Severity: Low.** `run.js` l.91 is `win.present(backend.px ||
backendPixels())`; the backend exposes its buffer as `raw`, never `px`
(l.662), so the `||` always falls through to `backendPixels()`, which
calls `toPPM()` — a full `Buffer.concat` copy per frame. `sim.js` l.390
reads `backend.raw` in place and says so.

*Remedy: `win.present(backend.raw)`.*

## Things the contract gets right (checked, no action)

- The ten-call list and their argument orders match
  `native_api.c`'s `js_gfx[]` table exactly, and match every JS backend's
  facade.
- `gfx.clip` really is a single rect, not a stack: the core intersects
  nested clips itself at `mjsx.js` l.252–260 and hands the backend one
  honest rect.
- The core really does draw thick lines as parallel 1px `gfx.line` calls
  (l.338) and never rasterizes a glyph itself.
- `sys.beep`/`tone`/`exit` really are app-only — zero core call sites.
- The `poly`-absent scanline fallback exists and is used (l.422–428).
- `radius` really may be 0 / absent: both C glues default `argc > 5 ? … :
  0` (`esp32/glue.c` l.122, `wasm/glue.c` l.123).

## Device-side natives: not verifiable here

`docs/devices.md` and `docs/hardware-api.md` describe firmware living in
the `filament-rfid` repo. That path does not exist on this machine, so
the following are **asserted by docs and by feature-gates in this tree,
not verified**: native `gfx.poly` (packed), native `gfx.blit`,
`sys.gpio`, `sys.i2c`, `sys.mods`, `sys.modCtl`, `sys.canvas`,
`sys.canvasTarget`, `sys.screen`, `sys.backlight`, `sys.sleepAfter`,
`sys.fonts`, `sys.view`, `sys.rotate`. Every example that uses one gates
it (`typeof sys.x === 'function'`) and renders a fallback — that pattern
is consistent across `examples/gpio`, `i2c`, `camera`, `canvas`,
`screen`, `wifi`, `printer`, and it is the right pattern. No in-tree
backend provides any of them.
