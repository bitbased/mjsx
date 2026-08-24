/*
 * mjsx compiled to WebAssembly — the SAME MicroQuickJS engine that targets
 * ESP32, run through Emscripten instead of the Arduino/Xtensa toolchain.
 * This is what makes engine parity a real, checkable claim rather than a
 * hope: a script that runs here ran through the identical interpreter a
 * chip would run it through, not a JS reimplementation of one.
 *
 * gfxN and sysN call out to JavaScript via EM_JS — for this first proof they
 * log to the browser/Node console, the same "prove the chain, defer real
 * pixels" scope the ESP32 minimal sketch used. A canvas-backed
 * implementation replaces only these functions; nothing above this file
 * (the engine, mjsx-core, an app) changes.
 */
#include <emscripten.h>
#include <emscripten/emscripten.h>
#include <math.h>
#include <string.h>
#include <stdio.h>
#include <stdlib.h>

#include "mquickjs.h"
#include "mquickjs_build.h"

static JSContext *g_ctx = NULL;
static uint8_t *g_mem = NULL;
#define JS_HEAP_BYTES (512 * 1024)

/* ---- what the stdlib expects the host to provide ---- */
static int64_t get_date_ms(void) { return (int64_t)emscripten_get_now(); }

JSValue js_date_constructor(JSContext *ctx, JSValue *this_val, int argc, JSValue *argv) {
    double val;
    argc &= ~FRAME_CF_CTOR;
    if (argc == 0) {
        val = (double)get_date_ms();
    } else if (argc == 1 && JS_IsNumber(ctx, argv[0])) {
        if (JS_ToNumber(ctx, &val, argv[0])) return JS_EXCEPTION;
    } else {
        return JS_ThrowTypeError(ctx, "unsupported Date() parameter");
    }
    return JS_NewDate(ctx, val);
}
JSValue js_date_now(JSContext *ctx, JSValue *this_val, int argc, JSValue *argv) {
    return JS_NewInt64(ctx, get_date_ms());
}
JSValue js_performance_now(JSContext *ctx, JSValue *this_val, int argc, JSValue *argv) {
    return JS_NewFloat64(ctx, emscripten_get_now());
}
JSValue js_gc(JSContext *ctx, JSValue *this_val, int argc, JSValue *argv) { return JS_UNDEFINED; }
JSValue js_load(JSContext *ctx, JSValue *this_val, int argc, JSValue *argv) {
    return JS_ThrowInternalError(ctx, "load() is not available on this host");
}
JSValue js_setTimeout(JSContext *ctx, JSValue *this_val, int argc, JSValue *argv) {
    return JS_ThrowInternalError(ctx, "setTimeout() is not available; the UI redraws on a tick");
}
JSValue js_clearTimeout(JSContext *ctx, JSValue *this_val, int argc, JSValue *argv) { return JS_UNDEFINED; }

EM_JS(void, jsConsoleWrite, (const char *buf, int len), {
  console.log(UTF8ToString(buf, len));
});
JSValue js_print(JSContext *ctx, JSValue *this_val, int argc, JSValue *argv) {
    int i;
    char line[512]; int used = 0;
    for (i = 0; i < argc && used < (int)sizeof(line) - 1; i++) {
        JSCStringBuf buf; const char *str; size_t len;
        if (i != 0 && used < (int)sizeof(line) - 1) line[used++] = ' ';
        str = JS_ToCStringLen(ctx, &len, argv[i], &buf);
        if (!str) return JS_EXCEPTION;
        int take = (int)len < (int)sizeof(line) - used - 1 ? (int)len : (int)sizeof(line) - used - 1;
        memcpy(line + used, str, take);
        used += take;
    }
    jsConsoleWrite(line, used);
    return JS_UNDEFINED;
}
static void jsLogFunc(void *opaque, const void *buf, size_t len) {
    (void)opaque;
    jsConsoleWrite((const char *)buf, (int)len);
}

/* ---- gfx.*: one EM_JS call per primitive, straight to a JS-side handler ---- */
EM_JS(void, gfxNClear, (unsigned rgb), { if (globalThis.mjsxGfx) globalThis.mjsxGfx.clear(rgb); });
EM_JS(void, gfxNRect, (int x, int y, int w, int h, unsigned rgb, int r, int fill), {
  if (globalThis.mjsxGfx) globalThis.mjsxGfx[fill ? 'frect' : 'rect'](x, y, w, h, rgb, r);
});
EM_JS(void, gfxNCircle, (int x, int y, int r, unsigned rgb, int fill), {
  if (globalThis.mjsxGfx) globalThis.mjsxGfx.circle(x, y, r, rgb, !!fill);
});
EM_JS(void, gfxNLine, (int x0, int y0, int x1, int y1, unsigned rgb), {
  if (globalThis.mjsxGfx) globalThis.mjsxGfx.line(x0, y0, x1, y1, rgb);
});
EM_JS(void, gfxNTextRaw, (int x, int y, int size, unsigned rgb, const char *s, int len), {
  if (globalThis.mjsxGfx) globalThis.mjsxGfx.text(x, y, size, rgb, UTF8ToString(s, len));
});
EM_JS(void, gfxNClip, (int x, int y, int w, int h), { if (globalThis.mjsxGfx) globalThis.mjsxGfx.clip(x, y, w, h); });
EM_JS(void, gfxNUnclip, (void), { if (globalThis.mjsxGfx) globalThis.mjsxGfx.unclip(); });
EM_JS(int, gfxNW, (void), { return (globalThis.mjsxGfx && globalThis.mjsxGfx.width) ? globalThis.mjsxGfx.width() : 240; });
EM_JS(int, gfxNH, (void), { return (globalThis.mjsxGfx && globalThis.mjsxGfx.height) ? globalThis.mjsxGfx.height() : 280; });

void sysNExit(void) { }
long sysNMillis(void) { return (long)emscripten_get_now(); }
void sysNBeep(int ok) { (void)ok; }
void sysNTone(int freq, int ms) { (void)freq; (void)ms; }
EM_JS(void, sysNStore, (const char *k, int klen, const char *v, int vlen), {
  try { localStorage.setItem(UTF8ToString(k, klen), UTF8ToString(v, vlen)); } catch (e) {}
});
EM_JS(int, sysNFetchRaw, (const char *k, int klen, char *out, int cap), {
  var v = ''; try { v = localStorage.getItem(UTF8ToString(k, klen)) || ''; } catch (e) {}
  return stringToUTF8(v, out, cap), Math.min(lengthBytesUTF8(v), cap - 1);
});

static int gi(JSContext *ctx, JSValue v) { int r = 0; JS_ToInt32Sat(ctx, &r, v); return r; }
static const char *gs(JSContext *ctx, JSValue v, JSCStringBuf *b, size_t *len) {
    *len = 0;
    if (!JS_IsString(ctx, v)) return "";
    const char *p = JS_ToCStringLen(ctx, len, v, b);
    return p ? p : "";
}
static size_t jslen(int n, size_t cap) { if (n < 0) return 0; return (size_t)n < cap ? (size_t)n : cap - 1; }

JSValue js_gfx_clear(JSContext *ctx, JSValue *t, int argc, JSValue *argv) { gfxNClear((unsigned)gi(ctx, argv[0])); return JS_UNDEFINED; }
JSValue js_gfx_rect(JSContext *ctx, JSValue *t, int argc, JSValue *argv) {
    gfxNRect(gi(ctx,argv[0]), gi(ctx,argv[1]), gi(ctx,argv[2]), gi(ctx,argv[3]), (unsigned)gi(ctx,argv[4]), argc > 5 ? gi(ctx,argv[5]) : 0, 0);
    return JS_UNDEFINED;
}
JSValue js_gfx_frect(JSContext *ctx, JSValue *t, int argc, JSValue *argv) {
    gfxNRect(gi(ctx,argv[0]), gi(ctx,argv[1]), gi(ctx,argv[2]), gi(ctx,argv[3]), (unsigned)gi(ctx,argv[4]), argc > 5 ? gi(ctx,argv[5]) : 0, 1);
    return JS_UNDEFINED;
}
JSValue js_gfx_circle(JSContext *ctx, JSValue *t, int argc, JSValue *argv) {
    gfxNCircle(gi(ctx,argv[0]), gi(ctx,argv[1]), gi(ctx,argv[2]), (unsigned)gi(ctx,argv[3]), argc > 4 ? gi(ctx,argv[4]) : 1);
    return JS_UNDEFINED;
}
JSValue js_gfx_line(JSContext *ctx, JSValue *t, int argc, JSValue *argv) {
    gfxNLine(gi(ctx,argv[0]), gi(ctx,argv[1]), gi(ctx,argv[2]), gi(ctx,argv[3]), (unsigned)gi(ctx,argv[4]));
    return JS_UNDEFINED;
}
JSValue js_gfx_text(JSContext *ctx, JSValue *t, int argc, JSValue *argv) {
    JSCStringBuf b; size_t len = 0; const char *s = 0;
    if (JS_IsString(ctx, argv[4])) s = JS_ToCStringLen(ctx, &len, argv[4], &b);
    if (s) gfxNTextRaw(gi(ctx,argv[0]), gi(ctx,argv[1]), gi(ctx,argv[2]), (unsigned)gi(ctx,argv[3]), s, (int)len);
    return JS_UNDEFINED;
}
JSValue js_gfx_clip(JSContext *ctx, JSValue *t, int argc, JSValue *argv) {
    gfxNClip(gi(ctx,argv[0]), gi(ctx,argv[1]), gi(ctx,argv[2]), gi(ctx,argv[3]));
    return JS_UNDEFINED;
}
JSValue js_gfx_unclip(JSContext *ctx, JSValue *t, int argc, JSValue *argv) { gfxNUnclip(); return JS_UNDEFINED; }
JSValue js_gfx_width(JSContext *ctx, JSValue *t, int argc, JSValue *argv) { return JS_NewInt32(ctx, gfxNW()); }
JSValue js_gfx_height(JSContext *ctx, JSValue *t, int argc, JSValue *argv) { return JS_NewInt32(ctx, gfxNH()); }

JSValue js_sys_exit(JSContext *ctx, JSValue *t, int argc, JSValue *argv) { sysNExit(); return JS_UNDEFINED; }
JSValue js_sys_millis(JSContext *ctx, JSValue *t, int argc, JSValue *argv) { return JS_NewInt64(ctx, sysNMillis()); }
JSValue js_sys_beep(JSContext *ctx, JSValue *t, int argc, JSValue *argv) { sysNBeep(argc > 0 ? gi(ctx, argv[0]) : 1); return JS_UNDEFINED; }
JSValue js_sys_tone(JSContext *ctx, JSValue *t, int argc, JSValue *argv) { sysNTone(gi(ctx, argv[0]), argc > 1 ? gi(ctx, argv[1]) : 150); return JS_UNDEFINED; }
JSValue js_sys_store(JSContext *ctx, JSValue *t, int argc, JSValue *argv) {
    JSCStringBuf b1, b2; size_t l1, l2;
    const char *k = gs(ctx, argv[0], &b1, &l1);
    const char *v = gs(ctx, argv[1], &b2, &l2);
    sysNStore(k, (int)l1, v, (int)l2);
    return JS_UNDEFINED;
}
JSValue js_sys_fetch(JSContext *ctx, JSValue *t, int argc, JSValue *argv) {
    JSCStringBuf b1; size_t l1; char out[1024];
    const char *k = gs(ctx, argv[0], &b1, &l1);
    int n = sysNFetchRaw(k, (int)l1, out, sizeof(out));
    return JS_NewStringLen(ctx, out, jslen(n, sizeof(out)));
}

#include "mjsx_stdlib.h"

/* ---- exported entry points, called from JS via Module.cwrap ---- */
EMSCRIPTEN_KEEPALIVE
int mjsxInit(void) {
    g_mem = (uint8_t *)malloc(JS_HEAP_BYTES);
    if (!g_mem) return 0;
    extern const JSSTDLibraryDef js_stdlib;
    g_ctx = JS_NewContext(g_mem, JS_HEAP_BYTES, &js_stdlib);
    if (!g_ctx) return 0;
    JS_SetLogFunc(g_ctx, jsLogFunc);
    return 1;
}

EMSCRIPTEN_KEEPALIVE
int mjsxEval(const char *src) {
    if (!g_ctx) return 0;
    JSValue v = JS_Eval(g_ctx, src, strlen(src), "<eval>", JS_EVAL_REPL);
    return !JS_IsException(v);
}

/* Runs UI.ticker() + UI.render() once, mirroring what a host's frame loop
   calls on every tick. Returns whether the ticker reported dirty. */
EMSCRIPTEN_KEEPALIVE
int mjsxRenderTick(void) {
    if (!g_ctx) return 0;
    return mjsxEval("if (UI.ticker()) UI.render();");
}
