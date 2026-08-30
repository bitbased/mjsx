/*
 * Standard library definition for the filament-rfid bridge.
 *
 * Host build input: mquickjs_build turns this into C tables the firmware
 * includes. Function names are emitted as *references* — the including
 * translation unit supplies the implementations — which is what lets the
 * device draw on the panel while the host harness draws into a log, from one
 * table.
 *
 * The tables and mquickjs_atom.h are word-size dependent and MUST be generated
 * together by scripts/gen-js-stdlib.sh (-m32 for the ESP32). A mismatched pair
 * corrupts atom numbering and presents as parse errors and panics — see
 * ~/bitbased/wiki/esp32/mquickjs.md.
 */
#include <math.h>
#include <stdio.h>
#include <string.h>

#include "mquickjs_build.h"

/*
 * The drawing surface a UI script sees.
 *
 * Deliberately tiny: rectangles, circles, lines, text, clear, and the screen
 * size. Layout, wrapping, components and hit-testing all live in JavaScript,
 * where they can change without touching firmware.
 *
 * Coordinates are pixels; colours are 24-bit 0xRRGGBB (the device converts to
 * the panel's 5-6-5 itself).
 */
static const JSPropDef js_gfx[] = {
    JS_CFUNC_DEF("clear", 1, js_gfx_clear),        /* clear(color) */
    JS_CFUNC_DEF("rect", 6, js_gfx_rect),          /* rect(x,y,w,h,color,radius) outline */
    JS_CFUNC_DEF("frect", 6, js_gfx_frect),        /* frect(x,y,w,h,color,radius) filled */
    JS_CFUNC_DEF("circle", 5, js_gfx_circle),      /* circle(x,y,r,color,filled) */
    JS_CFUNC_DEF("line", 5, js_gfx_line),          /* line(x0,y0,x1,y1,color) */
    JS_CFUNC_DEF("text", 5, js_gfx_text),          /* text(x,y,size,color,str) */
    JS_CFUNC_DEF("clip", 4, js_gfx_clip),         /* clip(x,y,w,h) — subsequent draws clamp here */
    JS_CFUNC_DEF("unclip", 0, js_gfx_unclip),
    JS_CFUNC_DEF("poly", 3, js_gfx_poly),          /* poly(rings, color, rule) scanline fill */
    JS_CFUNC_DEF("blit", 5, js_gfx_blit),          /* blit(canvasId, x, y, w, h) — place a canvas source */
    JS_CFUNC_DEF("width", 0, js_gfx_width),
    JS_CFUNC_DEF("height", 0, js_gfx_height),
    JS_PROP_END,
};

static const JSClassDef js_gfx_obj = JS_OBJECT_DEF("gfx", js_gfx);

/*
 * What a script may ask of the device itself. Small on purpose: everything
 * here must be safe for an untrusted-ish UI script to call at any moment.
 */
static const JSPropDef js_sys[] = {
    JS_CFUNC_DEF("exit", 0, js_sys_exit),      /* hand the screen back to the native UI */
    JS_CFUNC_DEF("millis", 0, js_sys_millis),
    JS_CFUNC_DEF("beep", 1, js_sys_beep),      /* beep(ok) — buzzer feedback if fitted */
    JS_CFUNC_DEF("tone", 2, js_sys_tone),      /* tone(hz, ms) — any pitch */
    JS_CFUNC_DEF("backlight", 1, js_sys_backlight),    /* backlight(1..100) */
    JS_CFUNC_DEF("sleepAfter", 2, js_sys_sleep_after), /* sleepAfter(secs, dim) */
    JS_CFUNC_DEF("screen", 0, js_sys_screen),          /* {bl, sleep, dim, asleep} */
    JS_CFUNC_DEF("readers", 0, js_sys_readers),        /* what each slot found */
    JS_CFUNC_DEF("rescan", 0, js_sys_rescan),          /* probe again, -> count */
    JS_CFUNC_DEF("rotate", 1, js_sys_rotate),  /* rotate(0..3) — persists */
    JS_CFUNC_DEF("view", 4, js_sys_view),      /* view(scaleQuarters, inset, shiftX, shiftY) */
    JS_CFUNC_DEF("fonts", 1, js_sys_fonts),    /* fonts(1) text stays panel-sharp on a scaled view */
    JS_CFUNC_DEF("canvas", 3, js_sys_canvas),      /* canvas(id, w, h) -> 1 — allocate a canvas source */
    JS_CFUNC_DEF("canvasTarget", 1, js_sys_canvas_target), /* canvasTarget(id | -1) — gfx draws there */
    JS_CFUNC_DEF("store", 2, js_sys_store),    /* store(key, value) — app settings */
    JS_CFUNC_DEF("fetch", 1, js_sys_fetch),    /* fetch(key) -> string or '' */
    JS_CFUNC_DEF("calMode", 1, js_sys_cal_mode), /* calMode(on) — deliver raw touch */
    JS_CFUNC_DEF("setCal", 2, js_sys_set_cal),   /* setCal(axis, "raw,screen,...") */
    JS_CFUNC_DEF("cal", 0, js_sys_cal),          /* cal() -> JSON of the above */
    JS_CFUNC_DEF("raw", 0, js_sys_raw),          /* raw() -> last uncorrected touch */
    JS_CFUNC_DEF("mods", 0, js_sys_mods),        /* runtime modules -> JSON list */
    JS_CFUNC_DEF("modCtl", 2, js_sys_modctl),    /* modCtl(name,"start"|"stop") -> 0|1, async */
    JS_CFUNC_DEF("gpio", 3, js_sys_gpio),        /* gpio(pin, op, val): 0=read 1=write 2=analog */
    JS_CFUNC_DEF("i2c", 3, js_sys_i2c),          /* i2c(addr, reg, val); val<0 reads a byte */
    JS_PROP_END,
};

static const JSPropDef js_net[] = {
    JS_CFUNC_DEF("scan", 0, js_net_scan),          /* start an async network scan */
    JS_CFUNC_DEF("results", 0, js_net_results),    /* JSON [{ssid,rssi,open}] or null while scanning */
    JS_CFUNC_DEF("join", 2, js_net_join),          /* join(ssid, psk) — persists and connects */
    JS_CFUNC_DEF("status", 0, js_net_status),      /* JSON {connected, ip, ssid} */
    JS_CFUNC_DEF("fetch", 2, js_net_fetch),        /* fetch(url, {head,max}) -> 1 started / 0 busy / -1 refused */
    JS_CFUNC_DEF("fetchState", 0, js_net_fetch_state), /* '' in flight, else {status,date,bytes,truncated,error} */
    JS_CFUNC_DEF("fetchBody", 0, js_net_fetch_body),   /* the body, unescaped; empty after a HEAD */
    JS_PROP_END,
};
static const JSClassDef js_net_obj = JS_OBJECT_DEF("net", js_net);

/*
 * The printer this box sits next to. Enough to configure it from the screen —
 * the scan-to-printer path itself stays in firmware, because it has to work
 * with no script loaded at all.
 */
static const JSPropDef js_printer[] = {
    JS_CFUNC_DEF("ip", 0, js_printer_ip),           /* ip() -> "192.168.1.144" or "" */
    JS_CFUNC_DEF("setIp", 1, js_printer_set_ip),    /* setIp(ip) — persists, reconnects */
    JS_CFUNC_DEF("auto", 0, js_printer_auto),       /* auto() -> 0|1: apply scans to the spool */
    JS_CFUNC_DEF("setAuto", 1, js_printer_set_auto),
    JS_CFUNC_DEF("syncMats", 0, js_printer_sync_mats),  /* fetch the DB from the printer */
    JS_CFUNC_DEF("mats", 0, js_printer_mats),           /* {count, note} */
    JS_CFUNC_DEF("raw", 1, js_printer_raw),             /* raw(json) queue a frame to the WS, async */
    JS_PROP_END,
};
static const JSClassDef js_printer_obj = JS_OBJECT_DEF("printer", js_printer);

static const JSClassDef js_sys_obj = JS_OBJECT_DEF("sys", js_sys);

#define CONFIG_GFX
#include "mqjs_stdlib.c"
