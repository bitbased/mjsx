---
title: "Getting started"
description: "From an empty directory to a UI on real glass."
---
<!-- GENERATED from docs/getting-started.md by scripts/docs-sync.mjs. Edit that file. -->Sixty seconds from a clone to a UI you wrote, and a few minutes more to
that same file running on real glass. Everything here runs with
[bun](https://bun.sh); there are no required dependencies, and nothing
below needs a device until the last step.

Everything below runs on real hardware — but you can try it right now,
without any, on the panel here. Edit the code and it re-runs.

<iframe class="sim-embed" src="/play/?embed=1#ex=hello" title="mjsx simulator running the hello example" loading="lazy"></iframe>


## 1. Install, and run an example

```
bun install
```

That is the whole install. SDL2 is the only native dependency in the repo
and it is optional — the window sim asks for it, nothing else does.

The fastest look at the engine is the example picker, which renders into
your terminal (arrow keys move a cursor, Enter taps, Esc backs out to the
menu, q quits):

```
bun run examples
```

<div class="shapes">
  <input type="radio" name="sw-ex-layers-0" id="sw-ex-layers-0-0">
  <label for="sw-ex-layers-0-0">
    <img src="/img/ex-layers-round128.png" alt="">
    round<br>240×240
  </label>
  <input type="radio" name="sw-ex-layers-0" id="sw-ex-layers-0-1">
  <label for="sw-ex-layers-0-1">
    <img src="/img/ex-layers-lcd147.png" alt="">
    portrait<br>172×320
  </label>
  <input type="radio" name="sw-ex-layers-0" id="sw-ex-layers-0-2">
  <label for="sw-ex-layers-0-2">
    <img src="/img/ex-layers-lcd169.png" alt="">
    landscape<br>280×240
  </label>
  <input type="radio" name="sw-ex-layers-0" id="sw-ex-layers-0-3" checked>
  <label for="sw-ex-layers-0-3">
    <img src="/img/ex-layers-lcd35.png" alt="">
    portrait<br>320×480
  </label>
  <input type="radio" name="sw-ex-layers-0" id="sw-ex-layers-0-4">
  <label for="sw-ex-layers-0-4">
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

For a window that looks like the hardware — plus a live browser mirror at
`http://localhost:8080` — use the CLI's dev command:

```
bun packages/cli/bin/mjsx.js dev counter
```

<div class="shapes">
  <input type="radio" name="sw-ex-layers-1" id="sw-ex-layers-1-0">
  <label for="sw-ex-layers-1-0">
    <img src="/img/ex-layers-round128.png" alt="">
    round<br>240×240
  </label>
  <input type="radio" name="sw-ex-layers-1" id="sw-ex-layers-1-1">
  <label for="sw-ex-layers-1-1">
    <img src="/img/ex-layers-lcd147.png" alt="">
    portrait<br>172×320
  </label>
  <input type="radio" name="sw-ex-layers-1" id="sw-ex-layers-1-2">
  <label for="sw-ex-layers-1-2">
    <img src="/img/ex-layers-lcd169.png" alt="">
    landscape<br>280×240
  </label>
  <input type="radio" name="sw-ex-layers-1" id="sw-ex-layers-1-3">
  <label for="sw-ex-layers-1-3">
    <img src="/img/ex-layers-lcd35.png" alt="">
    portrait<br>320×480
  </label>
  <input type="radio" name="sw-ex-layers-1" id="sw-ex-layers-1-4" checked>
  <label for="sw-ex-layers-1-4">
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

Two things worth knowing early: `mjsx dev` loads the **bundled examples
only** — it takes a name (`counter`) or a path inside `examples/` — and
the sim's `--circle` flag is a window mask, so it previews round glass
while the app still lays out square. Whether the glass is round is a fact
the *host* declares (`configStorage`'s `round` key, which `UI.isRound()`
reads once and caches); nothing in `backends/` writes it. See
[round.md](/round) and [contract.md](/contract).

And with no terminal and no window at all, the headless runner writes a
frame to a file:

```
bun run example:hello              # -> out/hello.ppm, 240x280
bun run example:counter            # -> out/counter.ppm, and a second frame
```

`example:counter` writes two: the example exports a `demo()` the runner
drives, so it prints `simulated tap at ... -> count is now 1` and writes
`out/counter.after.ppm` beside the first. That is the round trip — state,
`UI.set`, redraw — proven without a finger.

`out/` is gitignored, so a fresh clone may not have it. Neither of these
creates a directory; both write exactly the path they are given.

## 2. Your first app

A complete mjsx app is one flat `app.jsx` file with no imports. `h`, `UI`,
`em` and the components are ambient globals, because that is what a device
hands a script. Save this as `app.jsx` anywhere:

```jsx
function App() {
  return (
    <box pad={em(2)} gap={em(1.5)}>
      <box bg={UI.theme.panel} radius={8} border={UI.theme.accent} borderW={2}
           pad={em(1.5)}>
        <text text="Hello mjsx!" size={2} color={UI.theme.text} align="center" />
      </box>
      <text text="one core. esp32, pi, node, browser." size={1}
            color={UI.theme.muted} align="center" wrap={true} />
    </box>
  );
}

UI.mount(App);
```

Thirteen lines of code, and it is `examples/hello/app.jsx` with its
comment header removed. Run it:

```
bun packages/cli/bin/mjsx.js run app.jsx                        # into this terminal
bun packages/cli/bin/mjsx.js run app.jsx --ppm app.ppm --size 320x480
```

<div class="shapes">
  <input type="radio" name="sw-ex-hello-2" id="sw-ex-hello-2-0">
  <label for="sw-ex-hello-2-0">
    <img src="/img/ex-hello-round128.png" alt="">
    round<br>240×240
  </label>
  <input type="radio" name="sw-ex-hello-2" id="sw-ex-hello-2-1">
  <label for="sw-ex-hello-2-1">
    <img src="/img/ex-hello-lcd147.png" alt="">
    portrait<br>172×320
  </label>
  <input type="radio" name="sw-ex-hello-2" id="sw-ex-hello-2-2" checked>
  <label for="sw-ex-hello-2-2">
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
      <img src="/img/ex-hello-lcd35.png" alt="examples/hello — The smallest real mjsx app: a panel, a border, some centred text.">
      <figcaption><strong>Portrait, 320×480.</strong> examples/hello — The smallest real mjsx app: a panel, a border, some centred text. <a class="run-example" href="/play/#ex=hello&amp;shape=lcd35">▶ Run it</a></figcaption>
    </figure>
  </div>
</div>

Unlike `mjsx dev`, `mjsx run` takes any path, so this is the loop for
your own files. `--ppm` writes exactly the path you give it and does not
create directories; it fails early and says so if the directory is
missing.

## 3. Make it respond

There is no reconciler and no retained tree. A handler calls `UI.set`,
which shallow-merges into `UI.state` and marks the frame dirty, and the
next render redraws everything. That is the entire model:

```jsx
function App() {
  var count = UI.state.count || 0;
  return (
    <box pad={em(2)} gap={em(2)}>
      <text text={'COUNT: ' + count} size={3} color={UI.theme.text} align="center" />
      <Button label="+1" size={2}
              onTap={function () { UI.set({ count: count + 1 }); }} />
    </box>
  );
}

UI.mount(App);
```

<div class="shapes">
  <input type="radio" name="sw-ex-counter-3" id="sw-ex-counter-3-0">
  <label for="sw-ex-counter-3-0">
    <img src="/img/ex-counter-round128.png" alt="">
    round<br>240×240
  </label>
  <input type="radio" name="sw-ex-counter-3" id="sw-ex-counter-3-1">
  <label for="sw-ex-counter-3-1">
    <img src="/img/ex-counter-lcd147.png" alt="">
    portrait<br>172×320
  </label>
  <input type="radio" name="sw-ex-counter-3" id="sw-ex-counter-3-2" checked>
  <label for="sw-ex-counter-3-2">
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

Note the ES5: `var`, not `let`; `function () {}`, not `=>`; string
concatenation, not template literals. The core file runs on MicroQuickJS
on the chip, and app code has to too. The CLI checks that for you:

```
bun packages/cli/bin/mjsx.js lint --level mquickjs app.jsx
```

Handed a file that would not parse on the chip, it names the rule and the
line rather than letting the board find out:

```
app.jsx:1  const — const is ES6; use var
app.jsx:1  arrow — arrow functions are ES6; use function () {}
app.jsx:1  template-literal — template literals are ES6; build the string with +

3 problem(s) in 1 file(s) — this code would not parse on the device
```

`--level` is worth the extra typing here. The linter picks a level from
the path — `packages/core/`, `examples/` and `local-examples/` ship to a
chip and are checked as `mquickjs`, everything else is `modern` and
skipped — so an `app.jsx` sitting in your own directory reports
`0 file(s) clean` without having read a line of it. Run bare
(`mjsx lint`) it checks everything that ships to a device, which is the
form to put in a commit hook.

## 4. See it at the size it will ship at

An app written against a 320x480 panel is not automatically an app that
fits 172x320, and the honest way to find out is to render it there. The
runner takes a size, and the sim cycles the real panel presets from its
toolbar:

```
bun packages/cli/bin/mjsx.js run app.jsx --ppm app.ppm --size 172x320
bun packages/cli/bin/mjsx.js dev counter 240 240 3 --circle
```

(`dev` takes the sim's own arguments after the example name — width,
height, window scale — and passes every `--flag` straight through.)

<div class="shapes">
  <input type="radio" name="sw-ex-counter-4" id="sw-ex-counter-4-0">
  <label for="sw-ex-counter-4-0">
    <img src="/img/ex-counter-round128.png" alt="">
    round<br>240×240
  </label>
  <input type="radio" name="sw-ex-counter-4" id="sw-ex-counter-4-1" checked>
  <label for="sw-ex-counter-4-1">
    <img src="/img/ex-counter-lcd147.png" alt="">
    portrait<br>172×320
  </label>
  <input type="radio" name="sw-ex-counter-4" id="sw-ex-counter-4-2">
  <label for="sw-ex-counter-4-2">
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

<div class="shapes">
  <input type="radio" name="sw-ex-counter-5" id="sw-ex-counter-5-0" checked>
  <label for="sw-ex-counter-5-0">
    <img src="/img/ex-counter-round128.png" alt="">
    round<br>240×240
  </label>
  <input type="radio" name="sw-ex-counter-5" id="sw-ex-counter-5-1">
  <label for="sw-ex-counter-5-1">
    <img src="/img/ex-counter-lcd147.png" alt="">
    portrait<br>172×320
  </label>
  <input type="radio" name="sw-ex-counter-5" id="sw-ex-counter-5-2">
  <label for="sw-ex-counter-5-2">
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

## 5. Put it on a device

The bridge firmware evaluates a pushed JS bundle, so shipping an app is
**not** a reflash. A push bundles mjsx-core, the device shim and your
app, and swaps it over TCP:

```
bun packages/cli/bin/mjsx.js fleet ls                  # what is on the LAN
bun packages/cli/bin/mjsx.js push 192.168.1.50 app.jsx
```

The board is checked for a pulse on port 8765 *before* anything is built,
so a wrong address costs seconds rather than a transpile and a stalled
socket. Nothing else is needed: the JSX is transformed by the repo's own
`packages/core/src/jsx.js` — bun's transpiler is the wrong tool here,
because it *modernises* the ES5 MicroQuickJS requires — and `MJSX_TSC=`
points the bundler at a real `tsc` for anyone who wants to diff the two.
The bundler also runs the step-3 subset check on your source before it
transforms anything, so a stray `let` fails on your machine rather than
on a board with no console.

<div class="shapes">
  <input type="radio" name="sw-ex-hello-6" id="sw-ex-hello-6-0" checked>
  <label for="sw-ex-hello-6-0">
    <img src="/img/ex-hello-round128.png" alt="">
    round<br>240×240
  </label>
  <input type="radio" name="sw-ex-hello-6" id="sw-ex-hello-6-1">
  <label for="sw-ex-hello-6-1">
    <img src="/img/ex-hello-lcd147.png" alt="">
    portrait<br>172×320
  </label>
  <input type="radio" name="sw-ex-hello-6" id="sw-ex-hello-6-2">
  <label for="sw-ex-hello-6-2">
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
      <img src="/img/ex-hello-lcd35.png" alt="examples/hello — The smallest real mjsx app: a panel, a border, some centred text.">
      <figcaption><strong>Portrait, 320×480.</strong> examples/hello — The smallest real mjsx app: a panel, a border, some centred text. <a class="run-example" href="/play/#ex=hello&amp;shape=lcd35">▶ Run it</a></figcaption>
    </figure>
  </div>
</div>

A fresh board needs credentials first, and typing a passphrase into 172px
of glass is no way to live — `mjsx device wifi <port|auto>` provisions
over USB serial instead. Firmware updates go over HTTP with
`mjsx ota <ip> <firmware.bin>`. Both, plus the screenshot/tap loop that
makes on-hardware development bearable, are in
[devices.md](/devices).

## Where to go next

| If you want to | Read |
|---|---|
| Know every element, prop and `UI` call | [ui.md](/ui) |
| Understand how things get placed | [layout.md](/layout) |
| Add text entry | [input.md](/input), [keyboards.md](/keyboards) |
| Use the ready-made components | [components.md](/components) |
| Target round glass | [round.md](/round) |
| Reach pins, buses and sensors | [hardware-api.md](/hardware-api), [sensors.md](/sensors) |
| Write a backend of your own | [contract.md](/contract), [consistency.md](/consistency) |

<div class="shapes">
  <input type="radio" name="sw-ex-input-7" id="sw-ex-input-7-0">
  <label for="sw-ex-input-7-0">
    <img src="/img/ex-input-round128.png" alt="">
    round<br>240×240
  </label>
  <input type="radio" name="sw-ex-input-7" id="sw-ex-input-7-1">
  <label for="sw-ex-input-7-1">
    <img src="/img/ex-input-lcd147.png" alt="">
    portrait<br>172×320
  </label>
  <input type="radio" name="sw-ex-input-7" id="sw-ex-input-7-2">
  <label for="sw-ex-input-7-2">
    <img src="/img/ex-input-lcd169.png" alt="">
    landscape<br>280×240
  </label>
  <input type="radio" name="sw-ex-input-7" id="sw-ex-input-7-3" checked>
  <label for="sw-ex-input-7-3">
    <img src="/img/ex-input-lcd35.png" alt="">
    portrait<br>320×480
  </label>
  <div class="shape-panels">
    <figure>
      <img src="/img/ex-input-round128.png" alt="examples/input — Text input, every way in at once.">
      <figcaption><strong>Round, 240×240.</strong> examples/input — Text input, every way in at once. <a class="run-example" href="/play/#ex=input&amp;shape=round128">▶ Run it</a></figcaption>
    </figure>
    <figure>
      <img src="/img/ex-input-lcd147.png" alt="examples/input — Text input, every way in at once.">
      <figcaption><strong>Portrait, 172×320.</strong> examples/input — Text input, every way in at once. <a class="run-example" href="/play/#ex=input&amp;shape=lcd147">▶ Run it</a></figcaption>
    </figure>
    <figure>
      <img src="/img/ex-input-lcd169.png" alt="examples/input — Text input, every way in at once.">
      <figcaption><strong>Landscape, 280×240.</strong> examples/input — Text input, every way in at once. <a class="run-example" href="/play/#ex=input">▶ Run it</a></figcaption>
    </figure>
    <figure>
      <img src="/img/ex-input-lcd35.png" alt="examples/input — Text input, every way in at once.">
      <figcaption><strong>Portrait, 320×480.</strong> examples/input — Text input, every way in at once. <a class="run-example" href="/play/#ex=input&amp;shape=lcd35">▶ Run it</a></figcaption>
    </figure>
  </div>
</div>

The full index, with pictures of every area, is [README.md](/).
