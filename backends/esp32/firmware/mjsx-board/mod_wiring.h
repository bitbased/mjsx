#pragma once
/*
 * Module wiring: which compiled-in capabilities register with the
 * runtime registry (modules.h), and the thin start/tick/status glue for
 * each. Lives in a header ON PURPOSE: the Arduino prototype generator
 * mangles functions defined in the sketch when string literals confuse
 * its brace tracking, and headers are exempt from prototype generation
 * (same reason the dashboard page lives in a .cpp).
 *
 * What is COMPILED is present; what is REGISTERED can be started and
 * stopped from JS (sys.modCtl); everything modules produce arrives
 * asynchronously as state patches.
 */

String readerReport();
int readerProbeAll();

#if HAS_WIFI && MOD_PRINTER
static bool modPrinterStart() { printerRestore(); printerSubscribeStart(); return true; }
static void modPrinterTick() { printerNetStart(); }
static int modPrinterStatus(char *out, int cap) {
  return snprintf(out, cap, "\"link\":%s,\"ip\":\"%s\"",
                  printerLinkOpen() ? "true" : "false", g_printerIp);
}
#endif
static bool modRfidStart() { return readerProbeAll() >= 0; }
static int modRfidStatus(char *out, int cap) {
  String r = readerReport();
  return snprintf(out, cap, "\"readers\":\"%s\"", r.c_str());
}
/* local_modules.h -- native code you are working on but not committing,
   the same idea as local-examples/ for apps. Gitignored, picked up
   automatically when present, absent by default.
 
   Define anything you need and a `localModsSetup()`; it is called last, so
   a local module can also re-register over a shipped one. __has_include
   rather than a build flag, so dropping the file in is the whole step. */
#if defined(__has_include)
#if __has_include("local_modules.h")
#include "local_modules.h"
#define HAS_LOCAL_MODULES 1
#endif
#endif

static void modsSetup() {
#if HAS_WIFI && MOD_PRINTER
  modRegister("printer", true, modPrinterStart, nullptr, modPrinterTick, modPrinterStatus);
#endif
#if MOD_RFID
  modRegister("rfid", true, modRfidStart, nullptr, nullptr, modRfidStatus);
#endif
#if HAS_JS && HAS_DISPLAY
  modRegister("imu", false, imuStart, imuStop, imuTick, imuStatus);
#if MOD_CAMERA && HAS_DISPLAY
  /* manual start: initializing a sensor that may not be plugged in is
     the script's call, and the canvases only exist on display builds */
  modRegister("cam", false, camStart, camStop, camTick, camStatus, camCtl);
#endif
#endif
#ifdef HAS_LOCAL_MODULES
  localModsSetup();
#endif
}

