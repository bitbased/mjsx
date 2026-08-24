/*
 * mjsx's native-api stdlib definition, for MicroQuickJS on ESP32.
 *
 * This is the canonical, generic surface mjsx-core assumes exists — nothing
 * board- or app-specific. `mquickjs_build` turns this into C tables the
 * engine includes at compile time; function names are emitted as
 * *references* — glue.c supplies the implementations, and a display-less
 * build can make every one of them a no-op without this file changing.
 *
 * The tables and mquickjs_atom.h are word-size dependent and MUST be
 * generated together (see backends/esp32/tools/gen-stdlib.sh, -m32 for the
 * device). A mismatched pair corrupts atom numbering and shows up as parse
 * errors with no obvious cause.
 */
#include <math.h>
#include <stdio.h>
#include <string.h>

#include "mquickjs_build.h"

/*
 * The drawing surface an mjsx script sees. Deliberately the same ten calls
 * on every backend — layout, wrapping, components and hit-testing all live
 * in mjsx-core (JS), never here.
 *
 * Coordinates are pixels; colours are 24-bit 0xRRGGBB — a backend converts
 * to its own native depth.
 */
static const JSPropDef js_gfx[] = {
    JS_CFUNC_DEF("clear", 1, js_gfx_clear),
    JS_CFUNC_DEF("rect", 6, js_gfx_rect),
    JS_CFUNC_DEF("frect", 6, js_gfx_frect),
    JS_CFUNC_DEF("circle", 5, js_gfx_circle),
    JS_CFUNC_DEF("line", 5, js_gfx_line),
    JS_CFUNC_DEF("text", 5, js_gfx_text),
    JS_CFUNC_DEF("clip", 4, js_gfx_clip),
    JS_CFUNC_DEF("unclip", 0, js_gfx_unclip),
    JS_CFUNC_DEF("width", 0, js_gfx_width),
    JS_CFUNC_DEF("height", 0, js_gfx_height),
    JS_PROP_END,
};
static const JSClassDef js_gfx_obj = JS_OBJECT_DEF("gfx", js_gfx);

/*
 * What a script may ask of the host itself. Only the part every target can
 * answer: a clock, optional audio feedback, a way to hand the screen back,
 * and a generic key/value store. Board settings (brightness, rotation,
 * touch calibration) and anything domain-specific (a printer, a sensor)
 * are NOT here — they are an app-level native extension registered
 * alongside this table, the same pattern, just not baked into the core.
 */
static const JSPropDef js_sys[] = {
    JS_CFUNC_DEF("exit", 0, js_sys_exit),      /* hand the screen back to the host */
    JS_CFUNC_DEF("millis", 0, js_sys_millis),
    JS_CFUNC_DEF("beep", 1, js_sys_beep),      /* beep(ok) — no-op if there is no speaker */
    JS_CFUNC_DEF("tone", 2, js_sys_tone),      /* tone(hz, ms) */
    JS_CFUNC_DEF("store", 2, js_sys_store),    /* store(key, value) */
    JS_CFUNC_DEF("fetch", 1, js_sys_fetch),    /* fetch(key) -> string or '' */
    JS_PROP_END,
};
static const JSClassDef js_sys_obj = JS_OBJECT_DEF("sys", js_sys);

#define CONFIG_GFX
#include "mqjs_stdlib.c"
