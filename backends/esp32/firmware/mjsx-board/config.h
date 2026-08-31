#pragma once

// ---- Optional modules ----
//
// The bridge grew several loosely-coupled capabilities; each is a module
// that can be compiled out (-DMOD_PRINTER=0 and friends) for boards that
// are pure mjsx hosts, sensor nodes, or anything else. A module that is
// OFF still defines its outward symbols as stubs, so no call site --
// including the generated JS stdlib's natives -- ever changes.
#ifndef MOD_PRINTER
/* OFF here. This is an mjsx board: the printer client belongs to the
   unrelated project this firmware descends from, and its source is not in
   this repo. Left as a switch rather than deleted so the module wiring
   keeps its shape for whatever gets built next. */
#define MOD_PRINTER 0   // Creality K-series websocket client + dashboard
#endif
#ifndef MOD_RFID
/* OFF by default, and OPTIONAL: -DMOD_RFID=1 with mod_pn532.h present
   brings the readers back as a module, the same way the IMU is one. */
#define MOD_RFID 0      // PN532 readers and the tag command set
#endif
#ifndef MOD_WIFI_CFG
#define MOD_WIFI_CFG 1  // on-device network chooser + net.* JS natives
#endif
// RFID off rides the existing simulator seam: the tag plumbing compiles
// against fake readers and the PN532 library is never pulled in.
#if !MOD_RFID && !defined(SIMULATE_READER)
#define SIMULATE_READER 1
#endif
// ---- Which board this build is for ----
//
// Two so far, and they differ in more than size: a different panel driver, a
// different touch controller, and on the 3.5" the LCD reset and several other
// signals hang off an I2C expander rather than off a GPIO. Everything that
// varies is gathered here so the rest of the firmware never asks which board
// it is running on.
//
//   1  Waveshare ESP32-S3-Touch-LCD-1.69   240x280  ST7789  CST816T
//   2  Waveshare ESP32-S3-Touch-LCD-3.5    320x480  ST7796  FT6336
#ifndef BOARD
#define BOARD 1
#endif

// -------- filament-rfid-bridge configuration --------
// Copy this file's values to taste. Everything the sketch needs to know about
// your wiring and network lives here.

// ---- WiFi (optional) ----
// Leave WIFI_SSID empty ("") to run serial-only (no TCP server).
//
// Blank on purpose: join a network from the board's own settings screen, which
// saves the credentials to the device and takes precedence over anything here.
// Overridable from the build, so bootstrapping a board never means editing —
// and then having to remember to un-edit — a file that is committed:
//
//   --build-property 'compiler.cpp.extra_flags=-DWIFI_SSID="\"net\"" ...'
#ifndef WIFI_SSID
#define WIFI_SSID ""
#endif
#ifndef WIFI_PASS
#define WIFI_PASS ""
#endif
// Short on purpose: this is the mDNS name too, so the board answers at
// http://filman.local/ rather than at an address someone has to look up.
#define WIFI_HOSTNAME "filman"
#define TCP_PORT 8765

// ---- Serial ----
#define SERIAL_BAUD 115200

// ---- Simulator ----
// Run with no PN532 attached at all: each reader presents a virtual MIFARE
// Classic 1K tag held in RAM. Writes are stored, reads give them back, and a
// scan reports a synthetic UID — enough to exercise the whole host stack
// (encode, key derivation, write, read back, decode) on a bare board.
// Nothing else in the sketch changes, so the wire protocol is identical.
// Overridable from the build, so `bun run fw:sim` needs no edit here.
#ifndef SIMULATE_READER
#define SIMULATE_READER 0
#endif

// ---- How many PN532s this board carries ----
// One ESP32 can drive two readers, which is how you write both tags on a spool
// from a single USB cable or one WiFi connection. The host selects which one
// with an "r" field on every request; it is not two separate links.
// Set to 2 and wire the second reader on the pins below.
// All three are compiled in and probed at boot; the ones with nothing attached
// simply report nothing and are never polled again. Shipping every slot means
// wiring a reader is plugging it in and pressing RESCAN, not reflashing.
#ifndef READER_COUNT
#define READER_COUNT 3
#endif

// ---- PN532 interface ----
// Choose exactly one: PN532_IFACE_I2C, PN532_IFACE_SPI, or PN532_IFACE_HSU.
//
// The module picks its interface with two DIP switches, and the silkscreen
// labels the switches rather than the positions:
//
//         SET0(1)  SET1(2)
//   HSU      0        0      <- both the same; the shipping default
//   I2C      1        0
//   SPI      0        1
//
// HSU being the only mode with both switches alike is a useful property: set
// them the same and, if nothing answers, set them both the other way. (1,1) is
// not a mode, so you cannot land in I2C or SPI by accident.
//
// HSU is also the right choice for a reader on a long cable — see the note by
// the pins below.
#define PN532_IFACE_HSU

// I2C pins (ESP32 default SDA=21, SCL=22). IRQ/RST optional; -1 to disable.
#define PN532_I2C_SDA 21
#define PN532_I2C_SCL 22
#define PN532_IRQ 2
#define PN532_RESET -1

// Second I2C reader. The PN532's I2C address is fixed at 0x24 with no strap,
// register or command to change it, so two of them cannot share a bus — reader
// 2 would go on the second I2C peripheral (Wire1).
//
// Not recommended on this board: 33-37 are octal PSRAM and unusable, which
// leaves the same four pads the UARTs want, and I2C over a metre of cable is
// the fragile option. See the HSU pins below.
#define PN532_I2C2_SDA 17
#define PN532_I2C2_SCL 18
#define PN532_IRQ2 4
#define PN532_RESET2 -1

// SPI pins (used only with PN532_IFACE_SPI).
#define PN532_SPI_SCK 18
#define PN532_SPI_MISO 19
#define PN532_SPI_MOSI 23
#define PN532_SPI_SS 5
// Second SPI reader: same clock and data lines, its own chip select.
#define PN532_SPI_SS2 15

// HSU pins (used only with PN532_IFACE_HSU).
//
// These are hardware UARTs, not bit-banged: the S3 has three of them and a
// GPIO matrix that routes any of them to almost any pin, so the choice here is
// about which pads the board brings out rather than what the silicon allows.
//
// On the Waveshare 1.69 the free pads are GPIO 2, 3, 17 and 18 (TP1-TP11 on the
// schematic; 16 exists but goes to no pad). UART0 stays on 43/44, which are
// also pads, so the console is untouched.
#if BOARD == 2
// The 3.5" board, where board 1's numbers are actively destructive: its second
// reader sits on GPIO 2 and 3, which there are LCD_MISO and LCD_DC. DC decides
// whether the panel reads a byte as a command or as a pixel, so probing for a
// reader that is not there rewrites the display's state mid-frame — wrong
// colours, wrong alignment, and only once the probe has run, which leaves the
// first frames after boot looking correct.
//
// These are the pads left once the panel (1,2,3,5,6), the I2C bus (7,8), the
// SD card (9,10,11) and the camera (17,18,21,38-48) have taken theirs: UART0's
// pins, whose console runs over USB instead, and the I2S audio pins.
#define PN532_HSU_RX 44
#define PN532_HSU_TX 43
#define PN532_HSU2_RX 15
#define PN532_HSU2_TX 16
#define PN532_HSU3_RX 13
#define PN532_HSU3_TX 14
// GPIO 42 is a camera data line here, not the buzzer the 1.69 carries.
#define BUZZER_PIN -1
#elif BOARD == 3
// The 1.47" board's spare pads: UART0's pins (console runs over USB).
// 17/18 are its SD data lines here, NOT reader UARTs.
#define PN532_HSU_RX 44
#define PN532_HSU_TX 43
#define PN532_HSU2_RX -1
#define PN532_HSU2_TX -1
#define PN532_HSU3_RX -1
#define PN532_HSU3_TX -1
#define BUZZER_PIN -1
#elif BOARD == 4
// The round 1.28" board: one reader at most, on the exposed header pins
// (15/16/17/18/21/33 come out the SH1.0 connector). NOT 43/44 -- the
// console runs through the CH343 on exactly those, so probing a third
// reader there would chew on the console. One slot, full stop.
#if READER_COUNT > 1
#undef READER_COUNT
#define READER_COUNT 1
#endif
#define PN532_HSU_RX 18
#define PN532_HSU_TX 17
#define PN532_HSU2_RX -1
#define PN532_HSU2_TX -1
#define PN532_HSU3_RX -1
#define PN532_HSU3_TX -1
#define BUZZER_PIN -1
#else
#define PN532_HSU_RX 17
#define PN532_HSU_TX 18
// Second reader on UART2.
//
// TX on GPIO3, deliberately: 3 is a strapping pin (it selects the JTAG signal
// source) and an ESP32 output is high-impedance at reset, so nothing drives it
// while the strap is sampled. RX takes GPIO2, which the module's TX does drive
// and which straps nothing.
#define PN532_HSU2_RX 2
#define PN532_HSU2_TX 3
// A third reader on UART0, whose pins are pads on this board (43/44) and whose
// peripheral is idle: the console runs over USB CDC, so nothing else wants it.
// Better than the I2C slot for anything on a long cable, and it leaves the
// board's own I2C bus to the touch controller.
//
// One quirk: the ROM bootloader prints its startup banner on GPIO43 at reset,
// which the module sees as noise on its RX. A PN532 resynchronises on the next
// frame preamble, so it costs nothing but is worth knowing.
#define PN532_HSU3_RX 44
#define PN532_HSU3_TX 43
#endif  // BOARD == 2
// Set to 1 to put the third reader on the shared I2C bus instead (SDA/SCL are
// also pads). No IRQ pin needed — the library polls a ready byte.
#ifndef PN532_R3_I2C
#define PN532_R3_I2C 0
#endif

#if BOARD == 2

// ---- Display (Waveshare ESP32-S3-Touch-LCD-3.5) ----
// ST7796 320x480 on SPI. CS is not wired to the ESP32 at all: the panel is the
// only device on that bus and its select is tied low on the board, so -1 here
// is correct rather than a placeholder.
#ifndef HAS_DISPLAY
#define HAS_DISPLAY 0
#endif
// The DVP camera connector (OV2640/OV5640). Compiled in by default;
// the module starts only on request, so absent hardware costs nothing.
#ifndef MOD_CAMERA
/* OFF: mod_camera.h is not in this repo (see MOD_PRINTER). */
#define MOD_CAMERA 0
#endif
#define TFT_MOSI 1
#define TFT_MISO 2
#define TFT_SCLK 5
#define TFT_CS -1
#define TFT_DC 3
#define TFT_RST -1        // held by the I/O expander, see IOEXP_LCD_RST
#define TFT_BL 6
#define TFT_W 320
#define TFT_H 480
#define TFT_ROTATION 0
#define PANEL_ST7796 1
// The panel clock, which is what a frame costs.
//
// Adafruit's default is 32 MHz and this panel is specified well past it. On a
// 320x480 screen the difference is not academic: a full blit is 2.25 Mbit, so
// the clock sets the floor on frame time and nothing else in the path comes
// close to it — measured, 119 ms of a 134 ms frame was SPI.
#define TFT_SPI_HZ 80000000

// AXP2101 power management, on the same shared bus. Its CHGLED pin sinks
// the board's GREEN LED (open-drain to VSYS, per the schematic): disable
// the pin function and the LED goes dark. The RED LED there hangs off
// ESP_EN through a FET and is beyond any software.
#define AXP2101_ADDR 0x34

// TCA9554 I/O expander. The LCD reset, the touch interrupt and the SD card's
// chip select are all behind it, so it has to come up before the display does.
#define IOEXP_ADDR 0x20
#define IOEXP_LCD_RST 1
#define IOEXP_TP_INT 2
#define IOEXP_SD_CS 3

// FT6336 capacitive touch, on the board's shared I2C bus — which also carries
// the expander, an RTC, an IMU, the audio codec and the power management chip.
#define TOUCH_SDA 8
#define TOUCH_SCL 7
#define TOUCH_INT -1      // behind the expander; polled instead
#define TOUCH_RST -1
#define TOUCH_ADDR 0x38
#define TOUCH_FT6336 1
// Which panel rotation the controller's own frame agrees with. The FT6336
// reports in the panel's native orientation; the CST816 on the 1.69" reports
// it turned 180, and assuming either one for both puts every touch opposite
// the finger.
#define TOUCH_ROT_BASE 0

// Magnified 1.5x by default here.
//
// Both panels have almost the same pixel pitch, so rendering 1:1 on the bigger
// one would give more room at exactly the same physical text size — more of a
// UI that was already small rather than a better one. Magnifying makes every
// control physically bigger, which is what a 3.5" panel is for.
//
// 1.5x rather than 2x because of what is left to lay out in: 2x leaves a
// 152px logical width, narrower than the 240 every page was written for, and
// the titles wrap. 1.5x leaves 202 and they do not. The inset keeps content
// off the outer band, where touch is least accurate on this glass too.
#define VIEW_SCALE_DEFAULT 6
#define VIEW_INSET_DEFAULT 8

#elif BOARD == 3
// The 1.47" board: 172x320 JD9853 panel, AXS5106L touch. Pins from
// Waveshare's own ESP-IDF demo BSP (bsp_display.h / bsp_i2c.h /
// bsp_touch.h) -- the wiki pages disagree with each other; the demo
// code is what actually drives the hardware.
#ifndef HAS_DISPLAY
#define HAS_DISPLAY 0
#endif
#ifndef MOD_CAMERA
#define MOD_CAMERA 0
#endif
#define TFT_MOSI 39
#define TFT_MISO -1
#define TFT_SCLK 38
#define TFT_CS 21
#define TFT_DC 45
#define TFT_RST 40
#define TFT_BL 46
#define TFT_W 172
#define TFT_H 320
#define TFT_ROTATION 0
#define PANEL_JD9853 1
#define TFT_SPI_HZ 40000000

// AXS5106L on its own I2C pair, with a real reset line (it needs the
// pulse before it answers).
#define TOUCH_SDA 42
#define TOUCH_SCL 41
#define TOUCH_INT 47
#define TOUCH_RST 48
#define TOUCH_ADDR 0x63
#define TOUCH_AXS5106 1
#define TOUCH_MIRROR_X 1   /* reports X right-to-left; see touchRead */
#define TOUCH_ROT_BASE 0

#define VIEW_SCALE_DEFAULT 4
#define VIEW_INSET_DEFAULT 0

#elif BOARD == 4

// ---- Display (Waveshare ESP32-S3-Touch-LCD-1.28, ROUND) ----
// GC9A01 240x240 round panel, CST816S touch (same controller family as
// the 1.69"), QMI8658 IMU on the shared I2C. Pins read off the Rev3
// schematic. Board quirks that are NOT pins: the module is an S3R2 --
// 2MB QUAD PSRAM, so the build must say PSRAM=enabled, not opi -- and
// USB is a CH343 UART bridge on U0TXD/U0RXD, so the console must stay
// on UART0 (CDCOnBoot=default). The scripts' --b128 flag sets both.
#ifndef HAS_DISPLAY
#define HAS_DISPLAY 0
#endif
#ifndef MOD_CAMERA
#define MOD_CAMERA 0
#endif
#define TFT_MOSI 11
#define TFT_MISO -1
#define TFT_SCLK 10
#define TFT_CS 9
#define TFT_DC 8
#define TFT_RST 14
#define TFT_BL 2
#define TFT_W 240
#define TFT_H 240
#define TFT_ROTATION 0
#define PANEL_GC9A01 1
#define TFT_SPI_HZ 40000000

// CST816S with a wired reset line, address 0x15 like the 1.69's — but
// mounted the other way up: it reports in the panel's frame directly
// (base 2, the 1.69's value, put every tap 180 degrees from the finger).
#define TOUCH_SDA 6
#define TOUCH_SCL 7
#define TOUCH_INT 5
#define TOUCH_RST 13
#define TOUCH_ADDR 0x15
#define TOUCH_ROT_BASE 0

// The glass is a circle: layouts that hug corners lose them.
#define ROUND_DISPLAY 1

// 2MB of PSRAM total: the default 2MB JS heap IS the whole chip, the
// alloc fails, and the engine silently never starts (bundle:true,
// jsMs:0, native pages). One megabyte runs the full example set and
// leaves room for the frame canvas and friends.
#ifndef JS_HEAP_BYTES
#define JS_HEAP_BYTES (1024 * 1024)
#endif

#define VIEW_SCALE_DEFAULT 4
#define VIEW_INSET_DEFAULT 0

#else

// ---- Display (Waveshare ESP32-S3-Touch-LCD-1.69) ----
// ST7789V2 240x280 on SPI. Optional: the bridge works headless, the screen is
// there to show what the board is doing without a host attached.
// Overridable from the build, like the switches above.
#ifndef HAS_DISPLAY
#define HAS_DISPLAY 0
#endif
#ifndef MOD_CAMERA
#define MOD_CAMERA 0
#endif
#define TFT_MOSI 7
#define TFT_SCLK 6
#define TFT_CS 5
#define TFT_DC 4
#define TFT_RST 8
#define TFT_BL 15
#define TFT_W 240
#define TFT_H 280
// Panel orientation. 0 and 2 are the two portrait ways up; the touch
// controller reports in the panel's own frame, so this rotates both together
// and they cannot drift apart.
#define TFT_ROTATION 2

// CST816T capacitive touch, on the board's shared I2C bus (with the IMU and
// RTC). Note this is the same peripheral a PN532 would use in I2C mode — on
// this board give the readers SPI or HSU, or put them on Wire1.
#define TOUCH_SDA 11
#define TOUCH_SCL 10
#define TOUCH_INT 14
#define TOUCH_RST 13
#define TOUCH_ADDR 0x15
#define TOUCH_CST816 1
// Measured: at rotation 2 this controller reports in the display's own
// coordinate space, so the right transform there is none.
#define TOUCH_ROT_BASE 2

// 1:1 on the small panel: there is no room to spend on magnification.
#define VIEW_SCALE_DEFAULT 4
#define VIEW_INSET_DEFAULT 0

#endif  // BOARD

// ---- Scripting ----
// MicroQuickJS on board, so UI and behaviour can change without reflashing.
// Adds roughly 150 kB of code; the engine heap comes from PSRAM.
#ifndef HAS_JS
#define HAS_JS 0
#endif

// ---- Optional feedback ----
// The Waveshare 1.69 carries a buzzer on GPIO42 (schematic V2.1). Note the V1
// sheet puts it on GPIO33, which collides with this module's octal PSRAM — if
// your board is V1, leave this at -1.
#ifndef BUZZER_PIN
#define BUZZER_PIN 42
#endif
// No LED on this board: the screen is the status indicator. Leaving this at a
// real pin would drive GPIO2, which is one of the four free solder pads.
#define STATUS_LED_PIN -1

// Onboard LEDs, parked DARK at boot (LED_QUIET 0 leaves them alone).
// Plenty of boards ship LEDs that light with no help from us: a floating
// active-low user LED glows dimly (Seeed XIAO ESP32-S3: GPIO 21, off =
// HIGH), and an addressable RGB left to line noise flickers (Waveshare
// ESP32-S3-Zero: WS2812 on 21; the NON-touch ESP32-S3-LCD-1.47: WS2812
// on 38). Point these at the offender for the board and boot silences it.
//
// Know the limit: the 1.47 TOUCH board's red PWR and green CHG LEDs hang
// off the 3V3 rail and the charger IC, not a GPIO — no firmware reaches
// those; tape or a soldering iron does.
#ifndef LED_QUIET
#define LED_QUIET 1
#endif
#ifndef LED_OFF_PIN
#define LED_OFF_PIN -1     /* plain LED: parked at LED_OFF_LEVEL */
#endif
#ifndef LED_OFF_LEVEL
#define LED_OFF_LEVEL HIGH /* active-low user LEDs go dark driven HIGH */
#endif
#ifndef LED_RGB_PIN
#define LED_RGB_PIN -1     /* addressable WS2812: sent one black pixel */
#endif
