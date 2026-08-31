#pragma once
/*
 * On-device UI: status screen, settings, WiFi join.
 *
 * The point of this file is that the board can be put on the printer's network
 * without a host attached — scan for an SSID, type the passphrase on the glass,
 * and it remembers. After that the bridge is reachable over TCP and the desktop
 * app can do everything it does over USB.
 *
 * Everything here is optional: with HAS_DISPLAY off, the calls compile away to
 * nothing and the bridge behaves exactly as it did headless.
 *
 * The bridge itself stays ignorant of Creality's tag format. What the screen
 * shows about a filament arrives from the host via the `disp` command; what it
 * shows about links and readers, it knows first-hand.
 */

#include "config.h"

#if HAS_DISPLAY

#include <Adafruit_GFX.h>
#include <Adafruit_ST7789.h>
#if PANEL_ST7796
#include "panel_st7796.h"
#endif
#if PANEL_JD9853
#include "panel_jd9853.h"
#endif
#if PANEL_GC9A01
#include <Adafruit_GC9A01A.h>  /* the round 1.28" panel */
#endif
#include <Preferences.h>
#include <SPI.h>
#include <Wire.h>
#if defined(ESP32)
#include <WiFi.h>
#endif

// ---- palette ----
#define COL_BG 0x0000
#define COL_PANEL 0x18E3
#define COL_TEXT 0xFFFF
#define COL_MUTED 0x8410
#define COL_ACCENT 0x2D7F
#define COL_OK 0x2666
#define COL_WARN 0xFD20
#define COL_KEY 0x2124
#define COL_KEYDN 0x4208

// The glass is a rounded rectangle, so keep content off the corners.
#define EDGE_X 12
// Touch targets, sized for a fingertip (~9 mm ≈ 70 px here) rather than for
// how small a control can be drawn.
#define NAV_H 62
#define ROW_H 46
#define EDGE_TOP 14
#define EDGE_BOTTOM 14

#if PANEL_ST7796
static Adafruit_ST7796 tft = Adafruit_ST7796(TFT_CS, TFT_DC, TFT_RST);
#elif PANEL_JD9853
static Adafruit_JD9853 tft = Adafruit_JD9853(TFT_CS, TFT_DC, TFT_RST);
#elif PANEL_GC9A01
static Adafruit_GC9A01A tft = Adafruit_GC9A01A(TFT_CS, TFT_DC, TFT_RST);
#else
static Adafruit_ST7789 tft = Adafruit_ST7789(TFT_CS, TFT_DC, TFT_RST);
#endif

/**
 * Where the native pages draw.
 *
 * Into the canvas when there is one, so that they go through the viewport like
 * everything else. Drawing them straight at the panel put a 152x232 page in
 * the corner of a 320x480 screen at half the intended size, because the
 * coordinates come from SW()/SH() — which is the viewport, not the glass.
 * Defined below, once the canvas exists; declared here, where it is used.
 */
static Adafruit_GFX &scr();
static void uiFlush();
static void frameInit();
static void relayout();

#if IOEXP_ADDR
/**
 * The TCA9554 that holds the panel's reset line.
 *
 * Eight bits behind an I2C address, and on this board the LCD reset, the touch
 * interrupt and the SD card select are three of them. The display cannot come
 * up until this does, which makes it the first thing to talk to — before SPI,
 * before the panel.
 *
 * Register 1 is the output latch and register 3 is the direction mask, in
 * which a 0 bit means output. Everything else is left as an input, which is
 * the safe state for pins whose function this firmware does not use.
 */
static bool ioexpWrite(uint8_t reg, uint8_t val) {
  Wire.beginTransmission((uint8_t)IOEXP_ADDR);
  Wire.write(reg);
  Wire.write(val);
  return Wire.endTransmission() == 0;
}

static uint8_t g_ioexpOut = 0xFF;

static bool ioexpSet(int bit, bool high) {
  if (high) g_ioexpOut |= (1 << bit);
  else g_ioexpOut &= ~(1 << bit);
  return ioexpWrite(1, g_ioexpOut);
}

static bool ioexpBegin() {
  g_ioexpOut = 0xFF;                       /* everything released, then driven */
  if (!ioexpWrite(1, g_ioexpOut)) return false;
  const uint8_t outputs = (1 << IOEXP_LCD_RST) | (1 << IOEXP_SD_CS);
  return ioexpWrite(3, (uint8_t)~outputs); /* 0 = output */
}

/** The panel's reset pulse, which has to happen before its init sequence. */
static void panelReset() {
  ioexpSet(IOEXP_LCD_RST, true);
  delay(10);
  ioexpSet(IOEXP_LCD_RST, false);
  delay(10);
  ioexpSet(IOEXP_LCD_RST, true);
  delay(120);
}
#endif

// ---- native surface for the JS UI (C ABI; glue.c binds gfx.* to these) ----
//
// When a script owns the screen the native pages stand down: uiTick stops
// redrawing and forwards touches to the hook instead of onTouch. The OTA
// screens still draw directly — an update in progress outranks any UI.

// A script gets the whole stroke, not a verdict about it: phase 0 = press,
// 1 = move, 2 = release. Classifying gestures natively (tap vs swipe, from the
// controller's gesture register) meant a list could only move once the finger
// lifted, which reads as a broken screen. Tracking the finger is the script's
// job now; native only reports where it is.
static bool g_uiExternal = false;
static void (*g_ptrFwd)(int phase, int x, int y) = nullptr;


static Preferences g_prefs;

/**
 * Orientation is a runtime property, not a build-time one.
 *
 * The status pages want portrait — two reader panels stack naturally. The
 * QWERTY keyboard wants landscape, because ten columns across 280px is a 28px
 * key and across 240px it is 24px, and at this size that difference is the
 * difference between typing a passphrase and mistyping it.
 */
static uint8_t g_rot = TFT_ROTATION;

/**
 * Backlight and sleep.
 *
 * The panel sits beside a printer, often for hours, and the backlight is the
 * only part of this that draws real current or wears out. So it dims, and it
 * goes off by itself — waking on a touch, or on a scan, because the thing you
 * most want to see the moment a spool is read is the screen.
 *
 * PWM rather than the digital pin it was: brightness is worth having in a room
 * that changes, and a screen at 10% beside a printer at night is kinder than
 * one at 100% or one that is off.
 */
static uint8_t g_blLevel = 255;      // 0..255, when awake
static uint32_t g_sleepMs = 0;       // 0 = never sleep
static bool g_sleepDim = true;       // dim rather than go dark
static uint32_t g_lastPoke = 0;
static bool g_asleep = false;

static void blWrite(uint8_t duty) {
#if defined(TFT_BL) && (TFT_BL >= 0)
  ledcWrite(TFT_BL, duty);
#else
  (void)duty;
#endif
}

/** Something happened that deserves a lit screen. */
static uint32_t g_pokeTouch = 0, g_pokeOther = 0;  /* who keeps us awake */
static void uiPoke() {
  g_lastPoke = millis();
  if (g_asleep) {
    g_asleep = false;
    blWrite(g_blLevel);
  }
}

static bool uiAsleep() { return g_asleep; }

/**
 * Touch scaling, measured on the device rather than assumed.
 *
 * The controller reports in its own coordinate space, and on this panel that
 * space is not the screen: the glass is 280 px tall but the CST816 numbers it
 * as though it were 320, so a finger near the bottom outruns the cursor and the
 * last centimetre of screen cannot be reached at all. One linear fit per axis,
 * measured by the calibration page and kept in Preferences, corrects it before
 * rotation is applied — rotation is a property of how the panel is mounted, and
 * this is a property of the panel itself, so they compose in that order.
 */
#define CAL_MAX 8
static int16_t g_calXr[CAL_MAX], g_calXd[CAL_MAX];  /* raw -> screen, x */
static int16_t g_calYr[CAL_MAX], g_calYd[CAL_MAX];
static int g_calNX = 0, g_calNY = 0;                /* 0 = uncalibrated */

/**
 * The cross term: how much the y reading leans with x.
 *
 * Measured on this panel, every target in a row reported a y that climbed with
 * x — by about 50 units across the width, concentrated at the right edge — and
 * held to within a few units row to row. Two independent per-axis curves cannot
 * express that, however many knots they have, so it is taken out first: this
 * table gives the y offset to subtract for a given raw x, and what remains is
 * something the y curve can describe.
 */
static int16_t g_crossR[CAL_MAX], g_crossD[CAL_MAX];
static int g_crossN = 0;
/* While a script is measuring the mapping, it must see what the controller
   actually said — a transform cannot be measured through itself. */
static bool g_calRaw = false;

/**
 * Piecewise-linear correction along one axis.
 *
 * Two knots is a straight line, which is all a scale-and-offset error needs.
 * More knots bend it, which is what the edges want: the reported position drifts
 * near the rim of the glass in a way no single slope can describe. Between
 * knots it interpolates; outside them it extrapolates on the end segment, so a
 * touch past the outermost target still lands somewhere sensible.
 */
static int calApply(int v, const int16_t *r, const int16_t *d, int n) {
  if (n < 2) return v;
  int i = 0;
  while (i < n - 2 && v > r[i + 1]) i++;
  const int r0 = r[i], r1 = r[i + 1], d0 = d[i], d1 = d[i + 1];
  if (r1 == r0) return d0;
  return d0 + (int)(((long)(v - r0) * (d1 - d0)) / (r1 - r0));
}

/** Parse "raw,screen,raw,screen,..." into a knot table. Returns the count. */
static int calParse(const char *csv, int16_t *r, int16_t *d) {
  int n = 0;
  const char *p = csv;
  while (n < CAL_MAX && p && *p) {
    char *end;
    long a = strtol(p, &end, 10);
    if (end == p) break;
    p = *end ? end + 1 : end;
    long b = strtol(p, &end, 10);
    if (end == p) break;
    p = *end ? end + 1 : end;
    r[n] = (int16_t)a;
    d[n] = (int16_t)b;
    n++;
  }
  return n;
}

/** Screen extent for the current rotation; odd rotations swap the axes. */
/* The panel, as mounted: physical pixels, after rotation. */
static inline int panelW() { return (g_rot & 1) ? TFT_H : TFT_W; }
static inline int panelH() { return (g_rot & 1) ? TFT_W : TFT_H; }

/**
 * The viewport: what the UI thinks the screen is.
 *
 * A bigger panel is not automatically a better one to use. At 320x480 the same
 * six-pixel font is the same physical size it was on the 1.69" — the two
 * panels have almost the same pixel pitch — so "more room" is real but "easier
 * to hit" is not, and the edges of a larger sheet of glass are no more
 * accurate than the edges of a small one. Both problems are answered by
 * drawing the UI at its own size and then placing that image on the panel:
 *
 *   scale   the UI renders smaller and is magnified, so everything on it grows
 *   inset   a margin of panel left unused, keeping content off the edges
 *   shift   moves the image within what is left, for a panel mounted off-centre
 *
 * The UI itself knows none of this. It lays out against SW()/SH() as it always
 * has; the transform is applied once when the frame is blitted, and undone
 * once when a touch comes back the other way. Scale is in quarters so that
 * 1.5x is expressible without floating point anywhere on the path.
 */
static uint8_t g_vScaleQ = 4;    /* 4 = 1x, 5 = 1.25x, 6 = 1.5x, 8 = 2x */
/* The scale the view is ACTUALLY drawn at right now. The stored scale
   belongs to the JS app; the native pages always run 1:1, so their
   layout, touch mapping and canvas agree without scaling any of their
   code. The frame canvas is PHYSICAL (panel-resolution): each draw op
   is scaled on the way in — text at an integer glyph size — so the
   flush is a plain 1:1 blit and nothing lives outside the canvas. */
static inline int vq() { return g_uiExternal ? g_vScaleQ : 4; }
/* NATIVE mode scales each op into the physical canvas; PIXEL mode keeps
   the canvas logical and the flush upscales uniformly (the chunky look,
   fonts included). vpx is the per-op transform, so PIXEL = identity. */
/* 0 = PIXEL (logical canvas, uniform upscale), 1 = NATIVE (per-op,
   sharp), 2 = HD (native, plus Scale2x/3x-smoothed glyphs when the
   physical glyph scale reaches 2 -- rounded diagonals instead of
   blocks, the same smoothing mjsx's 12x16 face is generated with). */
static uint8_t g_fontMode = 2;
static inline bool vNative() { return g_fontMode >= 1; }
static inline bool vHdText() { return g_fontMode >= 2; }
int g_cvTargetRef();          /* defined with the canvas registry below */
static inline int vpx(int v) {
  /* canvases are their OWN pixel space: no view scaling while targeted */
  return (vNative() && g_cvTargetRef() < 0) ? v * vq() / 4 : v;
}
static int16_t g_vInset = 0;     /* panel px kept clear on every side */
static int16_t g_vShiftX = 0, g_vShiftY = 0;

/* The panel rectangle the UI is allowed to use, before scaling. */
static inline int viewAvailW() { return panelW() - g_vInset * 2; }
static inline int viewAvailH() { return panelH() - g_vInset * 2; }

/* The logical screen: what a script and every layout sees. */
static inline int SW() { return viewAvailW() * 4 / vq(); }
static inline int SH() { return viewAvailH() * 4 / vq(); }

/* And the rectangle it actually occupies, which rounding can leave a pixel or
   two short of the space available — so the image is centred in what is left
   rather than pinned to a corner. */
/* Ceiled: flooring both directions turned 320 into 213 logical into 319
   physical, losing a device column (and handing odd widths to the BMP). */
static inline int viewDrawW() { const int w = (SW() * vq() + 3) / 4; return w > viewAvailW() ? viewAvailW() : w; }
static inline int viewDrawH() { const int h = (SH() * vq() + 3) / 4; return h > viewAvailH() ? viewAvailH() : h; }
static inline int viewOX() {
  int o = g_vInset + (viewAvailW() - viewDrawW()) / 2 + g_vShiftX;
  if (o < 0) o = 0;
  if (o + viewDrawW() > panelW()) o = panelW() - viewDrawW();
  return o;
}
static inline int viewOY() {
  int o = g_vInset + (viewAvailH() - viewDrawH()) / 2 + g_vShiftY;
  if (o < 0) o = 0;
  if (o + viewDrawH() > panelH()) o = panelH() - viewDrawH();
  return o;
}
static inline bool viewPlain() {
  return vq() == 4 && viewOX() == 0 && viewOY() == 0 &&
         viewDrawW() == panelW() && viewDrawH() == panelH();
}


/** What each reader is showing. The host supplies label/colour; we observe the rest. */
struct ReaderView {
  bool present = false;
  char uid[16] = "";
  char label[24] = "";
  uint16_t colour = COL_MUTED;
  bool hasColour = false;
};
static ReaderView g_view[READER_COUNT];

enum UiPage { PAGE_STATUS, PAGE_SETTINGS, PAGE_WIFI, PAGE_KEYS, PAGE_PRINTER, PAGE_CALIB };
/* On a JS build the native UI is ONLY the wifi flow (plus calibration,
   which a command starts): the status/printer pages exist for the
   standalone bridge product and are unreachable here. */
#if HAS_JS
#define UI_HOME_PAGE PAGE_WIFI
#else
#define UI_HOME_PAGE PAGE_STATUS
#endif
static UiPage g_page = UI_HOME_PAGE;
/** Set by printer.h at startup; the printer page needs data this file has no
 *  business knowing about. */
static void (*g_printerPage)() = nullptr;
static bool g_dirty = true;

/*
 * The rescue hatch: a very long BOOT hold lands here. Whatever script
 * owns the screen is set aside (not killed -- engine and state survive)
 * and the NATIVE settings page takes over, so wifi and calibration stay
 * reachable under a broken or absent bundle. Settings' own navigation
 * leads back; rerunning the app restores the script.
 */
static void uiSetExternal(bool on, void (*ptrFwd)(int, int, int));
static void uiPoke();
static bool g_rescueMode = false;
static void uiRescue() {
  /* Straight to the WIFI page, and ONLY the wifi flow: rescue exists to
     get a board onto a network, not to resurrect the native app. The
     page flip happens here; stopping the script goes through its own
     exit channel (sysNExit -- the worker owns the engine; flipping the
     screen from this task while the script kept rendering made the two
     fight over the panel). */
  g_rescueMode = true;
  g_page = PAGE_WIFI;
  g_dirty = true;
  uiPoke();
}

static void uiSetExternal(bool on, void (*ptrFwd)(int, int, int)) {
  const bool was = g_uiExternal;
  g_uiExternal = on;
  g_ptrFwd = ptrFwd;
  if (was != on && g_vScaleQ != 4) {
    /* the effective scale (vq) just changed: the canvas dims and the
       native layout both key off it */
    frameInit();
    relayout();
  }
  if (!on) g_dirty = true;  // native UI resumes and must repaint
}
static bool uiExternal() { return g_uiExternal; }
static char g_link[40] = "USB";

// ---- WiFi state ----
static char g_ssid[33] = "";
static char g_pass[65] = "";
static int g_scanCount = 0;
static int g_scanTop = 0;      // first visible row, for scrolling
static int g_scanSel = -1;
static bool g_scanning = false;
static bool g_joining = false;
static char g_joinNote[40] = "";

// ---- keyboard state ----
static bool g_qwerty = true;   // otherwise T9
static char g_entry[65] = "";
static int g_caret = 0;           // insertion point: edits happen here
static bool g_caretDrag = false;  // finger is scrubbing the entry bar
static bool g_shift = false;
static int g_t9Key = -1;       // which key the multi-tap run is on
static int g_t9Idx = 0;
static unsigned long g_t9At = 0;

// ============================ drawing helpers ============================

static uint16_t rgb565(uint32_t rgb) {
  return (uint16_t)(((rgb >> 19) & 0x1F) << 11 | ((rgb >> 10) & 0x3F) << 5 | ((rgb >> 3) & 0x1F));
}

/** GFX's built-in font advances 6px per character, scaled by text size. */
static int textW(const char *s, uint8_t size) { return (int)strlen(s) * 6 * size; }

static void drawCenter(const char *text, int y, uint8_t size, uint16_t colour) {
  scr().setTextSize(size);
  scr().setTextColor(colour);
  scr().setCursor((SW() - textW(text, size)) / 2, y);
  scr().print(text);
}

static void drawText(const char *text, int x, int y, uint8_t size, uint16_t colour) {
  scr().setTextSize(size);
  scr().setTextColor(colour);
  scr().setCursor(x, y);
  scr().print(text);
}

/** A tappable box. Hit-testing uses the same rectangle, so they cannot drift. */
struct Btn {
  int x, y, w, h;
};
static bool hit(const Btn &b, int x, int y) {
  return x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h;
}
/**
 * Draw a control inside its hit area, not equal to it.
 *
 * A fingertip is about 9 mm, which on this panel is ~70 px — far more than a
 * button can look like without filling the screen. So the rect is the *hit*
 * area and reaches the edges, while the visible box is inset from it. Keeping
 * one rect means the two cannot drift apart, which is how touch targets end up
 * next to the thing they appear to be.
 */
/**
 * Flat by default: the control fills its hit area, with a hairline separating
 * it from its neighbour. On a panel this size a pill wastes the margin it needs,
 * and an inset button invites you to aim at the pill rather than the target.
 */
static void drawBtn(const Btn &b, const char *label, uint16_t bg, uint16_t fg, uint8_t size = 1) {
  scr().fillRect(b.x, b.y, b.w, b.h, bg);
  // Separators only where there is something to separate from.
  if (b.x > 0) scr().drawFastVLine(b.x, b.y + 6, b.h - 12, COL_BG);
  if (b.y > 0) scr().drawFastHLine(b.x, b.y, b.w, COL_BG);
  scr().setTextSize(size);
  scr().setTextColor(fg);
  scr().setCursor(b.x + (b.w - textW(label, size)) / 2, b.y + (b.h - 8 * size) / 2);
  scr().print(label);
}

/** A rounded control, for the times a pill is the right shape. */
static void drawPill(const Btn &b, const char *label, uint16_t bg, uint16_t fg, uint8_t size = 1) {
  const int i = 5;
  scr().fillRoundRect(b.x + i, b.y + i, b.w - 2 * i, b.h - 2 * i, 6, bg);
  scr().setTextSize(size);
  scr().setTextColor(fg);
  scr().setCursor(b.x + (b.w - textW(label, size)) / 2, b.y + (b.h - 8 * size) / 2);
  scr().print(label);
}

// ============================== touch ==============================

/**
 * CST816T. One touch point, read as six registers from 0x01.
 *
 * Only the press edge matters here — this UI has no drag or gesture — so a
 * press is reported once and then suppressed until the finger lifts.
 */
/**
 * Read the touch point, but only when there is one.
 *
 * The controller pulls INT low while a finger is down, so the I2C bus is left
 * alone the rest of the time. That is not a micro-optimisation: polling it every
 * loop meant a blocking transaction per iteration, and when the device did not
 * answer, those blocked long enough to starve the USB-CDC service task — which
 * shows up on the host as flashing failing partway through with a write
 * timeout. Espressif document exactly this class of fault: the running
 * application interfering with USB communication.
 */
// Last raw and mapped touch, kept for the `touch` diagnostic command — with no
// way to see the screen from here, the only way to tell a dead controller from
// a bad mapping is to look at both numbers.
static int g_tRawX = -1, g_tRawY = -1, g_tX = -1, g_tY = -1;
static uint32_t g_tCount = 0;

/**
 * Calibration.
 *
 * The controller does not report in the display's coordinate space, and the
 * mismatch is not a simple flip — taps along the bottom row read y = 1..32 on a
 * 280-tall panel. Rather than guess at signs and scales, show four targets at
 * known positions, record the raw reading at each, and derive the mapping from
 * the four pairs.
 */
#define CALIB_N 4
static int g_calStep = -1;                  // -1 = not calibrating
static int g_calRawX[CALIB_N], g_calRawY[CALIB_N];
static bool g_calDone = false;

/**
 * Bring the touch controller up, and confirm that it came.
 *
 * Without a reset it never answers at 0x15 — the bus shows only the RTC and the
 * IMU, and every tap is lost silently. One pulse is not reliable at power-on
 * either (it worked when issued later but not during setup), so this checks the
 * address afterwards and retries rather than assuming.
 */
static bool touchWake() {
#if TOUCH_RST < 0
  /* No reset line on this board — the controller shares the I2C bus and comes
     up with it, so the only question worth asking is whether it answers. */
  for (int attempt = 0; attempt < 4; attempt++) {
    Wire.beginTransmission(TOUCH_ADDR);
    if (Wire.endTransmission() == 0) return true;
    delay(50);
  }
  return false;
#else
  for (int attempt = 0; attempt < 4; attempt++) {
    // Re-initialise the bus, not just the chip.
    //
    // A reset pulse alone did not revive it, but the same pulse did work when a
    // bus scan (which ends and restarts Wire) had run first — pointing at a
    // wedged I2C peripheral rather than a sleeping controller. Clearing both is
    // cheap and removes the ambiguity.
    Wire.end();
    delay(5);
    Wire.begin(TOUCH_SDA, TOUCH_SCL);
    Wire.setTimeOut(20);

    pinMode(TOUCH_RST, OUTPUT);
    digitalWrite(TOUCH_RST, HIGH);
    delay(5);
    digitalWrite(TOUCH_RST, LOW);
    delay(200);                 // AXS5106L: Waveshare holds reset this long
    digitalWrite(TOUCH_RST, HIGH);
    delay(300 + attempt * 60);  // and waits this long before first contact

    Wire.beginTransmission(TOUCH_ADDR);
    if (Wire.endTransmission() == 0) return true;
  }
  return false;
#endif
}

/** Set when the last read failed on the bus, as opposed to finding no finger. */
static bool g_touchBusError = false;
/* Last gesture the controller classified (read with each touch report). */
static uint8_t g_gesture = 0;

static bool touchRead(int &x, int &y) {
  // No INT gate: the pin is not a reliable "finger down" signal on this board,
  // and gating on it stopped touch working altogether. The 25 ms throttle in
  // uiTick() is what keeps the bus quiet, which was the actual goal.
  Wire.beginTransmission(TOUCH_ADDR);
  Wire.write(0x01);
#if defined(TOUCH_AXS5106)
  /* Full STOP, not repeated start: Waveshare's own drivers (Arduino and
     ESP-IDF both) end the address write before reading, and the chip
     returns nothing useful over a repeated start. */
  const uint8_t wr = Wire.endTransmission(true);
#else
  const uint8_t wr = Wire.endTransmission(false);
#endif
  if (wr != 0) {
    g_touchBusError = true;  // the chip is not answering at all
    return false;
  }
  if (Wire.requestFrom((uint8_t)TOUCH_ADDR, (uint8_t)6) != 6) {
    g_touchBusError = true;
    return false;
  }
  g_touchBusError = false;
  /* AXS5106L included: Waveshare's own driver reads from reg 0x01 and takes
     byte[1] as the point count — gesture first, count second, coords at
     0x03..0x06. FT-identical layout, no special case. */
  g_gesture = Wire.read();
  const uint8_t fingers = (uint8_t)(Wire.read() & 0x0F);
  const uint8_t xh = Wire.read(), xl = Wire.read();
  const uint8_t yh = Wire.read(), yl = Wire.read();
  if (fingers == 0 || fingers > 2) return false;
  x = ((xh & 0x0F) << 8) | xl;
  y = ((yh & 0x0F) << 8) | yl;

  // The controller always reports in the panel's native frame, so the touch has
  // to be rotated exactly as the display is — otherwise a tap lands somewhere
  // else entirely, and on a rotated screen that is usually the opposite corner.
  int rx = x, ry = y;
  g_tRawX = rx;
  g_tRawY = ry;
  g_tCount++;

  // While calibrating, the raw reading is the whole point — return it untouched
  // so a wrong mapping cannot corrupt the measurement of that mapping.
  if (g_calStep >= 0 || g_calRaw) {
    x = rx;
    y = ry;
    return true;
  }

#if defined(TOUCH_MIRROR_X) && TOUCH_MIRROR_X
  // The AXS5106L reports X right-to-left relative to the panel — a mirror,
  // which no rotation can absorb. Waveshare's own driver flips it the same
  // way (x = width-1-raw.x at rotation 0). In the native frame, before
  // calibration, so everything downstream sees panel-handed coordinates.
  rx = TFT_W - 1 - rx;
#endif
  // Take the lean out first, in the controller's own coordinates, then map
  // each axis, then rotate.
  if (g_crossN >= 2) ry -= calApply(rx, g_crossR, g_crossD, g_crossN);
  rx = calApply(rx, g_calXr, g_calXd, g_calNX);
  ry = calApply(ry, g_calYr, g_calYd, g_calNY);
  if (rx < 0) rx = 0;
  if (ry < 0) ry = 0;
  if (rx > TFT_W - 1) rx = TFT_W - 1;
  if (ry > TFT_H - 1) ry = TFT_H - 1;
  x = rx;
  y = ry;
  // Measured, not assumed. Four-target calibration at TFT_ROTATION 2 gave:
  //
  //   target (30,30)   -> raw (46,3)      target (210,30)  -> raw (210,29)
  //   target (30,250)  -> raw (39,258)    target (210,250) -> raw (215,278)
  //
  // i.e. the controller already reports in the display's coordinate space at
  // this orientation, so the right transform is none. The earlier code inverted
  // both axes, which put every tap opposite the point pressed.
  //
  // The other three follow from that one fact plus the GFX rotation convention
  // (rotation r maps user (x,y) to panel (x_n,y_n): r=1 is x_n = W-1-y,
  // y_n = x; r=3 is x_n = y, y_n = H-1-x). Identity at rotation 2 means the
  // controller's frame is the panel's frame turned 180 degrees, i.e.
  // x_n = W-1-rx, y_n = H-1-ry; substituting gives each case below.
  //
  // The landscape pair was previously written the other way round, which put
  // every landscape touch exactly 180 degrees from the finger.
  //
  // Written against the rotation at which THIS controller reports in the
  // display's own frame (TOUCH_ROT_BASE) rather than against rotation 2, which
  // was only ever the answer for the CST816. The FT6336 on the 3.5" board
  // agrees with the panel at rotation 0, and running it through the other
  // board's table put every touch 180 degrees from the finger.
  switch ((g_rot - TOUCH_ROT_BASE + 4) & 3) {
    case 0:
      break;  // identity — the controller already speaks the panel's frame
    case 1:
      x = ry;
      y = TFT_W - 1 - rx;
      break;
    case 2:
      x = TFT_W - 1 - rx;
      y = TFT_H - 1 - ry;
      break;
    case 3:
      x = TFT_H - 1 - ry;
      y = rx;
      break;
  }

  /* Panel pixels until here. Undo the viewport so the UI is handed a point in
     the coordinate space it drew in — the same transform as the blit, run
     backwards. Clamped rather than rejected: a press in the inset margin is a
     press near the edge, and treating it as one is kinder than losing it. */
  if (!viewPlain()) {
    x = (x - viewOX()) * 4 / vq();
    y = (y - viewOY()) * 4 / vq();
    if (x < 0) x = 0;
    if (y < 0) y = 0;
    if (x > SW() - 1) x = SW() - 1;
    if (y > SH() - 1) y = SH() - 1;
  }

  g_tX = x;
  g_tY = y;
  return x >= 0 && x < SW() && y >= 0 && y < SH();
}

// ============================== pages ==============================

// Laid out from the live screen size rather than fixed, so a rotation moves the
// controls and their hit boxes together.
static Btn BTN_SETTINGS, BTN_PRINTER, BTN_BACK, BTN_WIFI, BTN_FORGET, BTN_RESCAN;
static Btn BTN_MODE, BTN_BKSP, BTN_DONE, BTN_ROT, BTN_SHIFT, BTN_SPACE, BTN_SYM;

/* QWERTY wants ten columns of at least ~22px: below a 220px short axis no
   orientation can hold it, and the keys page stays T9 with no mode button. */
static bool qwPossible() {
#if defined(ROUND_DISPLAY) && ROUND_DISPLAY
  return false;   /* ten columns on a circle: no height fixes that */
#else
  const int lo = SW() < SH() ? SW() : SH();
  return lo >= 220;
#endif
}

#if defined(ROUND_DISPLAY) && ROUND_DISPLAY
/* Half-width of the glass at a horizontal band: the chord, minus a
   margin. Every row of a round layout gets exactly the width the
   circle really has at its own height. */
static int roundHW(int yTop, int yBot) {
  const int c = SH() / 2, r = c - 2;
  int a = yTop < c ? c - yTop : yTop - c;
  const int b = yBot < c ? c - yBot : yBot - c;
  if (b > a) a = b;
  if (a >= r) return 0;
  return (int)sqrtf((float)(r * r - a * a)) - 4;
}
#endif

/* FULLSCREEN keyboard: under 280px of height the classic page (24px entry,
   40px chrome row, then keys) leaves the keys a strip — so the keyboard
   takes the whole screen instead. The entry shrinks to a slim bar across
   the top and every remaining pixel goes to keys: T9 keeps its chrome in a
   right-hand column, QWERTY folds its chrome into the shift/space row.
   The 1.69" sideways was silently CLIPPING its bottom rows before this. */
static bool kbFull() { return SH() < 280; }
#define KB_STRIP_H 20             /* the fullscreen entry bar */

/* T9 grid geometry, shared by draw and hit so they cannot disagree. Tall
   screens get the phone layout (3 wide, 4 down) under a full-width chrome
   row. A screen too short for four key rows (landscape on the 1.47", the
   1.69" turned sideways) goes COMPACT: the chrome moves into a column on
   the right edge and the same 12 keys pack 4 wide and 3 down beside it —
   digits stay a 3x3 block, the three special keys stack in the fourth
   column, and the rows get the height the chrome row was eating. */
/* Column-chrome T9 layout: every fullscreen keyboard that is not showing
   QWERTY (g_qwerty only matters where QWERTY is possible at all). */
static bool keysCompact() { return kbFull() && !(qwPossible() && g_qwerty); }
#define KEYS_CHROME_W 70          /* right-hand chrome column, compact mode */

/* QWERTY row geometry, shared by relayout, draw and hit. */
static int qwTop() { return kbFull() ? KB_STRIP_H + 2 : 86; }
static int qwKh() { return kbFull() ? (SH() - qwTop() - 46) / 4 - 2 : 44; }
static int qwBotY() { return qwTop() + 4 * (qwKh() + 2) + 2; }
#if defined(ROUND_DISPLAY) && ROUND_DISPLAY
static int t9Cols() { return 3; }        /* the phone grid, always */
static int t9KeyAt(int cell) { return cell; }
#else
static int t9Cols() { return keysCompact() ? 4 : 3; }
static int t9KeyAt(int cell) {
  if (!keysCompact()) return cell;
  const int r = cell / 4, c = cell % 4;
  return c < 3 ? r * 3 + c : 9 + r;
}
#endif
/* All key geometry flows from here, on purpose: a future round panel can
   swap the usable rect for its inscribed square in this one spot and the
   whole page follows. */
static Btn t9Btn(int cell) {
#if defined(ROUND_DISPLAY) && ROUND_DISPLAY
  /* A circle: 3 wide, 4 down, and each row as wide as the chord at its
     own height — a trapezoid that hugs the glass. Entry arc above,
     shift/JOIN arc below. */
  const int top = 46, kh = (SH() - top - 36) / 4 - 2;
  const int y = top + (cell / 3) * (kh + 2);
  const int hw = roundHW(y, y + kh);
  const int kw = (2 * hw - 8) / 3;
  Btn b = {SW() / 2 - hw + (cell % 3) * (kw + 4), y, kw, kh};
  return b;
#else
  if (!keysCompact()) {
    const int kw = (SW() - 2 * EDGE_X - 8) / 3;
    /* Grow into whatever height the screen has (leaving the hint line a
       spot), instead of a fixed 44 on a screen with room to spare. */
    int kh = (SH() - 86 - 18) / 4 - 4;
    if (kh < 44) kh = 44;
    if (kh > 64) kh = 64;
    Btn b = {EDGE_X + (cell % 3) * (kw + 4), 86 + (cell / 3) * (kh + 4), kw, kh};
    return b;
  }
  const int top = KB_STRIP_H + 2; /* right under the fullscreen entry bar */
  const int kh = (SH() - top - 4) / 3 - 4;
  const int kw = (SW() - EDGE_X - KEYS_CHROME_W - 8 - 12) / 4;
  Btn b = {EDGE_X + (cell % 4) * (kw + 4), top + (cell / 4) * (kh + 4), kw, kh};
  return b;
#endif
}

static void relayout() {
  const int w = SW(), h = SH();

  // A nav bar across the full width: each half is a target, edge to edge, and
  // tall enough to hit without looking. Nothing is inset here — the drawing is.
  const int navH = NAV_H;
  const int navY = h - navH;
  BTN_PRINTER = {0, navY, w / 2, navH};
  BTN_SETTINGS = {w / 2, navY, w - w / 2, navH};

  // Back is the same bar, but the whole width: on a page with one way out,
  // making you aim is pointless.
  BTN_BACK = {0, navY, w / 2, navH};
  BTN_RESCAN = {w / 2, navY, w - w / 2, navH};

  BTN_WIFI = {EDGE_X, 70, w - 2 * EDGE_X, 56};
  BTN_FORGET = {EDGE_X, 132, w - 2 * EDGE_X, 48};

  // Keyboard chrome: share the width among however many buttons this screen
  // gets. QWERTY needs ten usable columns, so a short axis under ~220px
  // (the 1.47" is 172) never offers the mode button at all — and the fixed
  // positions this replaced overlapped each other on anything narrower
  // than ~300px.
  // Keys chrome is always four buttons (plus shift/space in QWERTY). The
  // first is dual-purpose: the T9/ABC mode switch where QWERTY fits, a T9
  // shift key where it never will (t9Tap already honours g_shift — without
  // this button a QWERTY-less board could not type an uppercase
  // passphrase).
#if defined(ROUND_DISPLAY) && ROUND_DISPLAY
  // Round chrome: DEL rides inside the entry arc (set with entryRect),
  // shift and JOIN share the bottom arc, and ROT is nothing a circle
  // can use.
  {
    BTN_BKSP = {56 + 128 - 24 - 28, 20, 26, 26};
    BTN_MODE = {w / 2 - 54, h - 34, 36, 26};
    BTN_DONE = {w / 2 - 14, h - 34, 68, 26};
    BTN_ROT = {0, 0, 0, 0};
    BTN_SHIFT = {0, 0, 0, 0};
    BTN_SPACE = {0, 0, 0, 0};
    BTN_SYM = {0, 0, 0, 0};
  }
#else
  if (keysCompact()) {
    // Fullscreen T9: a column on the right edge — DEL by the entry tail,
    // JOIN at the bottom where a commit belongs.
    const int top = KB_STRIP_H + 2, bh = (h - top - 4) / 4 - 4;
    const int bx = w - KEYS_CHROME_W;
    BTN_BKSP = {bx, top, KEYS_CHROME_W, bh};
    BTN_MODE = {bx, top + (bh + 4), KEYS_CHROME_W, bh};
    BTN_ROT = {bx, top + 2 * (bh + 4), KEYS_CHROME_W, bh};
    BTN_DONE = {bx, top + 3 * (bh + 4), KEYS_CHROME_W, bh};
    BTN_SHIFT = {0, 0, 0, 0};
    BTN_SPACE = {0, 0, 0, 0};
    BTN_SYM = {0, 0, 0, 0};
  } else if (kbFull()) {
    // Fullscreen QWERTY: the chrome shares the bottom row with shift,
    // the symbol-page toggle, and space — six equal slots after shift.
    const int by = qwBotY(), bh2 = h - by - 2;
    const int bw = (w - 50 - 20) / 6;
    BTN_SHIFT = {0, by, 46, bh2};
    int bx = 50;
    BTN_SYM = {bx, by, bw, bh2}; bx += bw + 4;
    BTN_SPACE = {bx, by, bw, bh2}; bx += bw + 4;
    BTN_BKSP = {bx, by, bw, bh2}; bx += bw + 4;
    BTN_ROT = {bx, by, bw, bh2}; bx += bw + 4;
    BTN_MODE = {bx, by, bw, bh2}; bx += bw + 4;
    BTN_DONE = {bx, by, w - bx, bh2};
  } else {
    const int bw = (w - 12) / 4;
    int bx = 0;
    BTN_MODE = {bx, 40, bw, 40}; bx += bw + 4;
    BTN_ROT = {bx, 40, bw, 40}; bx += bw + 4;
    BTN_DONE = {bx, 40, bw, 40}; bx += bw + 4;
    BTN_BKSP = {bx, 40, bw, 40};
    BTN_SHIFT = {EDGE_X, qwBotY(), 56, 40};
    BTN_SYM = {EDGE_X + 60, qwBotY(), 44, 40};
    BTN_SPACE = {EDGE_X + 108, qwBotY(), w - 2 * EDGE_X - 108, 40};
  }
#endif
}

/** Change orientation and rebuild everything that depends on it. */
static void setRotation(uint8_t rot) {
  if (rot == g_rot) return;
  g_rot = rot & 3;
  tft.setRotation(g_rot);
  // Allocate the canvas now rather than on the first script draw. The native
  // pages render through it too, and until it exists they go straight at the
  // panel — at viewport coordinates, which on a scaled display puts a small
  // page in the corner of a large screen.
  tft.fillScreen(COL_BG);
  frameInit();
  relayout();
  g_dirty = true;
}

/** How many network rows fit above the nav bar. Shared so the list and its
 *  hit-testing cannot disagree about it. */
static int wifiRows() { return (SH() - NAV_H - (EDGE_TOP + 26)) / (ROW_H + 2); }

/** WiFi strength as a short word — bars would be four more draw calls. */
static const char *rssiWord(int rssi) {
  if (rssi >= -55) return "strong";
  if (rssi >= -70) return "ok";
  return "weak";
}

static void drawStatus() {
  scr().fillScreen(COL_BG);

  // "Filament RFID" centred as one 13-character line, in two colours.
  const int x = (SW() - 13 * 12) / 2;
  scr().setTextSize(2);
  scr().setCursor(x, EDGE_TOP);
  scr().setTextColor(COL_TEXT);
  scr().print("Filament");
  scr().setTextColor(COL_ACCENT);
  scr().print(" RFID");

#if SIMULATE_READER
  // Say so plainly: a simulated tag that looked real on screen would be a trap.
  drawCenter("SIMULATOR", EDGE_TOP + 20, 1, COL_MUTED);
#endif

  // Link line: the WiFi address when we have one, otherwise how we are reached.
  const bool up = WiFi.status() == WL_CONNECTED;
  char line[48];
  int top = EDGE_TOP + 46;
  if (up) {
    const String ipStr = WiFi.localIP().toString();
    snprintf(line, sizeof(line), "%s  %s", g_ssid, ipStr.c_str());
    if ((int)strlen(line) * 6 > SW() - 2 * EDGE_X) {
      // Narrow screen: the pair collides on one line — stack them.
      drawCenter(g_ssid, EDGE_TOP + 32, 1, COL_OK);
      drawCenter(ipStr.c_str(), EDGE_TOP + 44, 1, COL_OK);
      top = EDGE_TOP + 58;
    } else {
      drawCenter(line, EDGE_TOP + 32, 1, COL_OK);
    }
  } else {
    snprintf(line, sizeof(line), "%s", g_link);
    drawCenter(line, EDGE_TOP + 32, 1, COL_MUTED);
  }
  const int gap = 6;
  const int avail = SH() - top - NAV_H - 4;  // leave the nav bar its full height
  const int h = (avail - gap * (READER_COUNT - 1)) / READER_COUNT;

  for (int i = 0; i < READER_COUNT; i++) {
    const ReaderView &v = g_view[i];
    const int y = top + i * (h + gap);
    scr().fillRoundRect(EDGE_X, y, SW() - 2 * EDGE_X, h, 8, COL_PANEL);

    char hdr[16];
    snprintf(hdr, sizeof(hdr), "READER %d", i + 1);
    drawText(hdr, EDGE_X + 10, y + 9, 1, COL_MUTED);
    scr().fillCircle(SW() - EDGE_X - 12, y + 12, 5, v.present ? COL_OK : COL_MUTED);

    const int sw = 34;
    if (v.hasColour) {
      scr().fillRoundRect(EDGE_X + 10, y + 24, sw, sw, 4, v.colour);
      scr().drawRoundRect(EDGE_X + 10, y + 24, sw, sw, 4, COL_MUTED);
    }
    const int tx = EDGE_X + 10 + (v.hasColour ? sw + 8 : 0);
    drawText(v.label[0] ? v.label : (v.present ? "tag" : "no tag"), tx, y + 26, 2,
             v.label[0] ? COL_TEXT : COL_MUTED);
    drawText(v.uid[0] ? v.uid : "--", tx, y + 46, 1, COL_MUTED);
  }

  drawBtn(BTN_PRINTER, "PRINTER", COL_KEY, COL_TEXT);
  drawBtn(BTN_SETTINGS, "SETTINGS", COL_KEY, COL_TEXT);
}

static void drawSettings() {
  scr().fillScreen(COL_BG);
  drawCenter("Settings", EDGE_TOP, 2, COL_TEXT);

  const bool up = WiFi.status() == WL_CONNECTED;
  drawCenter(up ? "WiFi connected" : (g_ssid[0] ? "WiFi saved, not connected" : "WiFi not set"),
             EDGE_TOP + 24, 1, up ? COL_OK : COL_MUTED);

  drawBtn(BTN_WIFI, g_ssid[0] ? g_ssid : "Choose a network", COL_KEY, COL_TEXT, 2);
  if (g_ssid[0]) drawBtn(BTN_FORGET, "Forget this network", COL_KEY, COL_WARN);

  if (up) {
    char ip[32];
    snprintf(ip, sizeof(ip), "%s:%d", WiFi.localIP().toString().c_str(), TCP_PORT);
    drawCenter(ip, 164, 1, COL_MUTED);
  }
  if (g_joinNote[0]) drawCenter(g_joinNote, 182, 1, COL_WARN);

  drawBtn(BTN_BACK, "Back", COL_KEY, COL_TEXT);
}

static void drawWifiList() {
  scr().fillScreen(COL_BG);
  drawCenter("Networks", EDGE_TOP, 2, COL_TEXT);

  /* What matters first is where the board IS: the current connection
     (or the lack of one), before any list of alternatives. */
  {
    char cur[64];
    if (WiFi.status() == WL_CONNECTED) {
#if defined(ROUND_DISPLAY) && ROUND_DISPLAY
      // The chord up here is short: the address alone, which is the part
      // someone actually reads off the screen.
      snprintf(cur, sizeof(cur), "%s", WiFi.localIP().toString().c_str());
#else
      snprintf(cur, sizeof(cur), "%s  %s", WiFi.SSID().c_str(),
               WiFi.localIP().toString().c_str());
#endif
      drawCenter(cur, EDGE_TOP + 18, 1, COL_OK);
    } else {
      drawCenter("not connected", EDGE_TOP + 18, 1, COL_MUTED);
    }
  }

  if (g_scanning) {
    drawCenter("scanning...", 90, 1, COL_MUTED);
    drawBtn(BTN_BACK, "Back", COL_KEY, COL_TEXT);
    return;
  }
  if (g_scanCount <= 0) {
    drawCenter("none found", 90, 1, COL_MUTED);
  }

  // Rows are sized for a fingertip, so fewer fit — which is the right trade on
  // a panel this size. The list pages rather than scrolls.
  const int rowH = ROW_H;
  const int top = EDGE_TOP + 34;
  const int rows = wifiRows();
  for (int i = 0; i < rows; i++) {
    const int idx = g_scanTop + i;
    if (idx >= g_scanCount) break;
    const int y = top + i * (rowH + 2);
    // Full width: the row is the target, so it may as well reach the edges.
    // On round glass, ONE width for every row — the narrowest chord the
    // list band reaches. Rows that each hugged their own chord read as
    // wobble, not design.
    int rx = 4, rw = SW() - 8;
#if defined(ROUND_DISPLAY) && ROUND_DISPLAY
    {
      const int hw = roundHW(top, top + rows * (rowH + 2) - 2);
      rx = SW() / 2 - hw;
      rw = 2 * hw;
    }
#endif
    scr().fillRoundRect(rx, y, rw, rowH, 6, COL_PANEL);

    String ssid = WiFi.SSID(idx);
    char name[22];
    const int maxCh = (rw - 20) / 12;
    snprintf(name, sizeof(name), "%.*s", maxCh < 21 ? maxCh : 21, ssid.c_str());
    drawText(name, rx + 10, y + 10, 2, COL_TEXT);

    char meta[24];
    snprintf(meta, sizeof(meta), "%s%s", rssiWord(WiFi.RSSI(idx)),
             WiFi.encryptionType(idx) == WIFI_AUTH_OPEN ? "  open" : "");
    drawText(meta, rx + 10, y + 30, 1, COL_MUTED);
  }

  drawBtn(BTN_BACK, "Back", COL_KEY, COL_TEXT);
  drawBtn(BTN_RESCAN, g_scanCount > g_scanTop + wifiRows() ? "More" : "Rescan", COL_KEY, COL_TEXT);
}

// ---- keyboards ----
//
// Two layouts because the glass is 1.69": QWERTY keys are 24px wide, which is
// fine if your touch is accurate, and T9 keys are 76px, which is fine if it
// isn't. The mode button swaps them and the entry field is shared.

/* T9, matched to the framework's JS keyboard: LETTERS first, the digit
   last in each cycle (so the first tap is a letter and a LONG PRESS is
   the digit, phone style), punctuation on the 1 key, and the 0 key
   cycling space -> @ -> - -> 0. The two remaining cells of the 12-cell
   grid carry symbol cycles so the printable range stays reachable on a
   board with no QWERTY. */
static const char *T9_KEYS[12] = {".,?!'\"1", "abc2",  "def3",
                                  "ghi4",     "jkl5",  "mno6",
                                  "pqrs7",    "tuv8",  "wxyz9",
                                  "*#&$%^/",  " @-0",  "-_+=():;"};
/* QWERTY pages, the JS keyboard's exact plates: letters, symbols, and the
   rest of the face (page 2) so every printable glyph is typeable. */
static const char *QW_PAGES[3][4] = {
    {"1234567890", "qwertyuiop", "asdfghjkl", "zxcvbnm"},
    {"1234567890", "@#$%&-+()", "_\"':;!?", ""},
    {"[]{}<>()^~", "*/\\|=+-#%", "`$&\"':;", ""}};
static uint8_t g_qwPage = 0;     /* 0 letters, 1 symbols, 2 the rest */
/* press-and-hold bookkeeping: a held T9 key becomes its digit, a held
   DEL repeats */
static int8_t g_kbHoldKind = 0;  /* 0 none, 1 T9 cell, 2 DEL */
static int8_t g_kbHoldCell = -1;
static uint32_t g_kbHoldAt = 0;
static bool g_kbHoldDone = false;

/* The entry bar's geometry, one source for draw and touch. The text area
   stops short of the ESC (cancel) square on its right end; a tap or drag
   in the text area places the caret. */
static Btn entryRect() {
#if defined(ROUND_DISPLAY) && ROUND_DISPLAY
  /* Below the top arc, sized to the chord there: text, then DEL, then
     the ESC square, all inside one bar. */
  Btn b = {56, 20, 128, 26}; return b;
#else
  if (kbFull()) { Btn b = {0, 0, SW(), KB_STRIP_H}; return b; }
  Btn b = {EDGE_X, EDGE_TOP, SW() - 2 * EDGE_X, 24}; return b;
#endif
}
static Btn entryEscRect() {
  const Btn e = entryRect();
  Btn b = {e.x + e.w - 24, e.y, 24, e.h}; return b;
}
static void entryWindow(int &textX, int &start, int &maxChars) {
  const Btn e = entryRect();
  textX = e.x + 6;
#if defined(ROUND_DISPLAY) && ROUND_DISPLAY
  maxChars = (e.w - 12 - 24 - 28) / 12;  /* ESC square and DEL both ride inside */
#else
  maxChars = (e.w - 12 - 24) / 12;   /* 24: the ESC square */
#endif
  const int len = (int)strlen(g_entry);
  if (g_caret > len) g_caret = len;
  start = 0;
  if (len > maxChars) {
    start = len - maxChars;          /* default: the tail you just typed */
    if (g_caret < start + 1) start = g_caret > 0 ? g_caret - 1 : 0;
    if (start > len - maxChars) start = len - maxChars;
  }
}

static void drawEntry() {
  const Btn e = entryRect();
#if defined(ROUND_DISPLAY) && ROUND_DISPLAY
  scr().fillRoundRect(e.x, e.y, e.w, e.h, 5, COL_PANEL);
#else
  if (kbFull()) scr().fillRect(e.x, e.y, e.w, e.h, COL_PANEL);
  else scr().fillRoundRect(e.x, e.y, e.w, e.h, 5, COL_PANEL);
#endif
  int textX, start, maxChars;
  entryWindow(textX, start, maxChars);
  const int len = (int)strlen(g_entry);
  char shown[56];
  int n = len - start;
  if (n > maxChars) n = maxChars;
  if (n > (int)sizeof(shown) - 1) n = (int)sizeof(shown) - 1;
  memcpy(shown, g_entry + start, n);
  shown[n] = 0;
  const int textY = e.y + (e.h - 16) / 2 + 1;
  drawText(len ? shown : "passphrase", textX, textY, 2, len ? COL_TEXT : COL_MUTED);
  // The caret, at its insertion point.
  const int cx = textX + (g_caret - start) * 12 - 1;
  scr().fillRect(cx, e.y + 2, 2, e.h - 4, COL_ACCENT);
  // ESC: the way out that is not JOIN.
  drawText("x", e.x + e.w - 15, textY, 2, COL_MUTED);
}

static void drawKeys() {
  scr().fillScreen(COL_BG);
  drawEntry();

  if (qwPossible()) drawBtn(BTN_MODE, g_qwerty ? "T9" : "ABC", COL_KEY, COL_TEXT);
  else drawBtn(BTN_MODE, g_shift ? "ABC" : "abc", g_shift ? COL_ACCENT : COL_KEY, COL_TEXT);
  if (BTN_ROT.w) drawBtn(BTN_ROT, "ROT", COL_KEY, COL_TEXT);
  drawBtn(BTN_DONE, "JOIN", COL_ACCENT, COL_TEXT);
  drawBtn(BTN_BKSP, "DEL", COL_KEY, COL_TEXT);

  if (g_qwerty && qwPossible()) {
    const int top = qwTop(), kh = qwKh();
    for (int r = 0; r < 4; r++) {
      const char *row = QW_PAGES[g_qwPage][r];
      const int n = (int)strlen(row);
      if (!n) continue;
      const int kw = SW() / 10;
      const int x0 = (SW() - n * kw) / 2;
      for (int c = 0; c < n; c++) {
        char lbl[2] = {row[c], 0};
        if (g_shift && lbl[0] >= 'a' && lbl[0] <= 'z') lbl[0] -= 32;
        Btn b = {x0 + c * kw, top + r * (kh + 2), kw - 2, kh};
        drawBtn(b, lbl, COL_KEY, COL_TEXT, 2);
      }
    }
    // Bottom row: shift (or the symbol-page flip), the page toggle, space.
    const char *shLbl = g_qwPage == 0 ? (g_shift ? "ABC" : "abc")
                                      : (g_qwPage == 1 ? "#+=" : "123");
    drawBtn(BTN_SHIFT, shLbl, g_shift && g_qwPage == 0 ? COL_ACCENT : COL_KEY, COL_TEXT);
    drawBtn(BTN_SYM, g_qwPage ? "abc" : "123", COL_KEY, COL_TEXT);
    drawBtn(BTN_SPACE, "space", COL_KEY, COL_TEXT);
  } else {
    for (int cell = 0; cell < 12; cell++)
      drawBtn(t9Btn(cell), T9_KEYS[t9KeyAt(cell)], COL_KEY, COL_TEXT, 1);
    const Btn last = t9Btn(11);
#if !defined(ROUND_DISPLAY) || !ROUND_DISPLAY
    if (SH() - (last.y + last.h) >= 14)
      drawCenter("tap a key repeatedly", last.y + last.h + 4, 1, COL_MUTED);
#else
    (void)last;   /* the bottom arc belongs to shift and JOIN */
#endif
  }
}

/** Where the calibration targets sit, in display coordinates. */
static void calibTarget(int i, int &tx, int &ty) {
  const int inset = 30;
  tx = (i == 0 || i == 2) ? inset : SW() - inset;
  ty = (i < 2) ? inset : SH() - inset;
}

static void drawCalib() {
  scr().fillScreen(COL_BG);
  drawCenter("Calibration", EDGE_TOP, 2, COL_TEXT);
  char msg[32];
  snprintf(msg, sizeof(msg), "tap target %d of %d", g_calStep + 1, CALIB_N);
  drawCenter(msg, EDGE_TOP + 24, 1, COL_MUTED);

  int tx, ty;
  calibTarget(g_calStep, tx, ty);
  scr().drawCircle(tx, ty, 12, COL_ACCENT);
  scr().drawCircle(tx, ty, 4, COL_ACCENT);
  scr().drawFastHLine(tx - 18, ty, 36, COL_ACCENT);
  scr().drawFastVLine(tx, ty - 18, 36, COL_ACCENT);
}

static void uiDraw() {
  switch (g_page) {
    case PAGE_STATUS: drawStatus(); break;
    case PAGE_SETTINGS: drawSettings(); break;
    case PAGE_WIFI: drawWifiList(); break;
    case PAGE_KEYS: drawKeys(); break;
    case PAGE_PRINTER: if (g_printerPage) g_printerPage(); break;
    case PAGE_CALIB: drawCalib(); break;
  }
  uiFlush();
  g_dirty = false;
}

// ============================== behaviour ==============================

static void entryAppend(char c) {
  // "Append" by name and history, but it inserts at the caret.
  const int n = (int)strlen(g_entry);
  if (n >= (int)sizeof(g_entry) - 1) return;
  if (g_caret > n) g_caret = n;
  memmove(g_entry + g_caret + 1, g_entry + g_caret, n - g_caret + 1);
  g_entry[g_caret++] = c;
}

static void entryBackspace() {
  const int n = (int)strlen(g_entry);
  if (g_caret > n) g_caret = n;
  if (g_caret == 0) return;
  memmove(g_entry + g_caret - 1, g_entry + g_caret, n - g_caret + 1);
  g_caret--;
}

static void wifiSave(const char *ssid, const char *pass) {
  g_prefs.begin("filrfid", false);
  g_prefs.putString("ssid", ssid);
  g_prefs.putString("pass", pass);
  g_prefs.end();
}

static void wifiJoin(const char *ssid, const char *pass) {
  snprintf(g_ssid, sizeof(g_ssid), "%s", ssid);
  snprintf(g_pass, sizeof(g_pass), "%s", pass);
  wifiSave(ssid, pass);
  WiFi.mode(WIFI_STA);
  WiFi.begin(ssid, pass);
  g_joining = true;
  snprintf(g_joinNote, sizeof(g_joinNote), "joining %s...", ssid);
  g_dirty = true;
}

static void wifiForget() {
  g_prefs.begin("filrfid", false);
  g_prefs.remove("ssid");
  g_prefs.remove("pass");
  g_prefs.end();
  g_ssid[0] = 0;
  g_pass[0] = 0;
  g_joinNote[0] = 0;
  WiFi.disconnect(true);
  g_dirty = true;
}

static void startScan() {
  g_scanning = true;
  g_scanTop = 0;
  g_dirty = true;
  uiDraw();                 // show "scanning..." before we block on the radio
  WiFi.mode(WIFI_STA);
  g_scanCount = WiFi.scanNetworks();
  g_scanning = false;
  g_dirty = true;
}

/** Multi-tap: the same key cycles its letters until you pause or move on. */
static void t9Tap(int key) {
  const char *set = T9_KEYS[key];
  const int n = (int)strlen(set);
  const unsigned long now = millis();
  const bool cycling = g_t9Key == key && now - g_t9At < 900 && g_caret > 0;
  if (cycling) g_t9Idx = (g_t9Idx + 1) % n;
  else g_t9Idx = 0;
  g_t9Key = key;
  g_t9At = now;
  char c = set[g_t9Idx];
  if (g_shift && c >= 'a' && c <= 'z') c -= 32;
  if (cycling) g_entry[g_caret - 1] = c;  // replace the character being cycled
  else entryAppend(c);
}

/* Press-and-hold, serviced from uiTick while the finger stays down: a held
   T9 key upgrades the character it just typed to the key's DIGIT (the last
   in its cycle, phone style), and a held DEL repeats. */
static void kbHoldTick() {
  const uint32_t now = millis();
  if (g_kbHoldKind == 1 && !g_kbHoldDone && now - g_kbHoldAt > 600) {
    g_kbHoldDone = true;
    if (g_kbHoldCell >= 0 && g_caret > 0) {
      const char *set = T9_KEYS[g_kbHoldCell];
      g_entry[g_caret - 1] = set[strlen(set) - 1];
      g_t9Key = -1;             // the hold settles it; no cycle to continue
      g_dirty = true;
    }
  } else if (g_kbHoldKind == 2 && now - g_kbHoldAt > 500) {
    entryBackspace();
    g_t9Key = -1;
    g_kbHoldAt = now - 350;     // next repeat in 150ms
    g_dirty = true;
  }
}

static void onTouchPages(int x, int y);
static void onTouch(int x, int y) {
  onTouchPages(x, y);
#if HAS_JS
  if (g_page != PAGE_WIFI && g_page != PAGE_KEYS && g_page != PAGE_CALIB) {
    /* the wifi flow (and command-driven calibration) is ALL the native
       UI a JS build has -- any exit (BACK, a completed join) boots back
       into the JS app, fresh arena */
    delay(150);
    ESP.restart();
  }
#else
  (void)g_rescueMode;
#endif
}
static void onTouchPages(int x, int y) {
  switch (g_page) {
    case PAGE_STATUS:
      if (hit(BTN_SETTINGS, x, y)) { g_page = PAGE_SETTINGS; g_dirty = true; }
      else if (hit(BTN_PRINTER, x, y)) { g_page = PAGE_PRINTER; g_dirty = true; }
      break;

    case PAGE_PRINTER:
      if (hit(BTN_BACK, x, y)) { g_page = UI_HOME_PAGE; g_dirty = true; }
      break;

    case PAGE_CALIB:
      // x,y arrive raw here (see touchRead), which is what we want to record.
      if (g_calStep >= 0 && g_calStep < CALIB_N) {
        g_calRawX[g_calStep] = x;
        g_calRawY[g_calStep] = y;
        g_calStep++;
        if (g_calStep >= CALIB_N) {
          g_calStep = -1;
          g_calDone = true;
          g_page = UI_HOME_PAGE;
        }
        g_dirty = true;
      }
      break;

    case PAGE_SETTINGS:
      if (hit(BTN_BACK, x, y)) { g_page = UI_HOME_PAGE; g_dirty = true; }
      else if (hit(BTN_WIFI, x, y)) { g_page = PAGE_WIFI; startScan(); }
      else if (g_ssid[0] && hit(BTN_FORGET, x, y)) wifiForget();
      break;

    case PAGE_WIFI: {
      if (hit(BTN_BACK, x, y)) { g_page = PAGE_SETTINGS; g_dirty = true; break; }
      if (hit(BTN_RESCAN, x, y)) {
        // One button: page down while there is more, then rescan from the top.
        if (g_scanCount > g_scanTop + wifiRows()) { g_scanTop += wifiRows(); g_dirty = true; }
        else startScan();
        break;
      }
      const int rowH = ROW_H, top = EDGE_TOP + 34;
      const int rows = wifiRows();
      for (int i = 0; i < rows; i++) {
        const int idx = g_scanTop + i;
        if (idx >= g_scanCount) break;
        Btn b = {0, top + i * (rowH + 2), SW(), rowH};
        if (hit(b, x, y)) {
          g_scanSel = idx;
          snprintf(g_ssid, sizeof(g_ssid), "%s", WiFi.SSID(idx).c_str());
          if (WiFi.encryptionType(idx) == WIFI_AUTH_OPEN) {
            wifiJoin(g_ssid, "");     // nothing to type for an open network
            g_page = PAGE_SETTINGS;
          } else {
            g_entry[0] = 0;
            g_caret = 0;
            g_caretDrag = false;
            g_qwPage = 0;
            g_shift = false;
            g_kbHoldKind = 0;
            g_t9Key = -1;
            g_page = PAGE_KEYS;
            // Ten columns want the long edge: 28px keys instead of 24px.
            if (g_qwerty && qwPossible()) setRotation(1);
          }
          g_dirty = true;
          break;
        }
      }
      break;
    }

    case PAGE_KEYS: {
      // The entry bar first: its ESC square cancels out entirely, and a
      // touch on the text places the caret (uiTick keeps feeding moves
      // while the finger is down, so this is also the start of a drag).
      if (hit(entryEscRect(), x, y)) {
        setRotation(TFT_ROTATION);
        g_page = PAGE_WIFI;
        g_dirty = true;
        break;
      }
      // DEL before the entry bar: on the round board it rides inside it.
      if (hit(BTN_BKSP, x, y)) {
        entryBackspace();
        g_t9Key = -1;
        g_kbHoldKind = 2;
        g_kbHoldAt = millis();
        g_dirty = true;
        break;
      }
      if (hit(entryRect(), x, y)) {
        int textX, start, maxChars;
        entryWindow(textX, start, maxChars);
        int c = start + (x - textX + 6) / 12;
        const int len = (int)strlen(g_entry);
        if (c < 0) c = 0;
        if (c > len) c = len;
        g_caret = c;
        g_t9Key = -1;   // a moved caret ends any multi-tap run
        g_caretDrag = true;
        g_dirty = true;
        break;
      }
      if (hit(BTN_MODE, x, y)) {
        if (qwPossible()) {
          g_qwerty = !g_qwerty;
          relayout();   // fullscreen T9 and QWERTY place the chrome differently
        } else {
          g_shift = !g_shift;  // T9 shift: the only route to uppercase here
        }
        g_dirty = true;
        break;
      }
      if (hit(BTN_ROT, x, y)) { setRotation((g_rot + 1) & 3); break; }
      if (hit(BTN_DONE, x, y)) {
        wifiJoin(g_ssid, g_entry);
        setRotation(TFT_ROTATION);
        g_page = PAGE_SETTINGS;
        break;
      }

      if (g_qwerty && qwPossible()) {
        const int top = qwTop(), kh = qwKh(), kw = SW() / 10;
        for (int r = 0; r < 4; r++) {
          const char *row = QW_PAGES[g_qwPage][r];
          const int n = (int)strlen(row);
          if (!n) continue;
          const int x0 = (SW() - n * kw) / 2;
          for (int c = 0; c < n; c++) {
            Btn b = {x0 + c * kw, top + r * (kh + 2), kw - 2, kh};
            if (hit(b, x, y)) {
              char ch = row[c];
              if (g_shift && ch >= 'a' && ch <= 'z') {
                ch -= 32;
                g_shift = false;  // shift-once, phone style
              }
              entryAppend(ch);
              g_dirty = true;
              return;
            }
          }
        }
        if (hit(BTN_SHIFT, x, y)) {
          // On the letter page this is shift; on a symbol page it flips
          // between the two symbol plates (the JS keyboard's exact deal).
          if (g_qwPage == 0) g_shift = !g_shift;
          else g_qwPage = g_qwPage == 1 ? 2 : 1;
          g_dirty = true;
        } else if (hit(BTN_SYM, x, y)) {
          g_qwPage = g_qwPage ? 0 : 1;
          g_dirty = true;
        } else if (hit(BTN_SPACE, x, y)) {
          entryAppend(' ');
          g_dirty = true;
        }
      } else {
        for (int cell = 0; cell < 12; cell++)
          if (hit(t9Btn(cell), x, y)) {
            t9Tap(t9KeyAt(cell));
            g_kbHoldKind = 1;         // held key becomes its digit
            g_kbHoldCell = t9KeyAt(cell);
            g_kbHoldAt = millis();
            g_kbHoldDone = false;
            g_dirty = true;
            return;
          }
      }
      break;
    }
  }
}

// ============================== public API ==============================

/** Diagnostics for the `touch` command. */
static int uiTouchRawX() { return g_tRawX; }
static int uiTouchRawY() { return g_tRawY; }
static int uiTouchX() { return g_tX; }
static int uiTouchY() { return g_tY; }
static uint32_t uiTouchCount() { return g_tCount; }
static bool uiTouchBusError() { return g_touchBusError; }
static int uiPage() { return (int)g_page; }

/** Start the four-target calibration. */
static void uiCalibStart() {
  g_calStep = 0;
  g_calDone = false;
  g_page = PAGE_CALIB;
  g_dirty = true;
}

static bool uiCalibDone() { return g_calDone; }
static int uiCalibRawX(int i) { return (i >= 0 && i < CALIB_N) ? g_calRawX[i] : -1; }
static int uiCalibRawY(int i) { return (i >= 0 && i < CALIB_N) ? g_calRawY[i] : -1; }
static void uiCalibTarget(int i, int &tx, int &ty) { calibTarget(i, tx, ty); }
static int uiRot() { return g_rot; }

/**
 * Scan an I2C bus and report what answers.
 *
 * The board puts the touch controller, the IMU and the RTC on one bus, so a
 * scan separates "wrong pins" from "the touch chip is not responding": if the
 * IMU and RTC answer, the wiring is right.
 *
 * Writes found addresses into `out` as hex, space separated.
 */
/** Pins the display owns. Driving these as I2C tears the panel's bus down. */
static bool uiPinReserved(int pin) {
  return pin == TFT_SCLK || pin == TFT_MOSI || pin == TFT_CS || pin == TFT_DC ||
         pin == TFT_RST || pin == TFT_BL;
}

static int uiI2cScan(int sda, int scl, char *out, size_t outLen) {
  // Refuse the display's own pins. Scanning them once left the panel dark until
  // the board was restarted — a diagnostic must not break the thing it is
  // diagnosing.
  if (uiPinReserved(sda) || uiPinReserved(scl)) {
    snprintf(out, outLen, "refused: display pins");
    return -1;
  }
  Wire.end();
  Wire.begin(sda, scl);
  Wire.setTimeOut(20);
  int n = 0;
  size_t used = 0;
  out[0] = 0;
  for (uint8_t a = 1; a < 127; a++) {
    Wire.beginTransmission(a);
    if (Wire.endTransmission() == 0) {
      n++;
      if (used + 6 < outLen) used += snprintf(out + used, outLen - used, "0x%02X ", a);
    }
  }
  return n;
}

/** Put the bus back the way the UI expects it. */
static void uiI2cRestore() {
  Wire.end();
  Wire.begin(TOUCH_SDA, TOUCH_SCL);
  Wire.setTimeOut(20);
}

/**
 * Pulse the touch controller's reset and report what it looks like afterwards.
 *
 * A CST816 that has not been reset properly sits in its bootloader instead of
 * answering at 0x15 — which looks exactly like "touch is broken". This drives
 * RST deliberately and then reports which address responds and what the first
 * registers hold, so the two cases can be told apart.
 */
static int uiTouchProbe(uint8_t addr, int rstPin, char *out, size_t outLen) {
  if (rstPin >= 0) {
    pinMode(rstPin, OUTPUT);
    digitalWrite(rstPin, HIGH);
    delay(5);
    digitalWrite(rstPin, LOW);
    delay(20);       // the datasheet wants at least 10 ms low
    digitalWrite(rstPin, HIGH);
    delay(120);      // and a good while to boot before it answers
  }

  Wire.beginTransmission(addr);
  const bool present = Wire.endTransmission() == 0;

  size_t used = snprintf(out, outLen, present ? "present" : "silent");
  if (present) {
    // Registers 0x15 (chip id area) and the point block are enough to tell a
    // live controller from an echo.
    Wire.beginTransmission(addr);
    Wire.write(0x00);
    if (Wire.endTransmission(false) == 0 && Wire.requestFrom(addr, (uint8_t)8) == 8) {
      used += snprintf(out + used, outLen - used, " regs:");
      for (int i = 0; i < 8 && used + 4 < outLen; i++) {
        used += snprintf(out + used, outLen - used, " %02X", Wire.read());
      }
    }
    // Identity, from 0xA7: B4 = CST816S, B5 = CST816T, B6 = CST816D. Waveshare's
    // own wiki names two different parts for this board and links a third
    // datasheet, so the chip is worth asking rather than assuming.
    Wire.beginTransmission(addr);
    Wire.write(0xA7);
    if (Wire.endTransmission(false) == 0 && Wire.requestFrom(addr, (uint8_t)3) == 3) {
      const uint8_t chip = Wire.read(), proj = Wire.read(), fw = Wire.read();
      used += snprintf(out + used, outLen - used, " chip:%02X proj:%02X fw:%02X",
                       chip, proj, fw);
    }
  }
  return present ? 1 : 0;
}

static void uiSetLink(const char *s) {
  snprintf(g_link, sizeof(g_link), "%s", s);
  g_dirty = true;
}
static const char *uiGetLink() { return g_link; }

static void uiSetPresent(int r, bool present, const char *uid) {
  if (present) uiPoke();   // a tag arriving is exactly when the screen matters
  ReaderView &v = g_view[r];
  const bool sameUid = uid ? !strcmp(v.uid, uid) : v.uid[0] == 0;
  if (v.present == present && sameUid) return;  // nothing changed; don't redraw
  v.present = present;
  if (uid) snprintf(v.uid, sizeof(v.uid), "%s", uid);
  else v.uid[0] = 0;
  if (g_page == PAGE_STATUS) g_dirty = true;
}

static void uiSetLabel(int r, const char *label, const char *colorHex, bool clear) {
  ReaderView &v = g_view[r];
  if (clear) {
    v.label[0] = 0;
    v.hasColour = false;
  }
  if (label) snprintf(v.label, sizeof(v.label), "%s", label);
  if (colorHex && strlen(colorHex) >= 6) {
    v.colour = rgb565(strtoul(colorHex, nullptr, 16));
    v.hasColour = true;
  }
  if (g_page == PAGE_STATUS) g_dirty = true;
}

/**
 * The update screen.
 *
 * Drawn only when the percentage actually changes, and only the part of the bar
 * that grew — an update is exactly the wrong moment to spend milliseconds
 * repainting, and a stalled transfer is easier to see on a bar that stopped
 * than in a log nobody is watching.
 */
static int g_otaPct = -1;

static void uiOtaBegin() {
  g_otaPct = -1;
  scr().fillScreen(COL_BG);
  drawCenter("Updating", SH() / 2 - 40, 2, COL_TEXT);
  // The empty trough, drawn once.
  scr().drawRoundRect(EDGE_X, SH() / 2 - 6, SW() - 2 * EDGE_X, 16, 4, COL_MUTED);
}

static void uiOtaProgress(unsigned int done, unsigned int total) {
  if (!total) return;
  const int pct = (int)((done * 100ULL) / total);
  if (pct == g_otaPct) return;
  g_otaPct = pct;

  const int x = EDGE_X + 2, w = SW() - 2 * EDGE_X - 4;
  scr().fillRoundRect(x, SH() / 2 - 4, (w * pct) / 100, 12, 3, COL_ACCENT);

  char buf[8];
  snprintf(buf, sizeof(buf), "%d%%", pct);
  scr().fillRect(0, SH() / 2 + 20, SW(), 18, COL_BG);
  drawCenter(buf, SH() / 2 + 22, 2, COL_TEXT);
}

static void uiOtaEnd(bool ok) {
  scr().fillRect(0, SH() / 2 + 44, SW(), 20, COL_BG);
  drawCenter(ok ? "restarting" : "update failed", SH() / 2 + 46, 1, ok ? COL_OK : COL_WARN);
}

/** Saved credentials, so the board rejoins on its own after a power cut. */
static bool uiWifiRestore(char *ssid, size_t ssidLen, char *pass, size_t passLen) {
  g_prefs.begin("filrfid", true);
  String s = g_prefs.getString("ssid", "");
  String p = g_prefs.getString("pass", "");
  g_prefs.end();
  if (!s.length()) return false;
  snprintf(ssid, ssidLen, "%s", s.c_str());
  snprintf(pass, passLen, "%s", p.c_str());
  snprintf(g_ssid, sizeof(g_ssid), "%s", s.c_str());
  snprintf(g_pass, sizeof(g_pass), "%s", p.c_str());
  return true;
}

static void uiBegin() {
  // PWM from the start: attaching after the panel is lit gives a visible blink.
  ledcAttach(TFT_BL, 5000, 8);
  blWrite(0);
  // I2C BUS CLEAR before anything drives it: the FT6336 has no reset
  // line, survives ESP resets, and a crash mid-transaction leaves it
  // holding SDA low -- every read after that is garbage and no software
  // reboot fixes it. Nine SCL pulses release a stuck slave, then a STOP.
  {
    pinMode(TOUCH_SDA, INPUT_PULLUP);
    pinMode(TOUCH_SCL, OUTPUT);
    for (int i = 0; i < 9 && digitalRead(TOUCH_SDA) == LOW; i++) {
      digitalWrite(TOUCH_SCL, LOW);
      delayMicroseconds(5);
      digitalWrite(TOUCH_SCL, HIGH);
      delayMicroseconds(5);
    }
    pinMode(TOUCH_SDA, OUTPUT);        /* STOP: SDA low->high while SCL high */
    digitalWrite(TOUCH_SDA, LOW);
    delayMicroseconds(5);
    digitalWrite(TOUCH_SCL, HIGH);
    delayMicroseconds(5);
    digitalWrite(TOUCH_SDA, HIGH);
    delayMicroseconds(5);
  }
#if defined(TOUCH_RST) && (TOUCH_RST >= 0)
  // The AXS5106L answers nothing until its reset line is pulsed — and the
  // pulse must be LONG. Waveshare's driver holds reset low 200 ms and waits
  // 300 ms after release; with a short pulse the chip ACKs its address but
  // its firmware never comes up and every report reads as zero.
  pinMode(TOUCH_RST, OUTPUT);
  digitalWrite(TOUCH_RST, LOW);
  delay(200);
  digitalWrite(TOUCH_RST, HIGH);
  delay(300);
#endif
#if IOEXP_ADDR
  // Before SPI: the panel is held in reset by the expander, so nothing sent
  // down the bus would be listened to yet.
  Wire.begin(TOUCH_SDA, TOUCH_SCL);
  Wire.setTimeOut(20);
  ioexpBegin();
  panelReset();
#endif
#ifdef TFT_MISO
  SPI.begin(TFT_SCLK, TFT_MISO, TFT_MOSI, TFT_CS);
#else
  SPI.begin(TFT_SCLK, -1, TFT_MOSI, TFT_CS);
#endif
#if PANEL_GC9A01
  tft.begin(TFT_SPI_HZ);   // GC9A01A knows its own 240x240; begin, not init
#elif defined(TFT_SPI_HZ)
  tft.init(TFT_W, TFT_H, TFT_SPI_HZ);
#else
  tft.init(TFT_W, TFT_H);  // the library derives the 20-row offset from these
#endif
  {
    g_prefs.begin("filrfid", true);
    uint8_t r = g_prefs.getUChar("rot", TFT_ROTATION);
    g_blLevel = g_prefs.getUChar("bl", 255);
    g_vScaleQ = g_prefs.getUChar("vscale", VIEW_SCALE_DEFAULT);
    g_vInset = g_prefs.getShort("vinset", VIEW_INSET_DEFAULT);
    g_vShiftX = g_prefs.getShort("vshx", 0);
    g_vShiftY = g_prefs.getShort("vshy", 0);
    if (g_vScaleQ < 4 || g_vScaleQ > 16) g_vScaleQ = 4;
    g_sleepMs = g_prefs.getULong("sleep", 0);
    g_sleepDim = g_prefs.getBool("sleepdim", true);
    g_fontMode = g_prefs.getUChar("fmode", 2);
    if (g_fontMode > 2) g_fontMode = 1;
    g_calNX = calParse(g_prefs.getString("calx", "").c_str(), g_calXr, g_calXd);
    g_calNY = calParse(g_prefs.getString("caly", "").c_str(), g_calYr, g_calYd);
    g_crossN = calParse(g_prefs.getString("calc", "").c_str(), g_crossR, g_crossD);
    g_prefs.end();
    g_rot = r & 3;
  }
  tft.setRotation(g_rot);
  // True CP437 indexing: Adafruit's drawChar otherwise shifts chars
  // >= 176 by one to skip a historically missing glyph, disagreeing
  // with textBlit's direct table indexing on every high code point.
  tft.cp437(true);
  // The canvas, before anything draws. The native pages render through it too,
  // and until it exists they go straight at the panel in viewport coordinates
  // — which on a scaled display is a small page in the corner of a big screen.
  tft.fillScreen(COL_BG);
  frameInit();
  relayout();

  Wire.begin(TOUCH_SDA, TOUCH_SCL);
  // A bounded timeout so a missing or wedged device cannot block the loop.
  Wire.setTimeOut(20);
#if TOUCH_INT >= 0
  pinMode(TOUCH_INT, INPUT_PULLUP);
#endif

#if defined(AXP2101_ADDR) && LED_QUIET
  // The green LED is the AXP2101's CHGLED. Not the pin-DISABLE bit —
  // cleared, the pin falls back to its automatic charge-indication
  // function and stays lit. MANUAL mode with the output parked high-Z:
  // reg 0x69 = (old & 0xC8) | 0x05 (bit0 pin enable, bits[2:1]=10
  // manual, bits[5:4]=00 off) — the same value XPowersLib writes for
  // its LED-off mode.
  Wire.beginTransmission(AXP2101_ADDR);
  Wire.write(0x69);
  if (Wire.endTransmission(false) == 0 &&
      Wire.requestFrom((uint8_t)AXP2101_ADDR, (uint8_t)1) == 1) {
    const uint8_t v = Wire.read();
    Wire.beginTransmission(AXP2101_ADDR);
    Wire.write(0x69);
    Wire.write((uint8_t)((v & 0xC8) | 0x05));
    Wire.endTransmission();
  }
#endif
  touchWake();
  uiDraw();
  blWrite(g_blLevel);   // backlight last, so the first frame is not noise
  g_lastPoke = millis();
}

static void uiTick() {
  // One press per touch: this UI has no drag, and a held finger must not
  // hammer a key.
  static bool down = false;
  static unsigned long lastPoll = 0;
  // Throttle only the touch read — the redraw and the join watcher below still
  // run every pass. A script tracking a finger wants samples faster than a
  // frame; the native pages only need to know a key was hit, and 25 ms is well
  // under human reaction time there.
  if (millis() - lastPoll >= (g_uiExternal ? 12UL : 25UL)) {
    lastPoll = millis();

    // Wake the controller whenever it stops answering on the bus.
    //
    // Keyed on a bus error, not on "no touch seen": an idle panel legitimately
    // reports no finger, and resetting on that would pulse RST forever. Keyed
    // on touch count instead, this could only ever heal before the first
    // successful tap — no use for a chip that sleeps later.
    static uint32_t lastWake = 0;
    if (g_touchBusError && millis() - lastWake > 3000) {
      lastWake = millis();
      touchWake();
    }

    int x, y;
    static int lastX = 0, lastY = 0;
    if (touchRead(x, y)) {
      // The touch that wakes the screen does nothing else. Pressing a dark
      // panel to see it is not pressing whatever happens to be under the
      // finger, and finding out otherwise is unpleasant.
      if (g_asleep) {
        g_pokeTouch++;
        uiPoke();
        down = true;
        lastX = x;
        lastY = y;
        return;
      }
      g_pokeTouch++;
      uiPoke();
      if (!down) {
        down = true;
        lastX = x;
        lastY = y;
        if (g_uiExternal) {
          if (g_ptrFwd) g_ptrFwd(0, x, y);  // press; the script decides what it means
        } else {
        // Mark where the firmware thinks the finger is. Guessing at the sign of
        // a rotation from a description is how this got wrong twice; a dot that
        // either follows your finger or sits opposite it settles it at a
        // glance. Drawn before the handler, so it shows even if the page
        // changes underneath.
        scr().fillCircle(x, y, 6, COL_WARN);
        uiFlush();
        onTouch(x, y);
        }
      } else if (g_uiExternal && (x != lastX || y != lastY)) {
        lastX = x;
        lastY = y;
        if (g_ptrFwd) g_ptrFwd(1, x, y);  // move
      } else if (!g_uiExternal && g_caretDrag && (x != lastX || y != lastY)) {
        // The one native drag: a finger that landed on the entry bar keeps
        // steering the caret until it lifts.
        lastX = x;
        lastY = y;
        int textX, start, maxChars;
        entryWindow(textX, start, maxChars);
        int c = start + (x - textX + 6) / 12;
        const int len = (int)strlen(g_entry);
        if (c < 0) c = 0;
        if (c > len) c = len;
        if (c != g_caret) {
          g_caret = c;
          g_dirty = true;
        }
      }
      if (down && !g_uiExternal && g_kbHoldKind) kbHoldTick();
    } else {
      // Release carries the last known position: the controller reports no
      // coordinates once the finger is gone, and a stroke that ended off the
      // last sample would otherwise release wherever it began.
      if (down && g_uiExternal && g_ptrFwd) g_ptrFwd(2, lastX, lastY);
      down = false;
      g_caretDrag = false;
      g_kbHoldKind = 0;
    }
  }

  // The multi-tap window lapsing is the COMMIT: the cycle ends and a
  // shift-once spends itself (it survives cycling so every retype of the
  // same letter keeps its case — the JS keyboard's exact semantics).
  if (!g_uiExternal && g_page == PAGE_KEYS && g_t9Key >= 0 && millis() - g_t9At > 900) {
    g_t9Key = -1;
    if (g_shift && !qwPossible()) {
      g_shift = false;
      g_dirty = true;
    }
  }

  // Sleep on a timer, measured from the last thing worth staying awake for.
  if (g_sleepMs && !g_asleep && millis() - g_lastPoke > g_sleepMs) {
    g_asleep = true;
    // 1% — measured on this panel, not guessed: it lights cleanly with no
    // flicker, which makes it the right floor for a screen that is only there
    // to be noticed. Dark is for when any light at all is unwelcome.
    blWrite(g_sleepDim ? 3 : 0);
  }

  // A join takes seconds; report the outcome once rather than blocking on it.
  if (g_joining) {
    static unsigned long since = 0;
    if (!since) since = millis();
    if (WiFi.status() == WL_CONNECTED) {
      g_joining = false;
      since = 0;
      snprintf(g_joinNote, sizeof(g_joinNote), "connected");
      g_dirty = true;
    } else if (millis() - since > 15000) {
      g_joining = false;
      since = 0;
      snprintf(g_joinNote, sizeof(g_joinNote), "could not join");
      g_dirty = true;
    }
  }

  static unsigned long last = 0;
  if (!g_uiExternal && g_dirty && millis() - last >= 60) {
    last = millis();
    uiDraw();
  }
}

/**
 * Off-screen frame for the JS UI, in PSRAM.
 *
 * The script redraws the whole screen from state, and doing that straight to
 * the panel makes every update a visible clear-then-repaint flash. Drawing
 * into this canvas and blitting once per frame removes the flash entirely; the
 * blit is ~134 kB over SPI, well under a frame at interactive rates.
 *
 * Adafruit_GFX renders every primitive through drawPixel, so one override is
 * the whole implementation.
 */
class FrameCanvas : public Adafruit_GFX {
 public:
  uint16_t *buf = nullptr;
  /* The buffer is owned outside: 240x280 and 280x240 are the same bytes, so a
     rotation swaps the canvas object but keeps the allocation. */
  FrameCanvas(int16_t w, int16_t h, uint16_t *b) : Adafruit_GFX(w, h), buf(b) {}
  void drawPixel(int16_t x, int16_t y, uint16_t c) override {
    if (x < 0 || y < 0 || x >= WIDTH || y >= HEIGHT) return;
    buf[(int)y * WIDTH + x] = c;
  }
  /* The hot path: fills go through this, not pixel-by-pixel bounds checks. */
  void fillRect(int16_t x, int16_t y, int16_t w, int16_t h, uint16_t c) override {
    if (x < 0) { w += x; x = 0; }
    if (y < 0) { h += y; y = 0; }
    if (x + w > WIDTH) w = WIDTH - x;
    if (y + h > HEIGHT) h = HEIGHT - y;
    if (w <= 0 || h <= 0) return;
    for (int16_t j = 0; j < h; j++) {
      uint16_t *row = buf + (size_t)(y + j) * WIDTH + x;
      for (int16_t i = 0; i < w; i++) row[i] = c;
    }
  }
  void fillScreen(uint16_t c) override { fillRect(0, 0, WIDTH, HEIGHT, c); }
};

static uint16_t *g_frameBuf = nullptr;
static FrameCanvas *g_frame = nullptr;
static bool g_frameOk = false;
/* How long the last blit took, and how much of it was scaling rather than SPI.
   Guessing which half dominates is how you optimise the wrong one. */
static uint32_t g_flushUs = 0, g_scaleUs = 0, g_drawUs = 0;

/**
 * Enough state for a reader to know it got a whole frame.
 *
 * There is one buffer and two tasks: the UI thread draws into it, and an HTTP
 * request may read it at any moment. Catching it mid-render gives a torn
 * picture; catching it just after gfx.clear() gives a blank one.
 *
 * A seqlock rather than a mutex or a second buffer: the reader takes a copy and
 * checks that no render began or ended while it was copying, retrying if one
 * did. A static screen never renders, so the common case is one copy and no
 * waiting. Two words instead of 134 kB, and it cannot deadlock a UI thread that
 * has a screen to keep up with.
 */
static volatile bool g_frameBusy = false;
static volatile uint32_t g_frameSeq = 0;

/* Screen size in the current orientation, for callers that have no picture to
   measure — /info reports it so a client need not infer it from one. */
static bool uiFrameOk() { return g_frameOk && g_frame; }
static uint32_t uiFlushUs() { return g_flushUs; }
static uint32_t uiDrawUs() { return g_drawUs; }
void uiSetDrawUs(uint32_t us) { g_drawUs = us; }
static uint32_t uiScaleUs() { return g_scaleUs; }
static uint32_t uiDirtyPix();
static void uiSetDirty(bool on);
static bool uiDirtyOn();
static int uiScreenW() { return SW(); }
static int uiScreenH() { return SH(); }

static bool uiFrameBusy() { return g_frameBusy; }
static uint32_t uiFrameSeq() { return g_frameSeq; }
/** Bracket a render: nothing between these is worth reading. */
static void uiFrameBegin() { g_frameBusy = true; }
static void uiFrameEnd() { g_frameBusy = false; g_frameSeq++; }

/** (Re)build the canvas for the current orientation; the buffer persists. */
static bool frameEnsure() {
  /* PSRAM, deliberately. Drawing into internal RAM is measurably faster, but
     internal RAM is what WiFi allocates from — a UI that takes 125 kB of it to
     save a few milliseconds is a UI that stops answering the network. */
  if (!g_frameBuf) g_frameBuf = (uint16_t *)heap_caps_malloc((size_t)TFT_W * TFT_H * 2, MALLOC_CAP_SPIRAM);
  if (!g_frameBuf) return false;
  /* Height as well as width: scale changes both, and a viewport that got
     shorter without getting narrower would otherwise keep drawing into a
     canvas taller than the one being blitted. */
  const int cw = vNative() ? viewDrawW() : SW();
  const int ch = vNative() ? viewDrawH() : SH();
  if (!g_frame || g_frame->width() != cw || g_frame->height() != ch) {
    delete g_frame;
    g_frame = new FrameCanvas(cw, ch, g_frameBuf);
  }
  return g_frame != nullptr;
}

/**
 * The off-screen frame, for anything that wants to look at the screen.
 *
 * Only meaningful while a script owns the display: the native pages draw
 * straight to the panel, and reading pixels back out of an ST7789 over SPI is
 * slow and, on many of them, simply not supported.
 */
static const uint16_t *uiFrame(int &w, int &h) {
  if (!g_frameOk || !g_frame) { w = h = 0; return nullptr; }
  w = g_frame->width();
  h = g_frame->height();
  return g_frame->buf;
}

/**
 * Feed a touch in from somewhere other than a finger.
 *
 * The same path a real press takes, deliberately: a simulated stroke that took
 * a shortcut would prove the shortcut works. Coordinates are screen space, so
 * a caller does not need to know anything about the panel's calibration.
 */
static void uiInjectPointer(int phase, int x, int y) {
  // Same rule as the glass: the event that wakes the screen does not also act
  // on it. A remote viewer pressing a dark panel is pressing to see it.
  if (g_asleep) { uiPoke(); return; }
  uiPoke();
  if (g_uiExternal) {
    if (g_ptrFwd) g_ptrFwd(phase, x, y);
    return;
  }
  if (phase == 0) onTouch(x, y);   // the native pages act on the press
}

/** The surface the JS gfx calls land on: the canvas when it exists. */
static Adafruit_GFX &scr() {
  return (g_frameOk && g_frame) ? (Adafruit_GFX &)*g_frame : (Adafruit_GFX &)tft;
}

/* ---- CANVAS SOURCES ------------------------------------------------
 *
 * Numbered pixel buffers that live OUTSIDE the op stream: a camera
 * frame, a drawable bitmap, a logo. The UI references one with
 * gfx.blit(id, x, y, w, h) -- recorded as op 10 carrying the source's
 * GENERATION, so the dirty diff repaints the region exactly when the
 * content changes, while the ops themselves stay kilobytes. The remote
 * viewer streams a source's pixels separately (MJPEG, on demand) and
 * composites. sys.canvasTarget(id) redirects the whole gfx contract
 * into a source, so JS can draw bitmaps with the same API it draws the
 * screen -- the UI stays high-framerate while sources update at their
 * own pace. */
#define CV_MAX 4
struct CanvasSrc {
  uint16_t *buf = nullptr;
  FrameCanvas *fc = nullptr;
  int16_t w = 0, h = 0;
  uint16_t gen = 0;
};
static CanvasSrc g_cv[CV_MAX];
static int g_cvTarget = -1;
int g_cvTargetRef() { return g_cvTarget; }
static int g_cvSaveClip[5];   /* clip state across a target switch */

static inline bool cvOk(int id) {
  return id >= 0 && id < CV_MAX && g_cv[id].buf && g_cv[id].fc;
}
static inline uint16_t *surfBuf() {
  return g_cvTarget >= 0 ? g_cv[g_cvTarget].buf : (g_frame ? g_frame->buf : nullptr);
}
static inline int surfW() { return g_cvTarget >= 0 ? g_cv[g_cvTarget].w : (g_frame ? g_frame->width() : 0); }
static inline int surfH() { return g_cvTarget >= 0 ? g_cv[g_cvTarget].h : (g_frame ? g_frame->height() : 0); }

static void frameInit() { g_frameOk = frameEnsure(); }

static Adafruit_GFX &jsSurface() {
  if (g_cvTarget >= 0 && cvOk(g_cvTarget)) return (Adafruit_GFX &)*g_cv[g_cvTarget].fc;
  return (g_frameOk && g_frame) ? (Adafruit_GFX &)*g_frame : (Adafruit_GFX &)tft;
}

// Software clip for the JS UI. Adafruit_GFX has no scissor, so rectangles are
// clamped here and text/circles are skipped when fully outside — a half
// visible row shows its clamped panel without its label, which reads as
// clipped rather than as spill.
static int g_clipX = 0, g_clipY = 0, g_clipW = 0, g_clipH = 0;
static bool g_clipOn = false;

/*
 * Binary op recorder for /ops.bin: every gfxN* call is appended to a
 * frame buffer while armed (a /ops.bin request arms it; five quiet
 * seconds disarm it, so an unwatched board records nothing). RAW args
 * are recorded, before any clip clamping -- the replayer mirrors the
 * clip behaviour itself. Double-buffered: the UI task records into one
 * buffer and swaps it in as "published" at gfxNFlush (the frame
 * boundary); the HTTP task copies the published one under the mux.
 * Both buffers live in PSRAM, allocated on first arm.
 *
 * Format (little-endian): 'M','O',ver=1,0, u16 w, u16 h, then ops:
 *   1 clear  rgb[3]
 *   2 frect  i16 x,y,w,h rgb[3] u8 radius
 *   3 rect   i16 x,y,w,h rgb[3] u8 radius
 *   4 circle i16 x,y,r   rgb[3] u8 fill
 *   5 line   i16 x0,y0,x1,y1 rgb[3]
 *   6 text   i16 x,y u8 size rgb[3] u8 len bytes
 *   7 clip   i16 x,y,w,h
 *   8 unclip
 *   9 poly   rgb[3] u8 rule(1=nonzero) u8 nRings { u16 n, n*(i16 x10,y10) }
 */
#define OPREC_CAP (96 * 1024)   /* PSRAM; a heavy stroke canvas fits, so the diff stays alive */
static uint8_t *g_opMem = nullptr;
static uint8_t *g_opCur = nullptr, *g_opPub = nullptr;
static uint32_t g_opLen = 0, g_opPubLen = 0;
static bool g_opOver = false, g_opFresh = true;
static volatile uint32_t g_opArmedAt = 0;
/* Log ops ride the SAME frame stream, on their own arming clock: a viewer
   that wants the board's console asks for it (log=1), and one that only
   wants pixels never pays for it. Both expire the same way, so a browser
   that closes stops the cost without telling anyone. */
static volatile uint32_t g_logArmedAt = 0;
static portMUX_TYPE g_opMux = portMUX_INITIALIZER_UNLOCKED;

/* Recording is ALWAYS on once the buffers exist: the op stream is no
   longer just /ops.bin's food, it is what the dirty-rect flush diffs
   frames with. A few min/max and byte writes per draw call, in C. */
static inline bool opOn() {
  if (!g_opMem) {
    uint8_t *m = (uint8_t *)ps_malloc(OPREC_CAP * 2);
    if (!m) return false;
    g_opCur = m;
    g_opPub = m + OPREC_CAP;
    g_opMem = m;
  }
  return true;
}
static void opArm() { (void)opOn(); g_opArmedAt = millis(); }
static void opLogFlush();
static inline bool logWatched() { return millis() - g_logArmedAt < 5000; }
/* A FRESH arm drops whatever is queued. Lines can accumulate while one
   viewer holds the console open and another has it shut; opening the pane
   should show what happens next, not a backlog from a window you were not
   watching. Re-arming an already-live console keeps its queue. */
static void logArm() {
  (void)opOn();
  if (!logWatched()) opLogFlush();
  g_logArmedAt = millis();
}
/* record ops only when drawing the SCREEN: canvas-targeted drawing is
   pixels in a source, not part of the frame's op stream */
static inline bool opRec() { return g_cvTargetRef() < 0 && opOn(); }
static inline void opB(uint8_t v) {
  if (g_opLen < OPREC_CAP) g_opCur[g_opLen++] = v; else g_opOver = true;
}
static inline void op16(int v) { opB((uint8_t)(v & 0xff)); opB((uint8_t)((v >> 8) & 0xff)); }
static inline void opRGB(unsigned rgb) {
  opB((uint8_t)((rgb >> 16) & 0xff)); opB((uint8_t)((rgb >> 8) & 0xff)); opB((uint8_t)(rgb & 0xff));
}
static void opStart() {
  if (!g_opFresh) return;
  g_opFresh = false;
  g_opLen = 0;
  g_opOver = false;
  /* version 1.1: the header carries the view scale (quarters) and the
     font mode, so a replayer can reproduce the GLASS -- physical pixels,
     device text pipeline -- not just the logical ops. */
  opB('M'); opB('O'); opB(1); opB(1);
  op16(SW()); op16(SH());
  opB((uint8_t)vq()); opB(g_fontMode);
}
#define OP_HDR 10

/* op 12 -- a console line, TAKEN with a frame rather than recorded into one.
 *
 * The obvious build records the line into the frame buffer like any other
 * op. It does not work: a line then appears in exactly one frame and is
 * gone from the next, so a viewer that polls -- /ops.bin runs at 120-350ms
 * and the board renders faster than that -- misses most of what is logged.
 * Held here and appended at take time, a line survives until somebody
 * actually collects it.
 *
 * Staying out of the frame buffers has a second payoff: opDiffBox compares
 * this frame's ops against the last frame's to find the dirty rectangle,
 * and console lines that came and went between two identical frames would
 * have made them differ. The diff never sees these at all.
 *
 * Bounded on purpose, twice: 240 bytes per line and OPLOG_CAP for the
 * queue. Past that, lines are counted and dropped rather than growing
 * memory, and the drain reports the count as a line of its own -- a
 * console that quietly loses things is worse than one that says it did.
 */
#define OPLOG_CAP 2048
static uint8_t g_logBuf[OPLOG_CAP];
static uint32_t g_logLen = 0;
static uint16_t g_logDropped = 0;

static void opLogLine(uint8_t level, const char *p, int len) {
  if (!logWatched()) return;
  if (len < 0) len = 0;
  if (len > 240) len = 240;
  portENTER_CRITICAL(&g_opMux);
  if (g_logLen + 4 + (uint32_t)len <= OPLOG_CAP) {
    g_logBuf[g_logLen++] = 12;
    g_logBuf[g_logLen++] = level;
    g_logBuf[g_logLen++] = (uint8_t)(len & 0xff);
    g_logBuf[g_logLen++] = (uint8_t)((len >> 8) & 0xff);
    for (int i = 0; i < len; i++) g_logBuf[g_logLen++] = (uint8_t)p[i];
  } else if (g_logDropped < 0xffff) {
    g_logDropped++;
  }
  portEXIT_CRITICAL(&g_opMux);
}

/* Drop whatever is queued. Called when the console is armed FRESH, so
   opening the pane shows what happens next rather than a backlog from a
   window when nobody was watching. */
static void opLogFlush() {
  portENTER_CRITICAL(&g_opMux);
  g_logLen = 0;
  g_logDropped = 0;
  portEXIT_CRITICAL(&g_opMux);
}

/* Append the queued lines after a taken frame and empty the queue. */
static uint32_t opLogDrain(uint8_t *dst, uint32_t cap, uint32_t at) {
  portENTER_CRITICAL(&g_opMux);
  const uint32_t n = g_logLen;
  const uint16_t dropped = g_logDropped;
  if (n && at + n <= cap) { memcpy(dst + at, g_logBuf, n); at += n; }
  g_logLen = 0;
  g_logDropped = 0;
  portEXIT_CRITICAL(&g_opMux);
  if (dropped) {
    char m[48];
    const int ml = snprintf(m, sizeof(m), "[%u console line(s) dropped]", (unsigned)dropped);
    if (ml > 0 && at + 4 + (uint32_t)ml <= cap) {
      dst[at++] = 12; dst[at++] = 3;   /* level 3: warn */
      dst[at++] = (uint8_t)(ml & 0xff); dst[at++] = (uint8_t)((ml >> 8) & 0xff);
      memcpy(dst + at, m, (size_t)ml); at += (uint32_t)ml;
    }
  }
  return at;
}
static volatile uint32_t g_opGen = 0;
static void opPublish() {
  if (g_opFresh) return;
  portENTER_CRITICAL(&g_opMux);
  uint8_t *t = g_opPub; g_opPub = g_opCur; g_opCur = t;
  g_opPubLen = g_opOver ? 0 : g_opLen;
  g_opGen++;
  portEXIT_CRITICAL(&g_opMux);
  g_opFresh = true;
  g_opLen = 0;
}
/* One op's byte length at `off`, or 0 on parse trouble. */
static uint32_t opSpan(const uint8_t *b, uint32_t off, uint32_t len) {
  if (off >= len) return 0;
  switch (b[off]) {
    case 1: return 4;
    case 2: case 3: return 13;
    case 4: return 11;
    case 10: return 12;   /* canvas: id u8, gen u16, x,y,w,h i16 */
    case 11: {  /* canvas CHUNK: id u8, gen u16, off u32, total u32, len u16, bytes */
      if (off + 14 > len) return 0;
      const uint32_t l = (uint32_t)b[off + 12] | ((uint32_t)b[off + 13] << 8);
      return 14 + l;
    }
    case 5: return 12;
    case 12: return (off + 4 <= len) ? 4u + (uint32_t)(b[off + 2] | (b[off + 3] << 8)) : 0;
    case 6: return (off + 10 <= len) ? 10u + b[off + 9] : 0;
    case 7: return 9;
    case 8: return 1;
    case 9: {
      if (off + 6 > len) return 0;
      uint32_t o = off + 5;
      int nr = b[o++];
      for (int i = 0; i < nr; i++) {
        if (o + 2 > len) return 0;
        uint32_t np = b[o] | (b[o + 1] << 8);
        o += 2 + np * 4;
      }
      return o - off;
    }
    default: return 0;
  }
}
static inline int op_i16(const uint8_t *b, uint32_t o) { return (int16_t)(b[o] | (b[o + 1] << 8)); }
/* Pixel bounds of one op, padded a pixel for rounding. Returns:
   0 = paints nothing (clip/unclip), 1 = box set, 2 = whole screen. */
static int opBox(const uint8_t *b, uint32_t off, int *x0, int *y0, int *x1, int *y1) {
  switch (b[off]) {
    case 1: return 2;                       /* clear: everything */
    case 2: case 3: {
      int x = op_i16(b, off + 1), y = op_i16(b, off + 3);
      int w = op_i16(b, off + 5), h = op_i16(b, off + 7);
      *x0 = x; *y0 = y; *x1 = x + w; *y1 = y + h;
      return 1;
    }
    case 4: {
      int x = op_i16(b, off + 1), y = op_i16(b, off + 3), r = op_i16(b, off + 5);
      *x0 = x - r - 1; *y0 = y - r - 1; *x1 = x + r + 2; *y1 = y + r + 2;
      return 1;
    }
    case 5: {
      int xa = op_i16(b, off + 1), ya = op_i16(b, off + 3);
      int xb = op_i16(b, off + 5), yb = op_i16(b, off + 7);
      *x0 = (xa < xb ? xa : xb) - 1; *y0 = (ya < yb ? ya : yb) - 1;
      *x1 = (xa > xb ? xa : xb) + 2; *y1 = (ya > yb ? ya : yb) + 2;
      return 1;
    }
    case 6: {
      int x = op_i16(b, off + 1), y = op_i16(b, off + 3);
      int sz = b[off + 5], n = b[off + 9];
      *x0 = x; *y0 = y; *x1 = x + 6 * sz * n; *y1 = y + 8 * sz;
      return 1;
    }
    case 10: {
      int x = op_i16(b, off + 4), y = op_i16(b, off + 6);
      int w = op_i16(b, off + 8), h = op_i16(b, off + 10);
      *x0 = x; *y0 = y; *x1 = x + w; *y1 = y + h;
      return 1;
    }
    case 9: {
      uint32_t o = off + 5;
      int nr = b[o++];
      int ax = 32767, ay = 32767, bx = -32768, by = -32768;
      for (int i = 0; i < nr; i++) {
        uint32_t np = b[o] | (b[o + 1] << 8);
        o += 2;
        for (uint32_t k = 0; k < np; k++) {
          int px = op_i16(b, o), py = op_i16(b, o + 2);
          o += 4;
          if (px < ax) ax = px;
          if (px > bx) bx = px;
          if (py < ay) ay = py;
          if (py > by) by = py;
        }
      }
      *x0 = ax / 10 - 1; *y0 = ay / 10 - 1;
      *x1 = bx / 10 + 2; *y1 = by / 10 + 2;
      return 1;
    }
    default: return 0;                      /* clip/unclip paint nothing */
  }
}

/*
 * The dirty box: diff this frame's op list against the previous one.
 *
 * mjsx repaints the whole canvas every render, so tracking "what was
 * drawn" would mark everything. But identical ops paint identical
 * pixels (a property this renderer is verified against its replayers
 * for), so the FRAMES are diffed: op-aligned common prefix and suffix
 * are trimmed, and the union of the changed middle window's bounds --
 * from BOTH frames, so vanished things get erased -- is all the panel
 * needs. A caret blink diffs to a sliver; a scroll diffs to everything
 * and takes the full-flush path it would have taken anyway.
 *
 * Conservative outs, all landing on a full flush: no previous frame,
 * either frame overflowed, headers differ, too many ops to index, a
 * clip op inside the changed window (identical ops after a clip change
 * can paint DIFFERENT pixels, so the suffix cannot be trusted -- it is
 * dropped instead), or a clear in the window.
 *
 * Returns: 0 full flush, 1 boxed flush, 2 nothing changed at all.
 */
#define OPIDX_MAX 1024
static int opDiffBox(int sw, int sh, int *bx, int *by, int *bw, int *bh) {
  if (g_opFresh || g_opOver || !g_opMem) return 0;
  const uint8_t *A = g_opPub; const uint32_t an = g_opPubLen;
  const uint8_t *B = g_opCur; const uint32_t bn = g_opLen;
  if (an < OP_HDR || bn < OP_HDR || memcmp(A, B, OP_HDR) != 0) return 0;
  static uint32_t *ia = nullptr, *ib = nullptr;
  if (!ia) {
    ia = (uint32_t *)ps_malloc(OPIDX_MAX * 4 * 2);
    if (!ia) return 0;
    ib = ia + OPIDX_MAX;
  }
  int na = 0, nb = 0;
  for (uint32_t o = OP_HDR; o < an; ) {
    uint32_t sp = opSpan(A, o, an);
    if (!sp || na >= OPIDX_MAX) return 0;
    ia[na++] = o; o += sp;
  }
  for (uint32_t o = OP_HDR; o < bn; ) {
    uint32_t sp = opSpan(B, o, bn);
    if (!sp || nb >= OPIDX_MAX) return 0;
    ib[nb++] = o; o += sp;
  }
  int n = na < nb ? na : nb;
  int pre = 0;
  while (pre < n) {
    uint32_t sa = opSpan(A, ia[pre], an), sb = opSpan(B, ib[pre], bn);
    if (sa != sb || memcmp(A + ia[pre], B + ib[pre], sa) != 0) break;
    pre++;
  }
  if (pre == na && pre == nb) return 2;      /* identical frames */
  int suf = 0;
  while (suf < n - pre) {
    uint32_t oa = ia[na - 1 - suf], ob = ib[nb - 1 - suf];
    uint32_t sa = opSpan(A, oa, an), sb = opSpan(B, ob, bn);
    if (sa != sb || memcmp(A + oa, B + ob, sa) != 0) break;
    suf++;
  }
  for (int i = pre; i < na - suf; i++) {
    if (A[ia[i]] == 7 || A[ia[i]] == 8) { suf = 0; break; }
  }
  if (suf) {
    for (int i = pre; i < nb - suf; i++) {
      if (B[ib[i]] == 7 || B[ib[i]] == 8) { suf = 0; break; }
    }
  }
  int x0 = 32767, y0 = 32767, x1 = -32768, y1 = -32768;
  for (int side = 0; side < 2; side++) {
    const uint8_t *P = side ? B : A;
    const uint32_t *ix = side ? ib : ia;
    const int cnt = (side ? nb : na) - suf;
    for (int i = pre; i < cnt; i++) {
      int ox0, oy0, ox1, oy1;
      const int kind = opBox(P, ix[i], &ox0, &oy0, &ox1, &oy1);
      if (kind == 2) return 0;               /* clear changed: full */
      if (kind != 1) continue;
      if (ox0 < x0) x0 = ox0;
      if (oy0 < y0) y0 = oy0;
      if (ox1 > x1) x1 = ox1;
      if (oy1 > y1) y1 = oy1;
    }
  }
  if (x1 <= x0 || y1 <= y0) return 2;        /* only non-painting ops changed */
  if (x0 < 0) x0 = 0;
  if (y0 < 0) y0 = 0;
  if (x1 > sw) x1 = sw;
  if (y1 > sh) y1 = sh;
  if (x1 <= x0 || y1 <= y0) return 2;        /* changed entirely off-screen */
  /* stable pacing: a mostly-changed frame takes the full path, so the
     worst case costs exactly what it did before dirty-rect existed */
  if ((int64_t)(x1 - x0) * (y1 - y0) * 10 > (int64_t)sw * sh * 6) return 0;
  *bx = x0; *by = y0; *bw = x1 - x0; *bh = y1 - y0;
  return 1;
}
static bool g_dirtyEnable = true;
static uint32_t g_dirtyPix = 0;              /* pixels pushed by the last flush */
static uint32_t uiDirtyPix() { return g_dirtyPix; }
static void uiSetDirty(bool on) { g_dirtyEnable = on; }
static bool uiDirtyOn() { return g_dirtyEnable; }

/**
 * HTTP side: copy the latest published frame out. The copy itself runs
 * OUTSIDE the spinlock -- a 20KB PSRAM memcpy with interrupts disabled
 * is an interrupt-watchdog panic waiting to happen -- and a generation
 * counter detects the (rare) publish that raced the copy, in which case
 * the torn frame is retried against the fresh one.
 */
static uint32_t opTake(uint8_t *dst, uint32_t cap) {
  for (int tries = 0; tries < 3; tries++) {
    uint32_t gen, n;
    const uint8_t *src;
    portENTER_CRITICAL(&g_opMux);
    gen = g_opGen;
    n = g_opPubLen;
    src = g_opPub;
    portEXIT_CRITICAL(&g_opMux);
    if (!n || n > cap) return 0;
    memcpy(dst, src, n);
    portENTER_CRITICAL(&g_opMux);
    const bool clean = (gen == g_opGen);
    portEXIT_CRITICAL(&g_opMux);
    /* console lines ride out with the frame, and leave the queue when
       they do -- see opLogLine */
    if (clean) return opLogDrain(dst, cap, n);
  }
  return 0;
}

/**
 * Stream variant: hand a frame over only when the published generation
 * moved past *seen (updated on success). Same torn-frame retry as
 * opTake, so a long-lived pusher can sit in a loop on this and write
 * each frame exactly once.
 */
static uint32_t opGen() { return g_opGen; }
static uint32_t opTakeNew(uint8_t *dst, uint32_t cap, uint32_t *seen) {
  for (int tries = 0; tries < 3; tries++) {
    uint32_t gen, n;
    const uint8_t *src;
    portENTER_CRITICAL(&g_opMux);
    gen = g_opGen;
    n = g_opPubLen;
    src = g_opPub;
    portEXIT_CRITICAL(&g_opMux);
    if (gen == *seen || !n || n > cap) return 0;
    memcpy(dst, src, n);
    portENTER_CRITICAL(&g_opMux);
    const bool clean = (gen == g_opGen);
    portEXIT_CRITICAL(&g_opMux);
    if (clean) { *seen = gen; return opLogDrain(dst, cap, n); }
  }
  return 0;
}
/* Lines waiting for a frame to ride out on. The push stream asks, because
   a UI that is not animating produces no frames and the lines would sit
   here indefinitely -- a console that only works on a busy screen is not
   a console. */
static bool opLogPending() { return g_logLen != 0 || g_logDropped != 0; }

extern "C" {
void gfxNClip(int x, int y, int w, int h) {
  if (opRec()) { opStart(); opB(7); op16(x); op16(y); op16(w); op16(h); }
  /* ops record LOGICAL coords (the remote replays them); the canvas is
     physical, so the clip -- like every draw below -- scales endpoints
     on the way in. Endpoints, not sizes: adjacent logical rects must
     stay adjacent after scaling. */
  g_clipX = vpx(x); g_clipY = vpx(y);
  g_clipW = vpx(x + w) - vpx(x); g_clipH = vpx(y + h) - vpx(y);
  g_clipOn = true;
}
void gfxNUnclip(void) {
  if (opRec()) { opStart(); opB(8); }
  g_clipOn = false;
}
void gfxNClear(unsigned rgb) {
  if (!g_frameOk) g_frameOk = frameEnsure();  // first use allocates the frame
  if (opRec()) { opStart(); opB(1); opRGB(rgb); }
  jsSurface().fillScreen(rgb565(rgb));
}
/* AA quarter disc (fill) or 1px arc ring: 2x2-supersampled coverage
   blended 565, the same treatment HD text gets. FLOAT math on purpose:
   the glass emulator mirrors it with Math.fround for bit parity. */
static inline uint16_t hdBlend565(uint16_t dst, uint16_t fg, uint8_t a) {
  const uint32_t r = (((dst >> 11) & 31) * (64 - a) + ((fg >> 11) & 31) * a) >> 6;
  const uint32_t g = (((dst >> 5) & 63) * (64 - a) + ((fg >> 5) & 63) * a) >> 6;
  const uint32_t b = ((dst & 31) * (64 - a) + (fg & 31) * a) >> 6;
  return (uint16_t)((r << 11) | (g << 5) | b);
}
static void hdCorner(float Cx, float Cy, float R, int px0, int py0, int px1, int py1,
                     uint16_t fg, bool fillDisc) {
  if (!(g_frameOk && g_frame)) return;
  uint16_t *buf = surfBuf();
  const int W = surfW(), H = surfH();
  if (!buf) return;
  const float Ro2 = R * R;
  const float Ri = R - 1.0f > 0 ? R - 1.0f : 0;
  const float Ri2 = Ri * Ri;
  if (px0 < 0) px0 = 0;
  if (py0 < 0) py0 = 0;
  if (px1 > W) px1 = W;
  if (py1 > H) py1 = H;
  for (int py = py0; py < py1; py++) {
    for (int px = px0; px < px1; px++) {
      int n = 0;
      for (int sub = 0; sub < 4; sub++) {
        const float sx = px + ((sub & 1) ? 0.75f : 0.25f);
        const float sy = py + ((sub & 2) ? 0.75f : 0.25f);
        const float dx = sx - Cx, dy = sy - Cy;
        const float d2 = dx * dx + dy * dy;
        if (fillDisc ? (d2 <= Ro2) : (d2 <= Ro2 && d2 >= Ri2)) n++;
      }
      if (!n) continue;
      uint16_t *pp = buf + (size_t)py * W + px;
      *pp = n >= 4 ? fg : hdBlend565(*pp, fg, (uint8_t)(n * 16));
    }
  }
}

void gfxNRect(int x, int y, int w, int h, unsigned rgb, int r, int fill) {
  if (opRec()) {
    opStart(); opB(fill ? 2 : 3);
    op16(x); op16(y); op16(w); op16(h); opRGB(rgb);
    opB((uint8_t)(r < 0 ? 0 : (r > 255 ? 255 : r)));
  }
  { const int x2 = vpx(x + w), y2 = vpx(y + h);
    x = vpx(x); y = vpx(y); w = x2 - x; h = y2 - y; r = vpx(r); }
  if (g_clipOn) {
    // Clamp to the clip; a clamped rounded rect falls back to square edges.
    int x2 = x + w, y2 = y + h;
    if (x < g_clipX) { x = g_clipX; r = 0; }
    if (y < g_clipY) { y = g_clipY; r = 0; }
    if (x2 > g_clipX + g_clipW) { x2 = g_clipX + g_clipW; r = 0; }
    if (y2 > g_clipY + g_clipH) { y2 = g_clipY + g_clipH; r = 0; }
    w = x2 - x; h = y2 - y;
    if (w <= 0 || h <= 0) return;
  }
  Adafruit_GFX &g = jsSurface();
  /* HD: ROUND corners -- AA quarter arcs like the sim's renderer --
     instead of Adafruit's chamfered midpoint steps */
  if (vHdText() && r > 1 && w > 2 * r && h > 2 * r && surfBuf()) {
    const uint16_t fg = rgb565(rgb);
    const float R = (float)r;
    if (fill) {
      g.fillRect(x, y + r, w, h - 2 * r, fg);
      g.fillRect(x + r, y, w - 2 * r, r, fg);
      g.fillRect(x + r, y + h - r, w - 2 * r, r, fg);
      hdCorner(x + R, y + R, R, x, y, x + r, y + r, fg, true);
      hdCorner(x + w - R, y + R, R, x + w - r, y, x + w, y + r, fg, true);
      hdCorner(x + R, y + h - R, R, x, y + h - r, x + r, y + h, fg, true);
      hdCorner(x + w - R, y + h - R, R, x + w - r, y + h - r, x + w, y + h, fg, true);
    } else {
      g.drawFastHLine(x + r, y, w - 2 * r, fg);
      g.drawFastHLine(x + r, y + h - 1, w - 2 * r, fg);
      g.drawFastVLine(x, y + r, h - 2 * r, fg);
      g.drawFastVLine(x + w - 1, y + r, h - 2 * r, fg);
      hdCorner(x + R, y + R, R, x, y, x + r, y + r, fg, false);
      hdCorner(x + w - R, y + R, R, x + w - r, y, x + w, y + r, fg, false);
      hdCorner(x + R, y + h - R, R, x, y + h - r, x + r, y + h, fg, false);
      hdCorner(x + w - R, y + h - R, R, x + w - r, y + h - r, x + w, y + h, fg, false);
    }
    return;
  }
  if (fill) { if (r > 0) g.fillRoundRect(x, y, w, h, r, rgb565(rgb)); else g.fillRect(x, y, w, h, rgb565(rgb)); }
  else { if (r > 0) g.drawRoundRect(x, y, w, h, r, rgb565(rgb)); else g.drawRect(x, y, w, h, rgb565(rgb)); }
}
void gfxNCircle(int x, int y, int r, unsigned rgb, int fill) {
  if (opRec()) { opStart(); opB(4); op16(x); op16(y); op16(r); opRGB(rgb); opB(fill ? 1 : 0); }
  x = vpx(x); y = vpx(y); r = vpx(r);
  if (g_clipOn && (y - r < g_clipY || y + r > g_clipY + g_clipH)) return;
  if (vHdText() && r > 1 && surfBuf()) {
    /* HD: an AA disc/ring, radius r+0.5 around the centre pixel -- the
       same footprint Adafruit covers, actually round */
    const uint16_t fg = rgb565(rgb);
    const float Cx = x + 0.5f, Cy = y + 0.5f, R = r + 0.5f;
    hdCorner(Cx, Cy, R, x - r - 1, y - r - 1, x + r + 2, y + r + 2, fg, fill);
    return;
  }
  if (fill) jsSurface().fillCircle(x, y, r, rgb565(rgb)); else jsSurface().drawCircle(x, y, r, rgb565(rgb));
}
/**
 * Lines obey the clip too.
 *
 * Rectangles are clamped and text is skipped, but a line was drawn regardless —
 * so a plot inside a scrolling viewport painted straight over the header and
 * footer. Cohen-Sutherland: trim the endpoints to the clip rectangle, and drop
 * the line entirely when both ends sit outside the same edge.
 */
static int clipCode(int x, int y) {
  int c = 0;
  if (x < g_clipX) c |= 1;
  else if (x > g_clipX + g_clipW - 1) c |= 2;
  if (y < g_clipY) c |= 4;
  else if (y > g_clipY + g_clipH - 1) c |= 8;
  return c;
}

void gfxNLine(int x0, int y0, int x1, int y1, unsigned rgb) {
  if (opRec()) { opStart(); opB(5); op16(x0); op16(y0); op16(x1); op16(y1); opRGB(rgb); }
  x0 = vpx(x0); y0 = vpx(y0); x1 = vpx(x1); y1 = vpx(y1);
  if (g_clipOn) {
    const int xmin = g_clipX, xmax = g_clipX + g_clipW - 1;
    const int ymin = g_clipY, ymax = g_clipY + g_clipH - 1;
    int c0 = clipCode(x0, y0), c1 = clipCode(x1, y1);
    for (int guard = 0; guard < 8; guard++) {
      if (!(c0 | c1)) break;        // both inside
      if (c0 & c1) return;          // both beyond one edge
      const int c = c0 ? c0 : c1;
      int nx = x0, ny = y0;
      if (c & 8) { nx = x0 + (x1 - x0) * (ymax - y0) / (y1 - y0); ny = ymax; }
      else if (c & 4) { nx = x0 + (x1 - x0) * (ymin - y0) / (y1 - y0); ny = ymin; }
      else if (c & 2) { ny = y0 + (y1 - y0) * (xmax - x0) / (x1 - x0); nx = xmax; }
      else { ny = y0 + (y1 - y0) * (xmin - x0) / (x1 - x0); nx = xmin; }
      if (c == c0) { x0 = nx; y0 = ny; c0 = clipCode(x0, y0); }
      else { x1 = nx; y1 = ny; c1 = clipCode(x1, y1); }
    }
  }
  jsSurface().drawLine(x0, y0, x1, y1, rgb565(rgb));
}
/*
 * Direct glyph blitter. Adafruit's drawChar costs a virtual drawPixel --
 * or a whole fillRect at size>1 -- PER GLYPH PIXEL, and text is most of
 * a UI frame. Here each glyph row becomes at most two horizontal spans
 * written straight into the canvas. Geometry is drawChar's exactly: the
 * same classic table (our own include of glcdfont.c), the same 5x8 cell
 * and 6*size advance, transparent background -- so the browser replays,
 * which were verified pixel-identical against drawChar, stay identical.
 */
#include <glcdfont.c>
/* ---- HD glyphs: Scale2x/3x-smoothed 5x7, cached per glyph ----
 *
 * The same AdvMAME smoothing mjsx generates its 12x16 face with: each
 * source pixel becomes an fxf block whose corners borrow from matching
 * neighbours, which rounds diagonals and curves instead of fattening
 * blocks. Computed ONCE per glyph per factor from the 6x8 cell (5 font
 * columns + the advance gap, which corner smoothing may round into) and
 * cached in PSRAM: f=2 (16 rows), f=3 (24), f=4 (32, Scale2x twice).
 * Rows are bitmasks, bit x = column x, at most 24 bits wide. */
static inline uint32_t hdSrcRow(const unsigned char *col, int y) {
  uint32_t r = 0;
  for (int x = 0; x < 5; x++) r |= (uint32_t)((pgm_read_byte(&col[x]) >> y) & 1u) << x;
  return r;
}
static void hdScale2x(const uint32_t *src, int w, int h, uint32_t *out) {
  for (int y = 0; y < h; y++) {
    uint32_t r0 = 0, r1 = 0;
    for (int x = 0; x < w; x++) {
      const int E = (src[y] >> x) & 1;
      const int B = y > 0 ? (int)((src[y - 1] >> x) & 1) : 0;
      const int H = y < h - 1 ? (int)((src[y + 1] >> x) & 1) : 0;
      const int D = x > 0 ? (int)((src[y] >> (x - 1)) & 1) : 0;
      const int F = x < w - 1 ? (int)((src[y] >> (x + 1)) & 1) : 0;
      const int A = (y > 0 && x > 0) ? (int)((src[y - 1] >> (x - 1)) & 1) : 0;
      const int C = (y > 0 && x < w - 1) ? (int)((src[y - 1] >> (x + 1)) & 1) : 0;
      const int G = (y < h - 1 && x > 0) ? (int)((src[y + 1] >> (x - 1)) & 1) : 0;
      const int I = (y < h - 1 && x < w - 1) ? (int)((src[y + 1] >> (x + 1)) & 1) : 0;
      int e0 = (D == B && B != F && D != H) ? D : E;
      int e1 = (B == F && B != D && F != H) ? F : E;
      int e2 = (D == H && D != B && H != F) ? D : E;
      int e3 = (H == F && D != H && B != F) ? F : E;
      /* Fill a corner unless it pinches into a TRUE crossing: the cell
         across the corner is ink AND both strokes continue on the far
         side of each other (+, t, f). A joint where a stroke ENDS at
         the junction (z's diagonals, p's bowl, 4's angle) still rounds. */
      #define HDSB(xx, yy) \
        (((xx) >= 0 && (yy) >= 0 && (xx) < w && (yy) < h) ? (int)((src[(yy)] >> (xx)) & 1) : 0)
      if (!E) {
        if (A && HDSB(x - 1, y - 2) && HDSB(x - 2, y - 1)) e0 = 0;
        if (C && HDSB(x + 1, y - 2) && HDSB(x + 2, y - 1)) e1 = 0;
        if (G && HDSB(x - 1, y + 2) && HDSB(x - 2, y + 1)) e2 = 0;
        if (I && HDSB(x + 1, y + 2) && HDSB(x + 2, y + 1)) e3 = 0;
      }
      #undef HDSB
      r0 |= (uint32_t)e0 << (2 * x); r0 |= (uint32_t)e1 << (2 * x + 1);
      r1 |= (uint32_t)e2 << (2 * x); r1 |= (uint32_t)e3 << (2 * x + 1);
    }
    out[2 * y] = r0;
    out[2 * y + 1] = r1;
  }
}
static void hdScale3x(const uint32_t *src, int w, int h, uint32_t *out) {
  for (int y = 0; y < h; y++) {
    uint32_t r0 = 0, r1 = 0, r2 = 0;
    for (int x = 0; x < w; x++) {
      const int E = (src[y] >> x) & 1;
      const int B = y > 0 ? (int)((src[y - 1] >> x) & 1) : 0;
      const int H = y < h - 1 ? (int)((src[y + 1] >> x) & 1) : 0;
      const int D = x > 0 ? (int)((src[y] >> (x - 1)) & 1) : 0;
      const int F = x < w - 1 ? (int)((src[y] >> (x + 1)) & 1) : 0;
      const int A = (y > 0 && x > 0) ? (int)((src[y - 1] >> (x - 1)) & 1) : 0;
      const int C = (y > 0 && x < w - 1) ? (int)((src[y - 1] >> (x + 1)) & 1) : 0;
      const int G = (y < h - 1 && x > 0) ? (int)((src[y + 1] >> (x - 1)) & 1) : 0;
      const int I = (y < h - 1 && x < w - 1) ? (int)((src[y + 1] >> (x + 1)) & 1) : 0;
      const int e0 = (D == B && B != F && D != H) ? D : E;
      const int e1 = ((D == B && B != F && D != H && E != C) ||
                      (B == F && B != D && F != H && E != A)) ? B : E;
      const int e2 = (B == F && B != D && F != H) ? F : E;
      const int e3 = ((D == B && B != F && D != H && E != G) ||
                      (D == H && D != B && H != F && E != A)) ? D : E;
      const int e5 = ((B == F && B != D && F != H && E != I) ||
                      (H == F && D != H && B != F && E != C)) ? F : E;
      const int e6 = (D == H && D != B && H != F) ? D : E;
      const int e7 = ((D == H && D != B && H != F && E != I) ||
                      (H == F && D != H && B != F && E != G)) ? H : E;
      const int e8 = (H == F && D != H && B != F) ? F : E;
      int f0 = e0, f2 = e2, f6 = e6, f8 = e8, f1 = e1, f3 = e3, f5 = e5, f7 = e7;
      /* same refined crossing guard as the 2x; edge cells follow their
         two adjacent corners */
      #define HDSB(xx, yy) \
        (((xx) >= 0 && (yy) >= 0 && (xx) < w && (yy) < h) ? (int)((src[(yy)] >> (xx)) & 1) : 0)
      if (!E) {
        const int sA = A && HDSB(x - 1, y - 2) && HDSB(x - 2, y - 1);
        const int sC = C && HDSB(x + 1, y - 2) && HDSB(x + 2, y - 1);
        const int sG = G && HDSB(x - 1, y + 2) && HDSB(x - 2, y + 1);
        const int sI = I && HDSB(x + 1, y + 2) && HDSB(x + 2, y + 1);
        if (sA) f0 = 0;
        if (sC) f2 = 0;
        if (sG) f6 = 0;
        if (sI) f8 = 0;
        if (sA && sC) f1 = 0;
        if (sA && sG) f3 = 0;
        if (sC && sI) f5 = 0;
        if (sG && sI) f7 = 0;
      }
      #undef HDSB
      r0 |= (uint32_t)f0 << (3 * x); r0 |= (uint32_t)f1 << (3 * x + 1); r0 |= (uint32_t)f2 << (3 * x + 2);
      r1 |= (uint32_t)f3 << (3 * x); r1 |= (uint32_t)E << (3 * x + 1);  r1 |= (uint32_t)f5 << (3 * x + 2);
      r2 |= (uint32_t)f6 << (3 * x); r2 |= (uint32_t)f7 << (3 * x + 1); r2 |= (uint32_t)f8 << (3 * x + 2);
    }
    out[3 * y] = r0;
    out[3 * y + 1] = r1;
    out[3 * y + 2] = r2;
  }
}
static uint32_t *g_hdGlyph[3][256];   /* [f2|f3|f4][char] -> rows, lazy */
static const uint32_t *hdGlyph(int fi, unsigned ch, const unsigned char *col) {
  if (!g_hdGlyph[fi][ch]) {
    const int rows = fi == 0 ? 16 : (fi == 1 ? 24 : 32);
    uint32_t *out = (uint32_t *)ps_malloc((size_t)rows * 4);
    if (!out) return nullptr;
    if (ch == '*') {
      /* Three strokes smoothed ALONE (the junction guard rightly
         refuses their crossings when smoothed together), then OR'd --
         each arm renders exactly the way / itself does. Rows here are
         bit x = column x. */
      static const uint32_t SA[8] = { 0, 1, 2, 4, 8, 16, 0, 0 };
      static const uint32_t SB[8] = { 0, 16, 8, 4, 2, 1, 0, 0 };
      const uint32_t *parts[2] = { SA, SB };
      uint32_t tmp[32];
      for (int i = 0; i < rows; i++) out[i] = 0;
      for (int pi = 0; pi < 2; pi++) {
        if (fi == 0) hdScale2x(parts[pi], 6, 8, tmp);
        else if (fi == 1) hdScale3x(parts[pi], 6, 8, tmp);
        else {
          uint32_t mid[16];
          hdScale2x(parts[pi], 6, 8, mid);
          hdScale2x(mid, 12, 16, tmp);
        }
        for (int i = 0; i < rows; i++) out[i] |= tmp[i];
      }
      /* the vertical, straight into the smoothed grid: source rows
         0.5..6.5 -- half a pixel down, one short of cap height,
         centred on the arms */
      {
        const int f = fi == 0 ? 2 : (fi == 1 ? 3 : 4);
        const int vy0 = (f + 1) >> 1, vy1 = vy0 + 6 * f;
        uint32_t vmask = 0;
        for (int vx = 2 * f; vx < 3 * f; vx++) vmask |= 1u << vx;
        for (int vy = vy0; vy < vy1 && vy < rows; vy++) out[vy] |= vmask;
      }
      g_hdGlyph[fi][ch] = out;
      return out;
    }
    uint32_t src[8];
    for (int y = 0; y < 8; y++) src[y] = hdSrcRow(col, y);
    if (fi == 0) hdScale2x(src, 6, 8, out);
    else if (fi == 1) hdScale3x(src, 6, 8, out);
    else {
      uint32_t mid[16];
      hdScale2x(src, 6, 8, mid);
      hdScale2x(mid, 12, 16, out);
    }
    g_hdGlyph[fi][ch] = out;
  }
  return g_hdGlyph[fi][ch];
}

/* ---- VECTOR antialiased glyphs ------------------------------------
 *
 * The same pipeline the browser's FULL mode runs, ported: each glyph's
 * bitmap is VECTORIZED (maximal horizontal/vertical runs as segments
 * through pixel centres, staircase leftovers as 45-degree diagonals,
 * lone pixels as dots, corner connectors closing bowls) and rasterized
 * as round-pen CAPSULES with 2x2 supersampling into a coverage map the
 * blitter alpha-blends. Same letterforms as FULL, antialiased, at any
 * glyph scale -- p's bowl is finally a bowl. Cached per glyph per ps. */
#define HDVEC_MAXSEG 48
struct HdVec { float s[HDVEC_MAXSEG][4]; int ns; float d[16][2]; int nd; };
static void hdVectorize(const unsigned char *col, HdVec *v) {
  v->ns = 0;
  v->nd = 0;
  if (col == nullptr) return;
  uint8_t ink[5][8], covd[5][8];
  for (int x = 0; x < 5; x++)
    for (int y = 0; y < 8; y++) {
      ink[x][y] = (pgm_read_byte(&col[x]) >> y) & 1;
      covd[x][y] = 0;
    }
  #define INKAT(xx, yy) (((xx) >= 0 && (yy) >= 0 && (xx) < 5 && (yy) < 8) ? ink[(xx)][(yy)] : 0)
  /* horizontal runs */
  for (int y = 0; y < 8; y++)
    for (int x = 0; x < 5;) {
      if (!ink[x][y]) { x++; continue; }
      int x0 = x;
      while (x + 1 < 5 && ink[x + 1][y]) x++;
      if (x - x0 + 1 >= 2 && v->ns < HDVEC_MAXSEG) {
        float *sg = v->s[v->ns++];
        sg[0] = x0 + 0.5f; sg[1] = y + 0.5f; sg[2] = x + 0.5f; sg[3] = y + 0.5f;
        for (int cx = x0; cx <= x; cx++) covd[cx][y] = 1;
      }
      x++;
    }
  /* vertical runs */
  for (int x = 0; x < 5; x++)
    for (int y = 0; y < 8;) {
      if (!ink[x][y]) { y++; continue; }
      int y0 = y;
      while (y + 1 < 8 && ink[x][y + 1]) y++;
      if (y - y0 + 1 >= 2 && v->ns < HDVEC_MAXSEG) {
        float *sg = v->s[v->ns++];
        sg[0] = x + 0.5f; sg[1] = y0 + 0.5f; sg[2] = x + 0.5f; sg[3] = y + 0.5f;
        for (int cy = y0; cy <= y; cy++) covd[x][cy] = 1;
      }
      y++;
    }
  /* diagonal chains over unclaimed pixels, both slopes */
  static const int DIRS[2][2] = { { 1, 1 }, { -1, 1 } };
  for (int di = 0; di < 2; di++) {
    const int dx = DIRS[di][0], dy = DIRS[di][1];
    for (int y = 0; y < 8; y++)
      for (int x = 0; x < 5; x++) {
        if (!ink[x][y] || covd[x][y]) continue;
        const int hx = x - dx, hy = y - dy;
        if (INKAT(hx, hy) && !(hx >= 0 && hy >= 0 && hx < 5 && hy < 8 && covd[hx][hy])) continue;
        int ex = x, ey = y, n = 1;
        while (INKAT(ex + dx, ey + dy) &&
               !(ex + dx >= 0 && ey + dy >= 0 && ex + dx < 5 && ey + dy < 8 && covd[ex + dx][ey + dy]))
        { ex += dx; ey += dy; n++; }
        if (n >= 2 && v->ns < HDVEC_MAXSEG) {
          float *sg = v->s[v->ns++];
          sg[0] = x + 0.5f; sg[1] = y + 0.5f; sg[2] = ex + 0.5f; sg[3] = ey + 0.5f;
          int px = x, py = y;
          for (int k = 0; k < n; k++) { covd[px][py] = 1; px += dx; py += dy; }
        }
      }
  }
  /* extend diagonal ends one 45-degree step into adjacent covered ink */
  for (int si = 0; si < v->ns; si++) {
    float *sg = v->s[si];
    const float sdx = sg[2] - sg[0], sdy = sg[3] - sg[1];
    if (sdx == 0 || sdy == 0) continue;
    const int ux = sdx > 0 ? 1 : -1, uy = sdy > 0 ? 1 : -1;
    int fx = (int)floorf(sg[2]) + ux, fy = (int)floorf(sg[3]) + uy;
    if (INKAT(fx, fy) && fx >= 0 && fy >= 0 && fx < 5 && fy < 8 && covd[fx][fy]) { sg[2] = fx + 0.5f; sg[3] = fy + 0.5f; }
    int bx = (int)floorf(sg[0]) - ux, by = (int)floorf(sg[1]) - uy;
    if (INKAT(bx, by) && bx >= 0 && by >= 0 && bx < 5 && by < 8 && covd[bx][by]) { sg[0] = bx + 0.5f; sg[1] = by + 0.5f; }
  }
  /* dots: still-unclaimed ink */
  for (int y = 0; y < 8; y++)
    for (int x = 0; x < 5; x++)
      if (ink[x][y] && !covd[x][y] && v->nd < 16) {
        v->d[v->nd][0] = x + 0.5f;
        v->d[v->nd][1] = y + 0.5f;
        v->nd++;
      }
  /* corner connectors: stroke ends or dots exactly diagonal-adjacent
     across an open corner join with a 45 -- closes bowls (O, D, p, q) */
  float pts[HDVEC_MAXSEG * 2 + 16][2];
  int np = 0;
  const int segN = v->ns * 2;
  for (int si = 0; si < v->ns; si++) {
    pts[np][0] = v->s[si][0]; pts[np][1] = v->s[si][1]; np++;
    pts[np][0] = v->s[si][2]; pts[np][1] = v->s[si][3]; np++;
  }
  uint8_t dotUsed[16] = { 0 };
  for (int di2 = 0; di2 < v->nd; di2++) { pts[np][0] = v->d[di2][0]; pts[np][1] = v->d[di2][1]; np++; }
  for (int ai = 0; ai < np; ai++)
    for (int bi = ai + 1; bi < np; bi++) {
      if (ai < segN && bi < segN && (ai >> 1) == (bi >> 1)) continue;
      const float adx = pts[bi][0] - pts[ai][0], ady = pts[bi][1] - pts[ai][1];
      if (fabsf(fabsf(adx) - 1.0f) > 0.01f || fabsf(fabsf(ady) - 1.0f) > 0.01f) continue;
      const int c1x = (int)floorf(pts[ai][0] + adx), c1y = (int)floorf(pts[ai][1]);
      const int c2x = (int)floorf(pts[ai][0]), c2y = (int)floorf(pts[ai][1] + ady);
      if (INKAT(c1x, c1y) && INKAT(c2x, c2y)) continue;
      if (v->ns < HDVEC_MAXSEG) {
        float *sg = v->s[v->ns++];
        sg[0] = pts[ai][0]; sg[1] = pts[ai][1]; sg[2] = pts[bi][0]; sg[3] = pts[bi][1];
      }
      if (ai >= segN) dotUsed[ai - segN] = 1;
      if (bi >= segN) dotUsed[bi - segN] = 1;
    }
  int nd2 = 0;
  for (int di3 = 0; di3 < v->nd; di3++)
    if (!dotUsed[di3]) { v->d[nd2][0] = v->d[di3][0]; v->d[nd2][1] = v->d[di3][1]; nd2++; }
  v->nd = nd2;
  #undef INKAT
}

#define HDAA_MAXPS 8
static uint8_t *g_hdAA[HDAA_MAXPS - 1][256];   /* [ps-2][ch] -> coverage, lazy */
static const uint8_t *hdGlyphAA(int ps, unsigned ch, const unsigned char *col) {
  const int ai = ps - 2;
  if (g_hdAA[ai][ch]) return g_hdAA[ai][ch];
  const int gw = 6 * ps, gh = 8 * ps;
  uint8_t *cov = (uint8_t *)ps_malloc((size_t)gw * gh);
  if (!cov) return nullptr;
  HdVec v;
  if (ch == '*') {
    /* authored, same grid as the browser's FULL star */
    v.ns = 3; v.nd = 0;
    static const float STAR[3][4] = { { 2, 1, 2, 6 }, { 0, 1, 4, 5 }, { 4, 1, 0, 5 } };
    for (int i = 0; i < 3; i++)
      for (int k = 0; k < 4; k++) v.s[i][k] = STAR[i][k];
  } else {
    hdVectorize(col, &v);
  }
  const float u = (float)ps, penR = u * 0.5f, r2 = penR * penR;
  for (int gy = 0; gy < gh; gy++) {
    for (int gx = 0; gx < gw; gx++) {
      int n = 0;
      for (int sub = 0; sub < 4; sub++) {
        const float cx3 = gx + ((sub & 1) ? 0.75f : 0.25f);
        const float cy3 = gy + ((sub & 2) ? 0.75f : 0.25f);
        bool in = false;
        for (int si = 0; si < v.ns && !in; si++) {
          const float x0 = v.s[si][0] * u, y0 = v.s[si][1] * u;
          const float sx = v.s[si][2] * u - x0, sy = v.s[si][3] * u - y0;
          const float ll = sx * sx + sy * sy;
          float t = ll > 0 ? ((cx3 - x0) * sx + (cy3 - y0) * sy) / ll : 0;
          if (t < 0) t = 0;
          if (t > 1) t = 1;
          const float ddx = cx3 - (x0 + sx * t), ddy = cy3 - (y0 + sy * t);
          in = ddx * ddx + ddy * ddy <= r2;
        }
        for (int di = 0; di < v.nd && !in; di++) {
          const float ddx = cx3 - v.d[di][0] * u, ddy = cy3 - v.d[di][1] * u;
          in = ddx * ddx + ddy * ddy <= r2;
        }
        if (in) n++;
      }
      cov[gy * gw + gx] = (uint8_t)(n * 16);
    }
  }
  g_hdAA[ai][ch] = cov;
  return cov;
}

static void textBlit(int x0, int y0, int size, uint16_t c565, const char *s, int len) {
  /* x0, y0, size are LOGICAL; the canvas is physical. Each char is
     placed at its logical position scaled (so the advance matches the
     layout's 6*size cells exactly) and its glyph drawn at the FLOORED
     integer scale -- a glyph scale that rounded up would out-grow its
     own advance and the letters would touch (size 2 at 1.25x: 18px of
     glyph on a 15px advance). */
  uint16_t *buf = surfBuf();
  const int W = surfW(), H = surfH();
  if (!buf) return;
  const int q = (vNative() && g_cvTargetRef() < 0) ? vq() : 4;
  const int ps = size * q / 4 > 0 ? size * q / 4 : 1;
  const int py = vpx(y0);
  /* Horizontal clip, which drawChar never honoured: a scrolling strip's
     letters bled sideways over whatever sat left of the clip (anything
     right was hidden by later draws -- paint order made it look like a
     one-sided bug). Vertical stays the whole-string skip at the caller,
     which the replayers mirror. g_clip is already physical. */
  int cx0 = 0, cx1 = W;
  if (g_clipOn) {
    if (g_clipX > cx0) cx0 = g_clipX;
    if (g_clipX + g_clipW < cx1) cx1 = g_clipX + g_clipW;
    if (cx1 <= cx0) return;
  }
  /* the folded U+2026: three baseline dots in one 5x7 cell */
  static const unsigned char ELLIPSIS_COLS[5] = { 0x40, 0x00, 0x40, 0x00, 0x40 };
  /* glcdfont's asterisk is a + inside an x, and the crossing muddies at
     any scale; this one is a vertical through an X -- no horizontal --
     and smooths clean. The JS 5x7 face carries the same override. */
  static const unsigned char STAR_COLS[5] = { 0x22, 0x14, 0x7E, 0x14, 0x22 };
  /* the HD factor: the largest of 4/3/2 dividing the glyph scale (the
     smoothed grid must land exactly on device pixels); scales of 1 and
     the primes past 3 stay blocky, which in practice is only ps=1. */
  int hf = 0, hfi = -1;
  if (vHdText() && ps >= 2) {
    if (ps % 4 == 0) { hf = 4; hfi = 2; }
    else if (ps % 3 == 0) { hf = 3; hfi = 1; }
    else if (ps % 2 == 0) { hf = 2; hfi = 0; }
  }
  for (int i = 0; i < len; i++) {
    const int x = vpx(x0 + i * 6 * size);
    if (x >= cx1 || x + 6 * ps <= cx0) continue;
    const unsigned char uc = (unsigned char)s[i];
    const unsigned char *col = uc == 0x85 ? ELLIPSIS_COLS
        : (uc == '*' ? STAR_COLS : font + (size_t)uc * 5);
    if (vHdText() && ps >= 2 && ps <= HDAA_MAXPS) {
      const uint8_t *cov = hdGlyphAA(ps, (unsigned char)s[i], col);
      if (cov) {
        const int gw2 = 6 * ps, gh2 = 8 * ps;
        for (int gy = 0; gy < gh2; gy++) {
          const int yy = py + gy;
          if (yy < 0) continue;
          if (yy >= H) break;
          const uint8_t *crow = cov + (size_t)gy * gw2;
          uint16_t *row = buf + (size_t)yy * W;
          for (int gx = 0; gx < gw2; gx++) {
            const uint8_t av = crow[gx];
            if (!av) continue;
            const int xx = x + gx;
            if (xx < cx0 || xx >= cx1) continue;
            row[xx] = av >= 64 ? c565 : hdBlend565(row[xx], c565, av);
          }
        }
        continue;
      }
    }
    if (hfi >= 0) {
      const uint32_t *gl = hdGlyph(hfi, (unsigned char)s[i], col);
      if (gl) {
        const int b = ps / hf;         /* device px per smoothed px */
        const int gw = 6 * hf, gh = 8 * hf;
        for (int yy = 0; yy < gh; yy++) {
          const int ry = py + yy * b;
          if (ry >= H) break;
          if (ry + b <= 0) continue;
          const uint32_t bits = gl[yy];
          if (!bits) continue;
          int runStart = -1;
          for (int gx = 0; gx <= gw; gx++) {
            const bool on = gx < gw && ((bits >> gx) & 1u);
            if (on && runStart < 0) runStart = gx;
            else if (!on && runStart >= 0) {
              int sx0 = x + runStart * b, sx1 = x + gx * b;
              if (sx0 < cx0) sx0 = cx0;
              if (sx1 > cx1) sx1 = cx1;
              for (int sr = 0; sr < b; sr++) {
                const int y2 = ry + sr;
                if (y2 < 0 || y2 >= H) continue;
                uint16_t *row = buf + (size_t)y2 * W + sx0;
                for (int k = sx1 - sx0; k > 0; k--) *row++ = c565;
              }
              runStart = -1;
            }
          }
        }
        continue;
      }
    }
    for (int r = 0; r < 8; r++) {
      const int yy0 = py + r * ps;
      if (yy0 >= H) break;
      if (yy0 + ps <= 0) continue;
      int runStart = -1;
      for (int cx = 0; cx <= 5; cx++) {
        const bool on = cx < 5 && ((pgm_read_byte(&col[cx]) >> r) & 1);
        if (on && runStart < 0) runStart = cx;
        else if (!on && runStart >= 0) {
          int sx0 = x + runStart * ps, sx1 = x + cx * ps;
          if (sx0 < cx0) sx0 = cx0;
          if (sx1 > cx1) sx1 = cx1;
          for (int sr = 0; sr < ps; sr++) {
            const int yy = yy0 + sr;
            if (yy < 0 || yy >= H) continue;
            uint16_t *row = buf + (size_t)yy * W + sx0;
            for (int k = sx1 - sx0; k > 0; k--) *row++ = c565;
          }
          runStart = -1;
        }
      }
    }
  }
}

void gfxNText(int x, int y, int size, unsigned rgb, const char *s, int len) {
  /* MicroQuickJS hands strings over as UTF-8, and the core truncates
     with a real U+2026 -- three bytes no 5x7 face can use. Fold it to
     one byte (0x85, its Windows-1252 seat) so it costs the one cell the
     layout reserved; textBlit and the remote decoder draw that byte as
     an ellipsis. */
  char tb[256];
  int tl = 0;
  for (int i = 0; i < len && tl < 255; ) {
    if (i + 2 < len && (uint8_t)s[i] == 0xE2 && (uint8_t)s[i + 1] == 0x80 &&
        (uint8_t)s[i + 2] == 0xA6) {
      tb[tl++] = (char)0x85;
      i += 3;
    } else {
      tb[tl++] = s[i++];
    }
  }
  s = tb;
  len = tl;
  if (opRec()) {
    opStart(); opB(6); op16(x); op16(y);
    opB((uint8_t)(size < 0 ? 0 : (size > 255 ? 255 : size))); opRGB(rgb);
    int tl = len > 255 ? 255 : len;
    opB((uint8_t)tl);
    for (int i = 0; i < tl; i++) opB((uint8_t)s[i]);
  }
  /* the vertical whole-string skip, in physical terms (clip is physical) */
  if (g_clipOn && (vpx(y) < g_clipY || vpx(y + 8 * size) > g_clipY + g_clipH)) return;
  if (surfBuf()) { textBlit(x, y, size, rgb565(rgb), s, len); return; }
  Adafruit_GFX &g = jsSurface();
  g.setTextSize(size);
  g.setTextColor(rgb565(rgb));
  g.setCursor(x, y);
  for (int i = 0; i < len; i++) g.write(s[i]);
}
/**
 * Scanline polygon fill, even-odd or nonzero -- the SAME crossings and
 * the SAME Math.round span ends as mjsx-core's JS fill and the browser
 * replayer, so panel, /ops JSON replay and /ops.bin replay land on
 * identical pixels. Having it native is also simply faster: the span
 * arithmetic runs in C instead of MicroQuickJS.
 */
void gfxNPoly(const float *xy, const unsigned short *rl, int nRings, unsigned rgb, int nonzero) {
  if (!g_frameOk) g_frameOk = frameEnsure();
  if (opRec()) {
    opStart(); opB(9); opRGB(rgb); opB(nonzero ? 1 : 0);
    opB((uint8_t)nRings);
    int b = 0;
    for (int ri = 0; ri < nRings; ri++) {
      op16(rl[ri]);
      for (int vi = 0; vi < rl[ri]; vi++) {
        op16((int)lroundf(xy[(b + vi) * 2] * 10.0f));
        op16((int)lroundf(xy[(b + vi) * 2 + 1] * 10.0f));
      }
      b += rl[ri];
    }
  }
  enum { EMAX = 2048, CMAX = 128 };  /* long unsimplified live strokes: dropped edges smear */
  static float *ed = nullptr;
  static int8_t *edir = nullptr;
  if (!ed) {
    ed = (float *)ps_malloc(EMAX * 4 * sizeof(float));
    edir = (int8_t *)ps_malloc(EMAX);
  }
  if (!ed || !edir) return;
  int ne = 0, base = 0;
  float minY = 1e9f, maxY = -1e9f;
  /* scale into physical space at edge build: the fill then runs on
     device pixels, which is what makes polys subpixel-sharp at any view
     scale (identity at 1x) */
  const float fq = (vNative() && g_cvTargetRef() < 0) ? vq() / 4.0f : 1.0f;
  for (int ri = 0; ri < nRings; ri++) {
    const int n = rl[ri];
    for (int vi = 0; vi < n; vi++) {
      const float ax = xy[(base + vi) * 2] * fq, ay = xy[(base + vi) * 2 + 1] * fq;
      const int wj = base + ((vi + 1) % n);
      const float bx = xy[wj * 2] * fq, by = xy[wj * 2 + 1] * fq;
      if (ay != by && ne < EMAX) {
        ed[ne * 4] = ax; ed[ne * 4 + 1] = ay; ed[ne * 4 + 2] = bx; ed[ne * 4 + 3] = by;
        edir[ne] = (ay < by) ? 1 : -1;
        ne++;
      }
      if (ay < minY) minY = ay;
      if (ay > maxY) maxY = ay;
    }
    base += n;
  }
  if (!ne) return;
  Adafruit_GFX &g = jsSurface();
  const uint16_t c565 = rgb565(rgb);
  auto span = [&](int fx, int tx, int sy) {
    if (g_clipOn) {
      if (sy < g_clipY || sy >= g_clipY + g_clipH) return;
      if (fx < g_clipX) fx = g_clipX;
      if (tx > g_clipX + g_clipW) tx = g_clipX + g_clipW;
    }
    if (tx > fx) g.fillRect(fx, sy, tx - fx, 1, c565);
  };
  for (int sy = (int)floorf(minY); sy <= (int)ceilf(maxY); sy++) {
    const float cy = sy + 0.5f;
    float cx[CMAX];
    int8_t cd[CMAX];
    int nc = 0;
    for (int ei = 0; ei < ne && nc < CMAX; ei++) {
      const float ay = ed[ei * 4 + 1], by = ed[ei * 4 + 3];
      const float lo = ay < by ? ay : by, hi = ay < by ? by : ay;
      if (cy >= lo && cy < hi) {
        const float x = ed[ei * 4] + (ed[ei * 4 + 2] - ed[ei * 4]) * (cy - ay) / (by - ay);
        int j = nc++;
        while (j > 0 && cx[j - 1] > x) { cx[j] = cx[j - 1]; cd[j] = cd[j - 1]; j--; }
        cx[j] = x;
        cd[j] = edir[ei];
      }
    }
    if (nonzero) {
      int wind = 0;
      float openX = 0;
      for (int i = 0; i < nc; i++) {
        const bool was = wind != 0;
        wind += cd[i];
        if (!was && wind != 0) openX = cx[i];
        else if (was && wind == 0) {
          /* floorf(v+0.5) is JS Math.round exactly, negatives included */
          span((int)floorf(openX + 0.5f), (int)floorf(cx[i] + 0.5f), sy);
        }
      }
    } else {
      for (int i = 0; i + 1 < nc; i += 2) {
        span((int)floorf(cx[i] + 0.5f), (int)floorf(cx[i + 1] + 0.5f), sy);
      }
    }
  }
}
int gfxNW(void) { return SW(); }
int gfxNH(void) { return SH(); }

/**
 * Blit the finished frame to the panel, through the viewport.
 *
 * Unscaled and unshifted, this is the one-call bitmap push it always was, and
 * that path is kept because it is the common one and the fast one. Otherwise
 * the frame is magnified a row at a time by nearest neighbour: a column map is
 * built once per geometry so the inner loop is an index rather than a divide,
 * and each destination row is assembled in a small buffer and pushed in a
 * single SPI write. Nearest neighbour rather than anything smoother on
 * purpose — this is a UI of flat colour, thin borders and text, and
 * interpolating it would only make the edges soft.
 */
/**
 * Native fonts on a scaled view: walk the just-published op frame and
 * draw its text straight onto the panel -- physical coordinates, integer
 * glyph size -- over the freshly blitted (text-free) canvas. Clip ops
 * are honoured at character granularity: a char is drawn only when it
 * fits the active clip and the view entirely, which mirrors the
 * engine's own skip-when-vertically-clipped rule closely enough that
 * scrolling lists behave.
 */
/* JPEG view of a source, re-encoded only when the generation moves.
   DEFINED in the sketch: fmt2jpg lives with the camera converters. */
static bool cvJpeg(int id, uint8_t **out, size_t *outLen, uint16_t *outGen);
static void jsQueueState(const String &json);

/** Producer access: native modules (a camera) write frames directly. */
uint16_t *gfxNCanvasBuf(int id, int *w, int *h) {
  if (!cvOk(id)) return nullptr;
  if (w) *w = g_cv[id].w;
  if (h) *h = g_cv[id].h;
  return g_cv[id].buf;
}
void gfxNCanvasBump(int id) {
  if (cvOk(id)) g_cv[id].gen++;
}

/** Allocate (or resize) a canvas source. Returns 1 on success. */
int gfxNCanvas(int id, int w, int h) {
  if (id < 0 || id >= CV_MAX || w < 1 || h < 1 || w > 480 || h > 480) return 0;
  CanvasSrc &c = g_cv[id];
  if (c.buf && (c.w != w || c.h != h)) {
    delete c.fc;
    heap_caps_free(c.buf);
    c.buf = nullptr;
    c.fc = nullptr;
  }
  if (!c.buf) {
    c.buf = (uint16_t *)heap_caps_malloc((size_t)w * h * 2, MALLOC_CAP_SPIRAM);
    if (!c.buf) return 0;
    memset(c.buf, 0, (size_t)w * h * 2);
    c.fc = new FrameCanvas((int16_t)w, (int16_t)h, c.buf);
    c.w = (int16_t)w;
    c.h = (int16_t)h;
  }
  return 1;
}

/** Redirect the gfx contract into a source (-1 restores the screen).
 *  Releasing bumps the generation, so blits of it repaint. */
void gfxNCanvasTarget(int id) {
  if (id >= 0 && cvOk(id)) {
    if (g_cvTarget < 0) {
      g_cvSaveClip[0] = g_clipOn; g_cvSaveClip[1] = g_clipX; g_cvSaveClip[2] = g_clipY;
      g_cvSaveClip[3] = g_clipW; g_cvSaveClip[4] = g_clipH;
    }
    g_cvTarget = id;
    g_clipOn = false;
  } else {
    if (g_cvTarget >= 0) {
      g_cv[g_cvTarget].gen++;
      g_clipOn = g_cvSaveClip[0] != 0;
      g_clipX = g_cvSaveClip[1]; g_clipY = g_cvSaveClip[2];
      g_clipW = g_cvSaveClip[3]; g_clipH = g_cvSaveClip[4];
    }
    g_cvTarget = -1;
  }
}

/** Place a canvas source: nearest-scaled into the destination rect (a
 *  source may be LOWER resolution than its box -- a 160x120 camera
 *  frame filling a large panel). Op 10 carries the source generation,
 *  so the dirty diff repaints exactly when the content changes. */
/* The in-band CHUNKED sender. A canvas JPEG is snapshotted when its
   send begins -- a backing update mid-transfer cannot tear it -- and
   travels as op 11 chunks capped at CV_CHUNK bytes per FRAME, so the
   UI ops stay responsive while the picture streams in behind them. A
   newer generation waits for the snapshot to finish. While chunks
   remain, an empty state patch keeps frames (and so chunks) flowing. */
#define CV_CHUNK 6144
static struct {
  uint8_t *buf = nullptr;
  uint32_t len = 0, off = 0;
  uint16_t gen = 0;
  bool active = false;
  bool have = false;      /* viewer-side content believed current */
  uint16_t haveGen = 0;
} g_cvSend[CV_MAX];
/** New op-stream subscribers need the pixels re-sent. */
static void cvReemit() { for (int i = 0; i < CV_MAX; i++) g_cvSend[i].have = false; }

void gfxNBlit(int id, int x, int y, int w, int h) {
  if (!cvOk(id) || w < 1 || h < 1) return;
  CanvasSrc &c = g_cv[id];
  if (opRec()) {
    auto &sn = g_cvSend[id];
    /* Encode and emit pixels ONLY while someone is watching (a stream
       subscriber or a recent /ops poll keeps g_opArmedAt fresh): with
       no viewers, a stroke commit costs zero JPEG work. A new viewer
       re-arms and cvReemit()s, so content arrives on subscribe. */
    const bool watched = millis() - g_opArmedAt < 5000;
    if (watched && !sn.active && (!sn.have || sn.haveGen != c.gen)) {
      uint8_t *j = nullptr;
      size_t n = 0;
      uint16_t jg = 0;
      if (cvJpeg(id, &j, &n, &jg) && n > 0 && n < OPREC_CAP) {
        if (sn.buf) { heap_caps_free(sn.buf); sn.buf = nullptr; }
        sn.buf = (uint8_t *)heap_caps_malloc(n, MALLOC_CAP_SPIRAM);
        if (sn.buf) {
          memcpy(sn.buf, j, n);   /* the SNAPSHOT: updates cannot tear it */
          sn.len = (uint32_t)n;
          sn.off = 0;
          sn.gen = jg;
          sn.active = true;
        }
      }
    }
    if (sn.active && sn.buf) {
      const uint32_t take = sn.len - sn.off > CV_CHUNK ? CV_CHUNK : sn.len - sn.off;
      opStart(); opB(11); opB((uint8_t)id); op16((int)sn.gen);
      opB((uint8_t)(sn.off & 0xff)); opB((uint8_t)((sn.off >> 8) & 0xff));
      opB((uint8_t)((sn.off >> 16) & 0xff)); opB((uint8_t)((sn.off >> 24) & 0xff));
      opB((uint8_t)(sn.len & 0xff)); opB((uint8_t)((sn.len >> 8) & 0xff));
      opB((uint8_t)((sn.len >> 16) & 0xff)); opB((uint8_t)((sn.len >> 24) & 0xff));
      opB((uint8_t)(take & 0xff)); opB((uint8_t)((take >> 8) & 0xff));
      for (uint32_t bi = 0; bi < take; bi++) opB(sn.buf[sn.off + bi]);
      sn.off += take;
      if (sn.off >= sn.len) {
        sn.active = false;
        sn.have = true;
        sn.haveGen = sn.gen;
        heap_caps_free(sn.buf);
        sn.buf = nullptr;
        /* content moved on DURING the send: nudge one more frame so the
           newer generation starts now, not at the next unrelated render
           -- otherwise a burst of updates parks the viewer one behind */
        if (c.gen != sn.haveGen) jsQueueState("{}");
      } else {
        jsQueueState("{}");   /* keep frames coming until the image lands */
      }
    }
    opStart(); opB(10); opB((uint8_t)id); op16((int)c.gen);
    op16(x); op16(y); op16(w); op16(h);
  }
  const int x0 = vpx(x), y0 = vpx(y);
  const int x1 = vpx(x + w), y1 = vpx(y + h);
  int dx0 = x0, dy0 = y0, dx1 = x1, dy1 = y1;
  if (g_clipOn) {
    if (dx0 < g_clipX) dx0 = g_clipX;
    if (dy0 < g_clipY) dy0 = g_clipY;
    if (dx1 > g_clipX + g_clipW) dx1 = g_clipX + g_clipW;
    if (dy1 > g_clipY + g_clipH) dy1 = g_clipY + g_clipH;
  }
  uint16_t *dst = surfBuf();
  const int DW = surfW(), DH = surfH();
  if (!dst) return;
  if (dx0 < 0) dx0 = 0;
  if (dy0 < 0) dy0 = 0;
  if (dx1 > DW) dx1 = DW;
  if (dy1 > DH) dy1 = DH;
  const int dw = x1 - x0, dh = y1 - y0;
  if (dw < 1 || dh < 1) return;
  if (c.w == dw && c.h == dh) {
    /* 1:1 -- the common case is a straight row copy */
    for (int py = dy0; py < dy1; py++) {
      memcpy(dst + (size_t)py * DW + dx0,
             c.buf + (size_t)(py - y0) * c.w + (dx0 - x0),
             (size_t)(dx1 - dx0) * 2);
    }
    return;
  }
  /* scaled: one column map, then plain indexed copies per row */
  static uint16_t sxMap[480];
  const int span = dx1 - dx0;
  if (span > 480) return;
  for (int i = 0; i < span; i++) {
    int sx = (int)((int64_t)(dx0 + i - x0) * c.w / dw);
    sxMap[i] = (uint16_t)(sx >= c.w ? c.w - 1 : sx);
  }
  for (int py = dy0; py < dy1; py++) {
    int sy = (int)((int64_t)(py - y0) * c.h / dh);
    if (sy >= c.h) sy = c.h - 1;
    const uint16_t *srow = c.buf + (size_t)sy * c.w;
    uint16_t *drow = dst + (size_t)py * DW + dx0;
    for (int i = 0; i < span; i++) drow[i] = srow[sxMap[i]];
  }
}

void gfxNFlush(void) {
  if (!(g_frameOk && g_frame)) { opPublish(); return; }
  const uint32_t t0 = micros();
  const int sw = g_frame->width(), sh = g_frame->height();
  if (viewPlain()) {
    const int BANDP = 24;
    static uint16_t *pband = nullptr;
    if (!pband) {
      pband = (uint16_t *)heap_caps_malloc(
          (size_t)(TFT_W > TFT_H ? TFT_W : TFT_H) * BANDP * 2,
          MALLOC_CAP_INTERNAL | MALLOC_CAP_DMA);
    }
    /* Dirty-rect: diff this frame's ops against the previous frame's
       (see opDiffBox) and push only the changed window. The diff runs
       BEFORE opPublish so both frames are still in hand. */
    int bx = 0, by = 0, bw = 0, bh = 0;
    int mode = (g_dirtyEnable && pband) ? opDiffBox(sw, sh, &bx, &by, &bw, &bh) : 0;
    opPublish();
    if (mode == 2) {                 /* identical frames: nothing to push */
      g_dirtyPix = 0;
      g_scaleUs = 0;
      g_flushUs = micros() - t0;
      return;
    }
    if (mode == 1) {
      /* strided sub-rectangle, banded through internal RAM */
      const int rowsPerBand = bw > 0 ? (int)(((size_t)(TFT_W > TFT_H ? TFT_W : TFT_H) * BANDP) / bw) : BANDP;
      tft.startWrite();
      tft.setAddrWindow(bx, by, bw, bh);
      for (int r0 = 0; r0 < bh; ) {
        int rows = bh - r0 < rowsPerBand ? bh - r0 : rowsPerBand;
        if (rows < 1) rows = 1;
        for (int r = 0; r < rows; r++) {
          memcpy(pband + (size_t)r * bw,
                 g_frame->buf + (size_t)(by + r0 + r) * sw + bx,
                 (size_t)bw * 2);
        }
        tft.writePixels(pband, (uint32_t)rows * bw);
        r0 += rows;
      }
      tft.endWrite();
      g_dirtyPix = (uint32_t)bw * bh;
      g_scaleUs = 0;
      g_flushUs = micros() - t0;
      return;
    }
    /* Full flush, banded through internal RAM: SPI DMA out of PSRAM is
       markedly slower than out of internal. */
    if (!pband) {
      tft.drawRGBBitmap(0, 0, g_frame->buf, sw, sh);
    } else {
      tft.startWrite();
      tft.setAddrWindow(0, 0, sw, sh);
      for (int y0 = 0; y0 < sh; y0 += BANDP) {
        const int rows = (sh - y0 < BANDP) ? (sh - y0) : BANDP;
        memcpy(pband, g_frame->buf + (size_t)y0 * sw, (size_t)rows * sw * 2);
        tft.writePixels(pband, (uint32_t)rows * sw);
      }
      tft.endWrite();
    }
    g_dirtyPix = (uint32_t)sw * sh;
    g_scaleUs = 0;
    g_flushUs = micros() - t0;
    return;
  }
  /* Dirty-rect for the scaled view too: identical frames skip the
     flush entirely, changed frames push only the changed window. */
  int lbx = 0, lby = 0, lbw = 0, lbh = 0;
  const int lsw = SW(), lsh = SH();   /* ops are logical; the canvas is not */
  int dmode = g_dirtyEnable ? opDiffBox(lsw, lsh, &lbx, &lby, &lbw, &lbh) : 0;
  opPublish();

  const int dw = viewDrawW(), dh = viewDrawH();
  const int ox = viewOX(), oy = viewOY();
  if (dw <= 0 || dh <= 0 || sw <= 0 || sh <= 0) return;

  // Magnified a band at a time, into internal RAM.
  //
  // The whole scaled frame used to be built in PSRAM and handed over in one
  // call. That works, but it puts PSRAM on both ends of the hot path: the CPU
  // writes 280 kB into it and then the SPI DMA reads the same 280 kB back out,
  // and DMA out of PSRAM is markedly slower than out of internal RAM. A band
  // of rows is small enough to live in internal RAM, which removes both.
  //
  // One address window covers the whole rectangle and each band is written
  // into it in sequence — the panel does not need telling again between bands.
  const int BAND = 24;
  static uint16_t *band = nullptr;
  if (!band) {
    band = (uint16_t *)heap_caps_malloc((size_t)(TFT_W > TFT_H ? TFT_W : TFT_H) * BAND * 2,
                                        MALLOC_CAP_INTERNAL | MALLOC_CAP_DMA);
    if (!band) return;
  }

  // The margin is static by definition, so it is painted only when the
  // geometry changes rather than behind every frame.
  static int lastOX = -1, lastOY = -1, lastW = -1, lastH = -1;
  if (ox != lastOX || oy != lastOY || dw != lastW || dh != lastH) {
    tft.fillScreen(COL_BG);
    lastOX = ox; lastOY = oy; lastW = dw; lastH = dh;
    dmode = 0;                       /* the whole view needs repainting */
  }
  if (dmode == 2) {                  /* identical frames: nothing to push */
    g_dirtyPix = 0;
    g_scaleUs = 0;
    g_flushUs = micros() - t0;
    return;
  }
  /* the changed window, in view-relative physical pixels (ceil the far
     edge so a partly-covered device pixel is rewritten, not left stale) */
  /* the changed LOGICAL box, ceiled out to whole device pixels */
  const int q = vq();
  int vx0 = 0, vy0 = 0, vx1 = dw, vy1 = dh;
  if (dmode == 1) {
    vx0 = lbx * q / 4;
    vy0 = lby * q / 4;
    vx1 = ((lbx + lbw) * q + 3) / 4;
    vy1 = ((lby + lbh) * q + 3) / 4;
    if (vx1 > dw) vx1 = dw;
    if (vy1 > dh) vy1 = dh;
    if (vx1 <= vx0 || vy1 <= vy0) {
      g_dirtyPix = 0;
      g_scaleUs = 0;
      g_flushUs = micros() - t0;
      return;
    }
  }

  const int bwid = vx1 - vx0;
  uint32_t scaleUs = 0;
  tft.startWrite();
  tft.setAddrWindow(ox + vx0, oy + vy0, bwid, vy1 - vy0);
  if (vNative()) {
    /* NATIVE: the canvas is panel-resolution -- a straight banded copy,
       offset into the view rectangle */
    for (int dy0 = vy0; dy0 < vy1; dy0 += BAND) {
      const int rows = (vy1 - dy0 < BAND) ? (vy1 - dy0) : BAND;
      for (int r = 0; r < rows; r++) {
        memcpy(band + (size_t)r * bwid,
               g_frame->buf + (size_t)(dy0 + r) * sw + vx0,
               (size_t)bwid * 2);
      }
      tft.writePixels(band, (uint32_t)rows * bwid);
    }
  } else {
    /* PIXEL: the canvas is logical -- nearest-neighbor upscale of the
       window, the uniform chunky look, fonts included */
    static uint16_t colMap[(TFT_W > TFT_H ? TFT_W : TFT_H)];
    static int mapW = 0, mapQ = 0;
    if (mapW != dw || mapQ != q) {
      for (int i = 0; i < dw; i++) {
        int sx = i * 4 / q;
        colMap[i] = (uint16_t)(sx < sw ? sx : sw - 1);
      }
      mapW = dw;
      mapQ = q;
    }
    for (int dy0 = vy0; dy0 < vy1; dy0 += BAND) {
      const int rows = (vy1 - dy0 < BAND) ? (vy1 - dy0) : BAND;
      const uint32_t t1 = micros();
      for (int r = 0; r < rows; r++) {
        int sy = (dy0 + r) * 4 / q;
        if (sy >= sh) sy = sh - 1;
        const uint16_t *src = g_frame->buf + (size_t)sy * sw;
        uint16_t *dst = band + (size_t)r * bwid;
        for (int dx = vx0; dx < vx1; dx++) dst[dx - vx0] = src[colMap[dx]];
      }
      scaleUs += micros() - t1;
      tft.writePixels(band, (uint32_t)rows * bwid);
    }
  }
  tft.endWrite();
  g_dirtyPix = (uint32_t)bwid * (vy1 - vy0);
  g_scaleUs = scaleUs;
  g_flushUs = micros() - t0;
}

/** Forget the painted margin, so the next flush repaints it. */
static void viewInvalidate() { tft.fillScreen(COL_BG); }


}  // extern "C"

/** Push whatever the native pages just drew. One name for both callers. */
static void uiFlush() { gfxNFlush(); }

/**
 * A known pattern, drawn straight at the panel.
 *
 * No canvas, no viewport, no scaling — so what appears is the panel driver and
 * nothing else. Three questions get answered at once by looking at it: whether
 * the colour order is right (the corners are named), whether the geometry is
 * right (a one-pixel border either meets the edges or does not), and whether
 * anything shifts (the border is continuous, so a wrap shows as a step in it).
 */
static void uiPanelTest() {
  const int w = panelW(), h = panelH();
  tft.fillScreen(0x0000);
  tft.fillRect(0, 0, 60, 60, 0xF800);           /* red    top-left */
  tft.fillRect(w - 60, 0, 60, 60, 0x07E0);      /* green  top-right */
  tft.fillRect(0, h - 60, 60, 60, 0x001F);      /* blue   bottom-left */
  tft.fillRect(w - 60, h - 60, 60, 60, 0xFFFF); /* white  bottom-right */
  /* A border that touches all four edges: any offset breaks it visibly. */
  tft.drawFastHLine(0, 0, w, 0xFFE0);
  tft.drawFastHLine(0, h - 1, w, 0xFFE0);
  tft.drawFastVLine(0, 0, h, 0xFFE0);
  tft.drawFastVLine(w - 1, 0, h, 0xFFE0);
  /* Centre cross, so a shift shows against a known midpoint. */
  tft.drawFastHLine(0, h / 2, w, 0x7BEF);
  tft.drawFastVLine(w / 2, 0, h, 0x7BEF);
  tft.setTextColor(0xFFFF);
  tft.setTextSize(2);
  tft.setCursor(70, h / 2 - 40);
  tft.print(w);
  tft.print("x");
  tft.print(h);
}

/**
 * Copy the frame out, retrying until one comes back untorn.
 *
 * `stride` is 1 for every pixel or 2 for half size; `swap` writes big-endian
 * pairs, which is what the JPEG encoder wants and what BMP does not.
 */
static bool uiFrameCopy(uint8_t *dst, int stride, bool swap, int &ow, int &oh) {
  if (!g_frameOk || !g_frame) return false;
  const int w = g_frame->width(), h = g_frame->height();
  ow = w / stride;
  oh = h / stride;

  for (int attempt = 0; attempt < 5; attempt++) {
    // Wait for a gap between renders. Even a busy screen has one inside 60 ms.
    uint32_t waited = 0;
    while (g_frameBusy && waited < 60) { delay(2); waited += 2; }
    const uint32_t seq0 = g_frameSeq;

    const uint16_t *fb = g_frame->buf;
    for (int y = 0; y < oh; y++) {
      const uint16_t *in = fb + (size_t)(y * stride) * w;
      uint8_t *out = dst + (size_t)y * ow * 2;
      if (swap) {
        for (int x = 0; x < ow; x++) {
          const uint16_t p = in[x * stride];
          out[x * 2] = (uint8_t)(p >> 8);
          out[x * 2 + 1] = (uint8_t)(p & 0xFF);
        }
      } else if (stride == 1) {
        memcpy(out, in, (size_t)ow * 2);
      } else {
        uint16_t *o16 = (uint16_t *)out;
        for (int x = 0; x < ow; x++) o16[x] = in[x * stride];
      }
    }

    // Clean only if nothing rendered while we were reading.
    if (g_frameSeq == seq0 && !g_frameBusy) return true;
  }
  return true;   // five torn attempts: hand back the last one rather than fail
}

extern "C" {

/**
 * Touch calibration, driven from a script.
 *
 * calMode(1) hands the script the controller's own numbers so it can measure
 * the mapping; setCal stores the fit it arrives at. Coefficients cross the
 * boundary as integers (scale x1000) because the binding layer deals in ints,
 * and a scale of 0.875 is 875 with nothing lost.
 */
extern "C" void sysNCalMode(int on) { g_calRaw = on != 0; }

/** setCal(axis, "raw,screen,...") — 0 = x, 1 = y, 2 = the y-vs-x cross term.
 *  An empty string clears that table. */
extern "C" void sysNSetCal(int axis, const char *csv, int len) {
  char buf[128];
  snprintf(buf, sizeof(buf), "%.*s", len, csv ? csv : "");
  g_prefs.begin("filrfid", false);
  if (axis == 0) {
    g_calNX = calParse(buf, g_calXr, g_calXd);
    g_prefs.putString("calx", buf);
  } else if (axis == 1) {
    g_calNY = calParse(buf, g_calYr, g_calYd);
    g_prefs.putString("caly", buf);
  } else {
    g_crossN = calParse(buf, g_crossR, g_crossD);
    g_prefs.putString("calc", buf);
  }
  g_prefs.end();
}

/**
 * The controller's own numbers, whatever mode we are in.
 *
 * calMode() hands a script raw coordinates but takes hit-testing away while it
 * does, which makes it useless for a page that wants to show you the raw
 * reading AND have working buttons. This just reports the last sample, so a
 * diagnostic page can display both spaces at once and the real range of the
 * panel can be read off the glass instead of inferred from a fit.
 */
extern "C" int sysNRawXY(char *out, int cap) {
  return snprintf(out, cap, "{\"x\":%d,\"y\":%d,\"n\":%u}",
                  g_tRawX, g_tRawY, (unsigned)g_tCount);
}

extern "C" int sysNGetCal(char *out, int cap) {
  /* Rotation rides along: a script starts with no idea which way the panel is
     mounted, and assuming portrait made calibration lay its targets out in the
     wrong coordinate space whenever the board booted sideways. */
  int n = snprintf(out, cap, "{\"rot\":%d,\"x\":\"", (int)g_rot);
  for (int i = 0; i < g_calNX && n < cap; i++)
    n += snprintf(out + n, cap - n, "%s%d,%d", i ? "," : "", g_calXr[i], g_calXd[i]);
  n += snprintf(out + n, cap - n, "\",\"y\":\"");
  for (int i = 0; i < g_calNY && n < cap; i++)
    n += snprintf(out + n, cap - n, "%s%d,%d", i ? "," : "", g_calYr[i], g_calYd[i]);
  n += snprintf(out + n, cap - n, "\",\"c\":\"");
  for (int i = 0; i < g_crossN && n < cap; i++)
    n += snprintf(out + n, cap - n, "%s%d,%d", i ? "," : "", g_crossR[i], g_crossD[i]);
  n += snprintf(out + n, cap - n, "\"}");
  return n;
}

/** Brightness, 0-100. Applied at once unless the screen is asleep. */
extern "C" void sysNBacklight(int pct) {
  if (pct < 1) pct = 1;            // zero here means "broken", not "off"
  if (pct > 100) pct = 100;
  g_blLevel = (uint8_t)((pct * 255) / 100);
  g_prefs.begin("filrfid", false);
  g_prefs.putUChar("bl", g_blLevel);
  g_prefs.end();
  if (!g_asleep) blWrite(g_blLevel);
  g_lastPoke = millis();
}

/** Sleep after this many seconds of nothing; 0 never sleeps. `dim` chooses
 *  what sleeping means: a readable minimum, or dark. */
extern "C" void sysNSleepAfter(int secs, int dim) {
  g_sleepMs = secs > 0 ? (uint32_t)secs * 1000 : 0;
  g_sleepDim = dim != 0;
  g_prefs.begin("filrfid", false);
  g_prefs.putULong("sleep", g_sleepMs);
  g_prefs.putBool("sleepdim", g_sleepDim);
  g_prefs.end();
  uiPoke();
}

extern "C" int sysNScreen(char *out, int cap) {
  return snprintf(out, cap,
                  "{\"bl\":%d,\"sleep\":%lu,\"dim\":%s,\"asleep\":%s,\"rot\":%d,"
                  "\"scale\":%d,\"inset\":%d,\"shiftx\":%d,\"shifty\":%d,\"fnative\":%s,"
                  "\"fmode\":%d,\"panelw\":%d,\"panelh\":%d,\"w\":%d,\"h\":%d}",
                  (int)((g_blLevel * 100 + 127) / 255), (unsigned long)(g_sleepMs / 1000),
                  g_sleepDim ? "true" : "false", g_asleep ? "true" : "false", (int)g_rot,
                  (int)g_vScaleQ, (int)g_vInset, (int)g_vShiftX, (int)g_vShiftY,
                  g_fontMode >= 1 ? "true" : "false",
                  (int)g_fontMode, panelW(), panelH(), SW(), SH());
}

/**
 * Resize or move the viewport, from a script.
 *
 * Everything downstream keys off SW()/SH(), so the canvas has to be rebuilt
 * before anything draws again — a script that changed the scale and then drew
 * into the old canvas would put a correctly-rendered frame of the wrong size
 * on the panel. The margin is repainted for the same reason: shrinking the
 * image leaves the last frame's pixels around the new edge.
 */
extern "C" void sysNView(int scaleQ, int inset, int sx, int sy) {
  if (scaleQ < 4) scaleQ = 4;      /* below 1x would magnify nothing and read as a bug */
  if (scaleQ > 16) scaleQ = 16;
  const int maxInset = (panelW() < panelH() ? panelW() : panelH()) / 4;
  if (inset < 0) inset = 0;
  if (inset > maxInset) inset = maxInset;
  g_vScaleQ = (uint8_t)scaleQ;
  g_vInset = (int16_t)inset;
  g_vShiftX = (int16_t)sx;
  g_vShiftY = (int16_t)sy;
  g_frameOk = frameEnsure();
  viewInvalidate();
  g_prefs.begin("filrfid", false);
  g_prefs.putUChar("vscale", (uint8_t)scaleQ);
  g_prefs.putShort("vinset", (int16_t)inset);
  g_prefs.putShort("vshx", (int16_t)sx);
  g_prefs.putShort("vshy", (int16_t)sy);
  g_prefs.end();
  uiPoke();
}

extern "C" void sysNPoke(void) { uiPoke(); }

/** Orientation from a script: rotate panel, canvas and touch as one, persist. */
void sysNRotate(int r) {
  setRotation((uint8_t)(r & 3));
  g_frameOk = frameEnsure();
  /* Never diff across a rotation. A 180-degree flip keeps the frame's
     dimensions, so the op headers still match and the diff sees only
     what the app changed (one row of chips) -- while MADCTL flipped how
     the panel scans EVERYTHING. Dropping the published frame makes the
     next flush unconditionally full. (Quarter turns were already safe:
     the w,h in the header change and the diff refuses on its own.) */
  portENTER_CRITICAL(&g_opMux);
  g_opPubLen = 0;
  portEXIT_CRITICAL(&g_opMux);
  g_prefs.begin("filrfid", false);
  g_prefs.putUChar("rot", (uint8_t)(r & 3));
  g_prefs.end();
}
/** How text reaches a scaled view: 1 panel-sharp at flush, 0 blitted. */
void sysNFontMode(int native) {
  g_fontMode = native < 0 ? 0 : (native > 2 ? 2 : (uint8_t)native);
  g_prefs.begin("filrfid", false);
  g_prefs.putUChar("fmode", g_fontMode);
  g_prefs.end();
  frameInit();       /* NATIVE and PIXEL canvases have different dims */
  /* text just moved between the canvas and the glass: never diff
     across the change, and repaint the margin under it */
  portENTER_CRITICAL(&g_opMux);
  g_opPubLen = 0;
  portEXIT_CRITICAL(&g_opMux);
  uiPoke();
}

void sysNBeep(int ok) {
  extern void beepHook(bool);  // lives in the sketch, next to the buzzer
  beepHook(ok != 0);
}
void sysNTone(int freq, int ms) {
  extern void toneHook(int, int);
  toneHook(freq, ms);
}
}  // extern "C"

#else  // !HAS_DISPLAY

static void uiBegin() {}
static void uiTick() {}
static void uiSetLink(const char *s) { (void)s; }
static const char *uiGetLink() { return "USB"; }
static void uiSetPresent(int r, bool p, const char *uid) { (void)r; (void)p; (void)uid; }
static void uiSetLabel(int r, const char *l, const char *c, bool clear) {
  (void)r; (void)l; (void)c; (void)clear;
}
static bool uiWifiRestore(char *ssid, size_t sl, char *pass, size_t pl) {
  (void)ssid; (void)sl; (void)pass; (void)pl;
  return false;
}
static int uiI2cScan(int sda, int scl, char *out, size_t outLen) {
  (void)sda; (void)scl; (void)outLen;
  if (out) out[0] = 0;
  return 0;
}
static void uiI2cRestore() {}
static int uiTouchProbe(uint8_t a, int r, char *out, size_t n) {
  (void)a; (void)r; (void)n;
  if (out) out[0] = 0;
  return 0;
}
static const uint16_t *uiFrame(int &w, int &h) { w = h = 0; return nullptr; }
static bool uiFrameOk() { return false; }
static uint32_t uiFlushUs() { return 0; }
static uint32_t uiDrawUs() { return 0; }
void uiSetDrawUs(uint32_t us) { (void)us; }
static uint32_t uiScaleUs() { return 0; }
static uint32_t uiDirtyPix() { return 0; }
static void uiSetDirty(bool on) { (void)on; }
static bool uiDirtyOn() { return false; }
static int uiScreenW() { return 0; }
static int uiScreenH() { return 0; }
static void uiInjectPointer(int phase, int x, int y) { (void)phase; (void)x; (void)y; }
static void uiPoke() {}
static bool uiAsleep() { return false; }
static int uiTouchRawX() { return -1; }
static int uiTouchRawY() { return -1; }
static int uiTouchX() { return -1; }
static int uiTouchY() { return -1; }
static uint32_t uiTouchCount() { return 0; }
static bool uiTouchBusError() { return false; }
static int uiPage() { return -1; }
static void uiCalibStart() {}
static bool uiCalibDone() { return false; }
static int uiCalibRawX(int i) { (void)i; return -1; }
static int uiCalibRawY(int i) { (void)i; return -1; }
static void uiCalibTarget(int i, int &tx, int &ty) { (void)i; tx = ty = -1; }
static int uiRot() { return -1; }
static void uiPanelTest() {}
static void uiOtaBegin() {}
static void uiOtaProgress(unsigned int d, unsigned int t) { (void)d; (void)t; }
static void uiOtaEnd(bool ok) { (void)ok; }

static void uiSetExternal(bool on, void (*ptrFwd)(int, int, int)) { (void)on; (void)ptrFwd; }
static bool uiExternal() { return false; }
extern "C" {
void gfxNClip(int x, int y, int w, int h) { (void)x;(void)y;(void)w;(void)h; }
void gfxNUnclip(void) {}
void gfxNClear(unsigned rgb) { (void)rgb; }
void gfxNRect(int x, int y, int w, int h, unsigned rgb, int r, int fill) { (void)x;(void)y;(void)w;(void)h;(void)rgb;(void)r;(void)fill; }
int gfxNCanvas(int id, int w, int h) { (void)id;(void)w;(void)h; return 0; }
uint16_t *gfxNCanvasBuf(int id, int *w, int *h) { (void)id;(void)w;(void)h; return nullptr; }
void gfxNCanvasBump(int id) { (void)id; }
void gfxNCanvasTarget(int id) { (void)id; }
void gfxNBlit(int id, int x, int y, int w, int h) { (void)id;(void)x;(void)y;(void)w;(void)h; }
void gfxNCircle(int x, int y, int r, unsigned rgb, int fill) { (void)x;(void)y;(void)r;(void)rgb;(void)fill; }
void gfxNLine(int x0, int y0, int x1, int y1, unsigned rgb) { (void)x0;(void)y0;(void)x1;(void)y1;(void)rgb; }
void gfxNText(int x, int y, int size, unsigned rgb, const char *s, int len) { (void)x;(void)y;(void)size;(void)rgb;(void)s;(void)len; }
int gfxNW(void) { return 240; }
int gfxNH(void) { return 280; }
void gfxNFlush(void) {}
void gfxNPoly(const float *xy, const unsigned short *rl, int nRings, unsigned rgb, int nonzero) {
  (void)xy; (void)rl; (void)nRings; (void)rgb; (void)nonzero;
}
void sysNRotate(int r) { (void)r; }
void sysNFontMode(int native) { (void)native; }
void sysNBeep(int ok) { (void)ok; }
void sysNBacklight(int pct) { (void)pct; }
void sysNSleepAfter(int secs, int dim) { (void)secs; (void)dim; }
int sysNScreen(char *out, int cap) { return snprintf(out, cap, "{}"); }
void sysNView(int scaleQ, int inset, int sx, int sy) { (void)scaleQ; (void)inset; (void)sx; (void)sy; }
void sysNPoke(void) {}
void sysNTone(int freq, int ms) { (void)freq; (void)ms; }
void sysNCalMode(int on) { (void)on; }
void sysNSetCal(int axis, const char *csv, int len) { (void)axis; (void)csv; (void)len; }
int sysNGetCal(char *out, int cap) { return snprintf(out, cap, "{}"); }
int sysNRawXY(char *out, int cap) { return snprintf(out, cap, "{}"); }
}

#endif  // HAS_DISPLAY
