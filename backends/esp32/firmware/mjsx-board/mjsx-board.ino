/*
 * mjsx-board — the reference firmware for running mjsx on ESP32-S3 glass.
 *
 * This is the whole thing: panel driver, touch, WiFi, OTA, mDNS, the web
 * server, the :8765 push server that takes a pushed JS bundle, the :81 op
 * stream, and the MicroQuickJS engine with mjsx's native surface bound to
 * it. A board flashed with this needs nothing else from this repo but a
 * bundle, and nothing at all from any other repo.
 *
 * It descends from an earlier NFC-bridge firmware, which is where the
 * display substrate and the push protocol were built. That project is
 * unrelated to mjsx and is not a dependency: everything mjsx needs was
 * brought here, and THIS copy is the source of truth. Do not sync changes
 * back and forth with it.
 *
 * Wire protocol on :8765 and USB serial, line-delimited JSON:
 *   Requests : {"i":<id>,"c":"<cmd>",...}\n
 *   Responses: {"i":<id>,"ok":true,...}\n  or  {"i":<id>,"ok":false,"err":"..."}\n
 *
 * Libraries: ArduinoJson (v7). Board: ESP32-S3.
 * Build: see README.md — one arduino-cli line per panel.
 */

#include "config.h"
#include "ui.h"
#include "js.h"

#include <ArduinoJson.h>

#if defined(ESP32)
#include <WiFi.h>
#include <ArduinoOTA.h>
#include <ESPmDNS.h>
#include <WebServer.h>
// The software JPEG encoder from esp32-camera. Already linked into every
// ESP32-S3 sketch by the core, so this costs a declaration and nothing else.
#include "esp_camera.h"

/* JPEG view of a source for remote pulls, re-encoded ONLY when the
   generation moves: op 10's gen is the invalidation signal, so a viewer
   fetches /canvas?id=N exactly when it sees a gen it lacks -- pull on
   change, no idle streaming, high-rate sources self-throttle. */
/* Stream encoding knobs, shared by every viewer (frames fan out):
   quality 25..95 and resolution full/half/auto. /canvasq sets them; the
   JPEG cache drops so the next frame re-encodes and re-sends. */
static uint8_t g_cvQ = 80;
static uint8_t g_cvHalfMode = 0;   /* 0 auto (>100k px), 1 half, 2 full */
static uint8_t *g_cvJbuf[CV_MAX] = { 0 };
static size_t g_cvJlen[CV_MAX] = { 0 };
static uint16_t g_cvJgen[CV_MAX];
static bool g_cvJhave[CV_MAX] = { false };
static void cvJpegDrop() {
  for (int i = 0; i < CV_MAX; i++) g_cvJhave[i] = false;
}

static bool cvJpeg(int id, uint8_t **out, size_t *outLen, uint16_t *outGen) {
  if (!cvOk(id)) return false;
  CanvasSrc &c = g_cv[id];
  uint8_t **jbuf = g_cvJbuf;
  size_t *jlen = g_cvJlen;
  uint16_t *jgen = g_cvJgen;
  bool *jhave = g_cvJhave;
  if (!jhave[id] || jgen[id] != c.gen) {
    if (jbuf[id]) { free(jbuf[id]); jbuf[id] = nullptr; }
    uint8_t *j = nullptr;
    size_t n = 0;
    // fmt2jpg wants BIG-ENDIAN RGB565 (same dance as /screen.jpg):
    // swap into a snapshot, encode, free. LARGE sources encode at HALF
    // resolution -- the glass stays full-res, the stream gets a 4x
    // cheaper picture (125ms -> 34ms measured on 480x280), and viewers
    // scale any source size into the blit rect anyway.
    const bool half = g_cvHalfMode == 1 ||
                      (g_cvHalfMode == 0 && (size_t)c.w * c.h > 100000);
    const int ew = half ? c.w / 2 : c.w, eh = half ? c.h / 2 : c.h;
    const size_t px = (size_t)ew * eh;
    uint16_t *swp = (uint16_t *)heap_caps_malloc(px * 2, MALLOC_CAP_SPIRAM);
    if (!swp) return false;
    for (int yy = 0; yy < eh; yy++) {
      const uint16_t *src = c.buf + (size_t)(half ? yy * 2 : yy) * c.w;
      uint16_t *dst = swp + (size_t)yy * ew;
      for (int xx = 0; xx < ew; xx++) {
        const uint16_t v = src[half ? xx * 2 : xx];
        dst[xx] = (uint16_t)((v >> 8) | (v << 8));
      }
    }
    const bool ok = fmt2jpg((uint8_t *)swp, px * 2, ew, eh,
                            PIXFORMAT_RGB565, g_cvQ, &j, &n);
    heap_caps_free(swp);
    if (!ok) return false;
    jbuf[id] = j;
    jlen[id] = n;
    jgen[id] = c.gen;
    jhave[id] = true;
  }
  *out = jbuf[id];
  *outLen = jlen[id];
  *outGen = jgen[id];
  return true;
}

#include <Update.h>
#define HAS_WIFI 1
#elif defined(ESP8266)
#include <ESP8266WiFi.h>
#define HAS_WIFI 1
#else
#define HAS_WIFI 0
#endif

/* net.fetch needs an HTTP client; the old firmware got one transitively
   through its printer module, which does not belong here. */
#if HAS_WIFI
#include <HTTPClient.h>
#endif
#include "modules.h"
#if HAS_JS && HAS_DISPLAY
#include "mod_imu.h"
#endif
#include "mod_wiring.h"

/* No NFC readers. The board this firmware descends from drove PN532s;
   an mjsx board drives a panel. The two symbols the rest of the sketch
   still asks for are answered here so /info keeps its shape. */
#define READER_COUNT 0
#define SIMULATE_READER 0


#if HAS_WIFI
WiFiServer tcpServer(TCP_PORT);
WiFiClient tcpClient;

/**
 * A small HTTP face on port 80.
 *
 * The line protocol on TCP_PORT is what the app speaks, but it is invisible to
 * anything else. Port 80 means the board answers a browser: point at it and you
 * get its status, which is the fastest way to tell whether it is on the network
 * and what it thinks it is holding. It is also the obvious hook for scripting
 * later.
 */
WebServer http(80);

// One tag per compile: versions the served JS assets so browsers can
// never pair a fresh page with a stale cached rasterizer.
#define FW_BUILD_TAG (__DATE__ + 7)  /* placeholder, replaced below */
#undef FW_BUILD_TAG
static String fwBuildTag() {
  String v;
  const char *d = __DATE__ __TIME__;
  for (const char *c = d; *c; c++) if (isalnum((int)*c)) v += *c;
  return v;
}
#define FW_BUILD_TAG fwBuildTag()


#if HAS_DISPLAY
// ---- MJPEG stream (port 81) ----
//
// Low priority and pinned away from the UI worker: encoding is CPU-bound and a
// viewer should never make the device itself feel slow. WiFi's own tasks run
// well above this one, so throughput is not at its mercy either.
static WiFiServer streamServer(81);

static int streamArg(const String &req, const char *key, int dflt) {
  int at = req.indexOf(String(key) + "=");
  if (at < 0) return dflt;
  return req.substring(at + strlen(key) + 1).toInt();
}

/**
 * The op PUSH stream, MULTI-CLIENT: every viewer that GETs /ops on this
 * port is registered (up to 4; the oldest yields past that) and each
 * published frame is taken ONCE and fanned out -- so a second browser
 * tab no longer preempts the first into a reconnect ping-pong. Idle
 * streams get a 6-byte heartbeat ('F','R',len 0) every 1.5s, which
 * keeps NATs and browsers from reaping a quiet connection; viewers
 * ignore zero-length frames.
 */
#define OPS_MAXC 4
static WiFiClient g_opsC[OPS_MAXC];
static uint32_t g_opsSeen[OPS_MAXC];
static uint32_t g_opsBeat[OPS_MAXC];
static bool g_opsLog = false;   /* any current viewer asked for log ops */

static void opsAdd(WiFiClient &c) {
#if HAS_JS
  int slot = -1;
  for (int i = 0; i < OPS_MAXC; i++)
    if (!g_opsC[i] || !g_opsC[i].connected()) { slot = i; break; }
  if (slot < 0) { slot = 0; g_opsC[0].stop(); }
  c.print(F("HTTP/1.1 200 OK\r\n"
            "Content-Type: application/octet-stream\r\n"
            "Cache-Control: no-store\r\n"
            "Access-Control-Allow-Origin: *\r\n"
            "Connection: close\r\n\r\n"));
  g_opsC[slot] = c;
  g_opsSeen[slot] = opGen() - 1;   /* whatever is published goes first */
  g_opsBeat[slot] = millis();
  cvReemit();                      /* canvas pixels re-sent for the newcomer */
  opArm();
  jsQueueState("{}");              /* nudge: a frame without waiting for one */
#else
  c.stop();
#endif
}

static void opsPump() {
#if HAS_JS
  static uint8_t *buf = nullptr;   /* PSRAM: internal RAM is WiFi's */
  static uint32_t bufGen = 0, bufLen = 0;
  bool any = false;
  for (int i = 0; i < OPS_MAXC; i++) {
    if (g_opsC[i] && !g_opsC[i].connected()) g_opsC[i].stop();
    if (g_opsC[i] && g_opsC[i].connected()) any = true;
  }
  /* the flag is shared by every viewer, so it must not outlive them: the
     last one to leave turns the console back off */
  if (!any) { g_opsLog = false; return; }
  if (!buf) buf = (uint8_t *)ps_malloc(OPREC_CAP);
  if (!buf) return;
  static uint32_t pokeAt = 0;
  const uint32_t now = millis();
  if (now - pokeAt > 2000) {
    pokeAt = now;
    uiPoke();                      /* a watched screen is a looked-at screen */
    opArm();                       /* and a WATCHED stream: keeps the canvas
                                      chunk emitter's viewer gate open */
    if (g_opsLog) logArm();        /* ditto the console, if one asked for it */
  }
  /* A console line needs a frame to ride out on, and an idle UI makes
     none. Nudge one so a line logged on a still screen still arrives;
     the frame that results drains the queue, so this settles at once. */
  if (g_opsLog && opLogPending()) {
    static uint32_t logPokeAt = 0;
    if (now - logPokeAt > 150) { logPokeAt = now; jsQueueState("{}"); }
  }
  if (opGen() != bufGen) {
    uint32_t g2 = bufGen;          /* take ONCE for every viewer */
    const uint32_t n = opTakeNew(buf, OPREC_CAP, &g2);
    if (n) { bufGen = g2; bufLen = n; }
  }
  for (int i = 0; i < OPS_MAXC; i++) {
    WiFiClient &c = g_opsC[i];
    if (!c || !c.connected()) continue;
    if (bufLen && g_opsSeen[i] != bufGen) {
      uint8_t hdr[6] = { 'F', 'R', (uint8_t)bufLen, (uint8_t)(bufLen >> 8),
                         (uint8_t)(bufLen >> 16), (uint8_t)(bufLen >> 24) };
      if (c.write(hdr, 6) != 6 || c.write(buf, bufLen) != bufLen) { c.stop(); continue; }
      g_opsSeen[i] = bufGen;
      g_opsBeat[i] = now;
    } else if (now - g_opsBeat[i] > 1500) {
      uint8_t hb[6] = { 'F', 'R', 0, 0, 0, 0 };
      if (c.write(hb, 6) != 6) { c.stop(); continue; }
      g_opsBeat[i] = now;
    }
  }
#endif
}

static void streamTask(void *arg) {
  (void)arg;
  streamServer.begin();
  streamServer.setNoDelay(true);

  for (;;) {
    opsPump();
    WiFiClient c = streamServer.available();
    if (!c) { delay(10); continue; }

    // Browsers open SPECULATIVE sockets that never carry a request: wait
    // briefly for bytes and discard the silent ones, or they would be
    // mistaken for viewers (and previously PREEMPTED the live stream).
    {
      const uint32_t t0 = millis();
      while (c.connected() && !c.available() && millis() - t0 < 300) {
        delay(10);
        opsPump();
      }
      if (!c.available()) { c.stop(); continue; }
    }
    // Just the request line: the parameters live there and nothing else here
    // needs a header. The rest is drained so the client is not left blocked.
    String req = c.readStringUntil('\n');
    while (c.connected() && c.available()) {
      String h = c.readStringUntil('\n');
      if (h.length() <= 1) break;
    }

    if (req.startsWith("GET /ops")) {
      if (streamArg(req, "log", 0)) { g_opsLog = true; logArm(); }
      opsAdd(c);
      continue;
    }

    const int q = streamArg(req, "q", 45);
    // Full resolution unless asked otherwise. Halving is the last thing to
    // give up, not the first: on a 240x280 UI the text survives a hard JPEG
    // squeeze and does not survive losing every other pixel. Measured on this
    // panel — full res at q25 is 7.1 kB and readable; half res at q50 is 4.0 kB
    // and is not. Three kilobytes is not worth a picture you cannot read.
    const bool half = streamArg(req, "half", 0) != 0;
    const int fps = streamArg(req, "fps", 0);   // 0 = as fast as it manages

    c.print(F("HTTP/1.1 200 OK\r\n"
              "Content-Type: multipart/x-mixed-replace; boundary=frame\r\n"
              "Cache-Control: no-store\r\n"
              "Connection: close\r\n\r\n"));

    const int stride = half ? 2 : 1;
    int w = 0, h = 0;
    uiFrame(w, h);
    uint8_t *src = w ? (uint8_t *)heap_caps_malloc((size_t)(w / stride) * (h / stride) * 2,
                                                   MALLOC_CAP_SPIRAM)
                     : nullptr;

    uint32_t nextAt = millis();
    while (c.connected() && src) {
      // A viewer that changes quality or rate opens a new stream, and the old
      // one may take a frame or two to notice it has been abandoned. Yield to
      // whoever is waiting rather than making them queue behind a connection
      // nobody is reading — the newest request is the one that reflects what
      // the user just asked for.
      if (streamServer.hasClient()) break;
      opsPump();
      if (fps > 0) {
        const uint32_t now = millis();
        if (now < nextAt) { delay(nextAt - now); }
        nextAt = millis() + 1000 / fps;
      }

      int ow = 0, oh = 0;
      if (!uiFrameCopy(src, stride, true, ow, oh)) { delay(100); continue; }

      uint8_t *jpg = nullptr;
      size_t len = 0;
      if (!fmt2jpg(src, (size_t)ow * oh * 2, ow, oh, PIXFORMAT_RGB565, (uint8_t)q, &jpg, &len)) {
        break;
      }
      c.printf("--frame\r\nContent-Type: image/jpeg\r\nContent-Length: %u\r\n\r\n", (unsigned)len);
      const size_t sent = c.write(jpg, len);
      c.print(F("\r\n"));
      free(jpg);
      if (sent != len) break;   // the viewer went away mid-frame
    }
    if (src) heap_caps_free(src);
    c.stop();
  }
}
#else
static void streamTask(void *arg) { (void)arg; vTaskDelete(nullptr); }
#endif

// The /display viewer page lives in its own header: the Arduino
// preprocessor scans .ino files for function definitions to auto-declare,
// and the JavaScript inside a raw string looks enough like C++ to derail it.
#include "display_html.h"
#include "remote_html.h"
#include "remote_assets.h"



#endif

// Cached UID from the most recent successful scan, per reader (auth needs it).
// Kept separate because the two readers hold different tags at the same time.
/**
 * Ask one slot whether anything is there.
 *
 * Every slot is compiled in whether or not a module is wired to it, so this is
 * how the board finds out what it actually has — at boot, and again whenever
 * asked, which is what makes wiring a reader a matter of plugging it in rather
 * than of reflashing.
 */
/* No NFC readers on an mjsx board. /info keeps the field so an existing
   host tool that reads it does not have to special-case this firmware. */
int readerProbeAll() { return 0; }
String readerReport() { return String("none"); }


static const char *FW_VERSION = "0.1.0";

// ---------- helpers ----------
static void hexToBytes(const char *hex, uint8_t *out, size_t outLen) {
  for (size_t i = 0; i < outLen; i++) {
    char h[3] = {hex[i * 2], hex[i * 2 + 1], 0};
    out[i] = (uint8_t)strtol(h, nullptr, 16);
  }
}

static void bytesToHex(const uint8_t *in, size_t len, char *out) {
  static const char *H = "0123456789ABCDEF";
  for (size_t i = 0; i < len; i++) {
    out[i * 2] = H[in[i] >> 4];
    out[i * 2 + 1] = H[in[i] & 0x0F];
  }
  out[len * 2] = 0;
}

static void beep(bool ok) {
#if defined(BUZZER_PIN) && (BUZZER_PIN >= 0)
  tone(BUZZER_PIN, ok ? 1000 : 400, ok ? 120 : 250);
#endif
}

// ui.h forwards sys.beep here; the buzzer helper lives just above. Defined
// after the includes — a definition above them makes the Arduino preprocessor
// hoist every auto-prototype to that point, ahead of the types they mention.
void beepHook(bool ok) { beep(ok); }

/* Any pitch, for scripts. sys.beep has two tones and a meaning attached to
   each; this has neither, which is what a script wants when it is playing a
   sequence rather than reporting an outcome. */
void toneHook(int freq, int ms) {
#if defined(BUZZER_PIN) && (BUZZER_PIN >= 0)
  if (freq > 0 && ms > 0) tone(BUZZER_PIN, (unsigned)freq, (unsigned long)ms);
#else
  (void)freq; (void)ms;
#endif
}

/**
 * Our own prototypes, because the Arduino ones come out wrong.
 *
 * The preprocessor writes a declaration for every function in a .ino, and its
 * generator tracks `extern "C"` across the whole preprocessed sketch — headers
 * included. Once that state sticks it applies to everything after, so these
 * came out as `static extern "C" void sendJson(...)`, which is not a thing, and
 * setup/loop came out with C linkage. A function that already has a prototype
 * is left alone, which is the whole fix.
 */
void setup();
void loop();
static void sendJson(Stream &out, JsonDocument &doc);
static bool rdAuth(int r, int block, uint8_t keyNum, const uint8_t *key);
static void handleLine(Stream &out, const String &line);
static void pumpStream(Stream &in, Stream &out, String &buf);

// The C-ABI natives the script engine calls live in their own header.
//
// Not for tidiness: the Arduino preprocessor generates prototypes for every
// function in a .ino, and its generator carries `extern "C"` state past the end
// of a block — so the first static function after this one came out declared
// `static extern "C"`, which is not a thing. Headers are not scanned.
#include "natives.h"

static void sendJson(Stream &out, JsonDocument &doc) {
  serializeJson(doc, out);
  out.print('\n');
}

// ---------- command handlers ----------
/** Bridge activity counters, readable over HTTP even when TCP is wedged. */
static uint32_t g_linesIn = 0, g_repliesOut = 0;
static char g_lastCmd[16] = "";

static void handleLine(Stream &out, const String &line) {
  g_linesIn++;
  JsonDocument req;
  DeserializationError err = deserializeJson(req, line);
  JsonDocument res;
  if (err) {
    res["ok"] = false;
    res["err"] = "bad json";
    sendJson(out, res);
    return;
  }

  int id = req["i"] | 0;
  const char *cmd = req["c"] | "";
  res["i"] = id;

  // Which reader this request is for. Absent means reader 0, so a host that
  // knows nothing about dual boards keeps working unchanged.
  int r = req["r"] | 0;
  (void)r;
#if MOD_RFID
  // Bounds-checked only when the RFID module is compiled in. Unguarded, with
  // no readers present, this rejected EVERY command on the board -- `fput`
  // included, so a bundle could not be pushed at all.
  if (r < 0 || r >= READER_COUNT) {
    res["ok"] = false;
    res["err"] = "no such reader";
    sendJson(out, res);
    return;
  }
#endif
  if (!strcmp(cmd, "info")) {
    res["ok"] = true;
    res["fw"] = FW_VERSION;
    res["reader"] = "none";
    // How many readers this board presents, so the host can offer dual mode
    // over a single connection.
    res["readers"] = READER_COUNT;
    res["js"] = HAS_JS ? true : false;
    res["display"] = HAS_DISPLAY ? true : false;
#if HAS_WIFI
    res["ip"] = WiFi.localIP().toString();
#endif

  } else if (!strcmp(cmd, "disp")) {
    // The host knows what a tag means; the bridge only knows how to draw it.
    // {"c":"disp","r":0,"label":"Creality Hyper PLA","color":"FF6600"}
    const char *label = req["label"] | (const char *)nullptr;
    const char *color = req["color"] | (const char *)nullptr;
    const char *link = req["link"] | (const char *)nullptr;
    uiSetLabel(r, label, color, req["clear"] | false);
#if HAS_JS
    {
      char j[160];
      snprintf(j, sizeof(j), "{\"readerPatch\":{\"n\":%d,\"label\":\"%s\",\"color\":%ld}}",
               r, label ? label : "", color && strlen(color) >= 6 ? strtol(color, nullptr, 16) : -1);
      jsQueueState(String(j));
    }
#endif
    if (link) uiSetLink(link);
    res["ok"] = true;
    res["display"] = HAS_DISPLAY ? true : false;


  } else if (!strcmp(cmd, "touch")) {
    // Is the controller answering at all, and does the mapping agree with what
    // was pressed? Raw and mapped together tell those apart.
    res["ok"] = true;
    res["count"] = uiTouchCount();
    res["rawX"] = uiTouchRawX();
    res["rawY"] = uiTouchRawY();
    res["x"] = uiTouchX();
    res["y"] = uiTouchY();
    res["page"] = uiPage();
    res["rot"] = uiRot();
    // Tells "the chip is not answering" apart from "nobody is touching it".
    res["busError"] = uiTouchBusError();

  } else if (!strcmp(cmd, "i2c")) {
    // {"c":"i2c"} scans the configured pins; {"c":"i2c","sda":10,"scl":11}
    // tries another pair, which is how a swapped pinout gets ruled out.
    char found[96];
    const int sda = req["sda"] | TOUCH_SDA;
    const int scl = req["scl"] | TOUCH_SCL;
    const int n = uiI2cScan(sda, scl, found, sizeof(found));
    uiI2cRestore();
    res["ok"] = true;
    res["sda"] = sda;
    res["scl"] = scl;
    res["count"] = n;
    res["addrs"] = found;
    if (n < 0) res["err"] = "those pins belong to the display";

  } else if (!strcmp(cmd, "reg")) {
    // One byte of a device on the shared I2C bus, read or written:
    //   {"c":"reg","addr":52,"reg":105}          read
    //   {"c":"reg","addr":52,"reg":105,"val":5}  write
    // A bring-up tool: the AXP2101 CHGLED hunt went through this.
    const uint8_t addr = (uint8_t)(req["addr"] | 0);
    const uint8_t r = (uint8_t)(req["reg"] | 0);
    Wire.beginTransmission(addr);
    Wire.write(r);
    if (!req["val"].isNull()) {
      Wire.write((uint8_t)(req["val"] | 0));
      res["ok"] = Wire.endTransmission() == 0;
    } else if (Wire.endTransmission(false) == 0 &&
               Wire.requestFrom(addr, (uint8_t)1) == 1) {
      res["ok"] = true;
      res["val"] = Wire.read();
    } else {
      res["ok"] = false;
      res["err"] = "no answer";
    }

  } else if (!strcmp(cmd, "tprobe")) {
    // {"c":"tprobe","addr":21} — reset the touch chip and see who answers.
    char detail[96];
    const uint8_t addr = (uint8_t)(req["addr"] | TOUCH_ADDR);
    const int rst = req["rst"] | TOUCH_RST;
    uiTouchProbe(addr, rst, detail, sizeof(detail));
    char found[96];
    uiI2cScan(TOUCH_SDA, TOUCH_SCL, found, sizeof(found));
    uiI2cRestore();
    res["ok"] = true;
    res["addr"] = addr;
    res["rst"] = rst;
    res["detail"] = detail;
    res["afterReset"] = found;

  } else if (!strcmp(cmd, "calib")) {
    // {"c":"calib"} starts it; {"c":"calib","read":true} collects the result.
    if (req["read"] | false) {
      res["ok"] = true;
      res["done"] = uiCalibDone();
      JsonArray pts = res["points"].to<JsonArray>();
      for (int i = 0; i < 4; i++) {
        int tx, ty;
        uiCalibTarget(i, tx, ty);
        JsonObject o = pts.add<JsonObject>();
        o["targetX"] = tx;
        o["targetY"] = ty;
        o["rawX"] = uiCalibRawX(i);
        o["rawY"] = uiCalibRawY(i);
      }
    } else {
      uiCalibStart();
      res["ok"] = true;
      res["note"] = "tap the four targets";
    }

  } else if (!strcmp(cmd, "eval")) {
    // Starts the script and answers immediately; collect it with "jsresult".
    // {"c":"eval","js":"1+1"}
    const char *src = req["js"] | "";
    if (!src[0]) {
      res["ok"] = false;
      res["err"] = "no js";
    } else if (!jsEvalStart(src)) {
      res["ok"] = false;
      res["err"] = "a script is already running";
    } else {
      res["ok"] = true;
      res["started"] = true;
    }

  } else if (!strcmp(cmd, "fput")) {
    // Store a script chunk. {"c":"fput","name":"/app.js","b64":"...","first":true}
#if HAS_JS
    String err;
    if (jsFilePut(req["name"] | "/app.js", req["b64"] | "", req["first"] | false, err)) {
      res["ok"] = true;
    } else {
      res["ok"] = false;
      res["err"] = err;
    }
#else
    res["ok"] = false; res["err"] = "built without JS";
#endif

  } else if (!strcmp(cmd, "frun")) {
    // Run a stored script on the worker; result via jsresult. The script owns
    // the screen from then on if it defines UI.
#if HAS_JS
    String marker = String("\x03run:") + (req["name"] | "/app.js");
    if (jsEvalStart(marker.c_str())) res["ok"] = true;
    else { res["ok"] = false; res["err"] = "busy"; }
#else
    res["ok"] = false; res["err"] = "built without JS";
#endif

  } else if (!strcmp(cmd, "uioff")) {
    // Hand the screen back to the native pages.
#if HAS_JS
    g_jsUiActive = false;
    uiSetExternal(false, nullptr);
    res["ok"] = true;
#else
    res["ok"] = false; res["err"] = "built without JS";
#endif

  } else if (!strcmp(cmd, "wifi")) {
    // Provision over the wire: {"c":"wifi","ssid":"...","pass":"..."}
    // saves the credentials the same place the touch flow does and
    // reboots into them. A fresh board on a USB cable should not depend
    // on typing a passphrase into whatever glass it happens to carry --
    // the round display made that vivid.
    const char *ssid = req["ssid"] | (const char *)nullptr;
    if (!ssid || !*ssid) {
      res["ok"] = false;
      res["err"] = "need ssid";
    } else {
      Preferences pf;
      pf.begin("filrfid", false);
      pf.putString("ssid", ssid);
      pf.putString("pass", req["pass"] | "");
      pf.end();
      res["ok"] = true;
      res["rebooting"] = true;
      sendJson(out, res);
      delay(150);
      ESP.restart();
      return;
    }

  } else if (!strcmp(cmd, "wifiget")) {
    // The stored credentials — over PHYSICAL USB serial only, never the
    // network. Holding the cable is owning the box; asking over TCP is
    // not. Exists so one board can hand its network to the next without
    // a passphrase ever crossing a keyboard or the air.
    if (&out != (Stream *)&Serial) {
      res["ok"] = false;
      res["err"] = "usb serial only";
    } else {
      Preferences pf;
      pf.begin("filrfid", true);
      res["ok"] = true;
      res["ssid"] = pf.getString("ssid", "");
      res["pass"] = pf.getString("pass", "");
      pf.end();
    }

  } else if (!strcmp(cmd, "rescue")) {
    // The BOOT-button rescue, reachable over the wire: stop the script
    // through its own exit channel and show the native wifi flow. Unlike
    // `uioff`, the still-running app cannot re-grab the screen afterwards.
    // A reboot brings the app back.
#if HAS_JS && HAS_DISPLAY
    sysNExit();
    uiRescue();
    res["ok"] = true;
#else
    res["ok"] = false; res["err"] = "needs JS and a display";
#endif

  } else if (!strcmp(cmd, "jstest")) {
    // Kick off the built-in suite; read it back with jsresult.
    if (!jsEvalStart("\x02selftest")) {
      res["ok"] = false;
      res["err"] = "busy";
    } else {
      res["ok"] = true;
    }

  } else if (!strcmp(cmd, "jsresult")) {
    res["ok"] = true;
    res["busy"] = jsBusy();
    res["ready"] = jsHasResult();
    if (jsHasResult()) {
      res["success"] = jsResultOk();
      res["value"] = jsResult();
      if (jsLog().length()) res["log"] = jsLog();
    }

  } else if (!strcmp(cmd, "jsinfo")) {
    // Start the engine without running anything, so a failure to allocate is
    // told apart from a failure to evaluate.
    // Deliberately does NOT evaluate: starting the engine and running a script
    // are separate failures, and a hang in one must not hide the other.
    res["freePsram"] = jsFreePsram();
    res["ok"] = true;
    res["started"] = jsReady();
    res["ready"] = jsReady();
    res["heapFrom"] = jsWhere();

  } else if (!strcmp(cmd, "jsstat")) {
    // How far the last eval got. Readable after an eval that never answered.
    res["ok"] = true;
    res["enter"] = jsStage(0);
    res["taskCreated"] = jsStage(1);
    res["taskRan"] = jsStage(2);
    res["evaluated"] = jsStage(3);
    res["finished"] = jsStage(4);
    res["timedOut"] = jsStage(5);
    res["freeInternal"] = ESP.getFreeHeap();
    res["msBegin"] = jsMsBegin();
    res["msEval"] = jsMsEval();
    res["msTotal"] = jsMsTotal();

  } else if (!strcmp(cmd, "jsreset")) {
    jsReset();
    res["ok"] = true;

  } else if (!strcmp(cmd, "reboot")) {
    res["ok"] = true;
    sendJson(out, res);
    delay(150);
    ESP.restart();
    return;

  } else if (!strcmp(cmd, "tprobe")) {
    // {"c":"tprobe","addr":21} — reset the touch chip and see who answers.
    char detail[96];
    const uint8_t addr = (uint8_t)(req["addr"] | TOUCH_ADDR);
    const int rst = req["rst"] | TOUCH_RST;
    uiTouchProbe(addr, rst, detail, sizeof(detail));
    char found[96];
    uiI2cScan(TOUCH_SDA, TOUCH_SCL, found, sizeof(found));
    uiI2cRestore();
    res["ok"] = true;
    res["addr"] = addr;
    res["rst"] = rst;
    res["detail"] = detail;
    res["afterReset"] = found;

  } else if (!strcmp(cmd, "beep")) {
    const char *kind = req["kind"] | "ok";
    beep(!strcmp(kind, "ok"));
    res["ok"] = true;

  } else {
    res["ok"] = false;
    res["err"] = "unknown command";
  }

  snprintf(g_lastCmd, sizeof(g_lastCmd), "%s", cmd);
  sendJson(out, res);
  g_repliesOut++;
}

// Accumulate bytes per input source and dispatch on newline.
static String serialBuf;
#if HAS_WIFI
static String tcpBuf;
#endif

static void pumpStream(Stream &in, Stream &out, String &buf) {
  while (in.available()) {
    char c = (char)in.read();
    if (c == '\n') {
      String line = buf;
      buf = "";
      line.trim();
      if (line.length()) handleLine(out, line);
    } else if (c != '\r') {
      buf += c;
      if (buf.length() > 8192) buf = ""; // uploads carry ~1 KB base64 lines
    }
  }
}

void setup() {
  // Locks first: everything below may start a task, and a mutex created after
  // the tasks that share it is not shared.
  jsQueueInit();
  Serial.begin(SERIAL_BAUD);
  delay(200);
  uiBegin();
#if HAS_JS
#if defined(ROUND_DISPLAY) && ROUND_DISPLAY
  {
    // The bundle asks configStorage whether the glass is round; the
    // host answers once, through the same store (UI.isRound()).
    Preferences pf;
    pf.begin("jsapp", false);
    if (pf.getString("round", "") != "1") pf.putString("round", "1");
    pf.end();
  }
#endif
  // A stored UI script survives reboots and takes the screen on its own.
  if (jsFsBegin() && LittleFS.exists("/app.js")) jsEvalStart("\x03run:/app.js");
#endif
  modsSetup();

#if defined(STATUS_LED_PIN) && (STATUS_LED_PIN >= 0)
  pinMode(STATUS_LED_PIN, OUTPUT);
#endif

#if LED_QUIET
  // Park the board's own LEDs dark: an ignored active-low LED glows and
  // an ignored WS2812 flickers with line noise. See config.h.
#if defined(LED_OFF_PIN) && (LED_OFF_PIN >= 0)
  pinMode(LED_OFF_PIN, OUTPUT);
  digitalWrite(LED_OFF_PIN, LED_OFF_LEVEL);
#endif
#if defined(LED_RGB_PIN) && (LED_RGB_PIN >= 0)
#if defined(ESP_ARDUINO_VERSION) && ESP_ARDUINO_VERSION >= ESP_ARDUINO_VERSION_VAL(3, 0, 0)
  rgbLedWrite(LED_RGB_PIN, 0, 0, 0);
#else
  neopixelWrite(LED_RGB_PIN, 0, 0, 0);
#endif
#endif
#endif


#if HAS_WIFI
  // Credentials chosen on the screen outlive a reflash and take precedence
  // over anything compiled in, which is the point of setting them there.
  char ssid[33] = WIFI_SSID;
  char pass[65] = WIFI_PASS;
  uiWifiRestore(ssid, sizeof(ssid), pass, sizeof(pass));

  if (strlen(ssid) > 0) {
    WiFi.mode(WIFI_STA);
#if defined(ESP32)
    WiFi.setHostname(WIFI_HOSTNAME);
#endif
    WiFi.begin(ssid, pass);
    // Modem sleep is on by default and parks the radio between DTIM beacons,
    // which turns every request into a wait for the next one. Measured against
    // the same printer: a host on the same network answers in ~30 ms while the
    // board took 4-9 s for the identical request. This is a mains-powered
    // bridge, so trade the milliamps for latency.
    WiFi.setSleep(false);
    unsigned long start = millis();
    while (WiFi.status() != WL_CONNECTED && millis() - start < 15000) {
      delay(250);
      uiTick();
    }
    if (WiFi.status() == WL_CONNECTED) {
      // Again, now that association has actually happened.
      //
      // Setting it before connecting is not reliably kept: the 3.5" board came
      // up with power save active despite the call above, and showed exactly
      // the latency it is there to prevent — sub-second replies on a good
      // beacon and ten seconds on a bad one. Asking twice costs nothing and
      // removes the race.
      WiFi.setSleep(false);
      tcpServer.begin();
      tcpServer.setNoDelay(true);
      Serial.print("{\"ev\":\"wifi\",\"ip\":\"");
      Serial.print(WiFi.localIP());
      Serial.println("\"}");
      char line[48];
      snprintf(line, sizeof(line), "%s:%d", WiFi.localIP().toString().c_str(), TCP_PORT);
      uiSetLink(line);
#if HAS_JS
      {  /* link feed */
        char j[96];
        snprintf(j, sizeof(j), "{\"link\":\"%s\"}", line);
        jsQueueState(String(j));
      }
#endif

      // Update over the air from here on. Flashing this board over USB is slow
      // and unreliable; this is one transfer into the slot that is not running,
      // and a bad image simply leaves the old one booting.
      ArduinoOTA.setHostname(WIFI_HOSTNAME);
      ArduinoOTA.onStart([]() { uiOtaBegin(); });
      ArduinoOTA.onProgress([](unsigned int done, unsigned int total) { uiOtaProgress(done, total); });
      ArduinoOTA.onEnd([]() { uiOtaEnd(true); });
      ArduinoOTA.onError([](ota_error_t) { uiOtaEnd(false); });
      ArduinoOTA.begin();

      // Answer to a name, so nobody has to hunt for the address. ArduinoOTA
      // already starts mDNS; this advertises what we actually serve.
      MDNS.addService("filament-rfid", "tcp", TCP_PORT);
      MDNS.addService("http", "tcp", 80);

      http.on("/", []() {
        String body = F("<!doctype html><meta charset=utf-8>"
                        "<meta name=viewport content='width=device-width'>"
                        "<style>body{font:14px system-ui;background:#16181d;color:#e6e8eb;padding:20px}"
                        "code{color:#4b8bf5}"
                        /* The two pages are what someone came here to open; the
                           raw endpoints are for when they already know what
                           they want. Sizing says which is which. */
                        ".pill{display:inline-block;background:#4b8bf5;color:#fff;text-decoration:none;"
                        "padding:9px 16px;border-radius:8px;margin:2px 6px 2px 0;font-weight:600}"
                        ".pill:hover{background:#3f78dd}"
                        ".raw{color:#6b7280;font-size:12px}"
                        ".raw a{color:#8b929b;text-decoration:none}"
                        ".raw a:hover{text-decoration:underline}"
                        "</style><h2>mjsx board</h2>");
        body += "<p>firmware " + String(FW_VERSION) + " &middot; " +
                String(uiScreenW()) + "&times;" + String(uiScreenH()) + " panel";
#if MOD_RFID
        body += " &middot; " + String(READER_COUNT) + " reader(s)";
#endif
        body += "</p><p>Push a bundle with <code>mjsx push " + WiFi.localIP().toString() +
                "</code>, or drive the board over the line protocol on <code>" +
                WiFi.localIP().toString() + ":" + String(TCP_PORT) + "</code>.</p>";
        // Every path the board serves, as something you can click: a path you
        // can only read is a path you have to retype into the address bar.
        body += F(
#if HAS_JS && HAS_DISPLAY
                  /* Remote first: it mirrors the glass through the real
                     rasterizer, takes touch, and carries the console and the
                     REPL. Display is the plain JPEG view. */
                  "<p><a class=pill href='/remote'>Remote</a>"
                  "<a class=pill href='/display'>Display</a></p>"
#else
                  "<p><a class=pill href='/display'>Display</a></p>"
#endif
                  "<p class=raw><a href='/screen.jpg'>/screen.jpg</a> &middot; "
                  "<a href='/screen.bmp'>/screen.bmp</a> &middot; "
                  "<a href='/info'>/info</a> &middot; "
                  "<a href='/state'>/state</a></p>");
        http.send(200, "text/html", body);
      });
      http.on("/state", []() {
        // Deliberately on HTTP: when the line protocol stops answering, this is
        // the only way to see whether the bridge is running at all, what it
        // last handled, and whether it still believes it has a client.
        String j = "{\"linesIn\":" + String(g_linesIn) +
                   ",\"repliesOut\":" + String(g_repliesOut) +
                   ",\"lastCmd\":\"" + String(g_lastCmd) + "\"" +
                   ",\"tcpConnected\":" + String(tcpClient && tcpClient.connected() ? "true" : "false") +
                   ",\"pending\":" + String(tcpServer.hasClient() ? "true" : "false") +
                   ",\"freeInternal\":" + String(ESP.getFreeHeap()) +
                   ",\"jsBusy\":" + String(jsBusy() ? "true" : "false") +
                   ",\"jsMsTotal\":" + String(jsMsTotal()) +
                   ",\"psram\":" + String(ESP.getPsramSize()) +
                   ",\"psramFree\":" + String(ESP.getFreePsram()) +
                   ",\"frame\":" + String(uiFrameOk() ? "true" : "false") +
                   ",\"vw\":" + String(uiScreenW()) + ",\"vh\":" + String(uiScreenH()) +
                   ",\"flushUs\":" + String(uiFlushUs()) +
                   ",\"dirtyPix\":" + String(uiDirtyPix()) +
                   ",\"bundle\":" + String(jsFsBegin() && LittleFS.exists("/app.js") ? "true" : "false") +
                   ",\"fsFormats\":" + String(g_fsFormats) +
                   ",\"pokeAge\":" + String(millis() - g_lastPoke) +
                   ",\"pokeTouch\":" + String(g_pokeTouch) +
                   ",\"scaleUs\":" + String(uiScaleUs()) +
                   ",\"drawUs\":" + String(uiDrawUs()) + "}";
        http.send(200, "application/json", j);
      });
      http.on("/info", []() {
        String j = "{\"fw\":\"" + String(FW_VERSION) + "\",\"readers\":" + String(READER_COUNT) +
                   ",\"port\":" + String(TCP_PORT) +
                   ",\"sim\":" + String(SIMULATE_READER ? "true" : "false") +
                   ",\"display\":" + String(HAS_DISPLAY ? "true" : "false") +
                   ",\"readers_found\":\"" + readerReport() + "\"" +
#if HAS_DISPLAY
                   ",\"w\":" + String(uiScreenW()) + ",\"h\":" + String(uiScreenH()) +
                   ",\"stream\":\"http://" + WiFi.localIP().toString() + ":81/stream\"" +
#endif
                   ",\"ip\":\"" + WiFi.localIP().toString() + "\"}";
        http.send(200, "application/json", j);
      });
      /**
       * The screen, as a picture.
       *
       * Two encodings, because they answer different questions. JPEG is what
       * you want over WiFi — a UI screenshot is flat colour and large glyphs,
       * which compresses to a few kB, and the encoder is already linked into
       * every ESP32-S3 sketch (esp32-camera's fmt2jpg). BMP is uncompressed
       * and exact, for when the question is "what is the actual pixel value
       * here" rather than "what does it look like".
       *
       * PNG is missing on purpose: it needs a deflate implementation, and
       * there is no reason to carry one when JPEG costs nothing and BMP
       * answers the lossless case.
       *
       *   /screen.jpg?q=45  (add &half=1 only when bandwidth demands it)
       *   /screen.bmp
       */
      http.on("/screen.jpg", []() {
#if HAS_DISPLAY
        int w = 0, h = 0;
        const uint16_t *fb = uiFrame(w, h);
        if (!fb) { http.send(503, "text/plain", "no frame: a script must own the screen"); return; }

        const int q = http.hasArg("q") ? http.arg("q").toInt() : 70;
        const bool half = http.hasArg("half") && http.arg("half").toInt() != 0;

        // fmt2jpg wants big-endian RGB565, which is the panel's byte order but
        // not the framebuffer's. The copy is taken between renders, so what
        // comes back is one whole frame rather than halves of two.
        const int stride = half ? 2 : 1;
        int ow = 0, oh = 0;
        uint8_t *src = (uint8_t *)heap_caps_malloc((size_t)(w / stride) * (h / stride) * 2,
                                                   MALLOC_CAP_SPIRAM);
        if (!src) { http.send(500, "text/plain", "out of memory"); return; }
        const uint32_t tc = millis();
        uiFrameCopy(src, stride, true, ow, oh);
        const uint32_t copyMs = millis() - tc;

        uint8_t *jpg = nullptr;
        size_t jpgLen = 0;
        const uint32_t t0 = millis();
        const bool ok = fmt2jpg(src, (size_t)ow * oh * 2, ow, oh, PIXFORMAT_RGB565,
                                (uint8_t)q, &jpg, &jpgLen);
        const uint32_t encMs = millis() - t0;
        heap_caps_free(src);
        if (!ok || !jpg) { http.send(500, "text/plain", "encode failed"); return; }

        http.sendHeader("X-Encode-Ms", String(encMs));
        http.sendHeader("X-Copy-Ms", String(copyMs));
        http.sendHeader("Cache-Control", "no-store");
        http.setContentLength(jpgLen);
        http.send(200, "image/jpeg", "");
        http.client().write(jpg, jpgLen);
        free(jpg);
#else
        http.send(404, "text/plain", "no display");
#endif
      });

      http.on("/screen.bmp", []() {
#if HAS_DISPLAY
        int w = 0, h = 0;
        const uint16_t *fb = uiFrame(w, h);
        if (!fb) { http.send(503, "text/plain", "no frame: a script must own the screen"); return; }

        // 16-bit BI_BITFIELDS: the framebuffer's own format, so the only work
        // is a header and writing the rows bottom-up as BMP wants them.
        const uint32_t rowBytes = (uint32_t)w * 2;
        const uint32_t pixels = rowBytes * h;
        const uint32_t offset = 14 + 40 + 12;
        uint8_t hdr[14 + 40 + 12];
        memset(hdr, 0, sizeof(hdr));
        hdr[0] = 'B'; hdr[1] = 'M';
        const uint32_t total = offset + pixels;
        memcpy(hdr + 2, &total, 4);
        memcpy(hdr + 10, &offset, 4);
        const uint32_t infoLen = 40;
        memcpy(hdr + 14, &infoLen, 4);
        const int32_t wi = w, hi = h;
        memcpy(hdr + 18, &wi, 4);
        memcpy(hdr + 22, &hi, 4);
        const uint16_t planes = 1, bpp = 16;
        memcpy(hdr + 26, &planes, 2);
        memcpy(hdr + 28, &bpp, 2);
        const uint32_t comp = 3;  // BI_BITFIELDS
        memcpy(hdr + 30, &comp, 4);
        memcpy(hdr + 34, &pixels, 4);
        const uint32_t rmask = 0xF800, gmask = 0x07E0, bmask = 0x001F;
        memcpy(hdr + 54, &rmask, 4);
        memcpy(hdr + 58, &gmask, 4);
        memcpy(hdr + 62, &bmask, 4);

        // Copied first, then streamed: sending straight from the live buffer
        // spreads one picture across several seconds of rendering.
        uint8_t *snap = (uint8_t *)heap_caps_malloc(pixels, MALLOC_CAP_SPIRAM);
        if (!snap) { http.send(500, "text/plain", "out of memory"); return; }
        int ow = 0, oh = 0;
        const uint32_t tc2 = millis();
        uiFrameCopy(snap, 1, false, ow, oh);
        http.sendHeader("X-Copy-Ms", String(millis() - tc2));

        http.setContentLength(total);
        http.send(200, "image/bmp", "");
        WiFiClient c = http.client();
        c.write(hdr, sizeof(hdr));
        for (int y = h - 1; y >= 0; y--) c.write(snap + (size_t)y * rowBytes, rowBytes);
        heap_caps_free(snap);
#else
        http.send(404, "text/plain", "no display");
#endif
      });

      /**
       * A touch from somewhere other than a finger.
       *
       *   /touch?phase=0&x=120&y=140     0 press, 1 move, 2 release
       *   /tap?x=120&y=140               press and release in one call
       *
       * Screen coordinates, and it goes in where a real press does — so it
       * exercises the calibration, the gesture handling and the UI exactly as
       * the glass would.
       */
      http.on("/touch", []() {
#if HAS_DISPLAY
        const int phase = http.arg("phase").toInt();
        const int x = http.arg("x").toInt();
        const int y = http.arg("y").toInt();
        uiInjectPointer(phase, x, y);
        http.send(200, "application/json",
                  "{\"ok\":true,\"phase\":" + String(phase) + ",\"x\":" + String(x) +
                      ",\"y\":" + String(y) + "}");
#else
        http.send(404, "text/plain", "no display");
#endif
      });
      http.on("/tap", []() {
#if HAS_DISPLAY
        const int x = http.arg("x").toInt();
        const int y = http.arg("y").toInt();
        uiInjectPointer(0, x, y);
        delay(30);           // long enough for the UI thread to see a press
        uiInjectPointer(2, x, y);
        http.send(200, "application/json",
                  "{\"ok\":true,\"x\":" + String(x) + ",\"y\":" + String(y) + "}");
#else
        http.send(404, "text/plain", "no display");
#endif
      });

      /**
       * The screen, live, in a browser — and touchable.
       *
       * Enough of a remote interface to use the device from a phone: the
       * picture scales to fit, pointer events map back to screen coordinates
       * and go in through /touch, so a drag on the phone is a drag on the
       * glass. Deliberately one self-contained page with no dependencies —
       * anything it fetched from elsewhere would be a thing to go wrong on a
       * workshop network with no route out.
       */
      // A pattern drawn straight at the panel, for when the question is
      // whether the driver is right rather than whether the UI is.
      http.on("/paneltest", []() {
#if HAS_DISPLAY
        uiPanelTest();
        http.send(200, "text/plain",
                  "drawn: red=top-left green=top-right blue=bottom-left white=bottom-right\n"
                  "yellow border on all four edges, grey cross through the centre\n"
                  "GET /screen.jpg still shows the canvas, not this\n");
#else
        http.send(404, "text/plain", "no display");
#endif
      });
      http.on("/display", []() {
        http.sendHeader("Cache-Control", "no-store");
        http.send(200, "text/html", FPSTR(DISPLAY_HTML));
      });

      /**
       * The op-stream viewer: /remote replays the frame's DRAW OPS in the
       * browser through the real mjsx rasterizer, served from flash below.
       * The board's only extra work is the JS-side recorder in the app
       * bundle (armed by /ops polls, self-disarming); a frame travels as
       * kilobytes of JSON instead of a JPEG re-encode. The HD font faces
       * live in /mjsx-backend.js, so only the BROWSER carries them.
       */
      // Asset URLs carry the BUILD as a version: a browser that cached
      // /mjsx-backend.js under an older policy can never pair a fresh
      // page with a stale rasterizer again -- the URL itself changes.
      http.on("/remote", []() {
        String page = FPSTR(REMOTE_HTML);
        page.replace("src=/mjsx-backend.js", "src=/mjsx-backend.js?v=" + String(FW_BUILD_TAG));
        page.replace("src=/remote.js", "src=/remote.js?v=" + String(FW_BUILD_TAG));
        http.sendHeader("Cache-Control", "no-store");
        http.send(200, "text/html", page);
      });
      http.on("/remote.js", []() {
        http.sendHeader("Cache-Control", "no-store");
        http.send(200, "application/javascript", FPSTR(REMOTE_CLIENT_JS));
      });
      http.on("/mjsx-backend.js", []() {
        http.sendHeader("Content-Encoding", "gzip");
        // no-store: an hour of caching meant a rasterizer fix could look
        // unfixed for an hour -- 10KB gz is cheaper than that confusion
        http.sendHeader("Cache-Control", "no-store");
        http.send_P(200, "application/javascript",
                    (const char *)MJSX_BACKEND_JS_GZ, MJSX_BACKEND_JS_GZ_LEN);
      });
      http.on("/ops", []() {
#if HAS_JS
#if HAS_DISPLAY
        // A watched screen is a looked-at screen: polling keeps the panel
        // awake, so injected presses act instead of being spent on waking
        // it (uiInjectPointer swallows the press that wakes the glass).
        uiPoke();
#endif
        // __OPSGET() arms the recorder and returns the last frame's ops
        // JSON. The eval worker is pinned to this core, so waiting here
        // with delay() lets it run; the app bundle defines the function.
        if (jsBusy()) { http.send(503, "text/plain", "js busy"); return; }
        // print() rather than a return value: the worker's log channel
        // carries the bytes RAW, where the eval result is re-quoted with
        // escapes -- which doubled every frame on the wire.
        // The JSON path records in JS, so it takes the flag as an argument
        // rather than through the C recorder's arming clock.
        const String call = http.arg("log").toInt()
                              ? F("if(typeof __OPSGET==='function')print(__OPSGET(1))")
                              : F("if(typeof __OPSGET==='function')print(__OPSGET())");
        if (!jsEvalStart(call.c_str())) {
          http.send(503, "text/plain", "js busy");
          return;
        }
        jsPump();
        const uint32_t t0 = millis();
        while (!jsHasResult() && millis() - t0 < 600) delay(5);
        if (!jsHasResult()) { http.send(504, "text/plain", "timeout"); return; }
        String body = jsLog();
        body.trim();
        http.sendHeader("Cache-Control", "no-store");
        http.send(200, "application/json", body.length() ? body : "{}");
#else
        http.send(404, "text/plain", "no js");
#endif
      });
      http.on("/canvasq", []() {
#if HAS_JS && HAS_DISPLAY
        // Stream quality for canvas sources: q=25..95, half=0 auto /
        // 1 half / 2 full. Shared by all viewers; cache drops so the
        // change takes effect on the next frame.
        if (http.hasArg("q")) {
          int q = http.arg("q").toInt();
          if (q < 25) q = 25;
          if (q > 95) q = 95;
          g_cvQ = (uint8_t)q;
        }
        if (http.hasArg("half")) {
          int hm = http.arg("half").toInt();
          g_cvHalfMode = (uint8_t)(hm < 0 ? 0 : (hm > 2 ? 2 : hm));
        }
        cvJpegDrop();
        cvReemit();
        http.send(200, "application/json",
                  String("{\"q\":") + g_cvQ + ",\"half\":" + g_cvHalfMode + "}");
#else
        http.send(404, "text/plain", "no display");
#endif
      });
      http.on("/canvas", []() {
#if HAS_JS && HAS_DISPLAY
        // One JPEG of a canvas source, from the gen-keyed cache. The op
        // stream's gen field tells viewers WHEN to come back.
        const int id = http.hasArg("id") ? http.arg("id").toInt() : 0;
        uint8_t *j = nullptr;
        size_t n = 0;
        uint16_t gen = 0;
        if (!cvJpeg(id, &j, &n, &gen)) { http.send(404, "text/plain", "no canvas"); return; }
        http.sendHeader("Cache-Control", "no-store");
        http.sendHeader("X-Gen", String((int)gen));
        http.setContentLength(n);
        http.send(200, "image/jpeg", "");
        http.client().write(j, n);
#else
        http.send(404, "text/plain", "no display");
#endif
      });
      http.on("/dirty", []() {
        // A/B the dirty-rect flush live: /dirty?on=0 forces full flushes.
        if (http.hasArg("on")) uiSetDirty(http.arg("on").toInt() != 0);
        http.send(200, "application/json",
                  String("{\"dirty\":") + (uiDirtyOn() ? "true" : "false") + "}");
      });
      http.on("/ops.bin", []() {
#if HAS_JS && HAS_DISPLAY
        // The NATIVE op stream: recorded at the gfxN* layer in C, binary,
        // no MicroQuickJS involvement at all. Arms the recorder (like the
        // JSON /ops arms the JS one), keeps the panel awake, and nudges a
        // render so the first poll after idle has a frame to return.
        uiPoke();
        opArm();
        // log=1 asks for the board's console in the same stream. Its own
        // 5s arming clock, so pixels-only viewers never carry the lines.
        if (http.arg("log").toInt()) logArm();
        jsQueueState("{}");   // a no-op patch marks the UI dirty
        static uint8_t *out = nullptr;   // PSRAM: internal RAM is WiFi's
        if (!out) out = (uint8_t *)ps_malloc(OPREC_CAP);
        if (!out) { http.send(500, "text/plain", "oom"); return; }
        uint32_t n = 0;
        const uint32_t t0 = millis();
        while (!(n = opTake(out, OPREC_CAP)) && millis() - t0 < 700) delay(10);
        http.sendHeader("Cache-Control", "no-store");
        if (!n) { http.send(204, "application/octet-stream", ""); return; }
        http.setContentLength(n);
        http.send(200, "application/octet-stream", "");
        http.client().write(out, n);
#else
        http.send(404, "text/plain", "no js display");
#endif
      });
      /**
       * The REPL, over HTTP.
       *
       * MicroQuickJS has no REPL of its own, but jsEvalStart() compiles a
       * fresh script against the SAME global object the app is running
       * in -- so `UI.state`, the app's own globals and every native are
       * simply in scope, and a var set in one call is readable by the
       * next. That is what the :8765 push server's "eval" command has
       * always done; this is the same thing on port 80, so the /remote
       * page (which cannot open a raw socket) can use it.
       *
       * Anything the expression logs reaches the console pane by itself,
       * because console.log already goes to the log ops -- so a REPL line
       * and its output land in the same place.
       *
       * Same start-then-wait shape as /ops: the worker is pinned to this
       * core, so delay() here lets it run.
       */
      http.on("/eval", []() {
#if HAS_JS
        String js = http.arg("js");
        if (!js.length()) { http.send(400, "application/json", "{\"error\":\"no js\"}"); return; }
        /* RETRY the start, do not test-then-start.
           jsEvalStart fails only when the worker is mid-script, and on a
           ticking app that is true most of the time -- so a single
           attempt loses the race almost always, and checking jsBusy()
           first is the same race with extra steps. Keep trying for a
           couple of seconds and take the first gap between frames. */
        bool started = false;
        const uint32_t tw = millis();
        while (!(started = jsEvalStart(js.c_str())) && millis() - tw < 2000) {
          jsPump();
          delay(4);
        }
        if (!started) {
          http.send(503, "application/json", "{\"error\":\"engine did not free up\"}");
          return;
        }
        jsPump();
        const uint32_t t0 = millis();
        while (!jsHasResult() && millis() - t0 < 3000) delay(5);
        http.sendHeader("Cache-Control", "no-store");
        if (!jsHasResult()) {
          http.send(504, "application/json", "{\"error\":\"timeout\"}");
          return;
        }
        JsonDocument out;   /* v7: sized as it fills */
        out["ok"] = jsResultOk();
        out["value"] = jsResult();
        if (jsLog().length()) out["log"] = jsLog();
        String body;
        serializeJson(out, body);
        http.send(200, "application/json", body);
#else
        http.send(404, "text/plain", "no js");
#endif
      });
      http.on("/key", []() {
#if HAS_JS
        // Injected through the patch queue the worker already drains, so
        // it needs no new native surface; the app bundle's UI.patch
        // override turns it into UI.key presses (or menu/home).
        String k = http.arg("k");
        // ESCAPE, not strip: stripping made backslash and double-quote
        // untypeable from every remote keyboard
        k.replace("\\", "\\\\");
        k.replace("\"", "\\\"");
        jsQueueState(String("{\"___key\":\"") + k + "\"}");
        http.send(200, "application/json", "{\"ok\":true}");
#else
        http.send(404, "text/plain", "no js");
#endif
      });

      /**
       * MJPEG, on its own port and its own task.
       *
       * A snapshot costs about 38 ms of request overhead before a byte of
       * picture moves, which at ten frames a second is most of the budget.
       * multipart/x-mixed-replace pushes frame after frame down one socket, so
       * that overhead is paid once and the rate becomes what the encoder and
       * the link can actually sustain.
       *
       * Port 81 rather than 80, in a task of its own, because the stream loop
       * never returns while a viewer is watching — sharing the web server
       * would mean every /touch waited behind the next frame, and the point of
       * the viewer is to be able to press things.
       *
       *   <img src="http://board:81/stream?q=45&fps=10">
       */
      xTaskCreatePinnedToCore(streamTask, "mjpeg", 8192, nullptr, 1, nullptr, 0);

      // Streamed firmware upload.
      //
      // espota ACKs every 1460 bytes, so on a link with ~60 ms round trips it
      // spends most of a minute waiting rather than transferring. A plain HTTP
      // POST is one stream: same bytes, a fraction of the wall clock.
      //   curl -F "f=@firmware.bin" "http://<board>/update?size=<bytes>"
      http.on(
          "/update", HTTP_POST,
          []() {
            const bool ok = !Update.hasError();
            http.send(ok ? 200 : 500, "text/plain", ok ? "ok" : "failed");
            if (ok) {
              delay(300);
              ESP.restart();
            }
          },
          []() {
            HTTPUpload &up = http.upload();
            static size_t total = 0;
            if (up.status == UPLOAD_FILE_START) {
              // Content-Length covers the whole multipart body, so the caller
              // passes the image size for an honest progress bar.
              total = http.hasArg("size") ? (size_t)http.arg("size").toInt() : 0;
              uiOtaBegin();
              Update.begin(UPDATE_SIZE_UNKNOWN);
            } else if (up.status == UPLOAD_FILE_WRITE) {
              Update.write(up.buf, up.currentSize);
              if (total) uiOtaProgress(up.totalSize, total);
            } else if (up.status == UPLOAD_FILE_END) {
              const bool ok = Update.end(true);
              uiOtaEnd(ok);
            }
          });

      http.begin();
    } else {
      Serial.println("{\"ev\":\"wifi\",\"ip\":null}");
      uiSetLink("USB (wifi failed)");
    }
  }
#endif
}

void loop() {
  uiTick();
  jsPump();
#if HAS_JS
  /* The BOOT button as navigation: short press = Escape (blur / back),
     long hold = AppHome (the app's menu). Injected through the same
     patch queue as /key, so the app bundle decides what each means; a
     board with a second wired button can send AppHome from it instead. */
  {
    static bool btnInit = false, btnDown = false, btnLongSent = false;
    static uint32_t btnAt = 0;
    if (!btnInit) { pinMode(0, INPUT_PULLUP); btnInit = true; }
    const bool down = digitalRead(0) == LOW;
    const uint32_t bnow = millis();
    static bool btnRescued = false;
    if (down && !btnDown) { btnDown = true; btnAt = bnow; btnLongSent = false; btnRescued = false; }
    else if (down && !btnRescued && bnow - btnAt > 5000) {
      btnRescued = true;
#if HAS_DISPLAY
      if (uiExternal()) {
        // Rescue: stop the script via its own exit channel, then show
        // the wifi flow -- the ONLY native page rescue exposes.
        sysNExit();
        uiRescue();
      } else {
        // Held again from the native side: reboot back into the app (a
        // fresh boot runs /app.js in a fresh arena; re-evaling into the
        // live context double-loads the bundle).
        ESP.restart();
      }
#else
      ESP.restart();  /* headless: a long hold is just "start over" */
#endif
    }
    else if (down && !btnLongSent && bnow - btnAt > 600) {
      btnLongSent = true;
      jsQueueState("{\"___key\":\"AppHome\"}");
    } else if (!down && btnDown) {
      btnDown = false;
      if (!btnLongSent && bnow - btnAt > 30) jsQueueState("{\"___key\":\"Escape\"}");
    }
  }
#endif
#if HAS_WIFI
  if (WiFi.status() == WL_CONNECTED) {
    ArduinoOTA.handle();
    http.handleClient();
    // Modules tick here; anything that can block for seconds belongs in a
    // task of its own, because this is the loop that reads the touchscreen.
    modsTick();
  }
#endif

  // Serial source
  pumpStream(Serial, Serial, serialBuf);

#if HAS_WIFI
  // Gated on the live connection, not on WIFI_SSID: credentials chosen on the
  // screen are the normal case now, and testing the compile-time constant meant
  // a board that had joined a network perfectly well served nothing at all as
  // soon as that constant was blanked.
  if (WiFi.status() == WL_CONNECTED) {
    // One client at a time, but never held hostage by a stale one.
    //
    // A peer that goes away without closing cleanly can leave `connected()`
    // true indefinitely. The socket then accepts new connections at the TCP
    // level while the bridge answers none of them — which looks exactly like
    // the firmware having hung, and is not obviously distinguishable from it
    // when you are the one debugging.
    static uint32_t lastActivity = 0;
    const bool haveClient = tcpClient && tcpClient.connected();
    if (!haveClient || (millis() - lastActivity > 15000 && tcpServer.hasClient())) {
      WiFiClient nc = tcpServer.available();
      if (nc) {
        if (haveClient) tcpClient.stop();  // displace the idle one
        tcpClient = nc;
        tcpBuf = "";
        lastActivity = millis();
      }
    }
    if (tcpClient && tcpClient.connected()) {
      if (tcpClient.available()) lastActivity = millis();
      pumpStream(tcpClient, tcpClient, tcpBuf);
    }
  }
#endif
}
