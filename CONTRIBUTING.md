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
