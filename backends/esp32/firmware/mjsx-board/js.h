#pragma once
/*
 * JavaScript on the board, via MicroQuickJS.
 *
 * The point is that the parts of this device that change most — how the screen
 * is laid out, what a scanned tag should trigger — can change without building
 * and flashing firmware. Flashing this board over USB is slow and unreliable
 * enough that "edit, reload" is worth real effort.
 *
 * MicroQuickJS suits it: plain portable C with almost no libc dependency (no
 * malloc, free or printf of its own), ~100 kB of code, and it runs from a fixed
 * memory buffer handed to it at startup — which on this board comes out of the
 * 8 MB of PSRAM that is otherwise idle.
 *
 * What stays native, deliberately:
 *   - the NFC transport, which is timing sensitive
 *   - the printer WebSocket client, so a scan still applies with no script
 *   - touch reading and the keyboard, which want to feel immediate
 *
 * ES5-ish subset, stricter than the browser: no async, no generators, no
 * classes. That is not a limitation worth fighting for a UI script.
 */

#include "config.h"

#if HAS_JS

#include <esp_heap_caps.h>
#include <LittleFS.h>
#include "mbedtls/base64.h"

extern "C" {
#include "src/mquickjs/cutils.h"
#include "src/mquickjs/mquickjs.h"
// The stdlib tables live in glue.c, which also supplies the functions they
// name (print, Date). Generated on the host and committed, so no build step is
// needed here — see scripts/gen-js-stdlib.sh.
extern const JSSTDLibraryDef js_stdlib;
}

// The engine's heap. Small by desktop standards, enormous for what a layout
// script needs, and it comes from PSRAM so it costs no internal RAM.
#ifndef JS_HEAP_INTERNAL
#define JS_HEAP_INTERNAL 0
#endif
#ifndef JS_HEAP_BYTES
// Generous, because it comes from PSRAM: scripts that build a UI tree want more
// than the 64 kB the upstream example uses for a console.
#define JS_HEAP_BYTES (2 * 1024 * 1024)
#endif

static uint8_t *g_jsMem = nullptr;
static JSContext *g_jsCtx = nullptr;
/** Where the engine's memory came from, for the `jsinfo` diagnostic. */
static const char *g_jsWhere = "not started";

/**
 * Stage counters.
 *
 * The failure so far has no crash, no reboot and no response — so the only way
 * to find where it stops is to record how far it got, and read that back on a
 * later request.
 */
static volatile uint32_t g_evStage[6] = {0, 0, 0, 0, 0, 0};
enum { EV_ENTER, EV_TASK_OK, EV_TASK_RUN, EV_EVALED, EV_DONE, EV_TIMEOUT };

/** Anything the script logs, kept for the caller to read back. */
static String g_jsLog;

/** Collect output, bounded so a script in a loop cannot grow it without end. */
static void jsAppendLog(const char *p, size_t len) {
  if (g_jsLog.length() > 2048) return;
  for (size_t i = 0; i < len; i++) g_jsLog += p[i];
}

extern "C" void jsLogFunc(void *opaque, const void *buf, size_t len) {
  (void)opaque;
  jsAppendLog((const char *)buf, len);
}

/** What `print` and `console.log` call, from glue.c. */
extern "C" void jsGlueWrite(const char *buf, size_t len) { jsAppendLog(buf, len); }

/**
 * Start the engine.
 *
 * Returns false when the heap cannot be had — the bridge then runs exactly as
 * it did before, because nothing else depends on this.
 */
static bool jsBegin() {
  if (g_jsCtx) return true;
  // Internal RAM, not PSRAM.
  //
  // PSRAM is the obvious home for a 64 kB heap and it allocated there happily,
  // but evaluating anything on it took the board down. The engine stores
  // strings as UTF-8 and works the heap at byte granularity, which is exactly
  // the access pattern PSRAM is worst at. 64 kB out of ~270 kB of internal RAM
  // is affordable; a crash is not.
  // PSRAM, aligned.
  //
  // There is 8 MB of it and the engine is the only thing here big enough to
  // want it. Keeping the heap out of internal RAM matters for a second reason:
  // internal RAM is what lwIP allocates from, and starving it dropped the very
  // connection waiting on the answer. (An earlier attempt blamed PSRAM for
  // crashes that turned out to be a stale TCP client.)
#if JS_HEAP_INTERNAL
  // Measured: a small object costs ~12 us to allocate with the heap in PSRAM
  // and the UI spends most of a frame allocating. Internal RAM is worth trying
  // when the heap is small enough to spare it.
  g_jsMem = (uint8_t *)heap_caps_aligned_alloc(16, JS_HEAP_BYTES,
                                               MALLOC_CAP_INTERNAL | MALLOC_CAP_8BIT);
  g_jsWhere = g_jsMem ? "internal" : "";
  if (!g_jsMem)
#endif
  g_jsMem = (uint8_t *)heap_caps_aligned_alloc(16, JS_HEAP_BYTES, MALLOC_CAP_SPIRAM);
  if (!g_jsWhere || !g_jsWhere[0]) g_jsWhere = g_jsMem ? "psram" : "";
  if (!g_jsMem) {
    g_jsMem = (uint8_t *)heap_caps_aligned_alloc(16, JS_HEAP_BYTES,
                                                 MALLOC_CAP_INTERNAL | MALLOC_CAP_8BIT);
    g_jsWhere = g_jsMem ? "internal" : "none";
  }
  if (!g_jsMem) return false;

  g_jsCtx = JS_NewContext(g_jsMem, JS_HEAP_BYTES, &js_stdlib);
  if (!g_jsCtx) {
    free(g_jsMem);
    g_jsMem = nullptr;
    return false;
  }
  JS_SetLogFunc(g_jsCtx, jsLogFunc);
  return true;
}

/**
 * Evaluate a snippet and describe the result.
 *
 * The value is rendered rather than returned as a JSValue: everything on the
 * other side of this is JSON on a wire, and a string is what it wants.
 */
/**
 * Evaluation runs asynchronously.
 *
 * The obvious shape — run the script and answer with its value — means the
 * bridge stops serving while a script runs. In practice that lost the reply
 * entirely: the work completed (the stage counters proved it) but the response
 * never reached the client, because the loop that would have delivered it was
 * the one blocked waiting. So `eval` starts the work and answers at once, and
 * the result is collected afterwards.
 *
 * It is also just the right shape for a device: a slow script should never take
 * the readers or the printer link down with it.
 */
static String g_jsSrc;      // copied, because the request buffer is reused
static String g_jsResult;
static volatile bool g_jsBusy = false;
static volatile bool g_jsHasResult = false;
static volatile bool g_jsOk = false;
static volatile bool g_jsKick = false;
/** How long each stage took, so "slow" and "stuck" can be told apart. */
static volatile uint32_t g_msBegin = 0, g_msEval = 0, g_msTotal = 0;

/**
 * Render any JSValue as text.
 *
 * Two things make this less obvious than it looks. The pointer returned by
 * JS_ToCStringLen is **not NUL-terminated** — upstream writes it with fwrite
 * and an explicit length — so treating it as a C string reads past the end and
 * yields whatever follows in memory. And it only applies to string values, so
 * anything else has to be converted first.
 *
 * Getting this wrong produced a plausible-looking reply with a garbled value,
 * which the host then failed to parse: the board looked unresponsive when it
 * had in fact answered.
 */
static String jsToString(JSValue v, const char *fallback) {
  // Let the engine render its own values.
  //
  // JS_PrintValueF handles every type — objects, arrays, errors — and writes
  // through the log function, all inside the engine where the collector can
  // see what it is doing. The hand-rolled version this replaces got numbers
  // corrupted by GC movement, missed objects entirely, and could not display
  // an exception. Rendering values is the engine's job.
  const size_t before = g_jsLog.length();
  JS_PrintValueF(g_jsCtx, v, JS_DUMP_LONG | JS_DUMP_NOQUOTE);
  String out = g_jsLog.substring(before);
  g_jsLog.remove(before);  // the capture is a result, not part of the script's log
  return out.length() ? out : String(fallback);
}

static String jsSelfTest();  // defined below; the worker runs it on demand

// ---- the JS-owned screen ----
static volatile bool g_jsUiActive = false;

/**
 * Pointer events on their way to the script.
 *
 * A ring, not a slot: press and release are edges and cannot be coalesced away,
 * and a drag that lost its press would scroll from the wrong origin. Moves in
 * between are positions rather than deltas, so when the ring is full the newest
 * move overwrites the previous one — dropping intermediate samples costs
 * smoothness, dropping an edge costs correctness.
 */
struct JsPtrEv { uint8_t phase; int16_t x, y; };
#define JS_PTR_Q 16
static JsPtrEv g_ptrQ[JS_PTR_Q];
static volatile uint8_t g_ptrHead = 0, g_ptrTail = 0;

/** Touch hook installed into ui.h while a script owns the screen. */
static void jsPointerFwd(int phase, int x, int y) {
  uint8_t next = (g_ptrHead + 1) % JS_PTR_Q;
  if (next == g_ptrTail) {
    if (phase != 1) return;  // full and this is an edge: better late than lost
    uint8_t prev = (g_ptrHead + JS_PTR_Q - 1) % JS_PTR_Q;
    if (g_ptrQ[prev].phase == 1) { g_ptrQ[prev].x = x; g_ptrQ[prev].y = y; }
    return;
  }
  g_ptrQ[g_ptrHead].phase = (uint8_t)phase;
  g_ptrQ[g_ptrHead].x = (int16_t)x;
  g_ptrQ[g_ptrHead].y = (int16_t)y;
  g_ptrHead = next;
}

/** Set by sys.exit() from inside a script; applied by the worker loop. */
static volatile bool g_jsExitReq = false;
/** Set when a script (re)starts: every feed must resend its snapshot, because
 *  the new script begins from defaults and dedup caches say "already sent". */
static volatile bool g_jsFeedResync = false;
extern "C" void sysNExit(void) { g_jsExitReq = true; }
extern "C" long sysNMillis(void) { return (long)millis(); }
extern "C" void gfxNFlush(void);
void uiSetDrawUs(uint32_t us);

/**
 * State pushed at the UI from the native side (scans, link changes).
 *
 * A single latest-wins slot: each producer sends a self-contained snapshot of
 * its own keys, so dropping an older pending patch loses nothing that the
 * newer one does not restate.
 */
/* A small ring, single producer (the loop task) and single consumer (the
   worker). One latest-wins slot lost patches whenever two arrived inside a
   consumer tick — the link snapshot never survived the printer snapshot sent
   right behind it. */
#define JS_PATCH_Q 4
static String g_patchQ[JS_PATCH_Q];
static volatile uint8_t g_patchHead = 0, g_patchTail = 0;

/**
 * The queue crosses tasks, so it needs a lock.
 *
 * Both sides assign Arduino Strings, which free and allocate on the heap — a
 * producer writing a slot while the consumer clears one puts two tasks in
 * malloc at once, and the result is a corrupted heap rather than a lost
 * message. Rare while the producer was the main loop; frequent once the
 * printer had a task of its own.
 *
 * Created before any task exists rather than on first use: two tasks racing to
 * create a mutex get one each, and a lock nobody shares is not a lock.
 */
static SemaphoreHandle_t g_patchMux = nullptr;
static void jsQueueInit() {
  if (!g_patchMux) g_patchMux = xSemaphoreCreateMutex();
}

static void jsQueueState(const String &json) {
  if (g_patchMux) xSemaphoreTake(g_patchMux, portMAX_DELAY);
  uint8_t next = (g_patchHead + 1) % JS_PATCH_Q;
  if (next != g_patchTail) {   // full: drop the newcomer, keep order
    g_patchQ[g_patchHead] = json;
    g_patchHead = next;
  }
  if (g_patchMux) xSemaphoreGive(g_patchMux);
}

/** Take one message, or false when empty. Copied out under the lock so the JS
 *  call that follows does not hold the producer up. */
static bool jsQueueTake(String &out) {
  bool got = false;
  if (g_patchMux) xSemaphoreTake(g_patchMux, portMAX_DELAY);
  if (g_patchTail != g_patchHead) {
    out = g_patchQ[g_patchTail];
    g_patchQ[g_patchTail] = "";
    g_patchTail = (g_patchTail + 1) % JS_PATCH_Q;
    got = true;
  }
  if (g_patchMux) xSemaphoreGive(g_patchMux);
  return got;
}

/** Call UI.<method>(oneStringArg) — worker task only. */
static JSValue jsCallUIStr(const char *method, const char *arg, size_t len) {
  JSValue g = JS_GetGlobalObject(g_jsCtx);
  JSValue ui = JS_GetPropertyStr(g_jsCtx, g, "UI");
  JSValue fn = JS_GetPropertyStr(g_jsCtx, ui, method);
  if (JS_IsException(fn)) return fn;
  JS_StackCheck(g_jsCtx, 3);
  JS_PushArg(g_jsCtx, JS_NewStringLen(g_jsCtx, arg, len));
  JS_PushArg(g_jsCtx, fn);
  JS_PushArg(g_jsCtx, ui);
  return JS_Call(g_jsCtx, 1);
}

/**
 * Call UI.<method>(args...) — worker task only.
 *
 * Argument order is the engine's documented contract: args pushed in reverse,
 * then the function, then `this`. Getting that wrong does not error cleanly;
 * it calls one of the arguments.
 */
static JSValue jsCallUI(const char *method, int argc, const int *args) {
  JSValue g = JS_GetGlobalObject(g_jsCtx);
  JSValue ui = JS_GetPropertyStr(g_jsCtx, g, "UI");
  JSValue fn = JS_GetPropertyStr(g_jsCtx, ui, method);
  if (JS_IsException(fn)) return fn;
  JS_StackCheck(g_jsCtx, argc + 2);
  for (int i = argc - 1; i >= 0; i--) JS_PushArg(g_jsCtx, JS_NewInt32(g_jsCtx, args[i]));
  JS_PushArg(g_jsCtx, fn);
  JS_PushArg(g_jsCtx, ui);
  return JS_Call(g_jsCtx, argc);
}

/**
 * Evaluate one file from the script store. Returns false on any failure.
 *
 * Read into PSRAM rather than an Arduino String. A String needs one contiguous
 * block of INTERNAL heap, and once the UI bundle passed 64 kB that allocation
 * started coming back short — which is not an error you get told about: the
 * partial source parses until it runs off the end, and the engine reports a
 * syntax error on the last line of the last function. The size is also checked
 * against what was read, so a short read says so instead of being compiled.
 */
static bool jsRunFile(const char *path, String &err) {
  File f = LittleFS.open(path, "r");
  if (!f) { err = String("no such file: ") + path; return false; }
  const size_t want = f.size();
  char *src = (char *)heap_caps_malloc(want + 1, MALLOC_CAP_SPIRAM);
  if (!src) src = (char *)malloc(want + 1);
  if (!src) { f.close(); err = String("no memory for ") + want + " bytes"; return false; }
  const size_t got = f.readBytes(src, want);
  src[got] = 0;
  f.close();
  if (got != want) {
    free(src);
    err = String("short read: ") + got + " of " + want + " bytes";
    return false;
  }
  JSValue v = JS_Eval(g_jsCtx, src, got, path, JS_EVAL_REPL);
  free(src);
  if (JS_IsException(v)) {
    err = jsToString(JS_GetException(g_jsCtx), "exception");
    return false;
  }
  return true;
}

/**
 * One long-lived worker, not a task per script.
 *
 * Creating a 32 kB task for every evaluation left lwIP short of internal RAM
 * and dropped the very TCP connection that was waiting for the answer — the
 * board looked hung while it was in fact fine. One worker, created once, costs
 * that memory once.
 */
static TaskHandle_t g_jsTask = nullptr;

static void jsWorker(void *arg) {
  (void)arg;
  for (;;) {
    // Timed wait rather than forever: between requests this task is also the
    // UI thread — it owns the engine, so taps and renders have to happen here.
    // The wait is also the UI's frame budget: at 40 ms a dragged list visibly
    // lagged the finger, and the redraw itself is a few ms plus one blit.
    uint32_t got = ulTaskNotifyTake(pdTRUE, pdMS_TO_TICKS(16));

    if (!got) {
      if (g_jsUiActive && g_jsCtx) {
        // Every queued sample, in order: the script reconstructs the stroke.
        while (g_ptrTail != g_ptrHead) {
          JsPtrEv e = g_ptrQ[g_ptrTail];
          g_ptrTail = (g_ptrTail + 1) % JS_PTR_Q;
          int a[3] = { e.phase, e.x, e.y };
          jsCallUI("pointer", 3, a);
        }
        for (;;) {
          String pt;
          if (!jsQueueTake(pt)) break;
          jsCallUIStr("patch", pt.c_str(), pt.length());
        }
        if (g_jsExitReq) {
          g_jsExitReq = false;
          g_jsUiActive = false;
          uiSetExternal(false, nullptr);
        }
        // ticker(), not dirty(): it runs the app's onTick (polling native
        // state that has no push feed) and reports dirtiness in one call.
        JSValue d = jsCallUI("ticker", 0, nullptr);
        if (d == JS_TRUE) {
          // Bracketed so a screenshot can tell a finished frame from one in
          // progress: the buffer is cleared at the start of a render, so a read
          // landing mid-flight gives a blank or torn picture.
          uiFrameBegin();
          const uint32_t fr0 = micros();
          jsCallUI("render", 0, nullptr);
          // Drawing and blitting timed apart: they are optimised in completely
          // different places — one is pixels into the canvas, the other is
          // bytes down the SPI bus — and a single total hides which is which.
          uiSetDrawUs(micros() - fr0);
          gfxNFlush();  // one blit per frame; drawing happened off-screen
          uiFrameEnd();
        }
        // A crashed app must not hold the screen hostage: exceptions are
        // cleared per pump, but if they arrive EVERY pump the app is
        // wedged -- hand the screen back to the native pages so the
        // board stays operable (wifi setup, rescue) without its bundle.
        static int consecExc = 0;
        if (JS_HasException(g_jsCtx)) {
          JS_GetException(g_jsCtx);  // never let one linger
          if (g_jsUiActive && ++consecExc > 40) {
            consecExc = 0;
            g_jsUiActive = false;
            uiSetExternal(false, nullptr);
          }
        } else {
          consecExc = 0;
        }
      }
      continue;
    }
    g_evStage[EV_TASK_RUN]++;

    const uint32_t t0 = millis();
    if (g_jsSrc == "\x02selftest") {
      g_jsResult = jsSelfTest();
      g_jsOk = true;
    } else if (g_jsSrc.startsWith("\x03run:")) {
      String err;
      if (!jsBegin()) {
        g_jsResult = "no memory for the JS engine";
        g_jsOk = false;
      } else if (jsRunFile(g_jsSrc.c_str() + 5, err)) {
        // The script takes the screen only if it actually defined a UI.
        JSValue g2 = JS_GetGlobalObject(g_jsCtx);
        JSValue ui = JS_GetPropertyStr(g_jsCtx, g2, "UI");
        g_jsUiActive = !JS_IsUndefined(ui) && !JS_IsException(ui);
        uiSetExternal(g_jsUiActive, jsPointerFwd);
        g_jsFeedResync = true;
        g_jsResult = g_jsUiActive ? "script running, UI active" : "script ran (no UI object)";
        g_jsOk = true;
      } else {
        g_jsResult = err;
        g_jsOk = false;
      }
    } else if (!jsBegin()) {
      g_jsResult = "no memory for the JS engine";
      g_jsOk = false;
    } else {
      const uint32_t t1 = millis();
      g_msBegin = t1 - t0;
      // JS_EVAL_RETVAL is what makes a program evaluate to its last expression;
      // without it every script returns undefined, which looks like a broken
      // engine. JS_EVAL_REPL allows implicit globals, matching what people
      // expect when typing at a prompt.
      JSValue val = JS_Eval(g_jsCtx, g_jsSrc.c_str(), g_jsSrc.length(), "<eval>",
                            JS_EVAL_RETVAL | JS_EVAL_REPL);
      g_msEval = millis() - t1;
      g_evStage[EV_EVALED]++;

      if (JS_IsException(val)) {
        g_jsResult = jsToString(JS_GetException(g_jsCtx), "exception");
        g_jsOk = false;
      } else {
        g_jsResult = jsToString(val, "undefined");
        g_jsOk = true;
      }
    }
    g_msTotal = millis() - t0;
    g_evStage[EV_DONE]++;
    g_jsHasResult = true;
    g_jsBusy = false;
  }
}

/**
 * Built-in self-test: the same case list the host harness passes, run
 * back-to-back on the worker with no transport involved. One command, all
 * results — it separates "the engine is broken on-device" from "the eval
 * command path is corrupting something" in a single observation.
 */
static const char *JS_SELFTEST[] = {
  "1+1",
  "'hello ' + 'board'",
  "[1,2,3].map(function(x){return x*x}).join(',')",
  "JSON.stringify({m:'01001',c:'FF6600'})",
  "print('from JS'); 'done'",
  "(function f(n){return n<2?n:f(n-1)+f(n-2)})(22)",
  "1===1",
  "var st={page:0}; st.page=2; st.page",
  "nope.bad",
  "'after error still works'",
};

static String jsSelfTest() {
  String report;
  if (!jsBegin()) return String("engine did not start");
  for (size_t i = 0; i < sizeof(JS_SELFTEST) / sizeof(JS_SELFTEST[0]); i++) {
    const char *src = JS_SELFTEST[i];
    JSValue v = JS_Eval(g_jsCtx, src, strlen(src), "<test>", JS_EVAL_RETVAL | JS_EVAL_REPL);
    if (JS_IsException(v)) {
      report += "ERR ";
      report += jsToString(JS_GetException(g_jsCtx), "exception");
    } else {
      report += "ok ";
      report += jsToString(v, "undefined");
    }
    report += " | ";
  }
  return report;
}

/** Begin evaluating. Returns false only if something is already running. */
static bool jsEvalStart(const char *src) {
  if (g_jsBusy) return false;
  g_evStage[EV_ENTER]++;
  g_jsSrc = src;
  g_jsLog = "";
  g_jsResult = "";
  g_jsHasResult = false;
  g_jsOk = false;

  if (!g_jsTask) {
    // 16 kB: the VM avoids the CPU stack, but the parser recurses, so the
    // 8 kB the Arduino loop task gets is not enough.
    //
    // Pinned to the Arduino core. Unpinned, the worker could run on the other
    // core concurrently with the loop task, and a quick second eval reset the
    // board — with 2.5 s between evals it never did. Same core means the two
    // never touch the engine and the transport at the same instant.
    if (xTaskCreatePinnedToCore(jsWorker, "jsworker", 16384, nullptr, 1, &g_jsTask,
                                ARDUINO_RUNNING_CORE) != pdPASS) {
      g_jsTask = nullptr;
      g_jsResult = "could not start the JS worker";
      g_jsHasResult = true;
      return true;
    }
    g_evStage[EV_TASK_OK]++;
  }

  g_jsBusy = true;
  g_jsKick = true;  // released by jsPump() after the reply has gone out
  return true;
}

/**
 * Hand the worker its go signal, from loop().
 *
 * Deliberately not done in jsEvalStart: that runs mid-request, and waking the
 * worker there put the evaluation and the reply serialisation in a race.
 * Releasing it here means the reply is already on the wire.
 */
static void jsPump() {
  if (g_jsKick && g_jsTask) {
    g_jsKick = false;
    xTaskNotifyGive(g_jsTask);
  }
}

/** Mount the script store (the 7.9 MB "storage" partition). */
static int g_fsFormats = -1;   /* how many times the store was formatted */
static bool jsFsBegin() {
  static bool mounted = false;
  if (mounted) return true;
  /* NEVER format on the first miss: a transient mount failure used to
     silently ERASE the script store ("none found" out of nowhere).
     Retry, and only format -- counted, visibly -- when the filesystem
     is truly unmountable, because an unmountable store is useless until
     formatted anyway. */
  mounted = LittleFS.begin(false, "/lfs", 10, "storage");
  if (!mounted) {
    delay(50);
    mounted = LittleFS.begin(false, "/lfs", 10, "storage");
  }
  if (!mounted) {
    mounted = LittleFS.begin(true, "/lfs", 10, "storage");
    if (mounted) {
      Preferences pf;
      pf.begin("filrfid", false);
      g_fsFormats = pf.getInt("fsfmt", 0) + 1;
      pf.putInt("fsfmt", g_fsFormats);
      pf.end();
    }
  }
  return mounted;
}

/** Append a base64 chunk to a file; first=true truncates. */
static bool jsFilePut(const char *path, const char *b64, bool first, String &err) {
  if (!jsFsBegin()) { err = "script store failed to mount"; return false; }
  size_t inLen = strlen(b64);
  size_t outCap = (inLen * 3) / 4 + 4;
  uint8_t *buf = (uint8_t *)malloc(outCap);
  if (!buf) { err = "no memory"; return false; }
  size_t outLen = 0;
  if (mbedtls_base64_decode(buf, outCap, &outLen, (const uint8_t *)b64, inLen) != 0) {
    free(buf);
    err = "bad base64";
    return false;
  }
  File f = LittleFS.open(path, first ? "w" : "a");
  if (!f) { free(buf); err = "cannot open file"; return false; }
  f.write(buf, outLen);
  f.close();
  free(buf);
  return true;
}

static bool jsBusy() { return g_jsBusy; }
static bool jsHasResult() { return g_jsHasResult; }
static bool jsResultOk() { return g_jsOk; }
static const String &jsResult() { return g_jsResult; }

/** What the last script printed, if anything. */
static const String &jsLog() { return g_jsLog; }

/** Did the engine start, and out of which heap? */
static bool jsReady() { return g_jsCtx != nullptr; }
/** Report readiness without starting anything: starting belongs to the JS task. */
static bool jsStart() { return jsReady(); }
static const char *jsWhere() { return g_jsWhere; }
static size_t jsFreePsram() { return heap_caps_get_free_size(MALLOC_CAP_SPIRAM); }
static uint32_t jsStage(int i) { return (i >= 0 && i < 6) ? g_evStage[i] : 0; }
static uint32_t jsMsBegin() { return g_msBegin; }
static uint32_t jsMsEval() { return g_msEval; }
static uint32_t jsMsTotal() { return g_msTotal; }

/** Free the engine, so a bad script cannot hold the heap forever. */
static void jsReset() {
  if (g_jsCtx) {
    JS_FreeContext(g_jsCtx);
    g_jsCtx = nullptr;
  }
  if (g_jsMem) {
    free(g_jsMem);
    g_jsMem = nullptr;
  }
}

#else

static const String &jsLog() {
  static String empty;
  return empty;
}
static void jsReset() {}
static void jsPump() {}
static bool jsReady() { return false; }
static bool jsStart() { return false; }
static const char *jsWhere() { return "no js"; }
static size_t jsFreePsram() { return 0; }
static uint32_t jsStage(int i) { (void)i; return 0; }
static uint32_t jsMsBegin() { return 0; }
static uint32_t jsMsEval() { return 0; }
static uint32_t jsMsTotal() { return 0; }
static bool jsEvalStart(const char *src) { (void)src; return false; }
static bool jsBusy() { return false; }
static bool jsHasResult() { return false; }
static bool jsResultOk() { return false; }
static const String &jsResult() {
  static String s = "built without JS";
  return s;
}

#endif  // HAS_JS
