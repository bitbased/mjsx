# Golden frames

`hashes.json` is a sha256 of the raw RGB framebuffer for every example at every
display shape — 15 examples x 3 shapes = 45 cells, no exclusions.

| key suffix | shape | why it's in the matrix |
| --- | --- | --- |
| `@240x280` | tall portrait | the panel the examples were drawn for |
| `@320x172` | short landscape | wide, and short enough that vertical space runs out |
| `@240x240r` | round glass | `configStorage 'round'='1'`, seeded through `sys.store` before the example loads — `UI.isRound()` changes overscroll, `ArcFooter` placement and whole layout branches |

Run them with `bun test`; reseed after an intentional pixel change with
`bun test/golden/regen.mjs`. The shared harness is `matrix.js`, so the test and
the regen script can't drift.

**Determinism.** `sys.millis()` is frozen at 0 before each example loads.
`examples/sensors` renders `uptime <n>s` from it, so unfrozen its hash flips as
soon as more than a second passes between backend creation and the render — a
slow or loaded machine, not a rare one. Freezing keeps sensors in the matrix
instead of excluding it; nothing else in core or the examples reads a clock or
`Math.random`, and every cell gets a fresh backend, core and example module.
Two consecutive `regen.mjs` runs must produce an identical file — if they don't,
something grew a clock, and that's the bug, not the hash.
