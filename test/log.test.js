/* The console: formatting, sinks, and the bound on the ring.
 *
 * These are the properties a console has to have on a chip and nowhere
 * else: it must never grow without limit, it must format an object without
 * an inspector, and its sink set has to survive arriving as a config string
 * that someone may have typed wrong.
 */
var test = require('bun:test');
var describe = test.describe, it = test.it, expect = test.expect;
var mlog = require('../packages/core/src/log.js');
var oprec = require('../packages/core/src/oprec.js');

describe('console formatting', function () {
  it('prints scalars the way a console does', function () {
    expect(mlog.format(['a', 1, true, null, undefined])).toBe('a 1 true null undefined');
  });

  it('shows an object one level deep, and says so below that', function () {
    expect(mlog.format([{ a: 1, b: 'x' }])).toBe('{a: 1, b: "x"}');
    expect(mlog.format([[1, 2, 3]])).toBe('[1, 2, 3]');
    /* deeper than one level is a shape, not a dump: a log line must not be
       able to turn into a memory problem */
    expect(mlog.format([{ a: { b: { c: 1 } } }])).toBe('{a: {b: [Object]}}');
  });

  it('caps long arrays and wide objects rather than printing them whole', function () {
    var big = [];
    for (var i = 0; i < 40; i++) big.push(i);
    var out = mlog.format([big]);
    expect(out.indexOf('...28 more')).toBeGreaterThan(-1);
    expect(out.length).toBeLessThan(120);
  });

  it('a top-level string is bare, a nested one is quoted', function () {
    expect(mlog.format(['hi'])).toBe('hi');
    expect(mlog.format([['hi']])).toBe('["hi"]');
  });
});

describe('sink sets', function () {
  it('parses a comma list, and the shorthands', function () {
    expect(mlog.parseSinks('buffer,ops')).toEqual({ buffer: 1, ops: 1 });
    expect(mlog.parseSinks('all')).toEqual({ buffer: 1, serial: 1, ops: 1 });
    expect(mlog.parseSinks('none')).toEqual({});
  });

  it('ignores a name it does not know instead of throwing', function () {
    /* this string comes out of storage; a typo must not take an app down */
    expect(mlog.parseSinks('buffer,wat')).toEqual({ buffer: 1 });
  });
});

describe('the ring', function () {
  it('is bounded, so a script logging in a loop cannot exhaust memory', function () {
    var lg = mlog.createLog({ max: 10 });
    for (var i = 0; i < 500; i++) lg.console.log('line ' + i);
    expect(lg.lines().length).toBe(10);
    expect(lg.lines()[9].text).toBe('line 499');
    /* the sequence keeps counting past what is retained: that is how a
       reader knows lines were dropped rather than never sent */
    expect(lg.seq()).toBe(500);
  });

  it('since(n) returns only what is newer', function () {
    var lg = mlog.createLog({});
    lg.console.log('a'); lg.console.log('b');
    var first = lg.since(0);
    expect(first.length).toBe(2);
    expect(lg.since(first[1].n).length).toBe(0);
    lg.console.warn('c');
    var next = lg.since(first[1].n);
    expect(next.length).toBe(1);
    expect(next[0].level).toBe('warn');
  });

  it('routes to serial and ops only when asked', function () {
    var wrote = [], emitted = [];
    var lg = mlog.createLog({
      sinks: 'buffer',
      write: function (t) { wrote.push(t); },
      emit: function (lv, t) { emitted.push([lv, t]); }
    });
    lg.console.log('quiet');
    expect(wrote.length).toBe(0);
    expect(emitted.length).toBe(0);

    lg.setSinks('serial,ops');
    lg.console.error('loud');
    expect(wrote.length).toBe(1);
    expect(wrote[0]).toBe('[error] loud\n');
    expect(emitted[0]).toEqual(['error', 'loud']);
    /* buffer is off now, so the ring did not grow */
    expect(lg.lines().length).toBe(1);
  });

  it('honours a minimum level', function () {
    var lg = mlog.createLog({ level: 'warn' });
    lg.console.log('dropped');
    lg.console.debug('dropped too');
    lg.console.error('kept');
    expect(lg.lines().length).toBe(1);
    expect(lg.lines()[0].text).toBe('kept');
  });
});

describe('the L op', function () {
  function nullGfx() {
    var n = function () {};
    return { clear: n, rect: n, frect: n, circle: n, line: n, text: n,
             clip: n, unclip: n, width: function () { return 240; },
             height: function () { return 280; } };
  }

  it('carries a console line in the frame, and replay does not draw it', function () {
    var rec = oprec.record(nullGfx());
    rec.gfx.clear(0);
    rec.gfx.log('warn', 'careful');
    var ops = rec.take();
    expect(ops.length).toBe(2);
    expect(ops[1]).toEqual(['L', 'warn', 'careful']);

    /* a surface with no log sink must replay the frame without complaining */
    var drew = 0;
    var target = nullGfx();
    target.clear = function () { drew++; };
    oprec.replay(ops, target);
    expect(drew).toBe(1);

    /* one that has a sink receives it */
    var got = [];
    var target2 = nullGfx();
    target2.log = function (lv, t) { got.push([lv, t]); };
    oprec.replay(ops, target2);
    expect(got).toEqual([['warn', 'careful']]);
  });

  it('the active recorder is released by take, so recorders can nest', function () {
    /* Relative, not absolute: other suites in this run may have left a
       recorder open, and asserting a globally empty stack made this pass
       alone and fail in the full run — a test coupled to file order. */
    var before = oprec.active();
    var outer = oprec.record(nullGfx());
    expect(oprec.active()).toBe(outer.gfx);
    var inner = oprec.record(nullGfx());
    expect(oprec.active()).toBe(inner.gfx);
    inner.take();
    /* the inner one leaves and the OUTER is active again — it is still
       collecting, so a line logged now belongs in its frame. With a single
       slot instead of a stack this was null and those lines vanished. */
    expect(oprec.active()).toBe(outer.gfx);
    outer.take();
    expect(oprec.active()).toBe(before);
  });
});

describe('the ring is bounded by size, not only by line count', function () {
  var createLog = mlog.createLog;

  it('evicts on BYTES as well as on lines', function () {
    /* A line count alone is not a memory bound: 120 lines of a megabyte
       each is 120 megabytes, which on the host this runs on is the whole
       chip. This was the actual shape of the bug -- `max` looked like a
       memory limit and was not one. */
    var log = createLog({ max: 1000, maxBytes: 1000, maxLine: 400 });
    for (var i = 0; i < 50; i++) log.console.log(new Array(301).join('x'));

    expect(log.lines().length).toBeLessThan(50);      /* evicted long before 1000 */
    expect(log.bytes()).toBeLessThanOrEqual(1000);
    expect(log.seq()).toBe(50);                        /* and it is the OLD ones that went */
    expect(log.lines()[log.lines().length - 1].n).toBe(50);
  });

  it('truncates one enormous line rather than letting it fill the ring', function () {
    var log = createLog({ max: 10, maxBytes: 4096, maxLine: 100 });
    log.console.log(new Array(5001).join('y'));
    var only = log.lines()[0];

    expect(only.text.length).toBeLessThan(200);
    expect(only.text.indexOf('+4900 more') >= 0).toBe(true);   /* says what it dropped */
    expect(log.bytes()).toBe(only.text.length);
  });

  it('keeps the newest line even when it alone exceeds the budget', function () {
    var log = createLog({ max: 10, maxBytes: 50, maxLine: 500 });
    log.console.log(new Array(301).join('z'));
    expect(log.lines().length).toBe(1);
    expect(log.since(0).length).toBe(1);
  });

  it('clear() resets the byte count too', function () {
    var log = createLog({ maxBytes: 1000 });
    log.console.log('something');
    expect(log.bytes()).toBeGreaterThan(0);
    log.clear();
    expect(log.bytes()).toBe(0);
  });
});
