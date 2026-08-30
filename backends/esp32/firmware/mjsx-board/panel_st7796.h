#pragma once
/*
 * ST7796 as an Adafruit_ST77xx.
 *
 * The 3.5" board's panel is an ST7796, which Adafruit's library does not ship
 * a driver for — but it speaks the same command set as the ST7789 already
 * here: CASET, RASET, RAMWR, MADCTL, COLMOD. So it is not a new driver, it is
 * a different init sequence and a different size, and everything already
 * written against Adafruit_GFX keeps working unchanged. Writing it as an
 * Adafruit_SPITFT subclass rather than adding a second graphics library keeps
 * one surface type across both boards, which is what lets the canvas, the
 * screenshot endpoints and the native pages stay as they are.
 *
 * The register sequence is the one Arduino_GFX uses for this panel; the gamma
 * tables in particular are panel-specific and not worth deriving.
 */
#include <Adafruit_ST7789.h>  /* pulls in Adafruit_ST77xx and its command set */

// Adafruit's list format: a command byte, then a count whose high bit means
// "a delay follows the arguments", then the arguments.
#define ST7796_DELAY 0x80

// Adafruit's header names only the RGB order (0x00); the BGR bit itself is
// absent because the ST7789 never needs it. This panel does.
#define ST7796_MADCTL_BGR 0x08

static const uint8_t PROGMEM st7796_initcmds[] = {
    18,                                    // commands to follow
    ST77XX_SWRESET, ST7796_DELAY, 120,     //
    ST77XX_SLPOUT,  ST7796_DELAY, 120,     //
    ST77XX_COLMOD,  1, 0x55,               // 16-bit colour
    0xF0,           1, 0xC3,               // command set control: unlock
    0xF0,           1, 0x96,               //
    0xB4,           1, 0x01,               // inversion control
    0xB6,           3, 0x80, 0x22, 0x3B,   // display function control
    0xE8,           8, 0x40, 0x8A, 0x00, 0x00, 0x29, 0x19, 0xA5, 0x33,
    0xC1,           1, 0x06,               // power control 2
    0xC2,           1, 0xA7,               // power control 3
    0xC5,           1, 0x18,               // VCOM
    0xE0,          14, 0xF0, 0x09, 0x0B, 0x06, 0x04, 0x15, 0x2F,
                       0x54, 0x42, 0x3C, 0x17, 0x14, 0x18, 0x1B,
    0xE1,          14, 0xE0, 0x09, 0x0B, 0x06, 0x04, 0x03, 0x2B,
                       0x43, 0x42, 0x3B, 0x16, 0x14, 0x17, 0x1B,
    0xF0,           1, 0x3C,               // relock
    0xF0,           1, 0x69,               //
    0x38,           0,                     // idle mode off
    ST77XX_INVON,   0,                     // an IPS panel: inverted is correct
    ST77XX_DISPON,  ST7796_DELAY, 120};

class Adafruit_ST7796 : public Adafruit_ST77xx {
public:
  Adafruit_ST7796(int8_t cs, int8_t dc, int8_t rst)
      : Adafruit_ST77xx(320, 480, cs, dc, rst) {}
  Adafruit_ST7796(SPIClass *spi, int8_t cs, int8_t dc, int8_t rst)
      : Adafruit_ST77xx(320, 480, spi, cs, dc, rst) {}

  void init(uint16_t width, uint16_t height, uint32_t freq = 0) {
    _colstart = _rowstart = 0;
    _height = height;
    _width = width;
    /* begin() rather than commonInit(): commonInit calls begin() with no
       argument and so discards any frequency set beforehand. */
    begin(freq);
    displayInit(st7796_initcmds);
    setRotation(0);
  }

  /**
   * Rotation, with the colour order written out each time.
   *
   * The base class picks RGB or BGR per panel family, and this one is BGR —
   * inherit its choice and every red on the screen comes out blue. Setting the
   * whole MADCTL byte here is also the only place the panel's mounting is
   * described, so there is one thing to change if a board mounts it turned.
   */
  void setRotation(uint8_t m) {
    uint8_t madctl;
    rotation = m & 3;
    switch (rotation) {
      case 1:  madctl = ST77XX_MADCTL_MX | ST77XX_MADCTL_MV | ST7796_MADCTL_BGR;  break;
      case 2:  madctl = ST77XX_MADCTL_MX | ST77XX_MADCTL_MY | ST7796_MADCTL_BGR;  break;
      case 3:  madctl = ST77XX_MADCTL_MY | ST77XX_MADCTL_MV | ST7796_MADCTL_BGR;  break;
      default: madctl = ST7796_MADCTL_BGR;                                        break;
    }
    const bool swap = (rotation & 1) != 0;
    _width  = swap ? 480 : 320;
    _height = swap ? 320 : 480;
    _xstart = _ystart = 0;
    sendCommand(ST77XX_MADCTL, &madctl, 1);
  }
};
