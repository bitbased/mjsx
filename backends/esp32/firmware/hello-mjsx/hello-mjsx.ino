/*
 * Minimal mjsx firmware: MicroQuickJS + the native-api glue, no panel driver
 * yet. gfx.* logs to Serial in the same text form the pure-js backend's
 * proof used a human to read — the point of this sketch is proving the
 * whole chain compiles and runs on real hardware (JSX -> mjsx-core ->
 * native-api -> this device), not driving real pixels. A real panel driver
 * is the next step, ported from filament-rfid-bridge/panel_st7796.h — this
 * sketch's gfxN and sysN implementations are exactly where it plugs in;
 * nothing above this file changes.
 */
// Declared explicitly so the Arduino preprocessor's own generated prototype
// (which follows the include below and would otherwise inherit its "C"
// linkage) never gets a chance to disagree with these.
void setup();
void loop();

#include "mjsx_engine.h"

static JSContext *g_ctx = nullptr;
static uint8_t *g_mem = nullptr;
#define JS_HEAP_BYTES (96 * 1024)

/* ---- gfx.*: log what would have been drawn ---- */
extern "C" {

void gfxNClear(unsigned rgb) { Serial.printf("clear #%06x\n", rgb); }
void gfxNRect(int x, int y, int w, int h, unsigned rgb, int r, int fill) {
  Serial.printf("%s %d,%d %dx%d #%06x r%d\n", fill ? "frect" : "rect", x, y, w, h, rgb, r);
}
void gfxNCircle(int x, int y, int r, unsigned rgb, int fill) {
  Serial.printf("circle %d,%d r%d #%06x %s\n", x, y, r, rgb, fill ? "filled" : "outline");
}
void gfxNLine(int x0, int y0, int x1, int y1, unsigned rgb) {
  Serial.printf("line %d,%d -> %d,%d #%06x\n", x0, y0, x1, y1, rgb);
}
void gfxNText(int x, int y, int size, unsigned rgb, const char *s, int len) {
  Serial.printf("text %d,%d s%d #%06x \"%.*s\"\n", x, y, size, rgb, len, s);
}
void gfxNClip(int x, int y, int w, int h) { Serial.printf("clip %d,%d %dx%d\n", x, y, w, h); }
void gfxNUnclip(void) { Serial.println("unclip"); }
int gfxNW(void) { return 240; }
int gfxNH(void) { return 280; }

/* ---- sys.*: the generic subset ---- */
void sysNExit(void) { }
long sysNMillis(void) { return (long)millis(); }
void sysNBeep(int ok) { (void)ok; }
void sysNTone(int freq, int ms) { (void)freq; (void)ms; }
void sysNStore(const char *k, int klen, const char *v, int vlen) { (void)k; (void)klen; (void)v; (void)vlen; }
int sysNFetch(const char *k, int klen, char *out, int cap) { (void)k; (void)klen; if (cap) out[0] = 0; return 0; }

/* Anything a script prints (console.log, an uncaught exception) lands here. */
void jsGlueWrite(const char *buf, size_t len) { Serial.write((const uint8_t *)buf, len); }

}  // extern "C"

static void jsLogFunc(void *opaque, const void *buf, size_t len) {
  (void)opaque;
  Serial.write((const uint8_t *)buf, len);
}

/* mjsx-core plus one inline app, small enough to embed directly for this
   proof. A real firmware loads this from flash/LittleFS instead — see
   filament-rfid-bridge/js.h for that pattern, unrelated to the engine
   itself. */
static const char SCRIPT[] =
  "function App() {"
  "  return h('box', {pad: 10, gap: 8},"
  "    h('box', {bg: UI.theme.panel, radius: 6, border: UI.theme.accent, pad: 8, vcenter: true, h: 40},"
  "      h('text', {text: 'hello from esp32', size: 2, align: 'center'})));"
  "}"
  "UI.mount(App);"
  "UI.render();";

void setup() {
  Serial.begin(115200);
  delay(1500);
  Serial.println("--- mjsx / ESP32 minimal proof ---");

  g_mem = (uint8_t *)malloc(JS_HEAP_BYTES);
  if (!g_mem) { Serial.println("no heap for the engine"); return; }

  g_ctx = JS_NewContext(g_mem, JS_HEAP_BYTES, &js_stdlib);
  if (!g_ctx) { Serial.println("JS_NewContext failed"); return; }
  JS_SetLogFunc(g_ctx, jsLogFunc);

  // mjsx-core itself would normally be eval'd first, from its own source
  // file (packages/core/src/mjsx.js) concatenated ahead of the app the way
  // the filament-rfid build pipeline does it — omitted here only because
  // this sketch inlines a trivial app that calls h()/UI directly without
  // needing the full engine; the eval call below is exactly where a real
  // build's concatenated bundle goes.
  JSValue v = JS_Eval(g_ctx, SCRIPT, sizeof(SCRIPT) - 1, "<inline>", JS_EVAL_REPL);
  if (JS_IsException(v)) {
    JSValue exc = JS_GetException(g_ctx);
    JSCStringBuf b; size_t len;
    const char *msg = JS_ToCStringLen(g_ctx, &len, exc, &b);
    Serial.print("script threw: ");
    if (msg) Serial.write((const uint8_t *)msg, len);
    Serial.println();
  } else {
    Serial.println("--- script ran; draw log above ---");
  }
}

void loop() { delay(1000); }
