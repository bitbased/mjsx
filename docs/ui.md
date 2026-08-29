# The app-author API

Everything here is implemented in `packages/core/src/mjsx.js` and works the
same on every backend. Code samples are in the MicroQuickJS-safe ES5 subset,
because app code has to be too: no classes, no arrows, no template literals,
no destructuring, no spread.

## h() and JSX

`h(type, props, ...children)` builds a node. Arrays flatten one level;
`null`, `undefined` and `false` children are dropped, so
`cond && <text .../>` works. A bare string or number child renders as a
size-1 text line in `UI.theme.text`.

`.jsx` files compile to `h()` calls via the repo's `tsconfig.json`
(`"jsxFactory": "h"`); bun does this transparently when a runner loads an
example. A component is a plain function receiving props (children arrive
as `props.children`) and returning a node:

```js
function App() {
  var count = UI.state.count || 0;
  return h('box', { pad: em(2), gap: em(2) },
    h('text', { text: 'COUNT: ' + count, size: 3, align: 'center' }),
    h(Button, { label: '+1', size: 2,
                onTap: function () { UI.set({ count: count + 1 }); } }));
}
UI.mount(App);
```

Layout is width-in, height-out: a node is given a width and reports the
height it used. There is no reconciler; a dirty frame redraws everything.

## Elements

Unknown type names render as `box`.

### box

The block container: children stack vertically, separated by `gap`.

- `pad` — uniform padding; `padL`/`padR`/`padT`/`padB` override per side.
- `gap` — vertical gap between children (default 4). Zero-height children
  (lines, abs overlays) don't consume a gap.
- `w` — fixed width (narrows the box wherever it sits).
- `h` — pinned height. Turns the box into a flex column: children with
  `flex` (or `flex={N}`) split the leftover height by weight.
- `vcenter` — with a pinned height and nothing flexing, centre the content
  vertically (what a stretched button label wants).
- `bg`, `border`, `borderW` (default 1), `radius` — fill and outline.
- `scroll` — with `h`, makes the box a scroll viewport (see below).
- `clip` — confine children's draws and hit areas to the box. The native
  clip is a single rect, so clips don't nest inside one another.
- `offX`, `contentW` — slide children left by `offX` px and let them lay
  out `contentW` wide; with `clip` that is a horizontal scroller (the
  strip keyboard is one).
- `shield` — the box occludes what it covers: taps between its controls
  die here instead of reaching things underneath, and a shield's surface
  has no dead spots — a tap goes to the nearest control on it within
  ~13px. For overlay panels (keyboards, docked toolbars).
- `onTap(localX, localY)`, `onLongPress` (fires once after 500ms),
  `onHold` + `holdEvery` (repeats, default every 320ms), `onDraw`,
  `hitPad` (grow the touch target past the paint by N px).

### row

Children side by side. Fixed-`w` children take their width; the rest split
the remainder evenly.

- `pad`, `gap` (default 4), `bg`, `radius`.
- `h` — pinned row: `box`/`row` children without their own `h` stretch to
  fill it, everything else centres vertically.
- `onTap`, `onLongPress`, `onHold`/`holdEvery`, `onDraw`, `hitPad`.
- On a child: `w` fixes its column; `middle` centres it vertically.

### text

- `text` — the string. `size` — font size step (default 1).
- `color` (default `UI.theme.text`), `align` — `'center'` or `'right'`.
- Default: truncate to the available width, marking the cut with an
  ellipsis glyph. `wrap` word-wraps to multiple lines instead;
  `nowrap` draws the string untrimmed.

### spacer

Empty vertical space: `h` (default 6).

### abs

Escape from the flow: children draw at absolute screen coordinates and
take no flow space. `x`, `y` (default 0), `w` (available width for the
children), `h`. A child's own `w` wins over the abs's.

### input

A single-line text field. The engine owns editing state per `id` (text
when uncontrolled, caret, horizontal scroll), so the app's render stays a
pure description.

- `id` — the state key (default `'_input'`). Two nodes with the same id
  are the same field.
- `value` — controlled text; `defaultValue` — initial text otherwise.
- `onChange(text)` — every edit. `onSubmit(text)` — Enter (also blurs).
- `size`, `w`, `pad`, `bg`, `border`, `color`, `placeholder`,
  `password` (mask with `*`), `maxLen`.
- `focusable={false}` — out of the Tab/arrow focus order.
- `exclusive` — while focused, the keyboard takes the whole display and
  mirrors the field (this also happens automatically when the field
  cannot be scrolled clear of the keyboard).
- `label` — shown by the exclusive keyboard's opt-in header.

Gestures on a field: tap focuses and places the caret; a mostly-vertical
drag scrolls the enclosing scroll zone (fling included); a mostly-
horizontal drag scrolls overflowing text; press-and-hold 400ms then drag
walks the caret under the finger. A scroll passing over a field never
focuses it.

### Other elements

`pbar` (`pct` 0..1, `h`, `color`, `track`), `circle` (`r`, `color`,
`filled`), `line` (`x1,y1,x2,y2` offsets from the flow position, `color`,
`w` thickness; takes no flow height — a fixed-height box full of lines is
a plotting area), `path` (`pts` — a point list or list of subpaths,
`color`, `w`, `fill`, `close`, `join="miter"`; SVG-style outline strokes
and even-odd fills), `canvas` (`src`, `w`, `h` — external pixels via the
backend's `gfx.blit`, a placeholder frame without it).

## State and rendering

- `UI.state` — a plain object, yours to shape.
- `UI.set(patch)` — shallow-merge into `UI.state` and mark the frame
  dirty. All re-rendering flows from this.
- `UI.mount(f)` — set the root component; clears timers and listeners
  left by a previous script (the JS heap survives a live script swap).
- `UI.reset()` — back to power-on: runs `UI.onCleanup` callbacks first,
  then clears state, scroll offsets, inputs, focus, memo, everything.
  For hosts switching apps in one persistent context.
- `UI.onCleanup(fn)` — register teardown for hardware the app started
  (a sensor, a camera); runs on `reset()`.
- `UI.memo(key, deps, build)` — reuse a built subtree while `deps` are
  `===`-equal to last time. List everything the build reads AND
  everything its closures capture; draw-time reads (input text, scroll
  offsets) need no dep.

## Scroll zones

A box with `scroll="name"` and a fixed `h` is a scroll viewport. The
offset is stored under the name in `UI._scroll` and persists across
renders. Drawing and hit areas are clipped to the box; a drag past the
6px tap slop scrolls, and a release with enough velocity flings (decaying
~14% per tick until it stops or hits an end). `step` sets the notch for
`UI.swipe` (a number of pixels, or `'page'` for the viewport height;
default 40).

Overlays (a docked keyboard) extend the scroll range so covered rows can
still be brought into view. On round glass every zone unconditionally
gets a quarter-screen of extra range at the end, so the last rows can be
lifted out of the narrow bottom arc into the wide middle.

## The pointer model

Hosts feed strokes with `UI.pointer(id, phase, x, y)` — phase 0 press,
1 move, 2 release. `id` is 0 for a mouse or single-touch panel; a real
multitouch source passes each finger's identifier and each is tracked
independently.

The engine classifies the stroke:

- A stroke that stays within the 6px slop is a **tap** on where it
  started; the topmost (later-drawn) control wins and its handler gets
  the position within the control.
- Held still for 500ms on a control with `onLongPress`/`onHold`, it
  **holds**: `onLongPress` fires once, `onHold` repeats every
  `holdEvery` ms. `UI.onLongPressFeedback` (if set) is called on a
  non-repeating fire.
- Moving past the slop over a scroll zone **drags** it, and can fling on
  release.
- A control with `onDraw` **owns the whole stroke**: the handler is
  called as `onDraw(phase, localX, localY, pointerId)` for every sample,
  press to release, in the control's own coordinates — no tap, no
  scroll. This is how the drawing example and the strip keyboard work.
- **Edge-back**: a press within 12px of the left or right screen edge
  that travels inward more than 40px, staying mostly level, becomes
  `UI.key('press', 'Escape')` — a back gesture on glass with no corner
  for an exit control.

`UI.scrollBy(x, y, dy)` scrolls the zone under a point by exact pixels
(what a mouse wheel wants); `UI.swipe(x, y, dir)` moves it one notch.
Setting `UI.onPointer(id, phase, x, y)` and returning true takes a stroke
raw, before hit-testing (a touch-calibration screen).

## Keys, focus, inputs

`UI.key(type, key)` is the entry point for anything non-spatial: `type`
is `'down'`, `'up'` or `'press'`; `key` is a browser-style
`KeyboardEvent.key` name (`'Enter'`, `'ArrowUp'`, `'a'`). Every keyboard
— physical, the built-in virtual layouts, a host's native one, an app's
own JSX — travels this road.

While an input is focused it consumes the keyboard: printable characters
insert at the caret (respecting `maxLen`), `Backspace`/`Delete` edit,
arrows/`Home`/`End` move the caret, `Enter` submits and blurs, `Escape`
blurs. `Tab`/`ShiftTab` and `ArrowUp`/`ArrowDown` walk the focus order in
content order — including fields scrolled out of sight, which are
scrolled into view. `UI.focusNav = { tab: true, arrows: true }` turns
either off. A press the editor has no meaning for falls through to
`UI.onKey(type, key)` (down/up strokes stay swallowed while typing);
with nothing focused, every event reaches `UI.onKey`.

`UI.focus(id)`, `UI.blur()`, `UI.focused()`, `UI.focusNext()`,
`UI.focusPrev()` manage focus directly. `UI.type(str)` inserts literal
text into the focused field (the one-call convenience a custom JSX
keyboard wants; names like `'Backspace'` go through `UI.key`). A host
with its own keyboard sets `UI.onFocusChange` (called with the focused
id, or null on blur) to know when to show it. `UI.exclusive()` reports
whether the keyboard should take the whole display.

## Timers

`UI.setTimer(fn, ms)` returns an id; `UI.clearTimer(id)` cancels.
Deliberately not named `setTimeout`: it fires no more often than the
host's tick allows — fine for debouncing and delayed dismissals, not a
precision promise.

## configStorage

`configStorage.get(key, dflt)` / `configStorage.set(key, value)` —
persistent settings, one name on every host: `sys.store`/`sys.fetch`
(NVS) where the backend has them, `localStorage` on the web, plain
memory as the last resort. String values only — JSON-encode structures
yourself.

## Safe insets and round glass

`UI.safe = { top, left, bottom, right, inset }` marks edge bands where
the display's touch is unreliable. By default nothing changes visually:
controls and scroll zones touching a band have their touch targets
extended to the physical edge. `UI.safe.inset = true` additionally holds
the layout inside the safe rect (background still full-bleed) and snaps
band touches to the content edge — for truly dead rims and round glass.

`UI.isRound()` — true when the host seeded `configStorage`'s `'round'`
key with `'1'`. Read once, cached; layouts use it to stay off corners
that do not exist.

## Ready-made components

Defined in the core, optional: `Button`, `Swatch`, `Modal` (with
`UI.openModal`/`UI.closeModal` — a modal is just a component drawn last
that takes all input), `Keyboard` (layouts `qwerty`, `numbers`, `t9`,
`strip`; `position` `'inline'`/`'top'`/`'bottom'`), `ArcFooter` (edge
controls that follow the glass's shape; global under flat eval, not in
the CommonJS export list), and `em(n)` — text-relative spacing, n
line-heights snapped to the font's alignment quantum.
