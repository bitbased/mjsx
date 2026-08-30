#pragma once
/*
 * Motion module: the QMI8658 the Waveshare boards carry on the shared I2C
 * bus, plus whatever magnetometer happens to be wired to it.
 *
 * The template for every sensor module: start() probes and configures
 * (honest failure if the part is absent), tick() reads on a timer and
 * pushes a state patch ONLY when the reading moved -- so a script
 * "subscribes" by doing sys.modCtl('imu','start') and rendering
 * UI.state.accel. Nothing blocks; nothing is delivered synchronously.
 *
 *   {"accel":{"x":-0.02,"y":0.98,"z":0.11},        g
 *    "gyro":{"x":0.4,"y":-1.2,"z":0.0},            degrees/second
 *    "temp":31.5,                                  celsius
 *    "mag":{"x":12.4,"y":-30.1,"z":44.0}}          microtesla
 *
 * WHAT IS ACTUALLY HERE, measured by scanning all four boards:
 *   1.69"  0x6B QMI8658 (+RTC 0x51)
 *   3.5"   0x6B QMI8658 (+codec, expander, PMU, touch, RTC)
 *   1.28"  0x6B QMI8658 (+touch 0x15)
 *   1.47"  no motion sensor at all -- start() says so rather than lying
 * None of them carries a magnetometer, so the mag support below is for a
 * part wired to the exposed pins. Its detection is real; its scaling is
 * from each datasheet and has NOT been checked against a physical part.
 * (0x7E answers an address scan on three boards but no register read --
 * 0x78..0x7F are reserved I2C addresses, so that is a scan artifact, not
 * a device.)
 */
#include <Wire.h>

static uint8_t g_imuAddr = 0;
static uint8_t g_magAddr = 0;
static const char *g_magName = "none";
static float g_magScale = 1.0f;   /* raw LSB -> microtesla */

static bool i2cWr(uint8_t addr, uint8_t reg, uint8_t val) {
  Wire.beginTransmission(addr);
  Wire.write(reg);
  Wire.write(val);
  return Wire.endTransmission() == 0;
}
static int i2cRd(uint8_t addr, uint8_t reg, uint8_t *buf, int n) {
  Wire.beginTransmission(addr);
  Wire.write(reg);
  if (Wire.endTransmission(false) != 0) return 0;
  int got = Wire.requestFrom((int)addr, n);
  for (int i = 0; i < got; i++) buf[i] = Wire.read();
  return got;
}
static bool imuWr(uint8_t reg, uint8_t val) { return i2cWr(g_imuAddr, reg, val); }
static int imuRd(uint8_t reg, uint8_t *buf, int n) { return i2cRd(g_imuAddr, reg, buf, n); }

/* ---- magnetometer ----------------------------------------------------
 *
 * Several parts, one shape: identify by a WHO_AM_I where the part has
 * one, put it in continuous mode, then read six little-endian bytes.
 * Each scale converts that part's LSB to MICROTESLA so the JS side never
 * has to know which chip answered.
 */
static bool magStart() {
  uint8_t v = 0;
  g_magAddr = 0;
  g_magName = "none";

  /* QMC5883L (0x0D): no reliable WHO_AM_I; the period register must be
     set to 0x01 and the mode register enables continuous 200Hz. */
  if (i2cRd(0x0D, 0x0D, &v, 1) == 1) {
    i2cWr(0x0D, 0x0B, 0x01);        /* SET/RESET period */
    i2cWr(0x0D, 0x09, 0x1D);        /* continuous, 200Hz, 8G, 512x */
    g_magAddr = 0x0D; g_magName = "QMC5883L";
    g_magScale = 100.0f / 12000.0f; /* 12000 LSB/gauss at 8G -> uT */
    return true;
  }
  /* HMC5883L (0x1E): identification register A..C reads 'H','4','3'. */
  if (i2cRd(0x1E, 0x0A, &v, 1) == 1 && v == 'H') {
    i2cWr(0x1E, 0x00, 0x70);        /* 8 averaged, 15Hz */
    i2cWr(0x1E, 0x01, 0x20);        /* gain 1.3Ga */
    i2cWr(0x1E, 0x02, 0x00);        /* continuous */
    g_magAddr = 0x1E; g_magName = "HMC5883L";
    g_magScale = 100.0f / 1090.0f;  /* 1090 LSB/gauss -> uT */
    return true;
  }
  /* LIS3MDL (0x1C or 0x1E): WHO_AM_I 0x0F reads 0x3D. */
  const uint8_t lis[2] = { 0x1C, 0x1E };
  for (int i = 0; i < 2; i++) {
    if (i2cRd(lis[i], 0x0F, &v, 1) == 1 && v == 0x3D) {
      i2cWr(lis[i], 0x20, 0x70);    /* ultra-high perf X/Y, 10Hz */
      i2cWr(lis[i], 0x21, 0x00);    /* +-4 gauss */
      i2cWr(lis[i], 0x22, 0x00);    /* continuous conversion */
      i2cWr(lis[i], 0x23, 0x0C);    /* ultra-high perf Z */
      g_magAddr = lis[i]; g_magName = "LIS3MDL";
      g_magScale = 100.0f / 6842.0f;
      return true;
    }
  }
  /* MLX90393 (0x0C..0x0F): a COMMAND part, not a register file. Start
     burst mode on X/Y/Z (0x1E), then every read returns status + axes. */
  for (uint8_t a = 0x0C; a <= 0x0F; a++) {
    Wire.beginTransmission(a);
    Wire.write(0x1E);               /* SB: start burst, ZYX */
    if (Wire.endTransmission() != 0) continue;
    delay(2);
    if (Wire.requestFrom((int)a, 1) == 1) {
      Wire.read();                  /* status byte */
      g_magAddr = a; g_magName = "MLX90393";
      g_magScale = 0.150f;          /* GAIN_SEL 7, RES 0, XY: 0.150 uT/LSB */
      return true;
    }
  }
  return false;
}

/* Fills x/y/z in microtesla. Returns false when there is no part or the
   read failed. */
static bool magRead(float *mx, float *my, float *mz) {
  if (!g_magAddr) return false;
  uint8_t d[7];
  int16_t rx, ry, rz;
  if (g_magName[0] == 'M') {                    /* MLX90393: RM, ZYX */
    Wire.beginTransmission(g_magAddr);
    Wire.write(0x4E);                           /* RM: read measurement */
    if (Wire.endTransmission() != 0) return false;
    if (Wire.requestFrom((int)g_magAddr, 7) != 7) return false;
    for (int i = 0; i < 7; i++) d[i] = Wire.read();
    rx = (int16_t)((d[1] << 8) | d[2]);         /* big-endian here */
    ry = (int16_t)((d[3] << 8) | d[4]);
    rz = (int16_t)((d[5] << 8) | d[6]);
  } else if (g_magName[0] == 'H') {             /* HMC5883L: X,Z,Y big-endian */
    if (i2cRd(g_magAddr, 0x03, d, 6) != 6) return false;
    rx = (int16_t)((d[0] << 8) | d[1]);
    rz = (int16_t)((d[2] << 8) | d[3]);
    ry = (int16_t)((d[4] << 8) | d[5]);
  } else {                                      /* QMC5883L / LIS3MDL */
    const uint8_t reg = (g_magAddr == 0x0D) ? 0x00 : 0x28;
    if (i2cRd(g_magAddr, reg, d, 6) != 6) return false;
    rx = (int16_t)(d[0] | (d[1] << 8));
    ry = (int16_t)(d[2] | (d[3] << 8));
    rz = (int16_t)(d[4] | (d[5] << 8));
  }
  *mx = rx * g_magScale;
  *my = ry * g_magScale;
  *mz = rz * g_magScale;
  return true;
}

/* ---- QMI8658 ---------------------------------------------------------
 *
 * Accelerometer AND gyroscope, plus the die temperature. The ranges are
 * the ones the scale factors below assume: change one, change the other.
 */
#define QMI_ACC_LSB_PER_G   16384.0f   /* CTRL2 +-2g   */
#define QMI_GYR_LSB_PER_DPS 64.0f      /* CTRL3 +-512dps */

static bool imuStart() {
  const uint8_t tryAddr[2] = { 0x6B, 0x6A };
  g_imuAddr = 0;
  for (int a = 0; a < 2; a++) {
    uint8_t who = 0;
    if (i2cRd(tryAddr[a], 0x00, &who, 1) == 1 && who == 0x05) {
      g_imuAddr = tryAddr[a];
      imuWr(0x02, 0x40);  // CTRL1: address auto-increment
      imuWr(0x03, 0x04);  // CTRL2: accel +-2g, 250Hz
      imuWr(0x04, 0x54);  // CTRL3: gyro +-512dps, 250Hz
      imuWr(0x08, 0x03);  // CTRL7: accel + gyro enable
      break;
    }
  }
  /* the magnetometer is independent: a board can have one without the
     other, and a missing IMU must not hide a mag that is present */
  magStart();
  return g_imuAddr != 0 || g_magAddr != 0;
}

static void imuStop() {
  if (g_imuAddr) imuWr(0x08, 0x00);
}

static void imuTick() {
  static uint32_t lastAt = 0;
  static int16_t lA[3] = { 32767, 32767, 32767 };
  static int16_t lG[3] = { 32767, 32767, 32767 };
  static float lastT = -999.0f;
  static float lM[3] = { 1e9f, 1e9f, 1e9f };
  if ((!g_imuAddr && !g_magAddr) || millis() - lastAt < 100) return;
  lastAt = millis();

  char j[240];
  int n = 0;
  bool any = false;
  n += snprintf(j + n, sizeof(j) - n, "{");

  if (g_imuAddr) {
    /* temperature (0x33) then accel (0x35) and gyro (0x3B) in one sweep --
       auto-increment is on, so it is a single 14-byte transaction */
    uint8_t d[14];
    if (imuRd(0x33, d, 14) == 14) {
      const int16_t t  = (int16_t)(d[0] | (d[1] << 8));
      const int16_t ax = (int16_t)(d[2] | (d[3] << 8));
      const int16_t ay = (int16_t)(d[4] | (d[5] << 8));
      const int16_t az = (int16_t)(d[6] | (d[7] << 8));
      const int16_t gx = (int16_t)(d[8] | (d[9] << 8));
      const int16_t gy = (int16_t)(d[10] | (d[11] << 8));
      const int16_t gz = (int16_t)(d[12] | (d[13] << 8));
      const float tc = t / 256.0f;

      /* Patch only on real movement, per signal: ~0.02g, ~2dps, 0.5C.
         An idle board should not be a message pump. */
      if (abs(ax - lA[0]) >= 320 || abs(ay - lA[1]) >= 320 || abs(az - lA[2]) >= 320) {
        lA[0] = ax; lA[1] = ay; lA[2] = az;
        n += snprintf(j + n, sizeof(j) - n,
                      "\"accel\":{\"x\":%.2f,\"y\":%.2f,\"z\":%.2f}",
                      ax / QMI_ACC_LSB_PER_G, ay / QMI_ACC_LSB_PER_G, az / QMI_ACC_LSB_PER_G);
        any = true;
      }
      if (abs(gx - lG[0]) >= 128 || abs(gy - lG[1]) >= 128 || abs(gz - lG[2]) >= 128) {
        lG[0] = gx; lG[1] = gy; lG[2] = gz;
        n += snprintf(j + n, sizeof(j) - n, "%s\"gyro\":{\"x\":%.1f,\"y\":%.1f,\"z\":%.1f}",
                      any ? "," : "",
                      gx / QMI_GYR_LSB_PER_DPS, gy / QMI_GYR_LSB_PER_DPS, gz / QMI_GYR_LSB_PER_DPS);
        any = true;
      }
      if (tc < lastT - 0.5f || tc > lastT + 0.5f) {
        lastT = tc;
        n += snprintf(j + n, sizeof(j) - n, "%s\"temp\":%.1f", any ? "," : "", tc);
        any = true;
      }
    }
  }

  if (g_magAddr) {
    float mx, my, mz;
    if (magRead(&mx, &my, &mz)) {
      const float dx = mx - lM[0], dy = my - lM[1], dz = mz - lM[2];
      if (dx * dx + dy * dy + dz * dz > 1.0f) {   /* ~1uT of change */
        lM[0] = mx; lM[1] = my; lM[2] = mz;
        n += snprintf(j + n, sizeof(j) - n, "%s\"mag\":{\"x\":%.1f,\"y\":%.1f,\"z\":%.1f}",
                      any ? "," : "", mx, my, mz);
        any = true;
      }
    }
  }

  if (!any) return;
  snprintf(j + n, sizeof(j) - n, "}");
  jsQueueState(String(j));
}

static int imuStatus(char *out, int cap) {
  return snprintf(out, cap,
                  "\"addr\":%d,\"imu\":\"%s\",\"gyro\":%s,\"magAddr\":%d,\"mag\":\"%s\"",
                  (int)g_imuAddr, g_imuAddr ? "QMI8658" : "none",
                  g_imuAddr ? "true" : "false", (int)g_magAddr, g_magName);
}
