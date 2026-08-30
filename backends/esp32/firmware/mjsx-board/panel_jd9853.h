#pragma once
/*
 * JD9853 as an Adafruit_ST77xx — the 1.47" board's 172x320 panel.
 *
 * Same story as the ST7796: the JD9853 speaks the ST77xx command set
 * (CASET, RASET, RAMWR, MADCTL, COLMOD), so it is a different init
 * sequence and different offsets, not a new driver, and everything
 * written against Adafruit_GFX keeps working unchanged.
 *
 * The register sequence is Waveshare's own (ESP-IDF demo, esp_lcd_jd9853
 * vendor table) — the gamma and power tables are panel-specific and not
 * worth deriving. The 172-wide window sits at column 34 in the
 * controller's RAM (34 + 172 + 34 = 240), symmetric, so the offset
 * simply follows the native-X axis through rotations. IPS: inverted is
 * correct. Colour order is RGB (no BGR bit), per the same demo.
 */
#include <Adafruit_ST7789.h>  /* pulls in Adafruit_ST77xx and its command set */

#define JD9853_DELAY 0x80

static const uint8_t PROGMEM jd9853_initcmds[] = {
    33,                                  // commands to follow (count them: a
                                         // short count silently drops the tail
                                         // -- DISPON included, panel stays off)
    ST77XX_SLPOUT,  JD9853_DELAY, 120,   //
    0xDF,           2, 0x98, 0x53,       // unlock (the demo sends it twice)
    0xDF,           2, 0x98, 0x53,       //
    0xB2,           1, 0x23,             //
    0xB7,           4, 0x00, 0x47, 0x00, 0x6F,
    0xBB,           6, 0x1C, 0x1A, 0x55, 0x73, 0x63, 0xF0,
    0xC0,           2, 0x44, 0xA4,       //
    0xC1,           1, 0x16,             //
    0xC3,           8, 0x7D, 0x07, 0x14, 0x06, 0xCF, 0x71, 0x72, 0x77,
    0xC4,          12, 0x00, 0x00, 0xA0, 0x79, 0x0B, 0x0A, 0x16, 0x79,
                       0x0B, 0x0A, 0x16, 0x82,
    0xC8,          32, 0x3F, 0x32, 0x29, 0x29, 0x27, 0x2B, 0x27, 0x28,
                       0x28, 0x26, 0x25, 0x17, 0x12, 0x0D, 0x04, 0x00,
                       0x3F, 0x32, 0x29, 0x29, 0x27, 0x2B, 0x27, 0x28,
                       0x28, 0x26, 0x25, 0x17, 0x12, 0x0D, 0x04, 0x00,
    0xD0,           5, 0x04, 0x06, 0x6B, 0x0F, 0x00,
    0xD7,           2, 0x00, 0x30,       //
    0xE6,           1, 0x14,             //
    0xDE,           1, 0x01,             //
    0xB7,           5, 0x03, 0x13, 0xEF, 0x35, 0x35,
    0xC1,           3, 0x14, 0x15, 0xC0, //
    0xC2,           2, 0x06, 0x3A,       //
    0xC4,           2, 0x72, 0x12,       //
    0xBE,           1, 0x00,             //
    0xDE,           1, 0x02,             //
    0xE5,           3, 0x00, 0x02, 0x00, //
    0xE5,           3, 0x01, 0x02, 0x00, //
    0xDE,           1, 0x00,             //
    0x35,           1, 0x00,             // tearing effect on
    ST77XX_COLMOD,  1, 0x05,             // 16-bit colour
    ST77XX_CASET,   4, 0x00, 0x22, 0x00, 0xCD,  // 34..205
    ST77XX_RASET,   4, 0x00, 0x00, 0x01, 0x3F,  // 0..319
    0xDE,           1, 0x02,             //
    0xE5,           3, 0x00, 0x02, 0x00, //
    0xDE,           1, 0x00,             //
    ST77XX_INVON,   0,                   // IPS: inverted is correct
    ST77XX_DISPON,  JD9853_DELAY, 20};

class Adafruit_JD9853 : public Adafruit_ST77xx {
public:
  Adafruit_JD9853(int8_t cs, int8_t dc, int8_t rst)
      : Adafruit_ST77xx(172, 320, cs, dc, rst) {}

  void init(uint16_t width, uint16_t height, uint32_t freq = 0) {
    _width = width;
    _height = height;
    begin(freq);
    displayInit(jd9853_initcmds);
    setRotation(0);
  }

  /* The 172-wide window sits at RAM column 34, symmetric — the offset
     follows the native-X axis through every rotation. RGB order: the
     colour bit stays clear. */
  void setRotation(uint8_t m) {
    uint8_t madctl;
    rotation = m & 3;
    switch (rotation) {
      case 1:  madctl = ST77XX_MADCTL_MX | ST77XX_MADCTL_MV; break;
      case 2:  madctl = ST77XX_MADCTL_MX | ST77XX_MADCTL_MY; break;
      case 3:  madctl = ST77XX_MADCTL_MY | ST77XX_MADCTL_MV; break;
      default: madctl = 0;                                   break;
    }
    const bool swap = (rotation & 1) != 0;
    _width = swap ? 320 : 172;
    _height = swap ? 172 : 320;
    _xstart = swap ? 0 : 34;
    _ystart = swap ? 34 : 0;
    sendCommand(ST77XX_MADCTL, &madctl, 1);
  }
};
