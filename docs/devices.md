# ESP32 devices

What running mjsx on real hardware looks like today.

The firmware is **in this repo** and builds from it alone:
`backends/esp32/firmware/mjsx-board/`, with `./build.sh` for each panel.
It used to live in an unrelated project and be hand-synced here, which let
the two drift; it does not any more, and nothing in the build reads a file
from outside mjsx.

The CLI (`bun packages/cli/bin/mjsx.js push|ota|device wifi|fleet ...`)
wraps push, OTA and provisioning. What exists and works now: a
four-board fleet, all
Waveshare ESP32-S3 touch-LCD boards, running mjsx apps as a pushed JS
bundle evaluated by the firmware's embedded MicroQuickJS — pushing a new
app never means reflashing.

## The boards

Selected at build time with a flag to `build.sh`; the board blocks live in
`backends/esp32/firmware/mjsx-board/config.h`.

| Flag | Board | Panel | Touch |
|---|---|---|---|
| (default) | ESP32-S3-Touch-LCD-1.69 | 240x280 ST7789V2 | CST816T |
| `--b35` | ESP32-S3-Touch-LCD-3.5 | 320x480 ST7796 | FT6336 |
| `--b147` | ESP32-S3-Touch-LCD-1.47 | 172x320 JD9853 | AXS5106L |
| `--b128` | ESP32-S3-Touch-LCD-1.28 (round) | 240x240 GC9A01 | CST816S |

The same app on each of them — `examples/hello`, unchanged, no per-board
code. Flip between the panels to see what the four rows above actually
mean:

![](./img/ex-hello-lcd169p.png)

The round 1.28" board is the constrained one, and its quirks are worth
knowing because each cost real debugging:

- The module is an S3R2: **2MB quad PSRAM**, so the build must say
  `PSRAM=enabled` — `opi` bricks the boot.
- The default 2MB JS heap *is* the whole chip there: the alloc fails and
  the engine silently never starts. Its `config.h` block caps
  `JS_HEAP_BYTES` at **1MB**, which runs the full example set and leaves
  room for the frame canvas.
- USB is a **CH343 UART bridge**, so the console stays on UART0
  (`CDCOnBoot=default`) — and macOS's CDC driver drops large serial
  writes to it. esptool works only through `scripts/esptool-chunked.py`,
  a wrapper that chops every serial write into small (16-byte) flushed
  chunks with a pause between them. Slower, and it works. `--b128` sets
  all of this.

`LED_QUIET` (on by default) parks a board's onboard LEDs dark at boot —
plenty of boards ship LEDs that light with no help from the firmware (a
floating active-low user LED glows, an addressable RGB flickers on line
noise). `LED_OFF_PIN` / `LED_RGB_PIN` point it at the offender per board.

## First flash: USB, chunked

`cd backends/esp32/firmware/mjsx-board && ./build.sh --b35 --port /dev/cu.usbmodemXXXX`

USB flashing on these boards is unreliable for long sustained writes —
reproducibly, at every baud rate, stub or no stub. It is worth doing
exactly once per board, to get WiFi and the OTA endpoint onto it; after
that, use OTA and leave the cable alone.

## Every flash after that: OTA

`./build.sh --b35 --ota 192.168.1.x`, or `mjsx ota <ip> <firmware.bin>` for
an image you already built.

Once the board is on WiFi, OTA replaces the multi-minute chunked USB
flash with a single transfer of a few seconds — a streamed HTTP upload to
the board's `/update` endpoint, with `espota.py` as the fallback for
firmware that predates it. The image lands in the inactive OTA slot and
is verified before the board switches to it, so a failed update leaves
the working firmware running. Use OTA for everything after the first
flash; that is what it is for.

`build.sh` shells out to `arduino-cli` and esptool from the Arduino
ESP32 toolchain — the build step is the one piece the mjsx CLI has not
absorbed (push, OTA, and wifi provisioning are wrapped).

## Provisioning: wifi over the wire

The board answers a line-based JSON command protocol on USB serial and on
TCP port 8765 — same handler, both transports.

- `{"c":"wifi","ssid":"...","pass":"..."}` saves credentials the same
  place the touch flow does and reboots into them. A fresh board on a USB
  cable should not depend on typing a passphrase into whatever glass it
  happens to carry — the round display made that vivid.
- `{"c":"wifiget"}` returns the stored credentials — over *physical USB
  serial only*, never the network. Holding the cable is owning the box;
  asking over TCP is not.

Together they are the two-cable credential clone: `wifiget` from a
provisioned board, `wifi` into the new one, and a passphrase never
crosses a keyboard or the air. Once joined, the board announces itself
over mDNS (`filman.local` in the current firmware).

## Setting the clock

`mjsx clock` reads and sets the boards' time over the network:

```
mjsx clock ls                                   what each board thinks the time is
mjsx clock set [--time now|HH:MM[:SS]] [--tz ±MIN|±H:MM]
```

**The machine running the command is the time source.** A board can fetch
its own time with `net.fetch` and a `Date` header, but that needs the fetch
allowlist opened, a route to the internet, and it lands a second late. The
laptop already knows the time exactly.

It writes **both** places, because neither is enough alone:

- the **RTC at 0x51** (a PCF85063) through the firmware's `reg` command, so
  it works whatever app is running — or none — and survives a reboot. Only
  the 1.69" and 3.5" boards carry one; the 1.47" and round 1.28" do not.
- **`configStorage`** (`clock_utc`, `clock_tz`), which every board has and
  `examples/clock` reads at boot. On the two boards with no chip this is the
  only time there is, and it resets when the app does.

Hours and minutes are written before seconds on purpose: writing the
seconds register is what clears the oscillator-stop flag and starts the
count, so it has to go last. That is what takes a chip from `stopped` to
`running`.

`--time` is always **UTC**. A wall-clock string with no zone is ambiguous,
and guessing the caller's zone is how clocks end up an hour out twice a
year. `--tz` is display-only.

```
$ mjsx clock ls
  192.168.1.125   rtc:none      -             tz:0   uses stored (drifts)
  192.168.1.144   rtc:running   15:14:22 UTC  tz:0   uses RTC
```

## The on-hardware verification loop

Everything needed to develop against a real panel without touching it:

- **Push**: `bun scripts/ui-push.mjs <ip|/dev/tty...> [appfile]` builds
  the JSX locally (so a syntax the engine cannot parse fails on the dev
  machine, not on a board with no console), sends the bundle in base64
  chunks over TCP 8765 or USB serial, and starts it.
- **See**: `GET /screen.jpg?q=45` returns the live frame as JPEG (a UI
  screenshot is flat colour and compresses to a few kB); `/screen.bmp`
  is exact, for when the question is a pixel's actual value.
- **Touch**: `GET /tap?x=120&y=140` presses and releases;
  `/touch?phase=0&x=..&y=..` gives press/move/release separately. Both
  inject where a real press does, so they exercise calibration, gestures
  and the UI exactly as the glass would.
- **Recover**: `{"c":"jsreset"}` resets the JS engine;
  `{"c":"rescue"}` stops the running script and shows the native wifi
  flow (the same place a very long BOOT-button hold lands), so a script
  that wedges the screen never needs a reflash. `jsinfo`/`jsstat` report
  how far an eval got when it never answered.

The loop is push → screenshot → tap → screenshot, over WiFi, in seconds.
