/*
 * What mjsx's native-api stdlib expects the host application to provide.
 *
 * This file is pure C, engine-side JS-value marshalling only — every actual
 * implementation (gfxN and sysN) is `extern`, supplied by whatever the host
 * sketch links in. A display-less build can make every one of them a
 * no-op and a script still runs harmlessly; that's deliberate, the same
 * way HAS_DISPLAY=0 works in the filament-rfid firmware this was ported
 * from.
 *
 * The generated stdlib table (mjsx_stdlib.h) is included at the bottom,
 * after every function it names exists — the order MicroQuickJS's own
 * example uses.
 */
#include <math.h>
#include <string.h>
#include <stdio.h>

#include "mquickjs.h"
#include "mquickjs_build.h"

/* Provided by the host sketch; anything a script prints ends up here. */
void jsGlueWrite(const char *buf, size_t len);

extern unsigned long millis(void);
static int64_t get_date_ms(void) { return (int64_t)millis(); }

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

JSValue js_print(JSContext *ctx, JSValue *this_val, int argc, JSValue *argv) {
    int i;
    for (i = 0; i < argc; i++) {
        JSCStringBuf buf;
        const char *str;
        size_t len;
        if (i != 0) jsGlueWrite(" ", 1);
        str = JS_ToCStringLen(ctx, &len, argv[i], &buf);
        if (!str) return JS_EXCEPTION;
        jsGlueWrite(str, len);
    }
    jsGlueWrite("\n", 1);
    return JS_UNDEFINED;
}

JSValue js_performance_now(JSContext *ctx, JSValue *this_val, int argc, JSValue *argv) {
    return JS_NewFloat64(ctx, (double)millis());
}

JSValue js_gc(JSContext *ctx, JSValue *this_val, int argc, JSValue *argv) {
    return JS_UNDEFINED; /* the engine collects on demand */
}

JSValue js_load(JSContext *ctx, JSValue *this_val, int argc, JSValue *argv) {
    return JS_ThrowInternalError(ctx, "load() is not available on this host");
}

JSValue js_setTimeout(JSContext *ctx, JSValue *this_val, int argc, JSValue *argv) {
    return JS_ThrowInternalError(ctx, "setTimeout() is not available; the UI redraws on a tick");
}

JSValue js_clearTimeout(JSContext *ctx, JSValue *this_val, int argc, JSValue *argv) {
    return JS_UNDEFINED;
}

/*
 * gfx: thin wrappers over native draw calls. The real drawing lives in the
 * host sketch behind a C ABI — a panel driver is usually C++, this file is
 * C, and every mjsx backend (real panel, pixel buffer, structured stream)
 * implements the same eight functions below.
 */
extern void gfxNClear(unsigned rgb);
extern void gfxNRect(int x, int y, int w, int h, unsigned rgb, int r, int fill);
extern void gfxNCircle(int x, int y, int r, unsigned rgb, int fill);
extern void gfxNLine(int x0, int y0, int x1, int y1, unsigned rgb);
extern void gfxNText(int x, int y, int size, unsigned rgb, const char *s, int len);
extern void gfxNClip(int x, int y, int w, int h);
extern void gfxNUnclip(void);
extern int gfxNW(void);
extern int gfxNH(void);

extern void sysNExit(void);
extern long sysNMillis(void);
extern void sysNBeep(int ok);
extern void sysNTone(int freq, int ms);
extern void sysNStore(const char *k, int klen, const char *v, int vlen);
extern int sysNFetch(const char *k, int klen, char *out, int cap);

static int gi(JSContext *ctx, JSValue v) { int r = 0; JS_ToInt32Sat(ctx, &r, v); return r; }
static const char *gs(JSContext *ctx, JSValue v, JSCStringBuf *b, size_t *len) {
    *len = 0;
    if (!JS_IsString(ctx, v)) return "";
    const char *p = JS_ToCStringLen(ctx, len, v, b);
    return p ? p : "";
}
/** Clamp an snprintf return to what the buffer actually holds. */
static size_t jslen(int n, size_t cap) {
    if (n < 0) return 0;
    return (size_t)n < cap ? (size_t)n : cap - 1;
}

JSValue js_gfx_clear(JSContext *ctx, JSValue *t, int argc, JSValue *argv) {
    gfxNClear((unsigned)gi(ctx, argv[0]));
    return JS_UNDEFINED;
}
JSValue js_gfx_rect(JSContext *ctx, JSValue *t, int argc, JSValue *argv) {
    gfxNRect(gi(ctx,argv[0]), gi(ctx,argv[1]), gi(ctx,argv[2]), gi(ctx,argv[3]),
             (unsigned)gi(ctx,argv[4]), argc > 5 ? gi(ctx,argv[5]) : 0, 0);
    return JS_UNDEFINED;
}
JSValue js_gfx_frect(JSContext *ctx, JSValue *t, int argc, JSValue *argv) {
    gfxNRect(gi(ctx,argv[0]), gi(ctx,argv[1]), gi(ctx,argv[2]), gi(ctx,argv[3]),
             (unsigned)gi(ctx,argv[4]), argc > 5 ? gi(ctx,argv[5]) : 0, 1);
    return JS_UNDEFINED;
}
JSValue js_gfx_circle(JSContext *ctx, JSValue *t, int argc, JSValue *argv) {
    gfxNCircle(gi(ctx,argv[0]), gi(ctx,argv[1]), gi(ctx,argv[2]),
               (unsigned)gi(ctx,argv[3]), argc > 4 ? gi(ctx,argv[4]) : 1);
    return JS_UNDEFINED;
}
JSValue js_gfx_line(JSContext *ctx, JSValue *t, int argc, JSValue *argv) {
    gfxNLine(gi(ctx,argv[0]), gi(ctx,argv[1]), gi(ctx,argv[2]), gi(ctx,argv[3]),
             (unsigned)gi(ctx,argv[4]));
    return JS_UNDEFINED;
}
JSValue js_gfx_text(JSContext *ctx, JSValue *t, int argc, JSValue *argv) {
    JSCStringBuf b; size_t len = 0; const char *s = 0;
    if (JS_IsString(ctx, argv[4])) s = JS_ToCStringLen(ctx, &len, argv[4], &b);
    if (s) gfxNText(gi(ctx,argv[0]), gi(ctx,argv[1]), gi(ctx,argv[2]),
                    (unsigned)gi(ctx,argv[3]), s, (int)len);
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
JSValue js_sys_tone(JSContext *ctx, JSValue *t, int argc, JSValue *argv) {
    sysNTone(gi(ctx, argv[0]), argc > 1 ? gi(ctx, argv[1]) : 150);
    return JS_UNDEFINED;
}
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
    int n = sysNFetch(k, (int)l1, out, sizeof(out));
    return JS_NewStringLen(ctx, out, jslen(n, sizeof(out)));
}

#include "mjsx_stdlib.h"
