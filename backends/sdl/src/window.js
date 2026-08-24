/*
 * A native pixel window over SDL2 through bun:ffi — no browser, no Electron,
 * no compile step, no npm native modules. Bun dlopens the SDL2 shared
 * library the OS already has (brew install sdl2 / apt install libsdl2-2.0-0)
 * and this file is the entire binding: a window, one streaming texture the
 * RGB framebuffer blits into, and the event queue decoded into plain
 * objects. Cross-platform by SDL's nature — macOS, Linux, Windows, and a
 * Raspberry Pi console with no X11 at all (SDL's KMSDRM backend draws
 * straight to the display).
 *
 * The struct offsets below are SDL2's documented, ABI-stable event layouts
 * (every event starts u32 type + u32 timestamp; see each decode). SDL3
 * changed them — this binding is SDL2, deliberately, because that's what
 * ships everywhere today.
 */
var ffi = require('bun:ffi');
var dlopen = ffi.dlopen, fptr = ffi.ptr;

function libPath() {
  if (process.platform === 'darwin') {
    var cands = ['/opt/homebrew/lib/libSDL2.dylib', '/usr/local/lib/libSDL2.dylib', 'libSDL2.dylib'];
  } else if (process.platform === 'win32') {
    cands = ['SDL2.dll'];
  } else {
    cands = ['libSDL2-2.0.so.0', 'libSDL2.so'];
  }
  var fs = require('fs');
  for (var i = 0; i < cands.length; i++) {
    if (cands[i].indexOf('/') === -1 || fs.existsSync(cands[i])) return cands[i];
  }
  return cands[0];
}

var SDL_INIT_VIDEO = 0x20;
var SDL_WINDOWPOS_CENTERED = 0x2FFF0000;
var SDL_WINDOW_SHOWN = 0x4, SDL_WINDOW_RESIZABLE = 0x20;
var SDL_PIXELFORMAT_RGB24 = 0x17101803;
var SDL_TEXTUREACCESS_STREAMING = 1;

/* Event types */
var EV_QUIT = 0x100, EV_KEYDOWN = 0x300, EV_KEYUP = 0x301;
var EV_MOUSEMOTION = 0x400, EV_MOUSEDOWN = 0x401, EV_MOUSEUP = 0x402, EV_MOUSEWHEEL = 0x403;

/* SDLK_* for the non-printable keys relayed by name */
var KEYNAMES = {
  0x40000052: 'up', 0x40000051: 'down', 0x40000050: 'left', 0x4000004F: 'right',
  0x0D: 'enter', 0x1B: 'escape', 0x08: 'backspace', 0x09: 'tab', 0x20: ' '
};

function createSdlWindow(pxW, pxH, opts) {
  opts = opts || {};
  var scale = opts.scale || 4;
  var title = opts.title || 'mjsx';
  /* snapScale: keep the on-screen scale a whole number while the window is
     big enough (crisp pixels); turn off for continuous fit. mask: 'circle'
     previews a round display (everything outside the inscribed circle is
     dark), a number previews rounded corners of that pixel radius. */
  var snapScale = opts.snapScale !== false;
  var mask = opts.mask;
  /* Everything that is not the simulated screen — the letterbox around it
     and the masked-off corners — is bezel: dark but NOT black, so the
     screen's boundary and shape stay visible even when the app itself draws
     near-black. */
  var bezel = opts.bezel || [34, 36, 42];
  /* Optional host-UI strip across the top of the window, OUTSIDE the
     simulated screen: its own little pixel surface (toolbarH rows tall,
     drawn at a fixed toolbarScale), fed as present()'s second argument.
     Mouse events inside the strip come back with target 'toolbar' and
     toolbar-pixel coordinates. */
  var tbH = opts.toolbarH || 0;
  var tbScale = opts.toolbarScale || 2;
  var tbStrip = tbH * tbScale;

  var lib = dlopen(libPath(), {
    SDL_Init: { args: ['u32'], returns: 'i32' },
    SDL_Quit: { args: [], returns: 'void' },
    SDL_GetError: { args: [], returns: 'cstring' },
    SDL_CreateWindow: { args: ['ptr', 'i32', 'i32', 'i32', 'i32', 'u32'], returns: 'ptr' },
    SDL_DestroyWindow: { args: ['ptr'], returns: 'void' },
    SDL_CreateRenderer: { args: ['ptr', 'i32', 'u32'], returns: 'ptr' },
    SDL_DestroyRenderer: { args: ['ptr'], returns: 'void' },
    SDL_CreateTexture: { args: ['ptr', 'u32', 'i32', 'i32', 'i32'], returns: 'ptr' },
    SDL_DestroyTexture: { args: ['ptr'], returns: 'void' },
    SDL_UpdateTexture: { args: ['ptr', 'ptr', 'ptr', 'i32'], returns: 'i32' },
    SDL_RenderClear: { args: ['ptr'], returns: 'i32' },
    SDL_SetRenderDrawColor: { args: ['ptr', 'u8', 'u8', 'u8', 'u8'], returns: 'i32' },
    SDL_RenderCopy: { args: ['ptr', 'ptr', 'ptr', 'ptr'], returns: 'i32' },
    SDL_RenderPresent: { args: ['ptr'], returns: 'void' },
    SDL_PollEvent: { args: ['ptr'], returns: 'i32' },
    SDL_PushEvent: { args: ['ptr'], returns: 'i32' },
    SDL_SetHint: { args: ['ptr', 'ptr'], returns: 'i32' },
    SDL_GetPixelFormatName: { args: ['u32'], returns: 'cstring' }
  }).symbols;

  function cstr(s) { return fptr(Buffer.from(s + '\0', 'utf8')); }
  function fail(what) {
    throw new Error(what + ': ' + lib.SDL_GetError());
  }

  /* Nearest-neighbour scaling — pixels should look like pixels, not soup. */
  lib.SDL_SetHint(cstr('SDL_RENDER_SCALE_QUALITY'), cstr('0'));
  /* No mouse<->touch synthesis: SDL otherwise mirrors every mouse event as
     a touch event and back again, and each press would arrive more than
     once. Real touch input still arrives as its own event type. */
  lib.SDL_SetHint(cstr('SDL_MOUSE_TOUCH_EVENTS'), cstr('0'));
  lib.SDL_SetHint(cstr('SDL_TOUCH_MOUSE_EVENTS'), cstr('0'));

  if (lib.SDL_Init(SDL_INIT_VIDEO) !== 0) fail('SDL_Init');
  /* Belt and braces: the constant above is computed from SDL's macro; make
     sure this build of SDL agrees before trusting it with a buffer. */
  var fmtName = lib.SDL_GetPixelFormatName(SDL_PIXELFORMAT_RGB24);
  if (('' + fmtName) !== 'SDL_PIXELFORMAT_RGB24') fail('pixel format constant mismatch (' + fmtName + ')');

  var win = lib.SDL_CreateWindow(cstr(title), SDL_WINDOWPOS_CENTERED, SDL_WINDOWPOS_CENTERED,
                                 pxW * scale, pxH * scale + tbStrip, SDL_WINDOW_SHOWN | SDL_WINDOW_RESIZABLE);
  if (!win) fail('SDL_CreateWindow');
  var ren = lib.SDL_CreateRenderer(win, -1, 0);
  if (!ren) fail('SDL_CreateRenderer');
  var tex = lib.SDL_CreateTexture(ren, SDL_PIXELFORMAT_RGB24, SDL_TEXTUREACCESS_STREAMING, pxW, pxH);
  if (!tex) fail('SDL_CreateTexture');

  /* One reusable event buffer; SDL_Event is a 56-byte union. The pointer is
     taken FRESH on every native call — a cached ptr() can go stale across
     unrelated allocations, and a stale event pointer produced phantom
     repeated events in testing. */
  var evBuf = new Uint8Array(56);
  var dv = new DataView(evBuf.buffer);

  /* Window creation queues its own window events; start the caller clean. */
  var drain = 0;
  while (lib.SDL_PollEvent(fptr(evBuf)) === 1 && drain < 64) drain++;

  /* Contain-fit: the frame keeps its aspect, letterboxed in whatever shape
     the window has been dragged to. Recomputed on every size change; mouse
     coordinates are mapped back through the same rectangle. */
  var winW = pxW * scale, winH = pxH * scale + tbStrip;
  var tbW = 0, tbTex = null;
  var dst = { x: 0, y: 0, w: 0, h: 0, fit: scale };
  function refit() {
    var availH = winH - tbStrip;
    var fit = Math.min(winW / pxW, availH / pxH);
    if (snapScale && fit >= 1) fit = Math.floor(fit);
    dst.fit = fit;
    dst.w = Math.round(pxW * fit); dst.h = Math.round(pxH * fit);
    dst.x = Math.floor((winW - dst.w) / 2);
    dst.y = tbStrip + Math.floor((availH - dst.h) / 2);
    /* The toolbar surface tracks the window width at its own fixed scale;
       its texture is remade lazily when that width changes. */
    var newTbW = Math.max(1, Math.floor(winW / tbScale));
    if (newTbW !== tbW) {
      tbW = newTbW;
      if (tbTex) { lib.SDL_DestroyTexture(tbTex); tbTex = null; }
    }
  }
  refit();
  var rectBuf = new Int32Array(4);

  /* The display-shape mask is applied to a scratch copy of the frame, in
     pixel space, before upload — portable to every other backend (the web
     preview can do the same with border-radius, a panel simply is round). */
  var scratch = mask ? new Uint8Array(pxW * pxH * 3) : null;
  function applyMask(rgb) {
    if (!mask) return rgb;
    scratch.set(rgb);
    var r = mask === 'circle' ? Math.min(pxW, pxH) / 2 : mask;
    var cxs = [r, pxW - r, r, pxW - r], cys = [r, r, pxH - r, pxH - r];
    for (var y = 0; y < pxH; y++) {
      for (var x = 0; x < pxW; x++) {
        var out;
        if (mask === 'circle') {
          var dx = x + 0.5 - pxW / 2, dy = y + 0.5 - pxH / 2;
          out = dx * dx + dy * dy > r * r;
        } else {
          out = false;
          /* corner boxes: outside the quarter-circle -> dark */
          if ((x < r || x >= pxW - r) && (y < r || y >= pxH - r)) {
            var ci = (x < r ? 0 : 1) + (y < r ? 0 : 2);
            var ddx = x + 0.5 - cxs[ci], ddy = y + 0.5 - cys[ci];
            out = ddx * ddx + ddy * ddy > r * r;
          }
        }
        if (out) { var i = (y * pxW + x) * 3; scratch[i] = bezel[0]; scratch[i + 1] = bezel[1]; scratch[i + 2] = bezel[2]; }
      }
    }
    return scratch;
  }

  return {
    /* Blit an RGB (3 bytes/pixel, pxW*pxH) buffer and show it, contained
       and letterboxed in the current window. */
    present: function (rgb, toolbarRgb) {
      if (lib.SDL_UpdateTexture(tex, null, fptr(applyMask(rgb)), pxW * 3) !== 0) fail('SDL_UpdateTexture');
      lib.SDL_SetRenderDrawColor(ren, bezel[0], bezel[1], bezel[2], 255);
      lib.SDL_RenderClear(ren);
      if (tbH && toolbarRgb) {
        if (!tbTex) tbTex = lib.SDL_CreateTexture(ren, SDL_PIXELFORMAT_RGB24, SDL_TEXTUREACCESS_STREAMING, tbW, tbH);
        if (!tbTex) fail('SDL_CreateTexture (toolbar)');
        if (lib.SDL_UpdateTexture(tbTex, null, fptr(toolbarRgb), tbW * 3) !== 0) fail('SDL_UpdateTexture (toolbar)');
        rectBuf[0] = 0; rectBuf[1] = 0; rectBuf[2] = tbW * tbScale; rectBuf[3] = tbStrip;
        lib.SDL_RenderCopy(ren, tbTex, null, fptr(rectBuf));
      }
      rectBuf[0] = dst.x; rectBuf[1] = dst.y; rectBuf[2] = dst.w; rectBuf[3] = dst.h;
      lib.SDL_RenderCopy(ren, tex, null, fptr(rectBuf));
      lib.SDL_RenderPresent(ren);
    },

    /* Width of the toolbar's pixel surface — resize-dependent; redraw the
       strip at this width before every present. */
    toolbarWidth: function () { return tbW; },

    /* Drain the event queue into plain objects, coordinates already in
       PIXEL space (window coords divided by scale). */
    poll: function () {
      var out = [];
      while (lib.SDL_PollEvent(fptr(evBuf)) === 1) {
        var type = dv.getUint32(0, true);
        if (type === EV_QUIT) {
          out.push({ type: 'quit' });
        } else if (type === 0x200) {
          /* SDL_WINDOWEVENT: u8 event id at 12, new size in data1/data2
             (i32 at 16/20) for SIZE_CHANGED (6). The caller gets a redraw
             nudge so the letterboxed frame repaints immediately. */
          if (evBuf[12] === 6) {
            winW = dv.getInt32(16, true); winH = dv.getInt32(20, true);
            refit();
            out.push({ type: 'redraw' });
          }
        } else if (type === EV_MOUSEDOWN || type === EV_MOUSEUP || type === EV_MOUSEMOTION) {
          /* `which` (u32 at 12) is SDL_TOUCH_MOUSEID for events synthesized
             from touch — belt and braces against double-firing on top of the
             hints above. */
          if (dv.getUint32(12, true) === 0xFFFFFFFF) continue;
          /* MouseButton/MouseMotion both keep x at 20, y at 24 (i32). Motion
             carries the held-button bitmask as u32 at 16; button events a u8
             button at 16. */
          var wx = dv.getInt32(20, true), wy = dv.getInt32(24, true);
          var target = 'screen', mx, my;
          if (tbH && wy < tbStrip) {
            target = 'toolbar';
            mx = Math.floor(wx / tbScale); my = Math.floor(wy / tbScale);
          } else {
            mx = Math.floor((wx - dst.x) / dst.fit);
            my = Math.floor((wy - dst.y) / dst.fit);
            if (mx < 0) mx = 0; if (mx >= pxW) mx = pxW - 1;
            if (my < 0) my = 0; if (my >= pxH) my = pxH - 1;
          }
          if (type === EV_MOUSEMOTION) {
            var held = dv.getUint32(16, true);
            out.push({ type: held ? 'drag' : 'move', x: mx, y: my, target: target });
          } else {
            out.push({ type: type === EV_MOUSEDOWN ? 'down' : 'up', x: mx, y: my, button: evBuf[16], target: target });
          }
        } else if (type === EV_MOUSEWHEEL) {
          /* y at 20 (i32): +1 away from the user. */
          out.push({ type: 'wheel', dy: dv.getInt32(20, true) });
        } else if (type === EV_KEYDOWN || type === EV_KEYUP) {
          /* keysym.sym is an i32 at 20; printable ASCII maps to itself. */
          var sym = dv.getInt32(20, true);
          var key = KEYNAMES[sym] || (sym > 0 && sym < 127 ? String.fromCharCode(sym) : 'sym:' + sym);
          out.push({ type: type === EV_KEYDOWN ? 'keydown' : 'keyup', key: key, repeat: evBuf[13] !== 0 });
        }
      }
      return out;
    },

    /* Test hook: push a synthetic event through SDL's own queue. */
    _push: function (bytes) {
      evBuf.set(bytes.subarray(0, 56));
      return lib.SDL_PushEvent(fptr(evBuf));
    },

    destroy: function () {
      if (tbTex) lib.SDL_DestroyTexture(tbTex);
      lib.SDL_DestroyTexture(tex);
      lib.SDL_DestroyRenderer(ren);
      lib.SDL_DestroyWindow(win);
      lib.SDL_Quit();
    }
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { createSdlWindow: createSdlWindow };
}
