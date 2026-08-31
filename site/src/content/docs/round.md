---
title: "Designing for round glass"
description: "Designing for a circle: chords, arcs and the rules that follow."
---
<!-- GENERATED from docs/round.md by scripts/docs-sync.mjs. Edit that file. -->The round board is a 240x240 GC9A01 panel with the corners missing. Almost
everything else in mjsx ignores that; a handful of things must not. This
page is the list of things that must not, each with the picture of what
goes wrong or right.

The rule underneath all of it: **an app does not branch on the board.** It
asks the shape one question, `UI.isRound()`, and the layout primitives
handle the rest. The page below is the same source on both shapes.

- [One page, two shapes](#one-page-two-shapes)
- [Asking the shape: `UI.isRound()`](#asking-the-shape-uiisround)
- [The safe rect: holding the flow inside the circle](#the-safe-rect-holding-the-flow-inside-the-circle)
- [The chord: how wide the glass is at a given height](#the-chord-how-wide-the-glass-is-at-a-given-height)
- [Chord-fitted rows vs one uniform width](#chord-fitted-rows-vs-one-uniform-width)
- [ArcFooter: controls along the rim](#arcfooter-controls-along-the-rim)
- [The end margin: a quarter screen of overscroll](#the-end-margin-a-quarter-screen-of-overscroll)
- [The edge-back swipe](#the-edge-back-swipe)
- [Where controls go](#where-controls-go)
- [What to check on a round build](#what-to-check-on-a-round-build)

## One page, two shapes

One list, one footer, one source file. The shot script runs it unchanged
on the 3.5" rectangle and on the round 1.28".

<div class="shapes">
  <input type="radio" name="sw-round-page-0" id="sw-round-page-0-0">
  <label for="sw-round-page-0-0">
    <img src="/img/round-page-round128.png" alt="">
    round<br>240×240
  </label>
  <input type="radio" name="sw-round-page-0" id="sw-round-page-0-1" checked>
  <label for="sw-round-page-0-1">
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
  <input type="radio" name="sw-round-page-1" id="sw-round-page-1-0" checked>
  <label for="sw-round-page-1-0">
    <img src="/img/round-page-round128.png" alt="">
    round<br>240×240
  </label>
  <input type="radio" name="sw-round-page-1" id="sw-round-page-1-1">
  <label for="sw-round-page-1-1">
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

The whole of the shape-awareness is the first three lines
(`scripts/shoot.mjs`, `SHAPE_PAGE` — the page these two shots run):

```js
UI.safe = UI.isRound()
  ? { top: 36, left: 36, right: 36, bottom: 60, inset: true }
  : { top: 0, left: 0, right: 0, bottom: 44, inset: true };
UI.mount(function () {
  var rows = [];
  var names = ['PLA MATTE', 'PETG BLACK', 'ABS RED', 'TPU CLEAR', 'PLA SILK'];
  for (var i = 0; i < names.length; i++) {
    rows.push(h('row', { bg: UI.theme.panel, radius: 6, pad: 8, gap: 8, h: 34 }, [
      h(Swatch, { color: [0x4ade80, 0x98a1ae, 0xf87171, 0x4b8bf5, 0xfbbf24][i],
                  size: 18, w: 18 }),
      h('text', { text: names[i], size: 1, middle: true })
    ]));
  }
  return h('box', { h: gfx.height(), pad: em(1), gap: em(0.5) }, [
    h('text', { text: 'SPOOLS', size: 2, align: 'center', color: UI.theme.accent }),
    h('box', { flex: 1, scroll: 'spools', gap: 4 }, rows),
    h(ArcFooter, { items: [ /* three 44x30 buttons */ ], at: 90, spread: 60 })
  ]);
});
```

Nothing below that ternary asks what the glass is.

## Asking the shape: `UI.isRound()`

The app does not measure the panel and guess. **The host declares it**, and
the answer never changes while the process runs, so the core reads it once
and caches (`packages/core/src/mjsx.js`):

```js
isRound: function () {
  if (this._round === undefined) {
    this._round = configStorage.get('round', '0') === '1';
  }
  return this._round;
},
```

The channel is `configStorage`'s `'round'` key, and the firmware seeds it
at boot before any script can read it — the round build compiles with
`ROUND_DISPLAY`, so the board knows what it is and the bundle never has to
(`mjsx-board.ino`):

```cpp
#if defined(ROUND_DISPLAY) && ROUND_DISPLAY
  {
    // The bundle asks configStorage whether the glass is round; the
    // host answers once, through the same store (UI.isRound()).
    Preferences pf;
    pf.begin("jsapp", false);
    if (pf.getString("round", "") != "1") pf.putString("round", "1");
    pf.end();
  }
#endif
```

A host that says nothing leaves the key unset, so `isRound()` is false and
the default `'0'` does the right thing — which is what the terminal and the
SDL sim do today (see D4 in [`consistency.md`](/consistency): the sim
draws a circular *mask* without telling the core, so it previews the shape
without the behaviour).

Everything that does claim to show round glass seeds the key exactly as the
firmware does. The headless shot renderer sets
`backend.sys.store('round', '1')` on a round profile, the golden matrix
does the same before requiring an example, and the browser
[simulator](/simulator) sets it from the panel you choose. That is why
the round pictures on this page come out of the same code path a board
runs, and why picking round glass in the simulator changes behaviour and
not just the outline.

## The safe rect: holding the flow inside the circle

`UI.safe = { top, left, bottom, right, inset }` marks edge bands. With
`inset: true` the *layout* is held inside the safe rect while the
background still paints full-bleed, and touches in the band snap to the
content edge. That is the one mechanism that keeps ordinary rectangular
rows on round glass — see [`ui.md`](/ui) for the general contract.

The numbers are geometry, not taste. On the 240px circle, a 36px inset on
three sides leaves a 168px-wide band; its top corners sit
`sqrt(84² + 84²) = 118.8px` from centre, inside the 120px radius, so the
whole rectangle is on the glass. The bottom band is 60px instead of 36
because the footer lives there.

<div class="shapes">
  <input type="radio" name="sw-input-empty-2" id="sw-input-empty-2-0" checked>
  <label for="sw-input-empty-2-0">
    <img src="/img/input-empty-round128.png" alt="">
    round<br>240×240
  </label>
  <input type="radio" name="sw-input-empty-2" id="sw-input-empty-2-1">
  <label for="sw-input-empty-2-1">
    <img src="/img/input-empty-lcd35.png" alt="">
    portrait<br>320×480
  </label>
  <div class="shape-panels">
    <figure>
      <img src="/img/input-empty-round128.png" alt="The same field page on round glass, unfocused: the corners the layout cannot use.">
      <figcaption><strong>Round, 240×240.</strong> The same field page on round glass, unfocused: the corners the layout cannot use.</figcaption>
    </figure>
    <figure>
      <img src="/img/input-empty-lcd35.png" alt="Fields at rest: muted border, placeholder text, no caret — nothing is focused.">
      <figcaption><strong>Portrait, 320×480.</strong> Fields at rest: muted border, placeholder text, no caret — nothing is focused.</figcaption>
    </figure>
  </div>
</div>

Text metrics need no round-specific handling at all — `em()` follows the
picked font face, so a page written once relays out for the smaller panel
with no size in the source changing:

<div class="shapes">
  <input type="radio" name="sw-font-auto-3" id="sw-font-auto-3-0" checked>
  <label for="sw-font-auto-3-0">
    <img src="/img/font-auto-round128.png" alt="">
    round<br>240×240
  </label>
  <input type="radio" name="sw-font-auto-3" id="sw-font-auto-3-1">
  <label for="sw-font-auto-3-1">
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

Modals get it for free, because their margins are minimums rather than
fixed offsets:

<div class="shapes">
  <input type="radio" name="sw-comp-modal-4" id="sw-comp-modal-4-0">
  <label for="sw-comp-modal-4-0">
    <img src="/img/comp-modal-round128.png" alt="">
    round<br>240×240
  </label>
  <input type="radio" name="sw-comp-modal-4" id="sw-comp-modal-4-1" checked>
  <label for="sw-comp-modal-4-1">
    <img src="/img/comp-modal-lcd35.png" alt="">
    portrait<br>320×480
  </label>
  <div class="shape-panels">
    <figure>
      <img src="/img/comp-modal-round128.png" alt="The same modal on round glass — margins are minimums, so the panel keeps clear of the rim.">
      <figcaption><strong>Round, 240×240.</strong> The same modal on round glass — margins are minimums, so the panel keeps clear of the rim.</figcaption>
    </figure>
    <figure>
      <img src="/img/comp-modal-lcd35.png" alt="Modal: a centred panel over the page it interrupts, with sticky header and footer rows. Everything under it stops listening.">
      <figcaption><strong>Portrait, 320×480.</strong> Modal: a centred panel over the page it interrupts, with sticky header and footer rows. Everything under it stops listening.</figcaption>
    </figure>
  </div>
</div>

<div class="shapes">
  <input type="radio" name="sw-comp-modal-5" id="sw-comp-modal-5-0" checked>
  <label for="sw-comp-modal-5-0">
    <img src="/img/comp-modal-round128.png" alt="">
    round<br>240×240
  </label>
  <input type="radio" name="sw-comp-modal-5" id="sw-comp-modal-5-1">
  <label for="sw-comp-modal-5-1">
    <img src="/img/comp-modal-lcd35.png" alt="">
    portrait<br>320×480
  </label>
  <div class="shape-panels">
    <figure>
      <img src="/img/comp-modal-round128.png" alt="The same modal on round glass — margins are minimums, so the panel keeps clear of the rim.">
      <figcaption><strong>Round, 240×240.</strong> The same modal on round glass — margins are minimums, so the panel keeps clear of the rim.</figcaption>
    </figure>
    <figure>
      <img src="/img/comp-modal-lcd35.png" alt="Modal: a centred panel over the page it interrupts, with sticky header and footer rows. Everything under it stops listening.">
      <figcaption><strong>Portrait, 320×480.</strong> Modal: a centred panel over the page it interrupts, with sticky header and footer rows. Everything under it stops listening.</figcaption>
    </figure>
  </div>
</div>

## The chord: how wide the glass is at a given height

A circle's width depends on where you measure. `gfx.width()` is 240 on the
round board, and that number is only true across the exact middle. Any row
that is not in the middle has less. The core computes the real number —
half the chord across a horizontal band, taking whichever of the two edges
is farther from centre, minus a hair for the bezel:

```js
function kbChordHW(yTop, yBot) {
  var c = gfx.height() / 2, r = c - 2;
  var a = yTop < c ? c - yTop : yTop - c;
  var b = yBot < c ? c - yBot : yBot - c;
  if (b > a) a = b;
  if (a >= r) return 0;
  return Math.floor(Math.sqrt(r * r - a * a)) - 3;
}
```

Two places in the core use it, and both are worth copying.

**One: deciding what fits.** The keyboard's `auto` layout picks by width,
and the width it asks about is the chord down where the bottom rows sit,
not the bounding box:

```js
if (UI.isRound()) kbW = kbChordHW(gfx.height() * 0.72, gfx.height() * 0.86) * 2;
```

On the 240px circle that band is 154px across, not 240. QWERTY wants ~220,
T9 wants ~115, so the honest measurement picks T9 and the naive one would
have picked a QWERTY whose outer columns were under the bezel.

<div class="shapes">
  <input type="radio" name="sw-kb-auto-6" id="sw-kb-auto-6-0" checked>
  <label for="sw-kb-auto-6-0">
    <img src="/img/kb-auto-round128.png" alt="">
    round<br>240×240
  </label>
  <input type="radio" name="sw-kb-auto-6" id="sw-kb-auto-6-1">
  <label for="sw-kb-auto-6-1">
    <img src="/img/kb-auto-lcd147.png" alt="">
    portrait<br>172×320
  </label>
  <input type="radio" name="sw-kb-auto-6" id="sw-kb-auto-6-2">
  <label for="sw-kb-auto-6-2">
    <img src="/img/kb-auto-lcd35.png" alt="">
    portrait<br>320×480
  </label>
  <input type="radio" name="sw-kb-auto-6" id="sw-kb-auto-6-3">
  <label for="sw-kb-auto-6-3">
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

**Two: shaping each row.** `kbRoundRow` insets a row to the chord at its
own height, so a round keyboard is a **trapezoid** — the bottom row is
narrowest because it is nearest the rim, which is exactly where an un-inset
layout puts the space bar and OK.

<div class="shapes">
  <input type="radio" name="sw-kb-qwerty-7" id="sw-kb-qwerty-7-0" checked>
  <label for="sw-kb-qwerty-7-0">
    <img src="/img/kb-qwerty-round128.png" alt="">
    round<br>240×240
  </label>
  <input type="radio" name="sw-kb-qwerty-7" id="sw-kb-qwerty-7-1">
  <label for="sw-kb-qwerty-7-1">
    <img src="/img/kb-qwerty-lcd147.png" alt="">
    portrait<br>172×320
  </label>
  <input type="radio" name="sw-kb-qwerty-7" id="sw-kb-qwerty-7-2">
  <label for="sw-kb-qwerty-7-2">
    <img src="/img/kb-qwerty-lcd35.png" alt="">
    portrait<br>320×480
  </label>
  <input type="radio" name="sw-kb-qwerty-7" id="sw-kb-qwerty-7-3">
  <label for="sw-kb-qwerty-7-3">
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
  <input type="radio" name="sw-kb-t9-8" id="sw-kb-t9-8-0" checked>
  <label for="sw-kb-t9-8-0">
    <img src="/img/kb-t9-round128.png" alt="">
    round<br>240×240
  </label>
  <input type="radio" name="sw-kb-t9-8" id="sw-kb-t9-8-1">
  <label for="sw-kb-t9-8-1">
    <img src="/img/kb-t9-lcd147.png" alt="">
    portrait<br>172×320
  </label>
  <input type="radio" name="sw-kb-t9-8" id="sw-kb-t9-8-2">
  <label for="sw-kb-t9-8-2">
    <img src="/img/kb-t9-lcd35.png" alt="">
    portrait<br>320×480
  </label>
  <div class="shape-panels">
    <figure>
      <img src="/img/kb-t9-round128.png" alt="The T9 layout on round glass: at a quarter-screen height the keys come out under a finger, so the keyboard takes the whole display and insets every row to the chord it actually has — the trapezoid. OK moves into the bottom arc — space a full-width row could never use.">
      <figcaption><strong>Round, 240×240.</strong> The T9 layout on round glass: at a quarter-screen height the keys come out under a finger, so the keyboard takes the whole display and insets every row to the chord it actually has — the trapezoid. OK moves into the bottom arc — space a full-width row could never use.</figcaption>
    </figure>
    <figure>
      <img src="/img/kb-t9-lcd147.png" alt="The T9 layout docked at the bottom of lcd147 (172x320), field focused: a named layout is honoured exactly, however cramped.">
      <figcaption><strong>Portrait, 172×320.</strong> The T9 layout docked at the bottom of lcd147 (172x320), field focused: a named layout is honoured exactly, however cramped.</figcaption>
    </figure>
    <figure>
      <img src="/img/kb-t9-lcd35.png" alt="The T9 layout docked at the bottom of lcd35 (320x480), field focused: a named layout is honoured exactly, however cramped.">
      <figcaption><strong>Portrait, 320×480.</strong> The T9 layout docked at the bottom of lcd35 (320x480), field focused: a named layout is honoured exactly, however cramped.</figcaption>
    </figure>
  </div>
</div>

The exception proves the mechanism. A keyboard that stays **docked** is not
chord-inset, because a docked panel is a screen-edge overlay:

<div class="shapes">
  <input type="radio" name="sw-kb-strip-9" id="sw-kb-strip-9-0" checked>
  <label for="sw-kb-strip-9-0">
    <img src="/img/kb-strip-round128.png" alt="">
    round<br>240×240
  </label>
  <input type="radio" name="sw-kb-strip-9" id="sw-kb-strip-9-1">
  <label for="sw-kb-strip-9-1">
    <img src="/img/kb-strip-lcd147.png" alt="">
    portrait<br>172×320
  </label>
  <input type="radio" name="sw-kb-strip-9" id="sw-kb-strip-9-2">
  <label for="sw-kb-strip-9-2">
    <img src="/img/kb-strip-lcd35.png" alt="">
    portrait<br>320×480
  </label>
  <div class="shape-panels">
    <figure>
      <img src="/img/kb-strip-round128.png" alt="STRIP on round glass. Its two rows are tall enough to stay DOCKED, and a docked panel is NOT chord-inset — so the side keys run under the rim. The four-row layouts go full-display instead, and inset.">
      <figcaption><strong>Round, 240×240.</strong> STRIP on round glass. Its two rows are tall enough to stay DOCKED, and a docked panel is NOT chord-inset — so the side keys run under the rim. The four-row layouts go full-display instead, and inset.</figcaption>
    </figure>
    <figure>
      <img src="/img/kb-strip-lcd147.png" alt="The STRIP layout docked at the bottom of lcd147 (172x320), field focused: a named layout is honoured exactly, however cramped.">
      <figcaption><strong>Portrait, 172×320.</strong> The STRIP layout docked at the bottom of lcd147 (172x320), field focused: a named layout is honoured exactly, however cramped.</figcaption>
    </figure>
    <figure>
      <img src="/img/kb-strip-lcd35.png" alt="The STRIP layout docked at the bottom of lcd35 (320x480), field focused: a named layout is honoured exactly, however cramped.">
      <figcaption><strong>Portrait, 320×480.</strong> The STRIP layout docked at the bottom of lcd35 (320x480), field focused: a named layout is honoured exactly, however cramped.</figcaption>
    </figure>
  </div>
</div>

## Chord-fitted rows vs one uniform width

The keyboard fits every row to its own chord. **Lists should not.** The
keyboard is a grid of keys where each row is visibly its own object and a
stepped edge reads as shape; a list of rows is meant to read as one column,
and per-row widths make that column look like it is wobbling as it scrolls.

So content pages take a single uniform inset that the whole circle
contains — the safe rect above — and let the corners go unused. The
sensors example states it in one line
(`examples/sensors/app.jsx`):

```js
/* Round glass gets a uniform inset that keeps every panel inside the
   circle. The SHORT labels are a question of width, not shape: the
   1.47" is a perfectly square 172px panel and truncates
   "acceleration" just as readily as the circle does. */
var round = UI.isRound();
var narrow = round || gfx.width() < 200;
```

<div class="shapes">
  <input type="radio" name="sw-ex-sensors-10" id="sw-ex-sensors-10-0" checked>
  <label for="sw-ex-sensors-10-0">
    <img src="/img/ex-sensors-round128.png" alt="">
    round<br>240×240
  </label>
  <input type="radio" name="sw-ex-sensors-10" id="sw-ex-sensors-10-1">
  <label for="sw-ex-sensors-10-1">
    <img src="/img/ex-sensors-lcd147.png" alt="">
    portrait<br>172×320
  </label>
  <input type="radio" name="sw-ex-sensors-10" id="sw-ex-sensors-10-2">
  <label for="sw-ex-sensors-10-2">
    <img src="/img/ex-sensors-lcd169.png" alt="">
    landscape<br>280×240
  </label>
  <input type="radio" name="sw-ex-sensors-10" id="sw-ex-sensors-10-3">
  <label for="sw-ex-sensors-10-3">
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

The second half of that comment is the other half of the lesson. **Narrow
is not the same question as round.** Label truncation is a width problem,
and the 172px 1.47" rectangle hits it just as hard as the circle, so the
example gates short labels on `round || gfx.width() < 200` rather than on
shape alone:

<div class="shapes">
  <input type="radio" name="sw-ex-sensors-11" id="sw-ex-sensors-11-0">
  <label for="sw-ex-sensors-11-0">
    <img src="/img/ex-sensors-round128.png" alt="">
    round<br>240×240
  </label>
  <input type="radio" name="sw-ex-sensors-11" id="sw-ex-sensors-11-1" checked>
  <label for="sw-ex-sensors-11-1">
    <img src="/img/ex-sensors-lcd147.png" alt="">
    portrait<br>172×320
  </label>
  <input type="radio" name="sw-ex-sensors-11" id="sw-ex-sensors-11-2">
  <label for="sw-ex-sensors-11-2">
    <img src="/img/ex-sensors-lcd169.png" alt="">
    landscape<br>280×240
  </label>
  <input type="radio" name="sw-ex-sensors-11" id="sw-ex-sensors-11-3">
  <label for="sw-ex-sensors-11-3">
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

## ArcFooter: controls along the rim

`ArcFooter` places finished items where the ray from screen-centre at each
item's angle meets the boundary, pulled inward by the item's own size. On
round glass the boundary is the rim; on square glass it is the rectangle's
perimeter. One call serves both:

```js
var round = UI.isRound();
var inset = p.inset === undefined ? (round ? 10 : 8) : p.inset;
var spread = (p.spread || 120) * Math.PI / 180;
var a0 = (p.at === undefined ? 90 : p.at) * Math.PI / 180 - spread / 2;
/* ...then, per item, at angle `ang` along the sweep: */
var c = Math.cos(ang), s = Math.sin(ang);
var d;
if (round) {
  var big = items[i].w > items[i].h ? items[i].w : items[i].h;
  d = H / 2 - inset - big / 2;
} else {
  var hx = W / 2 - inset - items[i].w / 2;
  var hy = H / 2 - inset - items[i].h / 2;
  var tx = c < 0 ? -hx / c : (c > 0 ? hx / c : 1e9);
  var ty = s < 0 ? -hy / s : (s > 0 ? hy / s : 1e9);
  d = tx < ty ? tx : ty;
}
```

Props: `items` (`[{ w, h, node }]` — finished elements, `w`/`h` centre each
on its boundary point without measuring), `at` (centre angle, 90 = bottom
and the default, 270 = top), `spread` (total sweep, default 120), `inset`
(margin from the boundary, default 10 round / 8 square). Full prop notes
live in [`components.md`](/components).

<div class="shapes">
  <input type="radio" name="sw-comp-arcfooter-12" id="sw-comp-arcfooter-12-0" checked>
  <label for="sw-comp-arcfooter-12-0">
    <img src="/img/comp-arcfooter-round128.png" alt="">
    round<br>240×240
  </label>
  <input type="radio" name="sw-comp-arcfooter-12" id="sw-comp-arcfooter-12-1">
  <label for="sw-comp-arcfooter-12-1">
    <img src="/img/comp-arcfooter-lcd35.png" alt="">
    portrait<br>320×480
  </label>
  <input type="radio" name="sw-comp-arcfooter-12" id="sw-comp-arcfooter-12-2">
  <label for="sw-comp-arcfooter-12-2">
    <img src="/img/comp-arcfooter-wide.png" alt="">
    landscape<br>480×320
  </label>
  <div class="shape-panels">
    <figure>
      <img src="/img/comp-arcfooter-round128.png" alt="ArcFooter on round glass: five items on the bottom arc, each pulled in from the rim by its own size, all upright.">
      <figcaption><strong>Round, 240×240.</strong> ArcFooter on round glass: five items on the bottom arc, each pulled in from the rim by its own size, all upright.</figcaption>
    </figure>
    <figure>
      <img src="/img/comp-arcfooter-lcd35.png" alt="The identical ArcFooter call on a rectangle: the boundary is the perimeter, so the arc becomes the bottom edge and a wide spread walks the corners.">
      <figcaption><strong>Portrait, 320×480.</strong> The identical ArcFooter call on a rectangle: the boundary is the perimeter, so the arc becomes the bottom edge and a wide spread walks the corners.</figcaption>
    </figure>
    <figure>
      <img src="/img/comp-arcfooter-wide.png" alt="The same call again on a 480x320 desktop window.">
      <figcaption><strong>Landscape, 480×320.</strong> The same call again on a 480x320 desktop window.</figcaption>
    </figure>
  </div>
</div>

<div class="shapes">
  <input type="radio" name="sw-comp-arcfooter-13" id="sw-comp-arcfooter-13-0">
  <label for="sw-comp-arcfooter-13-0">
    <img src="/img/comp-arcfooter-round128.png" alt="">
    round<br>240×240
  </label>
  <input type="radio" name="sw-comp-arcfooter-13" id="sw-comp-arcfooter-13-1" checked>
  <label for="sw-comp-arcfooter-13-1">
    <img src="/img/comp-arcfooter-lcd35.png" alt="">
    portrait<br>320×480
  </label>
  <input type="radio" name="sw-comp-arcfooter-13" id="sw-comp-arcfooter-13-2">
  <label for="sw-comp-arcfooter-13-2">
    <img src="/img/comp-arcfooter-wide.png" alt="">
    landscape<br>480×320
  </label>
  <div class="shape-panels">
    <figure>
      <img src="/img/comp-arcfooter-round128.png" alt="ArcFooter on round glass: five items on the bottom arc, each pulled in from the rim by its own size, all upright.">
      <figcaption><strong>Round, 240×240.</strong> ArcFooter on round glass: five items on the bottom arc, each pulled in from the rim by its own size, all upright.</figcaption>
    </figure>
    <figure>
      <img src="/img/comp-arcfooter-lcd35.png" alt="The identical ArcFooter call on a rectangle: the boundary is the perimeter, so the arc becomes the bottom edge and a wide spread walks the corners.">
      <figcaption><strong>Portrait, 320×480.</strong> The identical ArcFooter call on a rectangle: the boundary is the perimeter, so the arc becomes the bottom edge and a wide spread walks the corners.</figcaption>
    </figure>
    <figure>
      <img src="/img/comp-arcfooter-wide.png" alt="The same call again on a 480x320 desktop window.">
      <figcaption><strong>Landscape, 480×320.</strong> The same call again on a 480x320 desktop window.</figcaption>
    </figure>
  </div>
</div>

<div class="shapes">
  <input type="radio" name="sw-comp-arcfooter-14" id="sw-comp-arcfooter-14-0">
  <label for="sw-comp-arcfooter-14-0">
    <img src="/img/comp-arcfooter-round128.png" alt="">
    round<br>240×240
  </label>
  <input type="radio" name="sw-comp-arcfooter-14" id="sw-comp-arcfooter-14-1">
  <label for="sw-comp-arcfooter-14-1">
    <img src="/img/comp-arcfooter-lcd35.png" alt="">
    portrait<br>320×480
  </label>
  <input type="radio" name="sw-comp-arcfooter-14" id="sw-comp-arcfooter-14-2" checked>
  <label for="sw-comp-arcfooter-14-2">
    <img src="/img/comp-arcfooter-wide.png" alt="">
    landscape<br>480×320
  </label>
  <div class="shape-panels">
    <figure>
      <img src="/img/comp-arcfooter-round128.png" alt="ArcFooter on round glass: five items on the bottom arc, each pulled in from the rim by its own size, all upright.">
      <figcaption><strong>Round, 240×240.</strong> ArcFooter on round glass: five items on the bottom arc, each pulled in from the rim by its own size, all upright.</figcaption>
    </figure>
    <figure>
      <img src="/img/comp-arcfooter-lcd35.png" alt="The identical ArcFooter call on a rectangle: the boundary is the perimeter, so the arc becomes the bottom edge and a wide spread walks the corners.">
      <figcaption><strong>Portrait, 320×480.</strong> The identical ArcFooter call on a rectangle: the boundary is the perimeter, so the arc becomes the bottom edge and a wide spread walks the corners.</figcaption>
    </figure>
    <figure>
      <img src="/img/comp-arcfooter-wide.png" alt="The same call again on a 480x320 desktop window.">
      <figcaption><strong>Landscape, 480×320.</strong> The same call again on a 480x320 desktop window.</figcaption>
    </figure>
  </div>
</div>

Two rules the pictures make concrete:

- **Items stay upright. Text is never rotated.** Only positions follow the
  edge. Rotated glyphs are neither drawable by the text primitive nor
  readable at these sizes.
- **Put wide items mid-list.** The boundary is most generous near the
  centre angle; angles that cluster at a square's corner can overlap, so
  keep `spread` and item count sane, and check the square shot as well as
  the round one.

An arc footer is also how a round app buys back the screen a toolbar would
have cost. `examples/draw/app.jsx` moves its whole toolbar to the rim when
the glass is round:

```jsx
if (UI.isRound()) {
  var items = [];
  items.push({ w: 38, h: 22, node:
    <Button label={tool.toUpperCase()} size={1} pad={em(0.25)} h={22} w={38}
            bg={0x2e4a37} color={0x9fe8b9}
            onTap={function () { /* cycle the tool */ }} /> });
  // ... the colour swatches climb the rim from there
}
```

## The end margin: a quarter screen of overscroll

The bottom arc is the narrowest part of the display, and it is where the
last row of any list ends up. So every scroll zone on round glass gets a
quarter-screen of extra range, **unconditionally**:

```js
/* Round glass: a quarter-screen of extra range, UNCONDITIONALLY,
   so the last rows can be lifted out of the narrow bottom arc
   into the wide middle. Content that FITS the square still
   drowns in the circle — a zone whose maxOff computed to zero is
   exactly the one whose bottom row is stuck in the arc. */
if (UI.isRound()) maxOff += gfx.height() >> 2;
```

On the 240px panel that is 60px of overscroll. The "unconditionally" is
load-bearing: the zone that most needs the margin is the short one whose
content already fits, because its `maxOff` is zero and without this line it
cannot be scrolled at all — leaving its last row parked in the arc
permanently.

<div class="shapes">
  <input type="radio" name="sw-layout-scroll-end-15" id="sw-layout-scroll-end-15-0" checked>
  <label for="sw-layout-scroll-end-15-0">
    <img src="/img/layout-scroll-end-round128.png" alt="">
    round<br>240×240
  </label>
  <input type="radio" name="sw-layout-scroll-end-15" id="sw-layout-scroll-end-15-1">
  <label for="sw-layout-scroll-end-15-1">
    <img src="/img/layout-scroll-end-lcd35.png" alt="">
    portrait<br>320×480
  </label>
  <div class="shape-panels">
    <figure>
      <img src="/img/layout-scroll-end-round128.png" alt="The round end-margin: every scroll zone on round glass gets a quarter-screen of extra range at the end, so the last rows can be lifted out of the narrow bottom arc into the wide middle.">
      <figcaption><strong>Round, 240×240.</strong> The round end-margin: every scroll zone on round glass gets a quarter-screen of extra range at the end, so the last rows can be lifted out of the narrow bottom arc into the wide middle.</figcaption>
    </figure>
    <figure>
      <img src="/img/layout-scroll-end-lcd35.png" alt="The same zone scrolled to its end on square glass, for comparison: the last row stops at the bottom edge with no extra margin.">
      <figcaption><strong>Portrait, 320×480.</strong> The same zone scrolled to its end on square glass, for comparison: the last row stops at the bottom edge with no extra margin.</figcaption>
    </figure>
  </div>
</div>

<div class="shapes">
  <input type="radio" name="sw-layout-scroll-end-16" id="sw-layout-scroll-end-16-0">
  <label for="sw-layout-scroll-end-16-0">
    <img src="/img/layout-scroll-end-round128.png" alt="">
    round<br>240×240
  </label>
  <input type="radio" name="sw-layout-scroll-end-16" id="sw-layout-scroll-end-16-1" checked>
  <label for="sw-layout-scroll-end-16-1">
    <img src="/img/layout-scroll-end-lcd35.png" alt="">
    portrait<br>320×480
  </label>
  <div class="shape-panels">
    <figure>
      <img src="/img/layout-scroll-end-round128.png" alt="The round end-margin: every scroll zone on round glass gets a quarter-screen of extra range at the end, so the last rows can be lifted out of the narrow bottom arc into the wide middle.">
      <figcaption><strong>Round, 240×240.</strong> The round end-margin: every scroll zone on round glass gets a quarter-screen of extra range at the end, so the last rows can be lifted out of the narrow bottom arc into the wide middle.</figcaption>
    </figure>
    <figure>
      <img src="/img/layout-scroll-end-lcd35.png" alt="The same zone scrolled to its end on square glass, for comparison: the last row stops at the bottom edge with no extra margin.">
      <figcaption><strong>Portrait, 320×480.</strong> The same zone scrolled to its end on square glass, for comparison: the last row stops at the bottom edge with no extra margin.</figcaption>
    </figure>
  </div>
</div>

![The round SPOOLS page scrolled to its end](/img/round-page-scrolled-round128.png)

*The end margin in a real page: the bottom of the list is readable in the
middle of the circle rather than crushed against the rim.*

`UI._scrollTo` clamps to the same `maxOff`, so programmatic scrolls,
flings, and `scrollBy` all inherit the margin — round overscroll is baked
into the zone's limit rather than applied at each call site.

## The edge-back swipe

Round glass has no corner to put a close button in. Rather than spend rim
space on one, the core makes an inward swipe from either rim send Escape —
the same key the BOOT button sends, so an app that already handles hardware
back needs no round-specific code.

Arming, at press time:

```js
/* EDGE-BACK: a press at the left or right rim arms the gesture;
   travelling inward turns the stroke into Escape. +1 = inward is
   rightward, -1 leftward, 0 = not an edge press. */
eb: x < 12 ? 1 : (x > gfx.width() - 12 ? -1 : 0)
```

Firing, on move:

```js
if (p.eb && !p.fired) {
  var inw = dx * p.eb;
  if (inw > 40 && (dy < 0 ? -dy : dy) < 60) {
    p.fired = 1;
    p.key = null;
    this.key('press', 'Escape');
    return;
  }
}
```

The thresholds: the press must start within 12px of a side, travel more
than 40px inward, and stay within 60px vertically. It is not round-only —
every screen gets it — and drawing surfaces never see it, because a canvas
that has taken the stroke owns it before this code is reached.

## Where controls go

**OK goes in the bottom arc.** Below the last key row of a full-display
keyboard there is a sliver of glass too narrow for a full-width row and
perfectly sized for one button. Every layout but `strip` parks OK there,
and caps its width to the chord it actually has:

```js
var okInArc = UI.isRound() && layout !== 'strip' && !!UI._exclusive;
...
var okW2 = Math.min(kbChordHW(okTop, okTop + okH2) * 2, em(10));
```

Because the arc was unusable space, moving OK there costs the key grid no
height at all.

Note the `UI._exclusive` term: **only the full-display view draws that
arc**, so only it may take OK out of the rows. The flag does both jobs, and
deciding it from the shape alone — before the auto-exclusive rule has even
run — left a *docked* round T9 with no OK key anywhere: dropped from the
row, and no arc to put it in.

<div class="shapes">
  <input type="radio" name="sw-kb-numbers-17" id="sw-kb-numbers-17-0" checked>
  <label for="sw-kb-numbers-17-0">
    <img src="/img/kb-numbers-round128.png" alt="">
    round<br>240×240
  </label>
  <input type="radio" name="sw-kb-numbers-17" id="sw-kb-numbers-17-1">
  <label for="sw-kb-numbers-17-1">
    <img src="/img/kb-numbers-lcd147.png" alt="">
    portrait<br>172×320
  </label>
  <input type="radio" name="sw-kb-numbers-17" id="sw-kb-numbers-17-2">
  <label for="sw-kb-numbers-17-2">
    <img src="/img/kb-numbers-lcd35.png" alt="">
    portrait<br>320×480
  </label>
  <div class="shape-panels">
    <figure>
      <img src="/img/kb-numbers-round128.png" alt="The NUMBERS layout on round glass: at a quarter-screen height the keys come out under a finger, so the keyboard takes the whole display and insets every row to the chord it actually has — the trapezoid. OK moves into the bottom arc — space a full-width row could never use.">
      <figcaption><strong>Round, 240×240.</strong> The NUMBERS layout on round glass: at a quarter-screen height the keys come out under a finger, so the keyboard takes the whole display and insets every row to the chord it actually has — the trapezoid. OK moves into the bottom arc — space a full-width row could never use.</figcaption>
    </figure>
    <figure>
      <img src="/img/kb-numbers-lcd147.png" alt="The NUMBERS layout docked at the bottom of lcd147 (172x320), field focused: a named layout is honoured exactly, however cramped.">
      <figcaption><strong>Portrait, 172×320.</strong> The NUMBERS layout docked at the bottom of lcd147 (172x320), field focused: a named layout is honoured exactly, however cramped.</figcaption>
    </figure>
    <figure>
      <img src="/img/kb-numbers-lcd35.png" alt="The NUMBERS layout docked at the bottom of lcd35 (320x480), field focused: a named layout is honoured exactly, however cramped.">
      <figcaption><strong>Portrait, 320×480.</strong> The NUMBERS layout docked at the bottom of lcd35 (320x480), field focused: a named layout is honoured exactly, however cramped.</figcaption>
    </figure>
  </div>
</div>

The mirrored input in exclusive mode gets the same treatment from the other
end — it is pushed a tenth of the display down, off the narrow top arc,
where at `y = 0` the chord is nearly nothing.

<div class="shapes">
  <input type="radio" name="sw-ex-wifi-join-18" id="sw-ex-wifi-join-18-0" checked>
  <label for="sw-ex-wifi-join-18-0">
    <img src="/img/ex-wifi-join-round128.png" alt="">
    round<br>240×240
  </label>
  <input type="radio" name="sw-ex-wifi-join-18" id="sw-ex-wifi-join-18-1">
  <label for="sw-ex-wifi-join-18-1">
    <img src="/img/ex-wifi-join-lcd35.png" alt="">
    portrait<br>320×480
  </label>
  <div class="shape-panels">
    <figure>
      <img src="/img/ex-wifi-join-round128.png" alt="The same wifi password step on round glass: the same unnamed Keyboard resolves to T9 here, and at this height it takes the whole display and mirrors the field.">
      <figcaption><strong>Round, 240×240.</strong> The same wifi password step on round glass: the same unnamed Keyboard resolves to T9 here, and at this height it takes the whole display and mirrors the field.</figcaption>
    </figure>
    <figure>
      <img src="/img/ex-wifi-join-lcd35.png" alt="examples/wifi after tapping a secured network: the password field appears and the keyboard comes up with no layout named — the app asked for &quot;whatever types best here&quot;, and 320px of glass buys QWERTY.">
      <figcaption><strong>Portrait, 320×480.</strong> examples/wifi after tapping a secured network: the password field appears and the keyboard comes up with no layout named — the app asked for &quot;whatever types best here&quot;, and 320px of glass buys QWERTY.</figcaption>
    </figure>
  </div>
</div>

**Everything else goes on an arc.** `at: 90` is the bottom arc (the
default), `at: 270` the top. Buttons need no round variant to sit there:

<div class="shapes">
  <input type="radio" name="sw-comp-button-19" id="sw-comp-button-19-0" checked>
  <label for="sw-comp-button-19-0">
    <img src="/img/comp-button-round128.png" alt="">
    round<br>240×240
  </label>
  <input type="radio" name="sw-comp-button-19" id="sw-comp-button-19-1">
  <label for="sw-comp-button-19-1">
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

**Exit is the edge-back swipe**, not a control. That is the trade the
section above buys: no rim space spent on a close affordance, and the
gesture works identically on the boards that do have corners.

## What to check on a round build

| Check | Where it bites | Section |
|---|---|---|
| Does the page set `UI.safe` with `inset: true`? | Rows run under the rim | [safe rect](#the-safe-rect-holding-the-flow-inside-the-circle) |
| Did you measure width with `gfx.width()`? | It is only true across the middle | [chord](#the-chord-how-wide-the-glass-is-at-a-given-height) |
| Do list rows share one width? | Per-row insets read as wobble | [uniform width](#chord-fitted-rows-vs-one-uniform-width) |
| Can the last row be scrolled clear of the arc? | Short lists, `maxOff` of zero | [end margin](#the-end-margin-a-quarter-screen-of-overscroll) |
| Is there a way out without a corner button? | Exit affordance | [edge-back](#the-edge-back-swipe) |
| Does the same source still look right square? | Round-only branches drift | [one page, two shapes](#one-page-two-shapes) |

That last row is the one that catches most regressions. Every round shot on
this page has a square counterpart generated from identical source, and
that is the point: round is a shape the layout absorbs, not a fork of the
app.

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

Related: [`ui.md`](/ui) for `UI.safe` and scroll zones,
[`components.md`](/components) for `ArcFooter` and `Keyboard` props,
[`devices.md`](/devices) for the round board's flashing quirks.
