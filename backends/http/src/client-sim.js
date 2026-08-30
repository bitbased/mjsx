/*
 * The browser entry for the SIMULATOR — the pieces a page needs to run an
 * mjsx app, not merely replay one.
 *
 * The figure viewer next door only needs the rasterizer, because it
 * replays a recorded op list. Running an app live needs three more things:
 * the engine itself, a JSX transpiler (a browser has no build step), and a
 * way to get a FRESH engine per run.
 *
 * That last one is why the core arrives as SOURCE TEXT rather than as an
 * import. The engine is a singleton — UI.state, mounted component, scroll
 * offsets, onTick handlers and timers all live on one UI object — so
 * running a second example against the same instance leaks the first one's
 * state. Every other host solves this by dropping the module from
 * require.cache and requiring it again (sim.js `freshCore`, the terminal
 * launcher, the screenshot harness). A browser bundle has no such cache,
 * so the equivalent is to evaluate the source again: same isolation, same
 * reasoning, and it is the same file on disk either way.
 *
 * Built by scripts/build-play.mjs, which appends MJSX_CORE_SRC.
 */
/* ESM on purpose, and not a style choice: Bun's iife build DEFINES a
   CommonJS entry without invoking it, so a require()-based entry's side
   effects — every assignment below — silently never run. The bundle loads,
   the globals are undefined, and nothing errors. client-backend.js next
   door carries the same warning for the same reason. */
import { createPureJsBackend } from '../../pure-js/src/backend.js';
import oprec from '../../../packages/core/src/oprec.js';
import jsx from '../../../packages/core/src/jsx.js';
import mlog from '../../../packages/core/src/log.js';

globalThis.createPureJsBackend = createPureJsBackend;
globalThis.mjsxTranspile = jsx.transpile;
globalThis.mjsxRecord = oprec.record;
globalThis.mjsxReplay = oprec.replay;
globalThis.mjsxBoxes = oprec.boxes;
globalThis.mjsxCreateLog = mlog.createLog;

/* A brand-new engine, wired to the given backend. The globals are the
   contract an app is written against: it says `h(...)`, `UI.mount(...)`,
   `gfx.width()` with nothing imported, exactly as it does on a chip. */
globalThis.mjsxFreshCore = function (be, opts) {
  opts = opts || {};
  globalThis.gfx = be.gfx;
  globalThis.sys = be.sys;

  var module = { exports: {} };
  /* indirect eval keeps this out of the bundle's scope, so the core sees
     the globals a device gives it and nothing else */
  (0, eval)('(function(module,exports){' + globalThis.MJSX_CORE_SRC +
            '\n})')(module, module.exports);
  var core = module.exports;

  globalThis.h = core.h;
  globalThis.UI = core.UI;
  globalThis.Button = core.Button;
  globalThis.Swatch = core.Swatch;
  globalThis.em = core.em;
  globalThis.Modal = core.Modal;
  globalThis.Keyboard = core.Keyboard;
  globalThis.ArcFooter = core.ArcFooter;
  globalThis.configStorage = core.configStorage;

  /* console, per engine instance.
     The browser has its own console, but an app running here is device code:
     it must reach the same sinks the board would use, and the simulator has
     to be able to SHOW what it said. So each fresh core gets its own logger,
     and the page reads it back with mjsxLog(). Lines still reach the
     browser's console too, because losing them in devtools would be a
     regression for anyone debugging with what they already have. */
  var host = (typeof console !== 'undefined') ? console : null;
  var lg = mlog.createLog({
    sinks: (opts && opts.logSinks) || 'buffer',
    max: (opts && opts.logMax) || 300,
    write: function (t) { if (host && host.log) host.log(t.replace(/\n$/, '')); },
    /* the 'ops' sink: put the line into whichever frame is being recorded,
       so a mirror replaying that frame sees what the app said alongside what
       it drew, in order and on one channel */
    emit: function (level, text) {
      var rec = oprec.active();
      if (rec && rec.log) rec.log(level, text);
    }
  });
  /* NOT globalThis.console. Replacing the global swallows the host's own
     logging — the page's, the test harness's — which is how the first cut of
     this produced a silent process. The app gets its console as a parameter
     of the wrapper it is evaluated in (see mjsxRun), so it is scoped to the
     app exactly the way a device's global console is scoped to the script. */
  globalThis.mjsxLog = lg;
  core.log = lg;

  /* the font the backend actually rasterizes with, so em() spacing and
     fitText widths agree with the pixels — the same handshake sim.js and
     the screenshot harness do */
  if (be.font) {
    core.FONT.advance = be.font.advance;
    core.FONT.lineH = be.font.lineH;
    core.FONT.pick = be.font.pick || null;
  }
  /* a firmware seeds this at boot; UI.isRound() reads it once and caches */
  if (opts.round) be.sys.store('round', '1');
  else be.sys.store('round', '');
  if (opts.safe) core.UI.safe = opts.safe;

  return core;
};

/* Run a user's source against a fresh core. JSX first (the browser cannot
   parse it), then the app's top level, which is what calls UI.mount. */
globalThis.mjsxRun = function (src, be, opts) {
  var core = globalThis.mjsxFreshCore(be, opts);
  var js;
  try {
    js = globalThis.mjsxTranspile(src);
  } catch (e) {
    e.mjsxPhase = 'jsx';
    throw e;
  }
  /* A CommonJS shape, because every other host loads these files through
     require and some of them use it — examples/counter ends with
     `module.exports.demo = ...`, a hook for the gallery. Without this the
     example is a ReferenceError in a browser and nowhere else, which is
     the worst kind of difference between the simulator and the real thing.
     require() is deliberately not implemented: a device has no module
     loader either, and a clear message beats a mysterious undefined. */
  var module = { exports: {} };
  var require = function (what) {
    throw new Error('require(' + JSON.stringify(what) + ') is not available: an mjsx app ' +
                    'runs as one flat script, with h/UI/gfx/sys already global');
  };
  /* console is a PARAMETER, not a global: the app sees it as an ambient
     name the way it does on a chip, and the host's own console is untouched. */
  (0, eval)('(function(module,exports,require,console){' + js + '\n})')(
    module, module.exports, require, core.log.console);
  return core;
};
