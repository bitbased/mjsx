/*
 * What the standard library expects the application to provide.
 *
 * MicroQuickJS's stdlib tables reference `print` and `Date` but do not
 * implement them — the embedder does, because what they mean depends on the
 * device. Here `print` goes to the log the `eval` command reads back, and time
 * comes from the board's own clock.
 *
 * The generated table header is included at the bottom, after the functions it
 * names exist, which is the order the upstream example uses.
 */
#include <math.h>
#include <string.h>
#include <stdio.h>

#include "mquickjs.h"
#include "mquickjs_build.h"

/* Provided by js.h; anything a script prints ends up here. */
void jsGlueWrite(const char *buf, size_t len);

/* Milliseconds since boot. There is no wall clock unless the RTC is read, and
   a monotonic clock is what scripts actually want for timing. */
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

/*
 * The remaining hooks the library expects.
 *
 * A device is not a shell: there is no file to `load`, and timers belong to the
 * firmware's own loop rather than to a script that may not be running. They are
 * defined so the stdlib links, and refuse honestly rather than pretending.
 */
JSValue js_performance_now(JSContext *ctx, JSValue *this_val, int argc, JSValue *argv) {
    return JS_NewFloat64(ctx, (double)millis());
}

JSValue js_gc(JSContext *ctx, JSValue *this_val, int argc, JSValue *argv) {
    /* The engine collects on demand; nothing useful to force from a script. */
    return JS_UNDEFINED;
}

JSValue js_load(JSContext *ctx, JSValue *this_val, int argc, JSValue *argv) {
    return JS_ThrowInternalError(ctx, "load() is not available on the device");
}

JSValue js_setTimeout(JSContext *ctx, JSValue *this_val, int argc, JSValue *argv) {
    return JS_ThrowInternalError(ctx, "setTimeout() is not available; the UI redraws on a tick");
}

JSValue js_clearTimeout(JSContext *ctx, JSValue *this_val, int argc, JSValue *argv) {
    return JS_UNDEFINED;
}

/*
 * The gfx object: thin wrappers over native draw calls.
 *
 * The real drawing lives in the sketch (ui.h) behind a C ABI, because the
 * panel driver is C++ and this file is C. On a display-less build the natives
 * are no-ops, so a UI script runs harmlessly.
 */
extern void gfxNClear(unsigned rgb);
extern void gfxNRect(int x, int y, int w, int h, unsigned rgb, int r, int fill);
extern void gfxNCircle(int x, int y, int r, unsigned rgb, int fill);
extern void gfxNLine(int x0, int y0, int x1, int y1, unsigned rgb);
extern void gfxNText(int x, int y, int size, unsigned rgb, const char *s, int len);
extern void gfxNClip(int x, int y, int w, int h);
extern void gfxNUnclip(void);
extern void gfxNPoly(const float *xy, const unsigned short *ringLen, int nRings,
                     unsigned rgb, int nonzero);
extern int gfxNW(void);
extern void sysNExit(void);
extern long sysNMillis(void);
extern void sysNBeep(int ok);
extern void sysNTone(int freq, int ms);
extern void sysNRotate(int r);
extern void sysNFontMode(int native);
extern int gfxNCanvas(int id, int w, int h);
extern void gfxNCanvasTarget(int id);
extern void gfxNBlit(int id, int x, int y, int w, int h);
extern void sysNBacklight(int pct);
extern void sysNSleepAfter(int secs, int dim);
extern void sysNView(int scaleQ, int inset, int sx, int sy);
extern int sysNScreen(char *out, int cap);
extern void sysNPoke(void);
extern int sysNReaders(char *out, int cap);
extern int sysNRescan(void);
extern void sysNCalMode(int on);
extern void sysNSetCal(int axis, const char *csv, int len);
extern int sysNGetCal(char *out, int cap);
extern int sysNRawXY(char *out, int cap);
extern int printerNIp(char *out, int cap);
extern void printerNSetIp(const char *ip, int len);
extern int printerNAuto(void);
extern void printerNSetAuto(int on);
extern int printerNSyncMaterials(void);
extern int printerNMatCount(void);
extern int printerNMatNote(char *out, int cap);
extern int printerNRaw(const char *json, int len);
extern int sysNMods(char *out, int cap);
extern int sysNModCtl(const char *name, int nlen, const char *action, int alen);
extern void sysNStore(const char *k, int klen, const char *v, int vlen);
extern int sysNFetch(const char *k, int klen, char *out, int cap);
extern int sysNGpio(int pin, int op, int value);
extern int sysNI2c(int addr, int reg, int value);
extern void netNScan(void);
extern int netNResults(char *out, int cap);   /* <0 while scanning */
extern void netNJoin(const char *ssid, int slen, const char *psk, int plen);
extern int netNStatus(char *out, int cap);
extern int netNFetch(const char *url, int ulen, int head, int max);
extern int netNFetchState(char *out, int cap);
extern int netNFetchBody(const char **p);
extern void sysNLog(const char *p, int len);
extern int gfxNH(void);

static int gi(JSContext *ctx, JSValue v) { int r = 0; JS_ToInt32Sat(ctx, &r, v); return r; }

JSValue js_sys_mods(JSContext *ctx, JSValue *t, int argc, JSValue *argv) {
    char out[1024];
    int n = sysNMods(out, sizeof(out));
    return JS_NewStringLen(ctx, out, n < 0 ? 0 : n);
}
JSValue js_sys_modctl(JSContext *ctx, JSValue *t, int argc, JSValue *argv) {
    JSCStringBuf b1, b2; size_t l1 = 0, l2 = 0;
    const char *nm = JS_IsString(ctx, argv[0]) ? JS_ToCStringLen(ctx, &l1, argv[0], &b1) : 0;
    const char *ac = (argc > 1 && JS_IsString(ctx, argv[1])) ? JS_ToCStringLen(ctx, &l2, argv[1], &b2) : 0;
    if (!nm || !ac) return JS_NewInt32(ctx, 0);
    return JS_NewInt32(ctx, sysNModCtl(nm, (int)l1, ac, (int)l2));
}
JSValue js_printer_raw(JSContext *ctx, JSValue *t, int argc, JSValue *argv) {
    JSCStringBuf b; size_t l = 0;
    const char *j = JS_IsString(ctx, argv[0]) ? JS_ToCStringLen(ctx, &l, argv[0], &b) : 0;
    if (!j) return JS_NewInt32(ctx, 0);
    return JS_NewInt32(ctx, printerNRaw(j, (int)l));
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

/*
 * poly(rings, color, rule): rings is an array of arrays of {x,y} points
 * (floats allowed - mjsx-core's stroke outliner produces tenths). Parsed
 * into flat static buffers and handed across the C ABI in one call; the
 * fill itself (scanline, even-odd or nonzero) lives with the other
 * drawing in the sketch. Caps are generous for a UI: 16 rings, 512
 * points; beyond them the shape is truncated rather than the heap risked.
 */
/* A LIVE pen stroke is unsimplified until release: a full-canvas
   scribble makes outlines well past 512 points, and silently dropping
   the excess breaks scanline parity downstream -- horizontal smears.
   2048 points covers anything the UI produces; the buffer moves off
   the static bss into PSRAM for it. */
#define GFX_POLY_MAX_PTS 2048
#define GFX_POLY_MAX_RINGS 32
JSValue js_gfx_poly(JSContext *ctx, JSValue *t, int argc, JSValue *argv) {
    static float *xy = 0;
    static unsigned short rl[GFX_POLY_MAX_RINGS];
    if (!xy) {
        extern void *ps_malloc(size_t);
        xy = (float *)ps_malloc(GFX_POLY_MAX_PTS * 2 * sizeof(float));
        if (!xy) return JS_UNDEFINED;
    }
    if (argc < 2) return JS_UNDEFINED;
    /*
     * String fast path: rings packed by the device shim as base-127
     * chars (code = value+1, so every byte is 1..127 -- single-byte
     * UTF-8, directly walkable from the C string pointer). Layout:
     *   [nRings] then per ring [count:2] then per point [x:3][y:3],
     * counts base-127 big-endian, coords = round(px*10) + 1000000 in 3
     * chars. One pointer walk replaces thousands of per-point property
     * gets through the engine, which dominated frames with many cached
     * shapes.
     */
    if (JS_IsString(ctx, argv[0])) {
        JSCStringBuf pb; size_t pn = 0;
        const unsigned char *ps = (const unsigned char *)JS_ToCStringLen(ctx, &pn, argv[0], &pb);
        if (!ps || pn < 1) return JS_UNDEFINED;
        size_t o = 0;
        int nRings = ps[o++] - 1;
        if (nRings < 1 || nRings > GFX_POLY_MAX_RINGS) return JS_UNDEFINED;
        int nPts = 0;
        for (int ri = 0; ri < nRings; ri++) {
            if (o + 2 > pn) return JS_UNDEFINED;
            int cnt = (ps[o] - 1) * 127 + (ps[o + 1] - 1);
            o += 2;
            if (cnt < 1 || o + (size_t)cnt * 6 > pn || nPts + cnt > GFX_POLY_MAX_PTS) return JS_UNDEFINED;
            rl[ri] = (unsigned short)cnt;
            for (int k = 0; k < cnt; k++) {
                long vx = ((long)(ps[o] - 1) * 127 + (ps[o + 1] - 1)) * 127 + (ps[o + 2] - 1);
                long vy = ((long)(ps[o + 3] - 1) * 127 + (ps[o + 4] - 1)) * 127 + (ps[o + 5] - 1);
                o += 6;
                xy[nPts * 2] = (float)(vx - 1000000L) / 10.0f;
                xy[nPts * 2 + 1] = (float)(vy - 1000000L) / 10.0f;
                nPts++;
            }
        }
        int nz = 0;
        if (argc >= 3 && JS_IsString(ctx, argv[2])) {
            JSCStringBuf rb; size_t rn = 0;
            const char *rs = JS_ToCStringLen(ctx, &rn, argv[2], &rb);
            if (rs && rn && rs[0] == 'n') nz = 1;
        }
        gfxNPoly(xy, rl, nRings, (unsigned)gi(ctx, argv[1]), nz);
        return JS_UNDEFINED;
    }
    if (!JS_IsArray(ctx, argv[0])) return JS_UNDEFINED;
    int nRings = 0, nPts = 0;
    int rc = gi(ctx, JS_GetPropertyStr(ctx, argv[0], "length"));
    /* The GC is a MOVING one: any JSValue held across an allocating
       call (property gets box floats) must live in a GC-ref slot, and it
       must be USED THROUGH the slot pointer JS_PushGCRef returns -- the
       collector updates the slot, never a plain C local. A pen stroke's
       long ring is reliably enough allocation to move the heap mid-walk;
       holding stale locals here crashed the board three times. */
    JSGCRef ring_ref, pt_ref;
    JSValue *ringp = JS_PushGCRef(ctx, &ring_ref);
    JSValue *ptp = JS_PushGCRef(ctx, &pt_ref);
    for (int ri = 0; ri < rc && nRings < GFX_POLY_MAX_RINGS; ri++) {
        *ringp = JS_GetPropertyUint32(ctx, argv[0], (uint32_t)ri);
        if (!JS_IsArray(ctx, *ringp)) continue;
        int pc = gi(ctx, JS_GetPropertyStr(ctx, *ringp, "length"));
        int start = nPts;
        for (int pi = 0; pi < pc && nPts < GFX_POLY_MAX_PTS; pi++) {
            *ptp = JS_GetPropertyUint32(ctx, *ringp, (uint32_t)pi);
            double px = 0, py = 0;
            JS_ToNumber(ctx, &px, JS_GetPropertyStr(ctx, *ptp, "x"));
            JS_ToNumber(ctx, &py, JS_GetPropertyStr(ctx, *ptp, "y"));
            xy[nPts * 2] = (float)px;
            xy[nPts * 2 + 1] = (float)py;
            nPts++;
        }
        if (nPts > start) rl[nRings++] = (unsigned short)(nPts - start);
    }
    JS_PopGCRef(ctx, &pt_ref);
    JS_PopGCRef(ctx, &ring_ref);
        if (!nRings) return JS_UNDEFINED;
    int nonzero = 0;
    if (argc >= 3 && JS_IsString(ctx, argv[2])) {
        JSCStringBuf b; size_t sl = 0;
        const char *s = JS_ToCStringLen(ctx, &sl, argv[2], &b);
        if (s && sl && s[0] == 'n') nonzero = 1;
    }
    gfxNPoly(xy, rl, nRings, (unsigned)gi(ctx, argv[1]), nonzero);
    return JS_UNDEFINED;
}
JSValue js_sys_exit(JSContext *ctx, JSValue *t, int argc, JSValue *argv) { sysNExit(); return JS_UNDEFINED; }
JSValue js_sys_millis(JSContext *ctx, JSValue *t, int argc, JSValue *argv) { return JS_NewInt64(ctx, sysNMillis()); }
JSValue js_sys_beep(JSContext *ctx, JSValue *t, int argc, JSValue *argv) { sysNBeep(argc > 0 ? gi(ctx, argv[0]) : 1); return JS_UNDEFINED; }
static const char *gs(JSContext *ctx, JSValue v, JSCStringBuf *b, size_t *len) {
    *len = 0;
    if (!JS_IsString(ctx, v)) return "";
    const char *p = JS_ToCStringLen(ctx, len, v, b);
    return p ? p : "";
}

JSValue js_sys_tone(JSContext *ctx, JSValue *t, int argc, JSValue *argv) {
    sysNTone(gi(ctx, argv[0]), argc > 1 ? gi(ctx, argv[1]) : 150);
    return JS_UNDEFINED;
}
JSValue js_sys_backlight(JSContext *ctx, JSValue *t, int argc, JSValue *argv) {
    sysNBacklight(gi(ctx, argv[0]));
    return JS_UNDEFINED;
}
JSValue js_sys_sleep_after(JSContext *ctx, JSValue *t, int argc, JSValue *argv) {
    sysNSleepAfter(gi(ctx, argv[0]), argc > 1 ? gi(ctx, argv[1]) : 1);
    return JS_UNDEFINED;
}
/** Clamp an snprintf return to what the buffer actually holds. */
static size_t jslen(int n, size_t cap) {
    if (n < 0) return 0;
    return (size_t)n < cap ? (size_t)n : cap - 1;
}

JSValue js_sys_screen(JSContext *ctx, JSValue *t, int argc, JSValue *argv) {
    char out[256];
    int n = sysNScreen(out, sizeof(out));
    return JS_NewStringLen(ctx, out, jslen(n, sizeof(out)));
}
JSValue js_sys_readers(JSContext *ctx, JSValue *t, int argc, JSValue *argv) {
    char out[192];
    int n = sysNReaders(out, sizeof(out));
    return JS_NewStringLen(ctx, out, jslen(n, sizeof(out)));
}
JSValue js_sys_rescan(JSContext *ctx, JSValue *t, int argc, JSValue *argv) {
    return JS_NewInt32(ctx, sysNRescan());
}
JSValue js_sys_rotate(JSContext *ctx, JSValue *t, int argc, JSValue *argv) { sysNRotate(gi(ctx, argv[0])); return JS_UNDEFINED; }
JSValue js_sys_fonts(JSContext *ctx, JSValue *t, int argc, JSValue *argv) { sysNFontMode(gi(ctx, argv[0])); return JS_UNDEFINED; }
JSValue js_sys_canvas(JSContext *ctx, JSValue *t, int argc, JSValue *argv) {
    return JS_NewInt32(ctx, gfxNCanvas(gi(ctx, argv[0]), gi(ctx, argv[1]), gi(ctx, argv[2])));
}
JSValue js_sys_canvas_target(JSContext *ctx, JSValue *t, int argc, JSValue *argv) { gfxNCanvasTarget(gi(ctx, argv[0])); return JS_UNDEFINED; }
JSValue js_gfx_blit(JSContext *ctx, JSValue *t, int argc, JSValue *argv) {
    gfxNBlit(gi(ctx, argv[0]), gi(ctx, argv[1]), gi(ctx, argv[2]), gi(ctx, argv[3]), gi(ctx, argv[4]));
    return JS_UNDEFINED;
}
JSValue js_sys_view(JSContext *ctx, JSValue *t, int argc, JSValue *argv) {
    sysNView(argc > 0 ? gi(ctx, argv[0]) : 4, argc > 1 ? gi(ctx, argv[1]) : 0,
             argc > 2 ? gi(ctx, argv[2]) : 0, argc > 3 ? gi(ctx, argv[3]) : 0);
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
    /* 1 kB, not 256: a stored value that is silently cut in half is worse than
       one that fails to store, and the calibration readings are ~150 bytes of
       CSV before anything else asks for room. */
    JSCStringBuf b1; size_t l1; char out[1024];
    const char *k = gs(ctx, argv[0], &b1, &l1);
    int n = sysNFetch(k, (int)l1, out, sizeof(out));
    return JS_NewStringLen(ctx, out, jslen(n, sizeof(out)));
}
JSValue js_sys_gpio(JSContext *ctx, JSValue *t, int argc, JSValue *argv) {
    return JS_NewInt32(ctx, sysNGpio(gi(ctx, argv[0]),
                                     argc > 1 ? gi(ctx, argv[1]) : 0,
                                     argc > 2 ? gi(ctx, argv[2]) : 0));
}
JSValue js_sys_i2c(JSContext *ctx, JSValue *t, int argc, JSValue *argv) {
    /* no third argument means read: value defaults to -1 */
    return JS_NewInt32(ctx, sysNI2c(gi(ctx, argv[0]), gi(ctx, argv[1]),
                                    argc > 2 ? gi(ctx, argv[2]) : -1));
}
JSValue js_net_scan(JSContext *ctx, JSValue *t, int argc, JSValue *argv) { netNScan(); return JS_UNDEFINED; }
JSValue js_net_results(JSContext *ctx, JSValue *t, int argc, JSValue *argv) {
    char out[1400];
    int n = netNResults(out, sizeof(out));
    if (n < 0) return JS_NULL;
    return JS_NewStringLen(ctx, out, (size_t)n);
}
JSValue js_net_join(JSContext *ctx, JSValue *t, int argc, JSValue *argv) {
    JSCStringBuf b1, b2; size_t l1, l2;
    const char *ssid = gs(ctx, argv[0], &b1, &l1);
    const char *psk = gs(ctx, argv[1], &b2, &l2);
    netNJoin(ssid, (int)l1, psk, (int)l2);
    return JS_UNDEFINED;
}
JSValue js_net_status(JSContext *ctx, JSValue *t, int argc, JSValue *argv) {
    char out[160];
    int n = netNStatus(out, sizeof(out));
    return JS_NewStringLen(ctx, out, jslen(n, sizeof(out)));
}
/* net.fetch(url [, opts]) -> 1 started, 0 busy, -1 refused.
   opts: {head:1} for a headers-only request, {max:N} to cap the kept body. */
JSValue js_net_fetch(JSContext *ctx, JSValue *t, int argc, JSValue *argv) {
    JSCStringBuf b; size_t l;
    const char *url = gs(ctx, argv[0], &b, &l);
    int head = 0, max = 0;
    if (argc > 1) {
        JSValue h = JS_GetPropertyStr(ctx, argv[1], "head");
        if (!JS_IsUndefined(h)) head = gi(ctx, &h);
        JSValue m = JS_GetPropertyStr(ctx, argv[1], "max");
        if (!JS_IsUndefined(m)) max = gi(ctx, &m);
    }
    return JS_NewInt32(ctx, netNFetch(url, (int)l, head, max));
}
/* '' while in flight, else a small JSON line: {status,date,bytes,truncated,error}.
   The body is NOT in here — see js_net_fetch_body. */
JSValue js_net_fetch_state(JSContext *ctx, JSValue *t, int argc, JSValue *argv) {
    char out[256];
    int n = netNFetchState(out, sizeof(out));
    return JS_NewStringLen(ctx, out, jslen(n, sizeof(out)));
}
/* The response body as a string, copied once, unescaped. Empty after a HEAD. */
JSValue js_net_fetch_body(JSContext *ctx, JSValue *t, int argc, JSValue *argv) {
    const char *p = "";
    int n = netNFetchBody(&p);
    return JS_NewStringLen(ctx, p, (size_t)(n < 0 ? 0 : n));
}
JSValue js_sys_log(JSContext *ctx, JSValue *t, int argc, JSValue *argv) {
    JSCStringBuf b; size_t l = 0;
    const char *s = gs(ctx, argv[0], &b, &l);
    sysNLog(s, (int)l);
    return JS_UNDEFINED;
}
JSValue js_sys_cal_mode(JSContext *ctx, JSValue *t, int argc, JSValue *argv) {
    sysNCalMode(argc > 0 ? gi(ctx, argv[0]) : 0);
    return JS_UNDEFINED;
}
JSValue js_sys_set_cal(JSContext *ctx, JSValue *t, int argc, JSValue *argv) {
    JSCStringBuf b; size_t l;
    const char *csv = gs(ctx, argv[1], &b, &l);
    sysNSetCal(gi(ctx, argv[0]), csv, (int)l);
    return JS_UNDEFINED;
}
JSValue js_sys_cal(JSContext *ctx, JSValue *t, int argc, JSValue *argv) {
    /* 96 bytes truncated the answer once the tables reached six knots an axis,
       and a truncated JSON string is worse than none: the caller that restores
       a previous mapping parses it back. */
    char out[320];
    int n = sysNGetCal(out, sizeof(out));
    return JS_NewStringLen(ctx, out, jslen(n, sizeof(out)));
}
JSValue js_sys_raw(JSContext *ctx, JSValue *t, int argc, JSValue *argv) {
    char out[64];
    int n = sysNRawXY(out, sizeof(out));
    return JS_NewStringLen(ctx, out, jslen(n, sizeof(out)));
}
JSValue js_printer_ip(JSContext *ctx, JSValue *t, int argc, JSValue *argv) {
    char out[48];
    int n = printerNIp(out, sizeof(out));
    return JS_NewStringLen(ctx, out, jslen(n, sizeof(out)));
}
JSValue js_printer_set_ip(JSContext *ctx, JSValue *t, int argc, JSValue *argv) {
    JSCStringBuf b; size_t l;
    const char *ip = gs(ctx, argv[0], &b, &l);
    printerNSetIp(ip, (int)l);
    return JS_UNDEFINED;
}
JSValue js_printer_auto(JSContext *ctx, JSValue *t, int argc, JSValue *argv) { return JS_NewInt32(ctx, printerNAuto()); }
JSValue js_printer_sync_mats(JSContext *ctx, JSValue *t, int argc, JSValue *argv) {
    return JS_NewInt32(ctx, printerNSyncMaterials());
}
JSValue js_printer_mats(JSContext *ctx, JSValue *t, int argc, JSValue *argv) {
    char out[64];
    int n = printerNMatNote(out, sizeof(out));
    char j[96];
    int k = snprintf(j, sizeof(j), "{\"count\":%d,\"note\":\"%.*s\"}",
                     printerNMatCount(), n < 0 ? 0 : n, out);
    return JS_NewStringLen(ctx, j, (size_t)k);
}
JSValue js_printer_set_auto(JSContext *ctx, JSValue *t, int argc, JSValue *argv) {
    printerNSetAuto(argc > 0 ? gi(ctx, argv[0]) : 0);
    return JS_UNDEFINED;
}
JSValue js_gfx_width(JSContext *ctx, JSValue *t, int argc, JSValue *argv) { return JS_NewInt32(ctx, gfxNW()); }
JSValue js_gfx_height(JSContext *ctx, JSValue *t, int argc, JSValue *argv) { return JS_NewInt32(ctx, gfxNH()); }

#include "mjsx_board_stdlib.h"
