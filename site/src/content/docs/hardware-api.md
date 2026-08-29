---
title: "Hardware access: sys.gpio and sys.i2c"
description: "The native calls a script can reach."
---
<!-- GENERATED from docs/hardware-api.md by scripts/docs-sync.mjs. Edit that file. -->Two natives give a script direct hardware access on the ESP32 bridge
firmware, the same way `sys.store`/`sys.fetch` do: a C function in the
firmware's `natives.h`, a thin wrapper in `glue.c`, an entry in the
generated stdlib table. Other backends (browser, sim, terminal, pure-js)
do not have them — check before calling, the way `examples/gpio` and
`examples/i2c` do:

```js
var HAVE = typeof sys !== 'undefined' && typeof sys.gpio === 'function';
```

## sys.gpio(pin, op, value) -> int

| op | does | returns |
|---|---|---|
| 0 | read: `INPUT_PULLUP`, then `digitalRead` | 0 or 1 |
| 1 | write: `OUTPUT`, then `digitalWrite(value)` | 1 |
| 2 | `analogRead` | the ADC count |

Returns -1 for a refused pin or an unknown op.

Things to know:

- **Reading reconfigures the pin.** op 0 sets `INPUT_PULLUP` every call, so
  polling a pin you just drove releases it. An open pin reads 1, not 0 —
  that is the pullup.
- **The ADC does not reach every pin.** On the ESP32-S3 only GPIO 1..20
  are ADC-capable; op 2 elsewhere reads nothing useful.

<div class="shapes">
  <input type="radio" name="sw-ex-gpio-0" id="sw-ex-gpio-0-0">
  <label for="sw-ex-gpio-0-0">
    <img src="/img/ex-gpio-round128.png" alt="">
    round<br>240×240
  </label>
  <input type="radio" name="sw-ex-gpio-0" id="sw-ex-gpio-0-1">
  <label for="sw-ex-gpio-0-1">
    <img src="/img/ex-gpio-lcd147.png" alt="">
    portrait<br>172×320
  </label>
  <input type="radio" name="sw-ex-gpio-0" id="sw-ex-gpio-0-2" checked>
  <label for="sw-ex-gpio-0-2">
    <img src="/img/ex-gpio-lcd35.png" alt="">
    portrait<br>320×480
  </label>
  <div class="shape-panels">
    <figure>
      <img src="/img/ex-gpio-round128.png" alt="examples/gpio — Direct pin access through sys.gpio(pin, op, value): op 0 reads (the firmware sets INPUT_PULLUP first, so an open pin reads 1) op 1. . . No device natives under the pure-js backend, so the app draws its own labelled fallback (the line under the title).">
      <figcaption><strong>Round, 240×240.</strong> examples/gpio — Direct pin access through sys.gpio(pin, op, value): op 0 reads (the firmware sets INPUT_PULLUP first, so an open pin reads 1) op 1. . . No device natives under the pure-js backend, so the app draws its own labelled fallback (the line under the title). <a class="run-example" href="/play/#ex=gpio&amp;shape=round128">▶ Run it</a></figcaption>
    </figure>
    <figure>
      <img src="/img/ex-gpio-lcd147.png" alt="examples/gpio — Direct pin access through sys.gpio(pin, op, value): op 0 reads (the firmware sets INPUT_PULLUP first, so an open pin reads 1) op 1. . . No device natives under the pure-js backend, so the app draws its own labelled fallback (the line under the title).">
      <figcaption><strong>Portrait, 172×320.</strong> examples/gpio — Direct pin access through sys.gpio(pin, op, value): op 0 reads (the firmware sets INPUT_PULLUP first, so an open pin reads 1) op 1. . . No device natives under the pure-js backend, so the app draws its own labelled fallback (the line under the title). <a class="run-example" href="/play/#ex=gpio&amp;shape=lcd147">▶ Run it</a></figcaption>
    </figure>
    <figure>
      <img src="/img/ex-gpio-lcd35.png" alt="examples/gpio — Direct pin access through sys.gpio(pin, op, value): op 0 reads (the firmware sets INPUT_PULLUP first, so an open pin reads 1) op 1. . . No device natives under the pure-js backend, so the app draws its own labelled fallback (the line under the title).">
      <figcaption><strong>Portrait, 320×480.</strong> examples/gpio — Direct pin access through sys.gpio(pin, op, value): op 0 reads (the firmware sets INPUT_PULLUP first, so an open pin reads 1) op 1. . . No device natives under the pure-js backend, so the app draws its own labelled fallback (the line under the title). <a class="run-example" href="/play/#ex=gpio&amp;shape=lcd35">▶ Run it</a></figcaption>
    </figure>
  </div>
</div>

## sys.i2c(addr, reg, value) -> int

One byte of a device on the board's shared I2C bus. `value` omitted or
negative reads (write `reg`, repeated-start, read one byte); `value` 0..255
writes that byte. Returns the byte read, 1 on a good write, -1 on no
answer or a bad address (accepted range 0x03..0x77). It is the same Wire
sequence as the bridge's `reg` TCP command, which is the bring-up tool it
mirrors.

The bus is the one the touch controller lives on, and on some boards much
more: the 3.5" board's I/O expander, power-management chip, RTC, IMU and
audio codec all share it. A read is usually harmless (though some devices
clear interrupt flags on read); a stray register write to the PMU is not.
Scan first, write only registers you know.

`examples/i2c` is that advice as a program: it walks 0x08..0x77 a few
addresses per tick so the UI stays live, lists what answered, and peeks
registers 0..15 of whichever address you tap.

<div class="shapes">
  <input type="radio" name="sw-ex-i2c-1" id="sw-ex-i2c-1-0">
  <label for="sw-ex-i2c-1-0">
    <img src="/img/ex-i2c-round128.png" alt="">
    round<br>240×240
  </label>
  <input type="radio" name="sw-ex-i2c-1" id="sw-ex-i2c-1-1">
  <label for="sw-ex-i2c-1-1">
    <img src="/img/ex-i2c-lcd147.png" alt="">
    portrait<br>172×320
  </label>
  <input type="radio" name="sw-ex-i2c-1" id="sw-ex-i2c-1-2" checked>
  <label for="sw-ex-i2c-1-2">
    <img src="/img/ex-i2c-lcd35.png" alt="">
    portrait<br>320×480
  </label>
  <div class="shape-panels">
    <figure>
      <img src="/img/ex-i2c-round128.png" alt="examples/i2c — Bus scan and register peek through sys.i2c(addr, reg, value): value &lt; 0 (or omitted) reads one byte of that register, value &gt;= 0 writes. . . The bus is SIMULATED by the harness — three devices at the real addresses this project's own boards use — because with no bus at all the page is two lines of text and documents nothing.">
      <figcaption><strong>Round, 240×240.</strong> examples/i2c — Bus scan and register peek through sys.i2c(addr, reg, value): value &lt; 0 (or omitted) reads one byte of that register, value &gt;= 0 writes. . . The bus is SIMULATED by the harness — three devices at the real addresses this project's own boards use — because with no bus at all the page is two lines of text and documents nothing. <a class="run-example" href="/play/#ex=i2c&amp;shape=round128">▶ Run it</a></figcaption>
    </figure>
    <figure>
      <img src="/img/ex-i2c-lcd147.png" alt="examples/i2c — Bus scan and register peek through sys.i2c(addr, reg, value): value &lt; 0 (or omitted) reads one byte of that register, value &gt;= 0 writes. . . The bus is SIMULATED by the harness — three devices at the real addresses this project's own boards use — because with no bus at all the page is two lines of text and documents nothing.">
      <figcaption><strong>Portrait, 172×320.</strong> examples/i2c — Bus scan and register peek through sys.i2c(addr, reg, value): value &lt; 0 (or omitted) reads one byte of that register, value &gt;= 0 writes. . . The bus is SIMULATED by the harness — three devices at the real addresses this project's own boards use — because with no bus at all the page is two lines of text and documents nothing. <a class="run-example" href="/play/#ex=i2c&amp;shape=lcd147">▶ Run it</a></figcaption>
    </figure>
    <figure>
      <img src="/img/ex-i2c-lcd35.png" alt="examples/i2c — Bus scan and register peek through sys.i2c(addr, reg, value): value &lt; 0 (or omitted) reads one byte of that register, value &gt;= 0 writes. . . The bus is SIMULATED by the harness — three devices at the real addresses this project's own boards use — because with no bus at all the page is two lines of text and documents nothing.">
      <figcaption><strong>Portrait, 320×480.</strong> examples/i2c — Bus scan and register peek through sys.i2c(addr, reg, value): value &lt; 0 (or omitted) reads one byte of that register, value &gt;= 0 writes. . . The bus is SIMULATED by the harness — three devices at the real addresses this project's own boards use — because with no bus at all the page is two lines of text and documents nothing. <a class="run-example" href="/play/#ex=i2c&amp;shape=lcd35">▶ Run it</a></figcaption>
    </figure>
  </div>
</div>

![](/img/ex-i2c-peek-lcd35.png)

## Safety rules

The firmware refuses, with -1, any `sys.gpio` pin the active board's
display or touch controller uses — the denylist is built from the same
`config.h` defines that wire those peripherals, so it tracks the board the
build is for. A script poking the panel's DC line mid-frame rewrites the
display's command state; that class of accident is fenced off rather than
trusted away.

The denylist covers display and touch only. Reader UART pins are **not**
refused — on a board with PN532s attached, driving those pins disturbs the
readers.

## Board pin notes

Refused pins (display + touch) and what else is spoken for, per board:

- **1.69" 240x280 (BOARD 1)**: refused 4, 5, 6, 7, 8, 15 (panel) and
  10, 11, 13, 14 (touch). Reader UARTs sit on 17/18, 2/3 and 43/44.
- **3.5" 320x480 (BOARD 2)**: refused 1, 2, 3, 5, 6 (panel) and 7, 8
  (the shared I2C bus). Readers on 44/43, 15/16, 13/14; SD on 9/10/11;
  the camera owns 17, 18, 21 and 38..48.
- **1.47" 172x320 (BOARD 3)**: refused 21, 38, 39, 40, 45, 46 (panel)
  and 41, 42, 47, 48 (touch). Reader UART on 43/44; 17/18 are SD data
  lines, not spare.
- **round 1.28" 240x240 (BOARD 4)**: refused 2, 8, 9, 10, 11, 14 (panel)
  and 5, 6, 7, 13 (touch). The SH1.0 header brings out 15, 16, 17, 18,
  21, 33; the single reader uses 17/18.

## Not exposed: serial/UART

There is no `sys.uart`. The board's UARTs belong to the PN532 readers
today, routed through the GPIO matrix to the pins listed above, and a
script sharing them would corrupt reader frames. Exposing a UART on a
build that gives up a reader slot is future work.
