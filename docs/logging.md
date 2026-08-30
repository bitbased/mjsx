# console.log, and where it goes

MicroQuickJS has no `console`. That is a small gap with a large consequence:
a line of debugging that works in the simulator, the terminal runner and a
browser tab throws `TypeError: not a function` on the one host where you
cannot attach a debugger. So mjsx ships its own — one implementation
(`packages/core/src/log.js`) used by every host, formatting a line the same
way wherever it is read.

```js
console.log('boot', { w: gfx.width(), h: gfx.height() });
console.info('…');  console.warn('…');  console.error('…');  console.debug('…');
```

Objects are shown one level deep. That is deliberate: deeper than that a log
line stops describing a shape and starts being a memory problem, on a part
with tens of kilobytes to spare. Arrays past twelve entries say how many more
there were.

## Three sinks

Where a line goes is chosen at runtime, not compiled in, and the choices
compose:

| Sink | Goes to | Costs |
|---|---|---|
| `buffer` | a bounded ring in memory, read back with `mjsx logs <ip>` | nothing until someone looks |
| `serial` | the USB console, through `sys.log` | a write per line |
| `ops` | the frame's op stream as `['L', level, text]` | a few bytes in the frame |

`buffer` is the default: a board with nobody watching should not be paying
to format strings onto a wire.

The `ops` sink is the interesting one. A console line rides the same stream
as the drawing calls, so a mirror showing a board's screen also shows what
the board said, in order, on one channel — no second connection to keep in
sync. Replaying a frame draws nothing for it; a viewer that wants the lines
reads them off the op list.

## Reading them

```
mjsx logs 192.168.1.144                  what the app has said
mjsx logs 192.168.1.144 --follow         keep printing as it arrives
mjsx logs 192.168.1.144 --clear          empty the ring
mjsx logs 192.168.1.144 --sinks serial,ops
```

`--sinks` is remembered in `configStorage` under `log`, so it survives a
restart and can be changed on a running board without a rebuild.

Following polls by **sequence number**, not by count, so a line logged
between two polls arrives exactly once — and if the ring wrapped in between,
the output says how many lines were dropped instead of pretending it was
continuous.

## In the simulator

`/play/` has a console pane under the panel. It shows the running app's
lines with their levels, and **as ops** switches the app to
`buffer,ops` so you can see what the frame stream would carry. The pane
clears when the app restarts, because the lines belong to that run.

## The console is the app's, not the host's

On a JS host the app is evaluated inside a wrapper that takes `console` as a
parameter, so the app sees it as an ambient name exactly the way it does on
a chip, and the page's or the test runner's own `console` is untouched.

The first version of this replaced `globalThis.console` instead, which
swallowed the host's logging — a test harness printing nothing at all was
how that got noticed.

## What it is not

There is no `console.table`, `%s` substitution, `console.time`, or grouping.
They are all reachable by formatting the string yourself, and each one is
code that would have to exist on the device.
