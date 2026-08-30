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

<div class="shapes">
  <input type="radio" name="sw-ex-hello-0" id="sw-ex-hello-0-0">
  <label for="sw-ex-hello-0-0">
    <img src="/img/ex-hello-round128.png" alt="">
    round<br>240×240
  </label>
  <input type="radio" name="sw-ex-hello-0" id="sw-ex-hello-0-1">
  <label for="sw-ex-hello-0-1">
    <img src="/img/ex-hello-lcd147.png" alt="">
    portrait<br>172×320
  </label>
  <input type="radio" name="sw-ex-hello-0" id="sw-ex-hello-0-2">
  <label for="sw-ex-hello-0-2">
    <img src="/img/ex-hello-lcd169p.png" alt="">
    portrait<br>240×280
  </label>
  <input type="radio" name="sw-ex-hello-0" id="sw-ex-hello-0-3" checked>
  <label for="sw-ex-hello-0-3">
    <img src="/img/ex-hello-lcd35.png" alt="">
    portrait<br>320×480
  </label>
  <div class="shape-panels">
    <figure>
      <img src="/img/ex-hello-round128.png" alt="examples/hello — The smallest real mjsx app: a panel, a border, some centred text.">
      <figcaption><strong>Round, 240×240.</strong> examples/hello — The smallest real mjsx app: a panel, a border, some centred text. <a class="run-example" href="/play/#ex=hello&amp;shape=round128">▶ Run it</a></figcaption>
    </figure>
    <figure>
      <img src="/img/ex-hello-lcd147.png" alt="examples/hello — The smallest real mjsx app: a panel, a border, some centred text.">
      <figcaption><strong>Portrait, 172×320.</strong> examples/hello — The smallest real mjsx app: a panel, a border, some centred text. <a class="run-example" href="/play/#ex=hello&amp;shape=lcd147">▶ Run it</a></figcaption>
    </figure>
    <figure>
      <img src="/img/ex-hello-lcd169p.png" alt="examples/hello — The smallest real mjsx app: a panel, a border, some centred text.">
      <figcaption><strong>Portrait, 240×280.</strong> examples/hello — The smallest real mjsx app: a panel, a border, some centred text. <a class="run-example" href="/play/#ex=hello&amp;shape=lcd169p">▶ Run it</a></figcaption>
    </figure>
    <figure>
      <img src="/img/ex-hello-lcd35.png" alt="examples/hello — The smallest real mjsx app: a panel, a border, some centred text.">
      <figcaption><strong>Portrait, 320×480.</strong> examples/hello — The smallest real mjsx app: a panel, a border, some centred text. <a class="run-example" href="/play/#ex=hello&amp;shape=lcd35">▶ Run it</a></figcaption>
    </figure>
  </div>
</div>

```jsx
<box bg={UI.theme.panel} radius={8} border={UI.theme.accent} borderW={2}
     pad={em(1.5)}>
  <text text="Hello mjsx!" size={2} color={UI.theme.text} align="center" />
</box>
```

<div class="shapes">
  <input type="radio" name="sw-ex-counter-1" id="sw-ex-counter-1-0">
  <label for="sw-ex-counter-1-0">
    <img src="/img/ex-counter-round128.png" alt="">
    round<br>240×240
  </label>
  <input type="radio" name="sw-ex-counter-1" id="sw-ex-counter-1-1">
  <label for="sw-ex-counter-1-1">
    <img src="/img/ex-counter-lcd147.png" alt="">
    portrait<br>172×320
  </label>
  <input type="radio" name="sw-ex-counter-1" id="sw-ex-counter-1-2" checked>
  <label for="sw-ex-counter-1-2">
    <img src="/img/ex-counter-lcd35.png" alt="">
    portrait<br>320×480
  </label>
  <div class="shape-panels">
    <figure>
      <img src="/img/ex-counter-round128.png" alt="examples/counter — A stateful example: tap the button, the count changes, the screen redraws to match.">
      <figcaption><strong>Round, 240×240.</strong> examples/counter — A stateful example: tap the button, the count changes, the screen redraws to match. <a class="run-example" href="/play/#ex=counter&amp;shape=round128">▶ Run it</a></figcaption>
    </figure>
    <figure>
      <img src="/img/ex-counter-lcd147.png" alt="examples/counter — A stateful example: tap the button, the count changes, the screen redraws to match.">
      <figcaption><strong>Portrait, 172×320.</strong> examples/counter — A stateful example: tap the button, the count changes, the screen redraws to match. <a class="run-example" href="/play/#ex=counter&amp;shape=lcd147">▶ Run it</a></figcaption>
    </figure>
    <figure>
      <img src="/img/ex-counter-lcd35.png" alt="examples/counter — A stateful example: tap the button, the count changes, the screen redraws to match.">
      <figcaption><strong>Portrait, 320×480.</strong> examples/counter — A stateful example: tap the button, the count changes, the screen redraws to match. <a class="run-example" href="/play/#ex=counter&amp;shape=lcd35">▶ Run it</a></figcaption>
    </figure>
  </div>
</div>

```jsx
<Button label="+1" size={2}
        onTap={function () { UI.set({ count: count + 1 }); }} />
```

<div class="shapes">
  <input type="radio" name="sw-ex-layers-2" id="sw-ex-layers-2-0">
  <label for="sw-ex-layers-2-0">
    <img src="/img/ex-layers-round128.png" alt="">
    round<br>240×240
  </label>
  <input type="radio" name="sw-ex-layers-2" id="sw-ex-layers-2-1">
  <label for="sw-ex-layers-2-1">
    <img src="/img/ex-layers-lcd147.png" alt="">
    portrait<br>172×320
  </label>
  <input type="radio" name="sw-ex-layers-2" id="sw-ex-layers-2-2">
  <label for="sw-ex-layers-2-2">
    <img src="/img/ex-layers-lcd169.png" alt="">
    landscape<br>280×240
  </label>
  <input type="radio" name="sw-ex-layers-2" id="sw-ex-layers-2-3" checked>
  <label for="sw-ex-layers-2-3">
    <img src="/img/ex-layers-lcd35.png" alt="">
    portrait<br>320×480
  </label>
  <input type="radio" name="sw-ex-layers-2" id="sw-ex-layers-2-4">
  <label for="sw-ex-layers-2-4">
    <img src="/img/ex-layers-wide.png" alt="">
    landscape<br>480×320
  </label>
  <div class="shape-panels">
    <figure>
      <img src="/img/ex-layers-round128.png" alt="examples/layers — Layering / scrolling / cropping torture test.">
      <figcaption><strong>Round, 240×240.</strong> examples/layers — Layering / scrolling / cropping torture test. <a class="run-example" href="/play/#ex=layers&amp;shape=round128">▶ Run it</a></figcaption>
    </figure>
    <figure>
      <img src="/img/ex-layers-lcd147.png" alt="examples/layers — Layering / scrolling / cropping torture test.">
      <figcaption><strong>Portrait, 172×320.</strong> examples/layers — Layering / scrolling / cropping torture test. <a class="run-example" href="/play/#ex=layers&amp;shape=lcd147">▶ Run it</a></figcaption>
    </figure>
    <figure>
      <img src="/img/ex-layers-lcd169.png" alt="examples/layers — Layering / scrolling / cropping torture test.">
      <figcaption><strong>Landscape, 280×240.</strong> examples/layers — Layering / scrolling / cropping torture test. <a class="run-example" href="/play/#ex=layers">▶ Run it</a></figcaption>
    </figure>
    <figure>
      <img src="/img/ex-layers-lcd35.png" alt="examples/layers — Layering / scrolling / cropping torture test.">
      <figcaption><strong>Portrait, 320×480.</strong> examples/layers — Layering / scrolling / cropping torture test. <a class="run-example" href="/play/#ex=layers&amp;shape=lcd35">▶ Run it</a></figcaption>
    </figure>
    <figure>
      <img src="/img/ex-layers-wide.png" alt="examples/layers — Layering / scrolling / cropping torture test.">
      <figcaption><strong>Landscape, 480×320.</strong> examples/layers — Layering / scrolling / cropping torture test. <a class="run-example" href="/play/#ex=layers">▶ Run it</a></figcaption>
    </figure>
  </div>
</div>

```jsx
<box flex={1} scroll="main" pad={em(0.75)} gap={em(0.5)}>
  {kids}
</box>
```

<div class="shapes">
  <input type="radio" name="sw-kb-auto-3" id="sw-kb-auto-3-0" checked>
  <label for="sw-kb-auto-3-0">
    <img src="/img/kb-auto-round128.png" alt="">
    round<br>240×240
  </label>
  <input type="radio" name="sw-kb-auto-3" id="sw-kb-auto-3-1">
  <label for="sw-kb-auto-3-1">
    <img src="/img/kb-auto-lcd147.png" alt="">
    portrait<br>172×320
  </label>
  <input type="radio" name="sw-kb-auto-3" id="sw-kb-auto-3-2">
  <label for="sw-kb-auto-3-2">
    <img src="/img/kb-auto-lcd35.png" alt="">
    portrait<br>320×480
  </label>
  <input type="radio" name="sw-kb-auto-3" id="sw-kb-auto-3-3">
  <label for="sw-kb-auto-3-3">
    <img src="/img/kb-auto-wide.png" alt="">
    landscape<br>480×320
  </label>
  <div class="shape-panels">
    <figure>
      <img src="/img/kb-auto-round128.png" alt="The AUTO layout on round glass: at a quarter-screen height the keys come out under a finger, so the keyboard takes the whole display and insets every row to the chord it actually has — the trapezoid. auto on round glass measures the CHORD where the bottom rows sit (154px across a 240px circle, not 240) and picks T9.">
      <figcaption><strong>Round, 240×240.</strong> The AUTO layout on round glass: at a quarter-screen height the keys come out under a finger, so the keyboard takes the whole display and insets every row to the chord it actually has — the trapezoid. auto on round glass measures the CHORD where the bottom rows sit (154px across a 240px circle, not 240) and picks T9.</figcaption>
    </figure>
    <figure>
      <img src="/img/kb-auto-lcd147.png" alt="The AUTO layout docked at the bottom of lcd147 (172x320), field focused: auto on 172px picks T9: ten columns do not fit, four do.">
      <figcaption><strong>Portrait, 172×320.</strong> The AUTO layout docked at the bottom of lcd147 (172x320), field focused: auto on 172px picks T9: ten columns do not fit, four do.</figcaption>
    </figure>
    <figure>
      <img src="/img/kb-auto-lcd35.png" alt="The AUTO layout docked at the bottom of lcd35 (320x480), field focused: auto on 320px of glass picks QWERTY: ten columns of ~22px fit.">
      <figcaption><strong>Portrait, 320×480.</strong> The AUTO layout docked at the bottom of lcd35 (320x480), field focused: auto on 320px of glass picks QWERTY: ten columns of ~22px fit.</figcaption>
    </figure>
    <figure>
      <img src="/img/kb-auto-wide.png" alt="The AUTO layout on a 480x320 desktop window: auto on 480px picks QWERTY with room to spare.">
      <figcaption><strong>Landscape, 480×320.</strong> The AUTO layout on a 480x320 desktop window: auto on 480px picks QWERTY with room to spare.</figcaption>
    </figure>
  </div>
</div>

```jsx
h(Keyboard, { layout: kb, position: pos, height: Math.floor(gfx.height() / 2.6) })
```

<div class="shapes">
  <input type="radio" name="sw-ex-draw-4" id="sw-ex-draw-4-0">
  <label for="sw-ex-draw-4-0">
    <img src="/img/ex-draw-round128.png" alt="">
    round<br>240×240
  </label>
  <input type="radio" name="sw-ex-draw-4" id="sw-ex-draw-4-1">
  <label for="sw-ex-draw-4-1">
    <img src="/img/ex-draw-lcd147.png" alt="">
    portrait<br>172×320
  </label>
  <input type="radio" name="sw-ex-draw-4" id="sw-ex-draw-4-2" checked>
  <label for="sw-ex-draw-4-2">
    <img src="/img/ex-draw-lcd35.png" alt="">
    portrait<br>320×480
  </label>
  <div class="shape-panels">
    <figure>
      <img src="/img/ex-draw-round128.png" alt="examples/draw — Freehand drawing with tools - the onDraw capture control in action.">
      <figcaption><strong>Round, 240×240.</strong> examples/draw — Freehand drawing with tools - the onDraw capture control in action. <a class="run-example" href="/play/#ex=draw&amp;shape=round128">▶ Run it</a></figcaption>
    </figure>
    <figure>
      <img src="/img/ex-draw-lcd147.png" alt="examples/draw — Freehand drawing with tools - the onDraw capture control in action.">
      <figcaption><strong>Portrait, 172×320.</strong> examples/draw — Freehand drawing with tools - the onDraw capture control in action. <a class="run-example" href="/play/#ex=draw&amp;shape=lcd147">▶ Run it</a></figcaption>
    </figure>
    <figure>
      <img src="/img/ex-draw-lcd35.png" alt="examples/draw — Freehand drawing with tools - the onDraw capture control in action.">
      <figcaption><strong>Portrait, 320×480.</strong> examples/draw — Freehand drawing with tools - the onDraw capture control in action. <a class="run-example" href="/play/#ex=draw&amp;shape=lcd35">▶ Run it</a></figcaption>
    </figure>
  </div>
</div>

<div class="shapes">
  <input type="radio" name="sw-ex-draw-5" id="sw-ex-draw-5-0" checked>
  <label for="sw-ex-draw-5-0">
    <img src="/img/ex-draw-round128.png" alt="">
    round<br>240×240
  </label>
  <input type="radio" name="sw-ex-draw-5" id="sw-ex-draw-5-1">
  <label for="sw-ex-draw-5-1">
    <img src="/img/ex-draw-lcd147.png" alt="">
    portrait<br>172×320
  </label>
  <input type="radio" name="sw-ex-draw-5" id="sw-ex-draw-5-2">
  <label for="sw-ex-draw-5-2">
    <img src="/img/ex-draw-lcd35.png" alt="">
    portrait<br>320×480
  </label>
  <div class="shape-panels">
    <figure>
      <img src="/img/ex-draw-round128.png" alt="examples/draw — Freehand drawing with tools - the onDraw capture control in action.">
      <figcaption><strong>Round, 240×240.</strong> examples/draw — Freehand drawing with tools - the onDraw capture control in action. <a class="run-example" href="/play/#ex=draw&amp;shape=round128">▶ Run it</a></figcaption>
    </figure>
    <figure>
      <img src="/img/ex-draw-lcd147.png" alt="examples/draw — Freehand drawing with tools - the onDraw capture control in action.">
      <figcaption><strong>Portrait, 172×320.</strong> examples/draw — Freehand drawing with tools - the onDraw capture control in action. <a class="run-example" href="/play/#ex=draw&amp;shape=lcd147">▶ Run it</a></figcaption>
    </figure>
    <figure>
      <img src="/img/ex-draw-lcd35.png" alt="examples/draw — Freehand drawing with tools - the onDraw capture control in action.">
      <figcaption><strong>Portrait, 320×480.</strong> examples/draw — Freehand drawing with tools - the onDraw capture control in action. <a class="run-example" href="/play/#ex=draw&amp;shape=lcd35">▶ Run it</a></figcaption>
    </figure>
  </div>
</div>

```jsx
{h(ArcFooter, { items: items, spread: 150, inset: 10 })}
```

## Documentation, by what you are trying to do

### Start here

| Page | The question it answers |
|---|---|
| [getting-started.md](/getting-started) | Install, run an example in a window and in the terminal, write a first app, push it to a board. |
| ../examples/README.md (`examples/README.md` in the repo) | The sixteen shipped examples and what each one demonstrates. Every one is a single flat `app.jsx` with no imports and no build step. |

<div class="shapes">
  <input type="radio" name="sw-ex-hello-6" id="sw-ex-hello-6-0">
  <label for="sw-ex-hello-6-0">
    <img src="/img/ex-hello-round128.png" alt="">
    round<br>240×240
  </label>
  <input type="radio" name="sw-ex-hello-6" id="sw-ex-hello-6-1" checked>
  <label for="sw-ex-hello-6-1">
    <img src="/img/ex-hello-lcd147.png" alt="">
    portrait<br>172×320
  </label>
  <input type="radio" name="sw-ex-hello-6" id="sw-ex-hello-6-2">
  <label for="sw-ex-hello-6-2">
    <img src="/img/ex-hello-lcd169p.png" alt="">
    portrait<br>240×280
  </label>
  <input type="radio" name="sw-ex-hello-6" id="sw-ex-hello-6-3">
  <label for="sw-ex-hello-6-3">
    <img src="/img/ex-hello-lcd35.png" alt="">
    portrait<br>320×480
  </label>
  <div class="shape-panels">
    <figure>
      <img src="/img/ex-hello-round128.png" alt="examples/hello — The smallest real mjsx app: a panel, a border, some centred text.">
      <figcaption><strong>Round, 240×240.</strong> examples/hello — The smallest real mjsx app: a panel, a border, some centred text. <a class="run-example" href="/play/#ex=hello&amp;shape=round128">▶ Run it</a></figcaption>
    </figure>
    <figure>
      <img src="/img/ex-hello-lcd147.png" alt="examples/hello — The smallest real mjsx app: a panel, a border, some centred text.">
      <figcaption><strong>Portrait, 172×320.</strong> examples/hello — The smallest real mjsx app: a panel, a border, some centred text. <a class="run-example" href="/play/#ex=hello&amp;shape=lcd147">▶ Run it</a></figcaption>
    </figure>
    <figure>
      <img src="/img/ex-hello-lcd169p.png" alt="examples/hello — The smallest real mjsx app: a panel, a border, some centred text.">
      <figcaption><strong>Portrait, 240×280.</strong> examples/hello — The smallest real mjsx app: a panel, a border, some centred text. <a class="run-example" href="/play/#ex=hello&amp;shape=lcd169p">▶ Run it</a></figcaption>
    </figure>
    <figure>
      <img src="/img/ex-hello-lcd35.png" alt="examples/hello — The smallest real mjsx app: a panel, a border, some centred text.">
      <figcaption><strong>Portrait, 320×480.</strong> examples/hello — The smallest real mjsx app: a panel, a border, some centred text. <a class="run-example" href="/play/#ex=hello&amp;shape=lcd35">▶ Run it</a></figcaption>
    </figure>
  </div>
</div>

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

<div class="shapes">
  <input type="radio" name="sw-font-auto-7" id="sw-font-auto-7-0">
  <label for="sw-font-auto-7-0">
    <img src="/img/font-auto-round128.png" alt="">
    round<br>240×240
  </label>
  <input type="radio" name="sw-font-auto-7" id="sw-font-auto-7-1" checked>
  <label for="sw-font-auto-7-1">
    <img src="/img/font-auto-lcd35.png" alt="">
    portrait<br>320×480
  </label>
  <div class="shape-panels">
    <figure>
      <img src="/img/font-auto-round128.png" alt="The font page on round glass: em() spacing follows the picked face, so the same source lays out for the smaller panel without a size in it changing.">
      <figcaption><strong>Round, 240×240.</strong> The font page on round glass: em() spacing follows the picked face, so the same source lays out for the smaller panel without a size in it changing.</figcaption>
    </figure>
    <figure>
      <img src="/img/font-auto-lcd35.png" alt="The AUTO ladder (the default): every text size picks the sharpest native font that fits it — 4x6 at size 1, 6x8 at size 2, 12x16 at size 3.">
      <figcaption><strong>Portrait, 320×480.</strong> The AUTO ladder (the default): every text size picks the sharpest native font that fits it — 4x6 at size 1, 6x8 at size 2, 12x16 at size 3.</figcaption>
    </figure>
  </div>
</div>

```jsx
<text text={'1EM = ' + em(1) + 'PX'} size={1} align="center" color={UI.theme.muted} />
```

### Components

| Page | The question it answers |
|---|---|
| [components.md](/components) | The ready-made components — `Button`, `input`, `Keyboard`, `ArcFooter` — every prop, and the fact that all of them are built from the same `box`/`row`/`text`/`abs` any app has. |
| [keyboards.md](/keyboards) | The four layouts plus `auto`: how a layout is chosen from the width the keys actually get, shift and the symbol pages, T9 multi-tap, docking versus taking the whole display. |
| [input.md](/input) | The text field: focus and caret, `password`, `maxLen`, overflow, where the keyboard goes, and how the mirrored field in exclusive mode is the same field. |

<div class="shapes">
  <input type="radio" name="sw-comp-button-8" id="sw-comp-button-8-0">
  <label for="sw-comp-button-8-0">
    <img src="/img/comp-button-round128.png" alt="">
    round<br>240×240
  </label>
  <input type="radio" name="sw-comp-button-8" id="sw-comp-button-8-1" checked>
  <label for="sw-comp-button-8-1">
    <img src="/img/comp-button-lcd35.png" alt="">
    portrait<br>320×480
  </label>
  <div class="shape-panels">
    <figure>
      <img src="/img/comp-button-round128.png" alt="The same button page on round glass.">
      <figcaption><strong>Round, 240×240.</strong> The same button page on round glass.</figcaption>
    </figure>
    <figure>
      <img src="/img/comp-button-lcd35.png" alt="Button: the default key colour, the theme colours passed as bg, and a small button whose hitPad grows the touch target past the paint (the outlined box).">
      <figcaption><strong>Portrait, 320×480.</strong> Button: the default key colour, the theme colours passed as bg, and a small button whose hitPad grows the touch target past the paint (the outlined box).</figcaption>
    </figure>
  </div>
</div>

<div class="shapes">
  <input type="radio" name="sw-kb-qwerty-9" id="sw-kb-qwerty-9-0">
  <label for="sw-kb-qwerty-9-0">
    <img src="/img/kb-qwerty-round128.png" alt="">
    round<br>240×240
  </label>
  <input type="radio" name="sw-kb-qwerty-9" id="sw-kb-qwerty-9-1">
  <label for="sw-kb-qwerty-9-1">
    <img src="/img/kb-qwerty-lcd147.png" alt="">
    portrait<br>172×320
  </label>
  <input type="radio" name="sw-kb-qwerty-9" id="sw-kb-qwerty-9-2" checked>
  <label for="sw-kb-qwerty-9-2">
    <img src="/img/kb-qwerty-lcd35.png" alt="">
    portrait<br>320×480
  </label>
  <input type="radio" name="sw-kb-qwerty-9" id="sw-kb-qwerty-9-3">
  <label for="sw-kb-qwerty-9-3">
    <img src="/img/kb-qwerty-wide.png" alt="">
    landscape<br>480×320
  </label>
  <div class="shape-panels">
    <figure>
      <img src="/img/kb-qwerty-round128.png" alt="The QWERTY layout on round glass: at a quarter-screen height the keys come out under a finger, so the keyboard takes the whole display and insets every row to the chord it actually has — the trapezoid. The arc under the panel carries an OK of its own, so QWERTY shows two.">
      <figcaption><strong>Round, 240×240.</strong> The QWERTY layout on round glass: at a quarter-screen height the keys come out under a finger, so the keyboard takes the whole display and insets every row to the chord it actually has — the trapezoid. The arc under the panel carries an OK of its own, so QWERTY shows two.</figcaption>
    </figure>
    <figure>
      <img src="/img/kb-qwerty-lcd147.png" alt="The QWERTY layout docked at the bottom of lcd147 (172x320), field focused: a named layout is honoured exactly, however cramped.">
      <figcaption><strong>Portrait, 172×320.</strong> The QWERTY layout docked at the bottom of lcd147 (172x320), field focused: a named layout is honoured exactly, however cramped.</figcaption>
    </figure>
    <figure>
      <img src="/img/kb-qwerty-lcd35.png" alt="The QWERTY layout docked at the bottom of lcd35 (320x480), field focused: a named layout is honoured exactly, however cramped.">
      <figcaption><strong>Portrait, 320×480.</strong> The QWERTY layout docked at the bottom of lcd35 (320x480), field focused: a named layout is honoured exactly, however cramped.</figcaption>
    </figure>
    <figure>
      <img src="/img/kb-qwerty-wide.png" alt="The QWERTY layout on a 480x320 desktop window: the width ten columns were drawn for.">
      <figcaption><strong>Landscape, 480×320.</strong> The QWERTY layout on a 480x320 desktop window: the width ten columns were drawn for.</figcaption>
    </figure>
  </div>
</div>

<div class="shapes">
  <input type="radio" name="sw-input-focused-10" id="sw-input-focused-10-0">
  <label for="sw-input-focused-10-0">
    <img src="/img/input-focused-lcd147.png" alt="">
    portrait<br>172×320
  </label>
  <input type="radio" name="sw-input-focused-10" id="sw-input-focused-10-1" checked>
  <label for="sw-input-focused-10-1">
    <img src="/img/input-focused-lcd35.png" alt="">
    portrait<br>320×480
  </label>
  <div class="shape-panels">
    <figure>
      <img src="/img/input-focused-lcd147.png" alt="A focused field on the 172x320 panel — the narrowest glass in the fleet.">
      <figcaption><strong>Portrait, 172×320.</strong> A focused field on the 172x320 panel — the narrowest glass in the fleet.</figcaption>
    </figure>
    <figure>
      <img src="/img/input-focused-lcd35.png" alt="The focused field: accent border, caret at the insertion point, placeholder gone.">
      <figcaption><strong>Portrait, 320×480.</strong> The focused field: accent border, caret at the insertion point, placeholder gone.</figcaption>
    </figure>
  </div>
</div>

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

<div class="shapes">
  <input type="radio" name="sw-round-page-11" id="sw-round-page-11-0">
  <label for="sw-round-page-11-0">
    <img src="/img/round-page-round128.png" alt="">
    round<br>240×240
  </label>
  <input type="radio" name="sw-round-page-11" id="sw-round-page-11-1" checked>
  <label for="sw-round-page-11-1">
    <img src="/img/round-page-lcd35.png" alt="">
    portrait<br>320×480
  </label>
  <div class="shape-panels">
    <figure>
      <img src="/img/round-page-round128.png" alt="The identical source on round glass: UI.safe.inset holds the rows inside the chord, the footer follows the rim, and the corners stay empty because they do not exist.">
      <figcaption><strong>Round, 240×240.</strong> The identical source on round glass: UI.safe.inset holds the rows inside the chord, the footer follows the rim, and the corners stay empty because they do not exist.</figcaption>
    </figure>
    <figure>
      <img src="/img/round-page-lcd35.png" alt="One page, square glass: full-bleed rows, the ArcFooter riding the bottom edge.">
      <figcaption><strong>Portrait, 320×480.</strong> One page, square glass: full-bleed rows, the ArcFooter riding the bottom edge.</figcaption>
    </figure>
  </div>
</div>

<div class="shapes">
  <input type="radio" name="sw-round-page-12" id="sw-round-page-12-0" checked>
  <label for="sw-round-page-12-0">
    <img src="/img/round-page-round128.png" alt="">
    round<br>240×240
  </label>
  <input type="radio" name="sw-round-page-12" id="sw-round-page-12-1">
  <label for="sw-round-page-12-1">
    <img src="/img/round-page-lcd35.png" alt="">
    portrait<br>320×480
  </label>
  <div class="shape-panels">
    <figure>
      <img src="/img/round-page-round128.png" alt="The identical source on round glass: UI.safe.inset holds the rows inside the chord, the footer follows the rim, and the corners stay empty because they do not exist.">
      <figcaption><strong>Round, 240×240.</strong> The identical source on round glass: UI.safe.inset holds the rows inside the chord, the footer follows the rim, and the corners stay empty because they do not exist.</figcaption>
    </figure>
    <figure>
      <img src="/img/round-page-lcd35.png" alt="One page, square glass: full-bleed rows, the ArcFooter riding the bottom edge.">
      <figcaption><strong>Portrait, 320×480.</strong> One page, square glass: full-bleed rows, the ArcFooter riding the bottom edge.</figcaption>
    </figure>
  </div>
</div>

```jsx
var round = UI.isRound();
```

### Hardware

| Page | The question it answers |
|---|---|
| [hardware-api.md](/hardware-api) | `sys.gpio(pin, op, value)` and `sys.i2c(addr, reg, value)` on the ESP32 bridge firmware — what each op does, which pins the firmware refuses, and why there is no `sys.uart`. |
| [sensors.md](/sensors) | Reading motion and the rest of the board from a script: what the host offers, how an app checks before calling, and what it shows when the hardware is not there. |

<div class="shapes">
  <input type="radio" name="sw-ex-gpio-13" id="sw-ex-gpio-13-0">
  <label for="sw-ex-gpio-13-0">
    <img src="/img/ex-gpio-round128.png" alt="">
    round<br>240×240
  </label>
  <input type="radio" name="sw-ex-gpio-13" id="sw-ex-gpio-13-1">
  <label for="sw-ex-gpio-13-1">
    <img src="/img/ex-gpio-lcd147.png" alt="">
    portrait<br>172×320
  </label>
  <input type="radio" name="sw-ex-gpio-13" id="sw-ex-gpio-13-2" checked>
  <label for="sw-ex-gpio-13-2">
    <img src="/img/ex-gpio-lcd35.png" alt="">
    portrait<br>320×480
  </label>
  <div class="shape-panels">
    <figure>
      <img src="/img/ex-gpio-round128.png" alt="examples/gpio — Direct pin access through sys.gpio(pin, op, value): op 0 reads (the firmware sets INPUT_PULLUP first, so an open pin reads 1) op 1. . . No device natives under the pure-js backend, so the app draws its own labelled fallback (the line under the title).">
      <figcaption><strong>Round, 240×240.</strong> examples/gpio — Direct pin access through sys.gpio(pin, op, value): op 0 reads (the firmware sets INPUT_PULLUP first, so an open pin reads 1) op 1. . . No device natives under the pure-js backend, so the app draws its own labelled fallback (the line under the title). <a class="run-example" href="/play/#ex=gpio&amp;shape=round128">▶ Run it</a></figcaption>
    </figure>
    <figure>
      <img src="/img/ex-gpio-lcd147.png" alt="examples/gpio — Direct pin access through sys.gpio(pin, op, value): op 0 reads (the firmware sets INPUT_PULLUP first, so an open pin reads 1) op 1. . . No device natives under the pure-js backend, so the app draws its own labelled fallback (the line under the title).">
      <figcaption><strong>Portrait, 172×320.</strong> examples/gpio — Direct pin access through sys.gpio(pin, op, value): op 0 reads (the firmware sets INPUT_PULLUP first, so an open pin reads 1) op 1. . . No device natives under the pure-js backend, so the app draws its own labelled fallback (the line under the title). <a class="run-example" href="/play/#ex=gpio&amp;shape=lcd147">▶ Run it</a></figcaption>
    </figure>
    <figure>
      <img src="/img/ex-gpio-lcd35.png" alt="examples/gpio — Direct pin access through sys.gpio(pin, op, value): op 0 reads (the firmware sets INPUT_PULLUP first, so an open pin reads 1) op 1. . . No device natives under the pure-js backend, so the app draws its own labelled fallback (the line under the title).">
      <figcaption><strong>Portrait, 320×480.</strong> examples/gpio — Direct pin access through sys.gpio(pin, op, value): op 0 reads (the firmware sets INPUT_PULLUP first, so an open pin reads 1) op 1. . . No device natives under the pure-js backend, so the app draws its own labelled fallback (the line under the title). <a class="run-example" href="/play/#ex=gpio&amp;shape=lcd35">▶ Run it</a></figcaption>
    </figure>
  </div>
</div>

```js
var HAVE = typeof sys !== 'undefined' && typeof sys.gpio === 'function';
```

<div class="shapes">
  <input type="radio" name="sw-ex-sensors-14" id="sw-ex-sensors-14-0">
  <label for="sw-ex-sensors-14-0">
    <img src="/img/ex-sensors-round128.png" alt="">
    round<br>240×240
  </label>
  <input type="radio" name="sw-ex-sensors-14" id="sw-ex-sensors-14-1">
  <label for="sw-ex-sensors-14-1">
    <img src="/img/ex-sensors-lcd147.png" alt="">
    portrait<br>172×320
  </label>
  <input type="radio" name="sw-ex-sensors-14" id="sw-ex-sensors-14-2">
  <label for="sw-ex-sensors-14-2">
    <img src="/img/ex-sensors-lcd169.png" alt="">
    landscape<br>280×240
  </label>
  <input type="radio" name="sw-ex-sensors-14" id="sw-ex-sensors-14-3" checked>
  <label for="sw-ex-sensors-14-3">
    <img src="/img/ex-sensors-lcd35.png" alt="">
    portrait<br>320×480
  </label>
  <div class="shape-panels">
    <figure>
      <img src="/img/ex-sensors-round128.png" alt="examples/sensors — Every motion sensor the host has, three ways to look at it. No device natives under the pure-js backend, so the app draws its own labelled fallback (the line under the title).">
      <figcaption><strong>Round, 240×240.</strong> examples/sensors — Every motion sensor the host has, three ways to look at it. No device natives under the pure-js backend, so the app draws its own labelled fallback (the line under the title). <a class="run-example" href="/play/#ex=sensors&amp;shape=round128">▶ Run it</a></figcaption>
    </figure>
    <figure>
      <img src="/img/ex-sensors-lcd147.png" alt="examples/sensors — Every motion sensor the host has, three ways to look at it. No device natives under the pure-js backend, so the app draws its own labelled fallback (the line under the title).">
      <figcaption><strong>Portrait, 172×320.</strong> examples/sensors — Every motion sensor the host has, three ways to look at it. No device natives under the pure-js backend, so the app draws its own labelled fallback (the line under the title). <a class="run-example" href="/play/#ex=sensors&amp;shape=lcd147">▶ Run it</a></figcaption>
    </figure>
    <figure>
      <img src="/img/ex-sensors-lcd169.png" alt="examples/sensors — Every motion sensor the host has, three ways to look at it. No device natives under the pure-js backend, so the app draws its own labelled fallback (the line under the title).">
      <figcaption><strong>Landscape, 280×240.</strong> examples/sensors — Every motion sensor the host has, three ways to look at it. No device natives under the pure-js backend, so the app draws its own labelled fallback (the line under the title). <a class="run-example" href="/play/#ex=sensors">▶ Run it</a></figcaption>
    </figure>
    <figure>
      <img src="/img/ex-sensors-lcd35.png" alt="examples/sensors — Every motion sensor the host has, three ways to look at it. No device natives under the pure-js backend, so the app draws its own labelled fallback (the line under the title).">
      <figcaption><strong>Portrait, 320×480.</strong> examples/sensors — Every motion sensor the host has, three ways to look at it. No device natives under the pure-js backend, so the app draws its own labelled fallback (the line under the title). <a class="run-example" href="/play/#ex=sensors&amp;shape=lcd35">▶ Run it</a></figcaption>
    </figure>
  </div>
</div>

<div class="shapes">
  <input type="radio" name="sw-ex-screen-15" id="sw-ex-screen-15-0">
  <label for="sw-ex-screen-15-0">
    <img src="/img/ex-screen-round128.png" alt="">
    round<br>240×240
  </label>
  <input type="radio" name="sw-ex-screen-15" id="sw-ex-screen-15-1">
  <label for="sw-ex-screen-15-1">
    <img src="/img/ex-screen-lcd147.png" alt="">
    portrait<br>172×320
  </label>
  <input type="radio" name="sw-ex-screen-15" id="sw-ex-screen-15-2">
  <label for="sw-ex-screen-15-2">
    <img src="/img/ex-screen-lcd169.png" alt="">
    landscape<br>280×240
  </label>
  <input type="radio" name="sw-ex-screen-15" id="sw-ex-screen-15-3" checked>
  <label for="sw-ex-screen-15-3">
    <img src="/img/ex-screen-lcd35.png" alt="">
    portrait<br>320×480
  </label>
  <div class="shape-panels">
    <figure>
      <img src="/img/ex-screen-round128.png" alt="examples/screen — Screen settings, in JSX: brightness, sleep timeout, and what sleeping means (dim to readable, or dark). No device natives under the pure-js backend, so the app draws its own labelled fallback (the line under the title).">
      <figcaption><strong>Round, 240×240.</strong> examples/screen — Screen settings, in JSX: brightness, sleep timeout, and what sleeping means (dim to readable, or dark). No device natives under the pure-js backend, so the app draws its own labelled fallback (the line under the title). <a class="run-example" href="/play/#ex=screen&amp;shape=round128">▶ Run it</a></figcaption>
    </figure>
    <figure>
      <img src="/img/ex-screen-lcd147.png" alt="examples/screen — Screen settings, in JSX: brightness, sleep timeout, and what sleeping means (dim to readable, or dark). No device natives under the pure-js backend, so the app draws its own labelled fallback (the line under the title).">
      <figcaption><strong>Portrait, 172×320.</strong> examples/screen — Screen settings, in JSX: brightness, sleep timeout, and what sleeping means (dim to readable, or dark). No device natives under the pure-js backend, so the app draws its own labelled fallback (the line under the title). <a class="run-example" href="/play/#ex=screen&amp;shape=lcd147">▶ Run it</a></figcaption>
    </figure>
    <figure>
      <img src="/img/ex-screen-lcd169.png" alt="examples/screen — Screen settings, in JSX: brightness, sleep timeout, and what sleeping means (dim to readable, or dark). No device natives under the pure-js backend, so the app draws its own labelled fallback (the line under the title).">
      <figcaption><strong>Landscape, 280×240.</strong> examples/screen — Screen settings, in JSX: brightness, sleep timeout, and what sleeping means (dim to readable, or dark). No device natives under the pure-js backend, so the app draws its own labelled fallback (the line under the title). <a class="run-example" href="/play/#ex=screen">▶ Run it</a></figcaption>
    </figure>
    <figure>
      <img src="/img/ex-screen-lcd35.png" alt="examples/screen — Screen settings, in JSX: brightness, sleep timeout, and what sleeping means (dim to readable, or dark). No device natives under the pure-js backend, so the app draws its own labelled fallback (the line under the title).">
      <figcaption><strong>Portrait, 320×480.</strong> examples/screen — Screen settings, in JSX: brightness, sleep timeout, and what sleeping means (dim to readable, or dark). No device natives under the pure-js backend, so the app draws its own labelled fallback (the line under the title). <a class="run-example" href="/play/#ex=screen&amp;shape=lcd35">▶ Run it</a></figcaption>
    </figure>
  </div>
</div>

<div class="shapes">
  <input type="radio" name="sw-ex-wifi-16" id="sw-ex-wifi-16-0">
  <label for="sw-ex-wifi-16-0">
    <img src="/img/ex-wifi-round128.png" alt="">
    round<br>240×240
  </label>
  <input type="radio" name="sw-ex-wifi-16" id="sw-ex-wifi-16-1">
  <label for="sw-ex-wifi-16-1">
    <img src="/img/ex-wifi-lcd147.png" alt="">
    portrait<br>172×320
  </label>
  <input type="radio" name="sw-ex-wifi-16" id="sw-ex-wifi-16-2" checked>
  <label for="sw-ex-wifi-16-2">
    <img src="/img/ex-wifi-lcd35.png" alt="">
    portrait<br>320×480
  </label>
  <div class="shape-panels">
    <figure>
      <img src="/img/ex-wifi-round128.png" alt="examples/wifi — WiFi setup, in JSX — the native settings page's job, done by a script. No device natives under the pure-js backend, so the app draws its own labelled fallback (the line under the title).">
      <figcaption><strong>Round, 240×240.</strong> examples/wifi — WiFi setup, in JSX — the native settings page's job, done by a script. No device natives under the pure-js backend, so the app draws its own labelled fallback (the line under the title). <a class="run-example" href="/play/#ex=wifi&amp;shape=round128">▶ Run it</a></figcaption>
    </figure>
    <figure>
      <img src="/img/ex-wifi-lcd147.png" alt="examples/wifi — WiFi setup, in JSX — the native settings page's job, done by a script. No device natives under the pure-js backend, so the app draws its own labelled fallback (the line under the title).">
      <figcaption><strong>Portrait, 172×320.</strong> examples/wifi — WiFi setup, in JSX — the native settings page's job, done by a script. No device natives under the pure-js backend, so the app draws its own labelled fallback (the line under the title). <a class="run-example" href="/play/#ex=wifi&amp;shape=lcd147">▶ Run it</a></figcaption>
    </figure>
    <figure>
      <img src="/img/ex-wifi-lcd35.png" alt="examples/wifi — WiFi setup, in JSX — the native settings page's job, done by a script. No device natives under the pure-js backend, so the app draws its own labelled fallback (the line under the title).">
      <figcaption><strong>Portrait, 320×480.</strong> examples/wifi — WiFi setup, in JSX — the native settings page's job, done by a script. No device natives under the pure-js backend, so the app draws its own labelled fallback (the line under the title). <a class="run-example" href="/play/#ex=wifi&amp;shape=lcd35">▶ Run it</a></figcaption>
    </figure>
  </div>
</div>

<div class="shapes">
  <input type="radio" name="sw-ex-camera-17" id="sw-ex-camera-17-0">
  <label for="sw-ex-camera-17-0">
    <img src="/img/ex-camera-round128.png" alt="">
    round<br>240×240
  </label>
  <input type="radio" name="sw-ex-camera-17" id="sw-ex-camera-17-1">
  <label for="sw-ex-camera-17-1">
    <img src="/img/ex-camera-lcd147.png" alt="">
    portrait<br>172×320
  </label>
  <input type="radio" name="sw-ex-camera-17" id="sw-ex-camera-17-2" checked>
  <label for="sw-ex-camera-17-2">
    <img src="/img/ex-camera-lcd35.png" alt="">
    portrait<br>320×480
  </label>
  <div class="shape-panels">
    <figure>
      <img src="/img/ex-camera-round128.png" alt="examples/camera — The camera, as canvas sources: the module drops a live frame into the PREVIEW canvas (~8fps, small) and SNAP copies one full frame into. . . No device natives under the pure-js backend, so the app draws its own labelled fallback (the line under the title).">
      <figcaption><strong>Round, 240×240.</strong> examples/camera — The camera, as canvas sources: the module drops a live frame into the PREVIEW canvas (~8fps, small) and SNAP copies one full frame into. . . No device natives under the pure-js backend, so the app draws its own labelled fallback (the line under the title). <a class="run-example" href="/play/#ex=camera&amp;shape=round128">▶ Run it</a></figcaption>
    </figure>
    <figure>
      <img src="/img/ex-camera-lcd147.png" alt="examples/camera — The camera, as canvas sources: the module drops a live frame into the PREVIEW canvas (~8fps, small) and SNAP copies one full frame into. . . No device natives under the pure-js backend, so the app draws its own labelled fallback (the line under the title).">
      <figcaption><strong>Portrait, 172×320.</strong> examples/camera — The camera, as canvas sources: the module drops a live frame into the PREVIEW canvas (~8fps, small) and SNAP copies one full frame into. . . No device natives under the pure-js backend, so the app draws its own labelled fallback (the line under the title). <a class="run-example" href="/play/#ex=camera&amp;shape=lcd147">▶ Run it</a></figcaption>
    </figure>
    <figure>
      <img src="/img/ex-camera-lcd35.png" alt="examples/camera — The camera, as canvas sources: the module drops a live frame into the PREVIEW canvas (~8fps, small) and SNAP copies one full frame into. . . No device natives under the pure-js backend, so the app draws its own labelled fallback (the line under the title).">
      <figcaption><strong>Portrait, 320×480.</strong> examples/camera — The camera, as canvas sources: the module drops a live frame into the PREVIEW canvas (~8fps, small) and SNAP copies one full frame into. . . No device natives under the pure-js backend, so the app draws its own labelled fallback (the line under the title). <a class="run-example" href="/play/#ex=camera&amp;shape=lcd35">▶ Run it</a></figcaption>
    </figure>
  </div>
</div>

<div class="shapes">
  <input type="radio" name="sw-ex-canvas-18" id="sw-ex-canvas-18-0">
  <label for="sw-ex-canvas-18-0">
    <img src="/img/ex-canvas-round128.png" alt="">
    round<br>240×240
  </label>
  <input type="radio" name="sw-ex-canvas-18" id="sw-ex-canvas-18-1">
  <label for="sw-ex-canvas-18-1">
    <img src="/img/ex-canvas-lcd147.png" alt="">
    portrait<br>172×320
  </label>
  <input type="radio" name="sw-ex-canvas-18" id="sw-ex-canvas-18-2" checked>
  <label for="sw-ex-canvas-18-2">
    <img src="/img/ex-canvas-lcd35.png" alt="">
    portrait<br>320×480
  </label>
  <div class="shape-panels">
    <figure>
      <img src="/img/ex-canvas-round128.png" alt="examples/canvas — Freehand drawing with a CANVAS SOURCE backing - draw's little sibling, restructured around sys.canvas.">
      <figcaption><strong>Round, 240×240.</strong> examples/canvas — Freehand drawing with a CANVAS SOURCE backing - draw's little sibling, restructured around sys.canvas. <a class="run-example" href="/play/#ex=canvas&amp;shape=round128">▶ Run it</a></figcaption>
    </figure>
    <figure>
      <img src="/img/ex-canvas-lcd147.png" alt="examples/canvas — Freehand drawing with a CANVAS SOURCE backing - draw's little sibling, restructured around sys.canvas.">
      <figcaption><strong>Portrait, 172×320.</strong> examples/canvas — Freehand drawing with a CANVAS SOURCE backing - draw's little sibling, restructured around sys.canvas. <a class="run-example" href="/play/#ex=canvas&amp;shape=lcd147">▶ Run it</a></figcaption>
    </figure>
    <figure>
      <img src="/img/ex-canvas-lcd35.png" alt="examples/canvas — Freehand drawing with a CANVAS SOURCE backing - draw's little sibling, restructured around sys.canvas.">
      <figcaption><strong>Portrait, 320×480.</strong> examples/canvas — Freehand drawing with a CANVAS SOURCE backing - draw's little sibling, restructured around sys.canvas. <a class="run-example" href="/play/#ex=canvas&amp;shape=lcd35">▶ Run it</a></figcaption>
    </figure>
  </div>
</div>

### Reference

| Page | The question it answers |
|---|---|
| [contract.md](/contract) | The ten `gfx` calls and `sys.millis()` in full, the optional natives (`poly`, `blit`, `store`/`fetch`, font metrics), the host-declared `round` key, and how a backend drives the loop. |
| [consistency.md](/consistency) | What each backend in this tree *actually* implements, measured against the contract — call by call, plus fourteen ranked divergences, each read out of the named source file. |

<div class="shapes">
  <input type="radio" name="sw-ex-shapes-19" id="sw-ex-shapes-19-0">
  <label for="sw-ex-shapes-19-0">
    <img src="/img/ex-shapes-round128.png" alt="">
    round<br>240×240
  </label>
  <input type="radio" name="sw-ex-shapes-19" id="sw-ex-shapes-19-1">
  <label for="sw-ex-shapes-19-1">
    <img src="/img/ex-shapes-lcd147.png" alt="">
    portrait<br>172×320
  </label>
  <input type="radio" name="sw-ex-shapes-19" id="sw-ex-shapes-19-2">
  <label for="sw-ex-shapes-19-2">
    <img src="/img/ex-shapes-lcd169.png" alt="">
    landscape<br>280×240
  </label>
  <input type="radio" name="sw-ex-shapes-19" id="sw-ex-shapes-19-3" checked>
  <label for="sw-ex-shapes-19-3">
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
| ../CONTRIBUTING.md (`CONTRIBUTING.md` in the repo) | The one hard rule (the core file stays in the MicroQuickJS ES5 subset), how to add an example, and how to add a backend. |

<div class="shapes">
  <input type="radio" name="sw-ex-hello-20" id="sw-ex-hello-20-0" checked>
  <label for="sw-ex-hello-20-0">
    <img src="/img/ex-hello-round128.png" alt="">
    round<br>240×240
  </label>
  <input type="radio" name="sw-ex-hello-20" id="sw-ex-hello-20-1">
  <label for="sw-ex-hello-20-1">
    <img src="/img/ex-hello-lcd147.png" alt="">
    portrait<br>172×320
  </label>
  <input type="radio" name="sw-ex-hello-20" id="sw-ex-hello-20-2">
  <label for="sw-ex-hello-20-2">
    <img src="/img/ex-hello-lcd169p.png" alt="">
    portrait<br>240×280
  </label>
  <input type="radio" name="sw-ex-hello-20" id="sw-ex-hello-20-3">
  <label for="sw-ex-hello-20-3">
    <img src="/img/ex-hello-lcd35.png" alt="">
    portrait<br>320×480
  </label>
  <div class="shape-panels">
    <figure>
      <img src="/img/ex-hello-round128.png" alt="examples/hello — The smallest real mjsx app: a panel, a border, some centred text.">
      <figcaption><strong>Round, 240×240.</strong> examples/hello — The smallest real mjsx app: a panel, a border, some centred text. <a class="run-example" href="/play/#ex=hello&amp;shape=round128">▶ Run it</a></figcaption>
    </figure>
    <figure>
      <img src="/img/ex-hello-lcd147.png" alt="examples/hello — The smallest real mjsx app: a panel, a border, some centred text.">
      <figcaption><strong>Portrait, 172×320.</strong> examples/hello — The smallest real mjsx app: a panel, a border, some centred text. <a class="run-example" href="/play/#ex=hello&amp;shape=lcd147">▶ Run it</a></figcaption>
    </figure>
    <figure>
      <img src="/img/ex-hello-lcd169p.png" alt="examples/hello — The smallest real mjsx app: a panel, a border, some centred text.">
      <figcaption><strong>Portrait, 240×280.</strong> examples/hello — The smallest real mjsx app: a panel, a border, some centred text. <a class="run-example" href="/play/#ex=hello&amp;shape=lcd169p">▶ Run it</a></figcaption>
    </figure>
    <figure>
      <img src="/img/ex-hello-lcd35.png" alt="examples/hello — The smallest real mjsx app: a panel, a border, some centred text.">
      <figcaption><strong>Portrait, 320×480.</strong> examples/hello — The smallest real mjsx app: a panel, a border, some centred text. <a class="run-example" href="/play/#ex=hello&amp;shape=lcd35">▶ Run it</a></figcaption>
    </figure>
  </div>
</div>

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

<div class="shapes">
  <input type="radio" name="sw-ex-layers-21" id="sw-ex-layers-21-0">
  <label for="sw-ex-layers-21-0">
    <img src="/img/ex-layers-round128.png" alt="">
    round<br>240×240
  </label>
  <input type="radio" name="sw-ex-layers-21" id="sw-ex-layers-21-1">
  <label for="sw-ex-layers-21-1">
    <img src="/img/ex-layers-lcd147.png" alt="">
    portrait<br>172×320
  </label>
  <input type="radio" name="sw-ex-layers-21" id="sw-ex-layers-21-2" checked>
  <label for="sw-ex-layers-21-2">
    <img src="/img/ex-layers-lcd169.png" alt="">
    landscape<br>280×240
  </label>
  <input type="radio" name="sw-ex-layers-21" id="sw-ex-layers-21-3">
  <label for="sw-ex-layers-21-3">
    <img src="/img/ex-layers-lcd35.png" alt="">
    portrait<br>320×480
  </label>
  <input type="radio" name="sw-ex-layers-21" id="sw-ex-layers-21-4">
  <label for="sw-ex-layers-21-4">
    <img src="/img/ex-layers-wide.png" alt="">
    landscape<br>480×320
  </label>
  <div class="shape-panels">
    <figure>
      <img src="/img/ex-layers-round128.png" alt="examples/layers — Layering / scrolling / cropping torture test.">
      <figcaption><strong>Round, 240×240.</strong> examples/layers — Layering / scrolling / cropping torture test. <a class="run-example" href="/play/#ex=layers&amp;shape=round128">▶ Run it</a></figcaption>
    </figure>
    <figure>
      <img src="/img/ex-layers-lcd147.png" alt="examples/layers — Layering / scrolling / cropping torture test.">
      <figcaption><strong>Portrait, 172×320.</strong> examples/layers — Layering / scrolling / cropping torture test. <a class="run-example" href="/play/#ex=layers&amp;shape=lcd147">▶ Run it</a></figcaption>
    </figure>
    <figure>
      <img src="/img/ex-layers-lcd169.png" alt="examples/layers — Layering / scrolling / cropping torture test.">
      <figcaption><strong>Landscape, 280×240.</strong> examples/layers — Layering / scrolling / cropping torture test. <a class="run-example" href="/play/#ex=layers">▶ Run it</a></figcaption>
    </figure>
    <figure>
      <img src="/img/ex-layers-lcd35.png" alt="examples/layers — Layering / scrolling / cropping torture test.">
      <figcaption><strong>Portrait, 320×480.</strong> examples/layers — Layering / scrolling / cropping torture test. <a class="run-example" href="/play/#ex=layers&amp;shape=lcd35">▶ Run it</a></figcaption>
    </figure>
    <figure>
      <img src="/img/ex-layers-wide.png" alt="examples/layers — Layering / scrolling / cropping torture test.">
      <figcaption><strong>Landscape, 480×320.</strong> examples/layers — Layering / scrolling / cropping torture test. <a class="run-example" href="/play/#ex=layers">▶ Run it</a></figcaption>
    </figure>
  </div>
</div>

<div class="shapes">
  <input type="radio" name="sw-ex-layers-22" id="sw-ex-layers-22-0">
  <label for="sw-ex-layers-22-0">
    <img src="/img/ex-layers-round128.png" alt="">
    round<br>240×240
  </label>
  <input type="radio" name="sw-ex-layers-22" id="sw-ex-layers-22-1">
  <label for="sw-ex-layers-22-1">
    <img src="/img/ex-layers-lcd147.png" alt="">
    portrait<br>172×320
  </label>
  <input type="radio" name="sw-ex-layers-22" id="sw-ex-layers-22-2">
  <label for="sw-ex-layers-22-2">
    <img src="/img/ex-layers-lcd169.png" alt="">
    landscape<br>280×240
  </label>
  <input type="radio" name="sw-ex-layers-22" id="sw-ex-layers-22-3" checked>
  <label for="sw-ex-layers-22-3">
    <img src="/img/ex-layers-lcd35.png" alt="">
    portrait<br>320×480
  </label>
  <input type="radio" name="sw-ex-layers-22" id="sw-ex-layers-22-4">
  <label for="sw-ex-layers-22-4">
    <img src="/img/ex-layers-wide.png" alt="">
    landscape<br>480×320
  </label>
  <div class="shape-panels">
    <figure>
      <img src="/img/ex-layers-round128.png" alt="examples/layers — Layering / scrolling / cropping torture test.">
      <figcaption><strong>Round, 240×240.</strong> examples/layers — Layering / scrolling / cropping torture test. <a class="run-example" href="/play/#ex=layers&amp;shape=round128">▶ Run it</a></figcaption>
    </figure>
    <figure>
      <img src="/img/ex-layers-lcd147.png" alt="examples/layers — Layering / scrolling / cropping torture test.">
      <figcaption><strong>Portrait, 172×320.</strong> examples/layers — Layering / scrolling / cropping torture test. <a class="run-example" href="/play/#ex=layers&amp;shape=lcd147">▶ Run it</a></figcaption>
    </figure>
    <figure>
      <img src="/img/ex-layers-lcd169.png" alt="examples/layers — Layering / scrolling / cropping torture test.">
      <figcaption><strong>Landscape, 280×240.</strong> examples/layers — Layering / scrolling / cropping torture test. <a class="run-example" href="/play/#ex=layers">▶ Run it</a></figcaption>
    </figure>
    <figure>
      <img src="/img/ex-layers-lcd35.png" alt="examples/layers — Layering / scrolling / cropping torture test.">
      <figcaption><strong>Portrait, 320×480.</strong> examples/layers — Layering / scrolling / cropping torture test. <a class="run-example" href="/play/#ex=layers&amp;shape=lcd35">▶ Run it</a></figcaption>
    </figure>
    <figure>
      <img src="/img/ex-layers-wide.png" alt="examples/layers — Layering / scrolling / cropping torture test.">
      <figcaption><strong>Landscape, 480×320.</strong> examples/layers — Layering / scrolling / cropping torture test. <a class="run-example" href="/play/#ex=layers">▶ Run it</a></figcaption>
    </figure>
  </div>
</div>

<div class="shapes">
  <input type="radio" name="sw-ex-layers-23" id="sw-ex-layers-23-0">
  <label for="sw-ex-layers-23-0">
    <img src="/img/ex-layers-round128.png" alt="">
    round<br>240×240
  </label>
  <input type="radio" name="sw-ex-layers-23" id="sw-ex-layers-23-1" checked>
  <label for="sw-ex-layers-23-1">
    <img src="/img/ex-layers-lcd147.png" alt="">
    portrait<br>172×320
  </label>
  <input type="radio" name="sw-ex-layers-23" id="sw-ex-layers-23-2">
  <label for="sw-ex-layers-23-2">
    <img src="/img/ex-layers-lcd169.png" alt="">
    landscape<br>280×240
  </label>
  <input type="radio" name="sw-ex-layers-23" id="sw-ex-layers-23-3">
  <label for="sw-ex-layers-23-3">
    <img src="/img/ex-layers-lcd35.png" alt="">
    portrait<br>320×480
  </label>
  <input type="radio" name="sw-ex-layers-23" id="sw-ex-layers-23-4">
  <label for="sw-ex-layers-23-4">
    <img src="/img/ex-layers-wide.png" alt="">
    landscape<br>480×320
  </label>
  <div class="shape-panels">
    <figure>
      <img src="/img/ex-layers-round128.png" alt="examples/layers — Layering / scrolling / cropping torture test.">
      <figcaption><strong>Round, 240×240.</strong> examples/layers — Layering / scrolling / cropping torture test. <a class="run-example" href="/play/#ex=layers&amp;shape=round128">▶ Run it</a></figcaption>
    </figure>
    <figure>
      <img src="/img/ex-layers-lcd147.png" alt="examples/layers — Layering / scrolling / cropping torture test.">
      <figcaption><strong>Portrait, 172×320.</strong> examples/layers — Layering / scrolling / cropping torture test. <a class="run-example" href="/play/#ex=layers&amp;shape=lcd147">▶ Run it</a></figcaption>
    </figure>
    <figure>
      <img src="/img/ex-layers-lcd169.png" alt="examples/layers — Layering / scrolling / cropping torture test.">
      <figcaption><strong>Landscape, 280×240.</strong> examples/layers — Layering / scrolling / cropping torture test. <a class="run-example" href="/play/#ex=layers">▶ Run it</a></figcaption>
    </figure>
    <figure>
      <img src="/img/ex-layers-lcd35.png" alt="examples/layers — Layering / scrolling / cropping torture test.">
      <figcaption><strong>Portrait, 320×480.</strong> examples/layers — Layering / scrolling / cropping torture test. <a class="run-example" href="/play/#ex=layers&amp;shape=lcd35">▶ Run it</a></figcaption>
    </figure>
    <figure>
      <img src="/img/ex-layers-wide.png" alt="examples/layers — Layering / scrolling / cropping torture test.">
      <figcaption><strong>Landscape, 480×320.</strong> examples/layers — Layering / scrolling / cropping torture test. <a class="run-example" href="/play/#ex=layers">▶ Run it</a></figcaption>
    </figure>
  </div>
</div>

<div class="shapes">
  <input type="radio" name="sw-ex-layers-24" id="sw-ex-layers-24-0" checked>
  <label for="sw-ex-layers-24-0">
    <img src="/img/ex-layers-round128.png" alt="">
    round<br>240×240
  </label>
  <input type="radio" name="sw-ex-layers-24" id="sw-ex-layers-24-1">
  <label for="sw-ex-layers-24-1">
    <img src="/img/ex-layers-lcd147.png" alt="">
    portrait<br>172×320
  </label>
  <input type="radio" name="sw-ex-layers-24" id="sw-ex-layers-24-2">
  <label for="sw-ex-layers-24-2">
    <img src="/img/ex-layers-lcd169.png" alt="">
    landscape<br>280×240
  </label>
  <input type="radio" name="sw-ex-layers-24" id="sw-ex-layers-24-3">
  <label for="sw-ex-layers-24-3">
    <img src="/img/ex-layers-lcd35.png" alt="">
    portrait<br>320×480
  </label>
  <input type="radio" name="sw-ex-layers-24" id="sw-ex-layers-24-4">
  <label for="sw-ex-layers-24-4">
    <img src="/img/ex-layers-wide.png" alt="">
    landscape<br>480×320
  </label>
  <div class="shape-panels">
    <figure>
      <img src="/img/ex-layers-round128.png" alt="examples/layers — Layering / scrolling / cropping torture test.">
      <figcaption><strong>Round, 240×240.</strong> examples/layers — Layering / scrolling / cropping torture test. <a class="run-example" href="/play/#ex=layers&amp;shape=round128">▶ Run it</a></figcaption>
    </figure>
    <figure>
      <img src="/img/ex-layers-lcd147.png" alt="examples/layers — Layering / scrolling / cropping torture test.">
      <figcaption><strong>Portrait, 172×320.</strong> examples/layers — Layering / scrolling / cropping torture test. <a class="run-example" href="/play/#ex=layers&amp;shape=lcd147">▶ Run it</a></figcaption>
    </figure>
    <figure>
      <img src="/img/ex-layers-lcd169.png" alt="examples/layers — Layering / scrolling / cropping torture test.">
      <figcaption><strong>Landscape, 280×240.</strong> examples/layers — Layering / scrolling / cropping torture test. <a class="run-example" href="/play/#ex=layers">▶ Run it</a></figcaption>
    </figure>
    <figure>
      <img src="/img/ex-layers-lcd35.png" alt="examples/layers — Layering / scrolling / cropping torture test.">
      <figcaption><strong>Portrait, 320×480.</strong> examples/layers — Layering / scrolling / cropping torture test. <a class="run-example" href="/play/#ex=layers&amp;shape=lcd35">▶ Run it</a></figcaption>
    </figure>
    <figure>
      <img src="/img/ex-layers-wide.png" alt="examples/layers — Layering / scrolling / cropping torture test.">
      <figcaption><strong>Landscape, 480×320.</strong> examples/layers — Layering / scrolling / cropping torture test. <a class="run-example" href="/play/#ex=layers">▶ Run it</a></figcaption>
    </figure>
  </div>
</div>

<div class="shapes">
  <input type="radio" name="sw-ex-layers-25" id="sw-ex-layers-25-0">
  <label for="sw-ex-layers-25-0">
    <img src="/img/ex-layers-round128.png" alt="">
    round<br>240×240
  </label>
  <input type="radio" name="sw-ex-layers-25" id="sw-ex-layers-25-1">
  <label for="sw-ex-layers-25-1">
    <img src="/img/ex-layers-lcd147.png" alt="">
    portrait<br>172×320
  </label>
  <input type="radio" name="sw-ex-layers-25" id="sw-ex-layers-25-2">
  <label for="sw-ex-layers-25-2">
    <img src="/img/ex-layers-lcd169.png" alt="">
    landscape<br>280×240
  </label>
  <input type="radio" name="sw-ex-layers-25" id="sw-ex-layers-25-3">
  <label for="sw-ex-layers-25-3">
    <img src="/img/ex-layers-lcd35.png" alt="">
    portrait<br>320×480
  </label>
  <input type="radio" name="sw-ex-layers-25" id="sw-ex-layers-25-4" checked>
  <label for="sw-ex-layers-25-4">
    <img src="/img/ex-layers-wide.png" alt="">
    landscape<br>480×320
  </label>
  <div class="shape-panels">
    <figure>
      <img src="/img/ex-layers-round128.png" alt="examples/layers — Layering / scrolling / cropping torture test.">
      <figcaption><strong>Round, 240×240.</strong> examples/layers — Layering / scrolling / cropping torture test. <a class="run-example" href="/play/#ex=layers&amp;shape=round128">▶ Run it</a></figcaption>
    </figure>
    <figure>
      <img src="/img/ex-layers-lcd147.png" alt="examples/layers — Layering / scrolling / cropping torture test.">
      <figcaption><strong>Portrait, 172×320.</strong> examples/layers — Layering / scrolling / cropping torture test. <a class="run-example" href="/play/#ex=layers&amp;shape=lcd147">▶ Run it</a></figcaption>
    </figure>
    <figure>
      <img src="/img/ex-layers-lcd169.png" alt="examples/layers — Layering / scrolling / cropping torture test.">
      <figcaption><strong>Landscape, 280×240.</strong> examples/layers — Layering / scrolling / cropping torture test. <a class="run-example" href="/play/#ex=layers">▶ Run it</a></figcaption>
    </figure>
    <figure>
      <img src="/img/ex-layers-lcd35.png" alt="examples/layers — Layering / scrolling / cropping torture test.">
      <figcaption><strong>Portrait, 320×480.</strong> examples/layers — Layering / scrolling / cropping torture test. <a class="run-example" href="/play/#ex=layers&amp;shape=lcd35">▶ Run it</a></figcaption>
    </figure>
    <figure>
      <img src="/img/ex-layers-wide.png" alt="examples/layers — Layering / scrolling / cropping torture test.">
      <figcaption><strong>Landscape, 480×320.</strong> examples/layers — Layering / scrolling / cropping torture test. <a class="run-example" href="/play/#ex=layers">▶ Run it</a></figcaption>
    </figure>
  </div>
</div>

The round board is also the constrained one — 2MB quad PSRAM, a 1MB JS
heap cap, and a CH343 UART bridge that needs chunked serial writes. Each
of those cost real debugging, and [devices.md](/devices) records why.
