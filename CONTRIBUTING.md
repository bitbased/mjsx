# Contributing

Small hobby project. Patches welcome; keep them small and true.

## Running things

Everything runs with bun. The example scripts live in `package.json`:

```
bun run example:hello      # render examples/hello to out/hello.ppm
bun run example:counter    # render examples/counter to out/counter.ppm
bun run examples           # interactive launcher in the terminal
bun test                   # run the tests
```

## The one hard rule

`packages/core/src/mjsx.js` stays in the MicroQuickJS ES5 subset: no arrow
functions, no `let`/`const`, no template literals. The same file has to run
unmodified on a chip's embedded interpreter, so "modernizing" it breaks the
product. Everything outside the core file can use normal JS.

## Adding an example

Make a directory under `examples/` with an `app.jsx` in it. Any backend can
run it:

```
bun backends/pure-js/src/run.js examples/yours/app.jsx out/yours.ppm
bun backends/terminal/src/run.js examples/yours/app.jsx
```

## Adding a backend

A backend implements the ten gfx calls — `clear`, `rect`, `frect`, `circle`,
`line`, `text`, `clip`, `unclip`, `width`, `height` — plus `sys.millis`.
That is the entire native surface; nothing above it changes per backend. The
contract is spelled out in `docs/contract.md`, and `backends/pure-js` is the
smallest working reference.

## Tests

`bun test`. If you fix a bug in the core, add a test that fails without the
fix.

## The five shapes

Every display this project runs on stays represented and tested. The set is
not arbitrary — each shape breaks a different assumption:

| Shape | Board | What it breaks |
|---|---|---|
| 240×280 | 1.69″ portrait | nothing; the shape the examples were drawn for |
| 172×320 | 1.47″ portrait | too narrow for ten keyboard columns |
| 320×172 | 1.47″ landscape | too short to dock a keyboard at all |
| 480×320 | 3.5″ landscape | the only glass where everything simply fits |
| 240×240 | 1.28″ round | has no corners |

A layout that survives all five is portable in the way this project means the
word. They are the rows of the golden matrix (`test/golden/matrix.js`) and the
profiles of the screenshot harness (`scripts/shoot.mjs`: `lcd169p`, `lcd147`,
`lcd147l`, `lcd35l`, `round128`), so a figure in the documentation and a golden
cell are the same render. Add a shape to both or neither.
