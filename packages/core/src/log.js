/*
 * console for mjsx — one implementation, three destinations.
 *
 * A script that runs on a chip, in a terminal, in a browser tab and on a
 * desktop should be able to say `console.log('here', n)` in all four and
 * have it arrive somewhere useful. On the desktop hosts `console` already
 * exists and does the obvious thing; on the device it did not exist at all,
 * so a line of debugging that worked everywhere else threw
 * "TypeError: not a function" on the one host where you cannot attach a
 * debugger. That asymmetry is what this file removes.
 *
 * THREE SINKS, chosen at runtime rather than compiled in:
 *
 *   buffer   a bounded ring kept in memory, read back over the wire
 *            (`mjsx logs <ip>`). The default, because it costs nothing when
 *            nobody is looking and cannot flood a serial line.
 *   serial   straight out of the host's own stream — Serial on the board,
 *            stderr on a JS runner. What you want with a cable attached.
 *   ops      into the frame's op stream as ['L', level, text], so a line
 *            logged on a board arrives in whatever is mirroring its screen.
 *            The simulator draws them in a console pane.
 *
 * They compose: 'serial,ops' does both. The set is a plain string so it can
 * be stored in configStorage and changed on a running device without a
 * rebuild.
 *
 * ES5 and MicroQuickJS-safe on purpose: this is the file the device needs
 * most, so it may not use anything the device lacks.
 */

var LEVELS = { debug: 10, log: 20, info: 20, warn: 30, error: 40 };
var LEVEL_NAMES = ['debug', 'log', 'info', 'warn', 'error'];

/* console's own formatting, minus the parts that need a real inspector.
   Objects are shown one level deep: enough to see a shape, never enough to
   turn a log line into a memory problem. */
function fmtOne(v, depth) {
  if (v === null) return 'null';
  if (v === undefined) return 'undefined';
  var t = typeof v;
  if (t === 'string') return depth > 0 ? '"' + v + '"' : v;
  if (t === 'number' || t === 'boolean') return '' + v;
  if (t === 'function') return '[Function' + (v.name ? ' ' + v.name : '') + ']';
  if (t !== 'object') return '' + v;

  if (depth > 1) return Array.isArray && Array.isArray(v) ? '[Array]' : '[Object]';

  var i, parts = [];
  if (v.length !== undefined && v.splice) {          /* array-ish */
    for (i = 0; i < v.length && i < 12; i++) parts.push(fmtOne(v[i], depth + 1));
    if (v.length > 12) parts.push('...' + (v.length - 12) + ' more');
    return '[' + parts.join(', ') + ']';
  }
  var n = 0;
  for (var k in v) {
    if (!Object.prototype.hasOwnProperty.call(v, k)) continue;
    if (n++ >= 12) { parts.push('...'); break; }
    parts.push(k + ': ' + fmtOne(v[k], depth + 1));
  }
  return '{' + parts.join(', ') + '}';
}

function format(args) {
  var out = [];
  for (var i = 0; i < args.length; i++) out.push(fmtOne(args[i], 0));
  return out.join(' ');
}

/* 'serial,ops' -> {serial:1, ops:1}. Unknown names are ignored rather than
   throwing: this string arrives from storage, and a typo in a config value
   should not take an app down. */
function parseSinks(spec) {
  var set = {}, i;
  var parts = ('' + (spec || '')).split(',');
  for (i = 0; i < parts.length; i++) {
    var name = parts[i].replace(/^\s+|\s+$/g, '');
    if (name === 'buffer' || name === 'serial' || name === 'ops') set[name] = 1;
    else if (name === 'none' || name === 'off') return {};
    else if (name === 'all') return { buffer: 1, serial: 1, ops: 1 };
  }
  return set;
}

/**
 * createLog(opts) -> a logger.
 *
 * opts.write(text)      the serial sink; omitted, 'serial' does nothing
 * opts.emit(level, text) the ops sink; omitted, 'ops' does nothing
 * opts.sinks            initial sink spec, default 'buffer'
 * opts.level            lowest level kept, default 'debug'
 * opts.max              lines held in the ring, default 200
 */
function createLog(opts) {
  opts = opts || {};
  var ring = [], seq = 0;
  var max = opts.max || 200;
  var sinks = parseSinks(opts.sinks === undefined ? 'buffer' : opts.sinks);
  var minLevel = LEVELS[opts.level] || LEVELS.debug;

  function emit(level, args) {
    if ((LEVELS[level] || 20) < minLevel) return;
    var text = format(args);
    if (sinks.buffer) {
      ring.push({ n: ++seq, level: level, text: text });
      /* a ring, not a growing list: a script in a loop must not be able to
         exhaust memory by logging */
      while (ring.length > max) ring.shift();
    }
    if (sinks.serial && opts.write) {
      opts.write((level === 'log' ? '' : '[' + level + '] ') + text + '\n');
    }
    if (sinks.ops && opts.emit) opts.emit(level, text);
  }

  var api = {
    /* the console object to install as a global */
    console: {},
    /* everything since the given sequence number, for a poller */
    since: function (n) {
      var out = [];
      for (var i = 0; i < ring.length; i++) if (ring[i].n > (n || 0)) out.push(ring[i]);
      return out;
    },
    lines: function () { return ring.slice(); },
    clear: function () { ring = []; },
    seq: function () { return seq; },
    setSinks: function (spec) { sinks = parseSinks(spec); return api.sinks(); },
    sinks: function () {
      var out = [];
      for (var k in sinks) if (sinks[k]) out.push(k);
      return out.join(',');
    },
    setLevel: function (name) { minLevel = LEVELS[name] || LEVELS.debug; }
  };

  for (var i = 0; i < LEVEL_NAMES.length; i++) {
    (function (name) {
      api.console[name] = function () { emit(name, arguments); };
    })(LEVEL_NAMES[i]);
  }
  return api;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    createLog: createLog, format: format, parseSinks: parseSinks,
    LEVELS: LEVELS, LEVEL_NAMES: LEVEL_NAMES
  };
}
