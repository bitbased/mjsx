# mjsx-board — an in-progress firmware port

**This does not build yet. Do not flash it.**

`hello-mjsx/` next door is a working bring-up sketch that logs `gfx.*` to
Serial and drives no panel. The firmware that actually runs mjsx on glass —
panel drivers, touch, WiFi, OTA, the `:8765` push server — lives outside
this repo, in the `filament-rfid` bridge. This directory is the start of
bringing that here so the engine and its firmware ship together.

## What is here and working

| Piece | State |
|---|---|
| `src/engine/` | The MicroQuickJS engine. **Byte-identical** to the bridge's copy, so there is no fork to reconcile. |
| `src/engine/glue.c` | The full native surface — the ten calls plus `sys.i2c`, canvas sources, `net.*` — not `hello-mjsx`'s ten-call subset. |
| `natives.h` | The C side of those natives, including `net.fetch` and `sys.log` (see `docs/hardware-api.md` and `docs/logging.md`). |
| `src/engine/mjsx_board_stdlib.c` + `gen-stdlib.sh` | The native name table and its generator. Run the script after changing the table; it regenerates the tables **and** the atom header from one pass, because the two disagreeing about word size corrupts atom numbering. |
| `config.h`, `panel_*.h`, `js.h`, `mod_*.h` | Copied from the bridge, unmodified. |

`natives.h` and `glue.c` are copies too, and they drift: a native added to
the bridge is not here until someone copies it over. `glue.c` differs by
exactly one line — the stdlib header it includes — so the check is

    diff bridge/natives.h natives.h
    diff bridge/src/mquickjs/glue.c src/engine/glue.c   # expect 1 hunk

and a copy is followed by re-adding the native's name to
`src/engine/mjsx_board_stdlib.c` and running `./gen-stdlib.sh`.

## What is missing

- **The sketch.** There is no `.ino`: no `setup()`/`loop()`, no WiFi join,
  no OTA, no mDNS, no web server, no `:8765` push listener. Without those a
  flashed board cannot be updated except over USB.
- **`ui.h` is still fused.** Its first ~430 lines are the display substrate
  (panel init, flush, backlight, rotation, the canvas registry, the native
  surface `glue.c` binds `gfx.*` to). Everything below is the filament
  app's own C UI — pages, keyboards, calibration — which mjsx replaces with
  JS and which should not come along.
- **Never compiled.** No `arduino-cli` run has been attempted here.

## The order that keeps a board usable

The remote-update path has to exist in the new firmware *before* it
replaces the old one, or every iteration costs a USB flash on hardware
whose USB flashing is unreliable:

1. panel driver for one controller — prove pixels over USB
2. a real `loop()` plus the touch controller
3. WiFi + OTA + the `:8765` push server ← **the gate**
4. then `sys.i2c`, canvas sources, `net.fetch`

The 3.5" board is the one to do it on: it is the largest panel and the
easiest to see, and taking it off the LAN costs nothing.
