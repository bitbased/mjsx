---
title: "Figures that carry their own source"
---
<!-- GENERATED from docs/shots.md by scripts/docs-sync.mjs. Edit that file. -->Every picture in this documentation is a real render of real code, made
headlessly by the repo's own pure-js backend. Each one also carries, in
the PNG itself, two things a screenshot normally throws away: **how it was
made**, and **the frame as draw calls** rather than as pixels.

```
bun scripts/shoot.mjs <name> <profile> <app.jsx|-e "code"> [options]
bun scripts/shot-info.mjs <shot.png>                      # the recipe
bun scripts/shot-info.mjs <shot.png> --replay out.png --scale 4
```

## The recipe

A screenshot with no record of its own making is a dead end: a year later
nobody knows which board, which example, or which tap produced it. So
`shoot.mjs` writes a `mjsx-shot` text chunk holding the profile, the
source file, the interactions, and any free-text `--note`, plus the exact
command that would make it again.

```
$ bun scripts/shot-info.mjs docs/img/shape-input-round128-round128.png
  note      the input example with a field focused; look at the trapezoid
            keyboard and OK in the bottom arc
  profile   round128  240x240 round
  source    examples/input/app.jsx
  actions   [{"op":"tap","x":120,"y":110}]
  reproduce bun scripts/shoot.mjs shape-input-round128 round128 \
              examples/input/app.jsx --tap 120,110
  ops       100 draw calls
```

Pass `--note` when the shot needs a reason: what to look at, why this
profile, what was being demonstrated. It costs nothing and it is the part
that will not be obvious later.

## The ops

The engine is only ten calls wide, so a frame can be kept as the list of
those calls instead of the bitmap they produced. That list goes into a
`mjsx-ops` chunk, compressed, alongside the image.

Why bother, when the picture is right there: **the ops are
resolution-independent.** Replaying at 4x redraws the text with a 4x font
rather than magnifying a small one, so a figure captured at 240x240 can be
re-rendered crisp at any size the documentation needs.

```
$ bun scripts/shot-info.mjs docs/img/kb-qwerty-lcd35.png --replay big.png --scale 4
replayed 214 ops at 4x -> big.png  1280x1920
```

Both chunks are ordinary PNG text chunks. Every viewer ignores the ones it
does not recognise, so these stay ordinary PNGs — and a browser can read
them back with `fetch` plus a little chunk parsing (`DecompressionStream`
inflates the compressed variant), which keeps the single-file property:
the picture and its source travel together.

The format is documented in `packages/core/src/oprec.js`. It is the same
recorder the HTTP mirror has always used to stream a device's screen to a
browser — one implementation, so the two cannot drift.

## What this makes possible

Keeping frames as data rather than pixels leaves several doors open that a
screenshot closes:

- **Debug overlays on documentation figures.** The ops carry every rect
  the layout produced, so hit boxes, clip regions and scroll zones can be
  drawn *over* a published figure without re-running the app.
- **Rendering modes side by side.** The same ops replayed through the SD,
  HD and pixel-exact text paths show what each actually does to a glyph —
  a comparison that is impossible to make honestly from three separate
  screenshots.
- **Re-theming.** Colours are values in the op list, so a figure can be
  recoloured without touching the app that drew it.
- **Vector output.** Nothing in the format is raster-bound; the same list
  could be emitted as SVG.

None of that is built yet. It is worth saying plainly rather than
implying: today the ops are recorded, replayable, and tested, and the rest
is a door rather than a room.

## Reproducing every figure

```
bun scripts/shoot.mjs --all          # the whole documentation set
bun scripts/shoot.mjs --list         # paths and captions, without rendering
```

Figures render at the five shapes the project tests against (the table in
`CONTRIBUTING.md`), so a picture in the documentation and a golden-test
cell are the same render.
