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

## On a board: the console beside the pixels

A board's `/remote` page has a **CON** button. Turned on, the console opens
along the bottom and the board's lines arrive in it, coloured by level, in
step with the frames they were logged during.

That works because a console line is an op. The frame stream already exists
— it is how `/remote` mirrors the screen — so a line rides out with the
drawing it describes rather than needing a channel of its own:

```
GET /ops?log=1        the JSON stream, lines as ["L", level, text]
GET /ops.bin?log=1    the binary stream, lines as op 12
GET :81/ops?log=1     the push stream, same op 12
```

Without `log=1` no line is carried on any of the three, so a viewer that
only wants pixels never pays for the console. The flag re-arms on a 5s
clock, the same way the frame recorder does, so a browser that closes stops
the cost without having to say so.

Lines are **collected, not recorded**. The obvious build writes a line into
the frame buffer like any other op, and it does not work: a line then
appears in exactly one frame and is gone from the next, so a viewer polling
at 120–350ms misses most of what is logged. Queued and appended when a
frame is taken, a line survives until somebody actually collects it. If the
queue overflows, the drop is itself reported as a line.

## A REPL, in the same pane

Under the console there is a prompt. What you type is evaluated **in the
app's own globals** — `UI.state`, the app's variables, every native — and a
`var` you set in one line is there in the next:

```
> Object.keys(UI.state).join(",")
"link,printer"
> UI._hits.length
17
> console.log('hi'), 'done'
done
hi
```

MicroQuickJS has no REPL of its own. This is `jsEvalStart()`, which compiles
a fresh script against the same global object the app is running in — the
mechanism the `:8765` push server's `eval` command has always used, exposed
on port 80 as `GET /eval?js=...` so a browser (which cannot open a raw
socket) can reach it. Anything the expression logs arrives through the
ordinary log-op path, so a line and its output land in the same place.

What it does **not** see is function-local scope: globals only. A variable
closed over inside a component is not reachable, and there is no breakpoint
— this inspects state, it does not stop time.

`/eval` is unauthenticated, like every other endpoint on these boards. It
runs arbitrary code on the device. That is the same exposure the `:8765`
push server has always had, but it is worth knowing before putting a board
on a network you do not control.

## The console is the app's, not the host's

On a JS host the app is evaluated inside a wrapper that takes `console` as a
parameter, so the app sees it as an ambient name exactly the way it does on
a chip, and the page's or the test runner's own `console` is untouched.

The first version of this replaced `globalThis.console` instead, which
swallowed the host's logging — a test harness printing nothing at all was
how that got noticed.

Under the **terminal** backend an app's console goes to **stderr**, because
stdout is the frame: the backend paints by writing escape sequences there,
and a line printed into stdout lands in the middle of the picture. The
runner's own status output still goes to stdout, after the frame.

## What it is not

There is no `console.table`, `%s` substitution, `console.time`, or grouping.
They are all reachable by formatting the string yourself, and each one is
code that would have to exist on the device.
