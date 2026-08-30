#pragma once
// Included from the sketch, after the objects these reach into exist.

// ---- natives behind the script's `net` and `sys` objects ----
//
// Joining writes the same Preferences keys the native settings page uses, so
// credentials set from either UI are one set of credentials.
extern "C" {

void netNScan(void) {
#if HAS_WIFI && MOD_WIFI_CFG
  WiFi.scanNetworks(true /* async: the worker must not stall for seconds */);
#endif
}

int netNResults(char *out, int cap) {
#if HAS_WIFI && MOD_WIFI_CFG
  int n = WiFi.scanComplete();
  if (n == WIFI_SCAN_RUNNING) return -1;
  if (n < 0) { snprintf(out, cap, "[]"); return 2; }
  int used = snprintf(out, cap, "[");
  for (int i = 0; i < n && i < 12; i++) {
    used += snprintf(out + used, cap - used, "%s{\"ssid\":\"%s\",\"rssi\":%d,\"open\":%s}",
                     i ? "," : "", WiFi.SSID(i).c_str(), WiFi.RSSI(i),
                     WiFi.encryptionType(i) == WIFI_AUTH_OPEN ? "true" : "false");
    if (used >= cap - 80) break;  // stop before truncating a record
  }
  used += snprintf(out + used, cap - used, "]");
  WiFi.scanDelete();
  return used;
#else
  snprintf(out, cap, "[]");
  return 2;
#endif
}

void netNJoin(const char *ssid, int slen, const char *psk, int plen) {
#if HAS_WIFI && MOD_WIFI_CFG
  char ss[33], pk[65];
  snprintf(ss, sizeof(ss), "%.*s", slen, ssid);
  snprintf(pk, sizeof(pk), "%.*s", plen, psk);
  Preferences p;
  p.begin("filrfid", false);
  p.putString("ssid", ss);
  p.putString("pass", pk);
  p.end();
  WiFi.disconnect();
  WiFi.begin(ss, pk);
#endif
}

int netNStatus(char *out, int cap) {
#if HAS_WIFI
  const bool up = WiFi.status() == WL_CONNECTED;
  return snprintf(out, cap, "{\"connected\":%s,\"ip\":\"%s\",\"ssid\":\"%s\"}",
                  up ? "true" : "false",
                  up ? WiFi.localIP().toString().c_str() : "",
                  WiFi.SSID().c_str());
#else
  return snprintf(out, cap, "{\"connected\":false,\"ip\":\"\",\"ssid\":\"\"}");
#endif
}

void sysNStore(const char *k, int klen, const char *v, int vlen) {
  char key[16];
  snprintf(key, sizeof(key), "%.*s", klen > 15 ? 15 : klen, k);
  Preferences p;
  p.begin("jsapp", false);
  p.putString(key, String(v).substring(0, vlen));
  p.end();
}

int sysNFetch(const char *k, int klen, char *out, int cap) {
  char key[16];
  snprintf(key, sizeof(key), "%.*s", klen > 15 ? 15 : klen, k);
  Preferences p;
  p.begin("jsapp", true);
  String v = p.getString(key, "");
  p.end();
  return snprintf(out, cap, "%s", v.c_str());
}

/* Readers, for the settings screen: what the last probe found, and a way to
   look again — so wiring a module is plugging it in and pressing a button. */
int sysNReaders(char *out, int cap) {
  extern String readerReport();
  const String r = readerReport();
  return snprintf(out, cap, "%s", r.c_str());
}

int sysNRescan(void) {
  extern int readerProbeAll();
  return readerProbeAll();
}

/* Pins a script may not touch: the active board's display and touch signals.
   A script poking TFT_DC mid-frame rewrites the panel's command state (the
   BOARD==2 note in config.h describes exactly that failure), so these are
   refused rather than trusted. Entries that are -1 on this board match no
   requested pin and cost nothing. */
/* TFT_MISO is optional -- the 1.69" panel is write-only and does not
   define it, and an undefined name in the list below is a build failure
   rather than a missing entry. */
#ifndef TFT_MISO
#define TFT_MISO -1
#endif
static bool sysGpioDenied(int pin) {
  static const int deny[] = { TFT_MOSI, TFT_MISO, TFT_SCLK, TFT_CS, TFT_DC,
                              TFT_RST,  TFT_BL,   TOUCH_SDA, TOUCH_SCL,
                              TOUCH_INT, TOUCH_RST };
  if (pin < 0 || pin > 48) return true;  // S3 package tops out at GPIO48
  for (size_t i = 0; i < sizeof(deny) / sizeof(deny[0]); i++)
    if (deny[i] == pin) return true;
  return false;
}

/**
 * sys.gpio(pin, op, value) -> int
 *   op 0: read  — INPUT_PULLUP then digitalRead, so a bare pin reads 1
 *   op 1: write — OUTPUT then digitalWrite(value)
 *   op 2: analogRead
 * Returns -1 for a denied pin or unknown op.
 */
int sysNGpio(int pin, int op, int value) {
  if (sysGpioDenied(pin)) return -1;
  switch (op) {
    case 0:
      pinMode(pin, INPUT_PULLUP);
      return digitalRead(pin);
    case 1:
      pinMode(pin, OUTPUT);
      digitalWrite(pin, value ? HIGH : LOW);
      return 1;
    case 2:
      return analogRead(pin);
  }
  return -1;
}

/**
 * sys.i2c(addr, reg, value) -> int
 *
 * One byte of a device on the shared I2C bus — the same sequence as the
 * `reg` TCP command above in the sketch, which is the bring-up tool this
 * mirrors. value < 0 reads (write reg, repeated-start read one byte);
 * value >= 0 writes that byte. Returns the byte read, 1 on a good write,
 * -1 on no answer or a bad address.
 */
int sysNI2c(int addr, int reg, int value) {
  if (addr < 0x03 || addr > 0x77 || reg < 0 || reg > 255) return -1;
  const uint8_t a = (uint8_t)addr;
  Wire.beginTransmission(a);
  Wire.write((uint8_t)reg);
  if (value >= 0) {
    Wire.write((uint8_t)value);
    return Wire.endTransmission() == 0 ? 1 : -1;
  }
  if (Wire.endTransmission(false) == 0 && Wire.requestFrom(a, (uint8_t)1) == 1)
    return Wire.read();
  return -1;
}

/* ---- net.fetch: HTTP from JS, on a budget --------------------------------
 *
 * The round board is an S3R2 with 2MB of PSRAM, and a response body becomes a
 * JS string in the engine's heap. So this native never allocates in proportion
 * to what a server sends:
 *
 *   - `max` is enforced WHILE READING, not after. The socket is drained into a
 *     fixed buffer and the rest is discarded; a 4MB body costs the same as a
 *     4KB one.
 *   - a declared Content-Length over `max` is refused before the body is read
 *     at all.
 *   - exactly one request is in flight. A second call is told the line is
 *     busy rather than queued, because a queue is an unbounded allocation
 *     wearing a hat.
 *   - HEAD reads no body whatever, which is the point for a clock: the Date
 *     header is a timestamp, so a clock costs zero body bytes.
 *
 * Everything is async in the same style as net.scan/net.results, because the
 * frame loop must not block: netNFetch() starts, netNFetchState() reports.
 *
 * SANDBOX. Off unless the host turns it on. `netFetchAllow` is a comma
 * separated host allowlist from NVS ("*" for anything); an empty setting
 * means the native refuses every call, so a board is not an open proxy the
 * moment someone pushes a script to it.
 */
/* The ceiling depends on where the buffer can live. With PSRAM there is room
   for 32K; without it the buffer competes with WiFi for internal RAM, where
   32K is not affordable — the frame canvas learned that lesson already. The
   buffer itself is allocated in PSRAM when there is any, for the same reason:
   internal RAM is WiFi's. */
#define NET_FETCH_CAP_PSRAM 32768
#define NET_FETCH_CAP_DRAM   8192
static int netFetchCap() {
#if defined(BOARD_HAS_PSRAM) || defined(CONFIG_SPIRAM)
  return psramFound() ? NET_FETCH_CAP_PSRAM : NET_FETCH_CAP_DRAM;
#else
  return NET_FETCH_CAP_DRAM;
#endif
}
static int g_fetchCapBytes = 0;   /* what was actually allocated */

static char   g_fetchUrl[192];       /* the request, handed to the task */
static int    g_fetchHead = 0, g_fetchMax = 0;
static TaskHandle_t g_fetchTask = nullptr;

static bool   g_fetchBusy = false;
static bool   g_fetchDone = false;
static int    g_fetchStatus = 0;     /* HTTP status, or negative for a failure */
static int    g_fetchLen = 0;        /* bytes kept in g_fetchBody */
static bool   g_fetchTrunc = false;
static char  *g_fetchBody = nullptr;
static char   g_fetchDate[40];       /* the response Date: header, if any */
static char   g_fetchErr[64];

static bool netFetchAllowed(const char *url) {
  Preferences p;
  p.begin("jsapp", true);
  String allow = p.getString("netfetch", "");
  p.end();
  if (allow.length() == 0) return false;          /* sandboxed by default */
  if (allow == "*") return true;
  /* compare against the host part of the URL only */
  const char *h = strstr(url, "://");
  h = h ? h + 3 : url;
  int n = 0;
  while (h[n] && h[n] != '/' && h[n] != ':') n++;
  String host = String(h).substring(0, n);
  int from = 0;
  while (from < (int)allow.length()) {
    int c = allow.indexOf(',', from);
    if (c < 0) c = allow.length();
    String one = allow.substring(from, c);
    one.trim();
    if (one.length() && (one == host || one == "*")) return true;
    from = c + 1;
  }
  return false;
}

/* The transfer runs on its own task.
 *
 * The API was always shaped async -- start, then poll -- but the first cut
 * performed the whole HTTP transaction inline, which blocks the JS engine and
 * the frame loop for as long as the far end takes. A slow or dead server
 * froze the UI for the entire timeout. Now netNFetch() only validates and
 * hands over; the task does the waiting, and net.fetchState() keeps its
 * contract of '' until there is something to report.
 *
 * One task at a time, created per request and deleted on completion, because
 * a permanent worker would hold its stack (8 KB) forever for a feature most
 * apps never touch.
 */
static void netFetchTask(void *arg) {
#if HAS_WIFI
  HTTPClient http;
  http.setTimeout(6000);
  http.setConnectTimeout(4000);
  if (!http.begin(g_fetchUrl)) {
    snprintf(g_fetchErr, sizeof(g_fetchErr), "bad url");
    g_fetchStatus = -1;
  } else {
    const char *want[] = { "Date", "Content-Length" };
    http.collectHeaders(want, 2);
    g_fetchStatus = g_fetchHead ? http.sendRequest("HEAD") : http.GET();
    if (g_fetchStatus > 0) {
      String d = http.header("Date");
      snprintf(g_fetchDate, sizeof(g_fetchDate), "%s", d.c_str());
      if (!g_fetchHead) {
        int declared = http.getSize();            /* -1 when chunked */
        int max = g_fetchMax;
        if (declared > max) {
          g_fetchTrunc = true;                    /* refused before the body */
        } else {
          if (!g_fetchBody) {
            /* PSRAM first: a 32K buffer in internal RAM is a WiFi outage */
            g_fetchCapBytes = netFetchCap();
            g_fetchBody = (char *)heap_caps_malloc(g_fetchCapBytes + 1, MALLOC_CAP_SPIRAM);
            if (!g_fetchBody) {
              g_fetchCapBytes = NET_FETCH_CAP_DRAM;
              g_fetchBody = (char *)malloc(NET_FETCH_CAP_DRAM + 1);
            }
          }
          if (!g_fetchBody) {
            snprintf(g_fetchErr, sizeof(g_fetchErr), "no heap");
            g_fetchStatus = -1;
          } else {
            if (max > g_fetchCapBytes) max = g_fetchCapBytes;
            WiFiClient *st = http.getStreamPtr();
            unsigned long t0 = millis();
            while (http.connected() && millis() - t0 < 6000) {
              size_t avail = st->available();
              if (!avail) { if (declared >= 0 && g_fetchLen >= declared) break; delay(2); continue; }
              if (g_fetchLen >= max) {            /* cap reached: drain, drop */
                g_fetchTrunc = true;
                while (st->available()) st->read();
                break;
              }
              int room = max - g_fetchLen;
              int n = st->readBytes(g_fetchBody + g_fetchLen,
                                    (int)avail < room ? (int)avail : room);
              if (n <= 0) break;
              g_fetchLen += n;
            }
            g_fetchBody[g_fetchLen] = 0;
          }
        }
      }
    } else {
      snprintf(g_fetchErr, sizeof(g_fetchErr), "%s",
               HTTPClient::errorToString(g_fetchStatus).c_str());
    }
    http.end();
  }
#endif
  g_fetchBusy = false;
  g_fetchDone = true;
  g_fetchTask = nullptr;
  vTaskDelete(nullptr);
}

/* start a request. 1 accepted, 0 busy, -1 refused. Returns immediately. */
int netNFetch(const char *url, int ulen, int head, int max) {
#if HAS_WIFI
  if (g_fetchBusy) return 0;
  if (WiFi.status() != WL_CONNECTED) return -1;

  snprintf(g_fetchUrl, sizeof(g_fetchUrl), "%.*s",
           ulen > (int)sizeof(g_fetchUrl) - 1 ? (int)sizeof(g_fetchUrl) - 1 : ulen, url);

  /* a refusal is a RESULT, not a silent no-op: clear the previous one so a
     stale Date cannot look like this request's answer */
  g_fetchDate[0] = 0; g_fetchErr[0] = 0;
  g_fetchLen = 0; g_fetchTrunc = false;

  if (!netFetchAllowed(g_fetchUrl)) {
    g_fetchDone = true; g_fetchStatus = -1;
    snprintf(g_fetchErr, sizeof(g_fetchErr), "not allowed");
    return -1;
  }
  int hard = netFetchCap();
  if (max <= 0 || max > hard) max = hard;
  g_fetchHead = head; g_fetchMax = max;
  g_fetchBusy = true; g_fetchDone = false; g_fetchStatus = 0;

  if (xTaskCreate(netFetchTask, "netfetch", 8192, nullptr, 1, &g_fetchTask) != pdPASS) {
    g_fetchBusy = false; g_fetchDone = true; g_fetchStatus = -1;
    snprintf(g_fetchErr, sizeof(g_fetchErr), "no task");
    return -1;
  }
  return 1;
#else
  (void)url; (void)ulen; (void)head; (void)max;
  return -1;
#endif
}

/* '' while in flight, else a SMALL json line — no body in it.
   Inlining the body here was a mistake: JSON-escaping 32K of arbitrary bytes
   is up to 192K of \uXXXX, which is precisely the allocation this native
   exists to avoid. The body has its own accessor, so a caller that only wants
   the clock (or the status) never materialises it at all. */
int netNFetchState(char *out, int cap) {
  if (g_fetchBusy || !g_fetchDone) { out[0] = 0; return 0; }
  return snprintf(out, cap,
                  "{\"status\":%d,\"date\":\"%s\",\"bytes\":%d,"
                  "\"truncated\":%s,\"error\":\"%s\"}",
                  g_fetchStatus, g_fetchDate, g_fetchLen,
                  g_fetchTrunc ? "true" : "false", g_fetchErr);
}

/* The body as raw bytes. The engine copies it into a JS string, so this
   costs one copy and no escaping. Returns 0 bytes when there is no body,
   which is every HEAD request. */
int netNFetchBody(const char **p) {
  if (g_fetchBusy || !g_fetchDone || !g_fetchBody) { *p = ""; return 0; }
  *p = g_fetchBody;
  return g_fetchLen;
}

/* The 'serial' console sink.
 *
 * The buffer sink is a ring in JS (packages/core/src/log.js, bundled with
 * the app) and the ops sink is the frame recorder, so neither needs C. This
 * is the one destination the script cannot reach on its own: the wire.
 *
 * Deliberately raw — no level prefix, no newline. The caller formats, this
 * writes, so what appears on a terminal is exactly what the logger built. */
void sysNLog(const char *p, int len) {
  if (len > 0) Serial.write((const uint8_t *)p, (size_t)len);
}

}  // extern "C"
