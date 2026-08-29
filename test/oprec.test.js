/* Draw-op recording and replay.
 *
 * The claim being tested is the one the documentation rests on: a
 * recorded frame is the SAME picture when replayed at 1x, and a genuine
 * re-render — not a magnification — at any other scale. If that breaks,
 * every figure carrying ops in its PNG quietly becomes a lie.
 */
var test = require('bun:test');
var describe = test.describe, it = test.it, expect = test.expect;
var crypto = require('crypto');
var path = require('path');
var oprec = require('../packages/core/src/oprec.js');
var load = require('./load.js');

var BACKEND = path.resolve(__dirname, '../backends/pure-js/src/backend.js');

function sha(buf) {
  return crypto.createHash('sha256').update(Buffer.from(buf)).digest('hex');
}

/* Draw a small scene through whatever gfx is handed in. */
function scene(g) {
  g.clear(0x101010);
  g.frect(4, 4, 40, 20, 0x2244aa, 4);
  g.rect(8, 30, 30, 12, 0xffffff, 0);
  g.circle(60, 20, 10, 0x44dd88, true);
  g.line(0, 50, 80, 50, 0x888888);
  g.clip(2, 2, 70, 60);
  g.text(6, 54, 1, 0xffffff, 'hi');
  g.unclip();
}

describe('op recording', function () {
  it('records one entry per draw call, in order', function () {
    var t = load.fresh(80, 64);
    var rec = oprec.record(globalThis.gfx);
    scene(rec.gfx);
    var ops = rec.take();
    expect(ops.map(function (o) { return o[0]; }))
      .toEqual(['C', 'f', 'r', 'c', 'l', 'x', 't', 'X']);
    expect(t).toBeTruthy();
  });

  it('take() empties the buffer so the next frame starts clean', function () {
    load.fresh(80, 64);
    var rec = oprec.record(globalThis.gfx);
    scene(rec.gfx);
    expect(rec.take().length).toBeGreaterThan(0);
    expect(rec.take()).toEqual([]);
  });

  it('still draws while recording — it wraps, it does not replace', function () {
    var direct = load.fresh(80, 64);
    scene(globalThis.gfx);
    var pixelsDirect = sha(direct.backend.raw);

    var wrapped = load.fresh(80, 64);
    var rec = oprec.record(globalThis.gfx);
    scene(rec.gfx);
    expect(sha(wrapped.backend.raw)).toBe(pixelsDirect);
  });

  it('replays at 1x to exactly the same pixels', function () {
    var a = load.fresh(80, 64);
    var rec = oprec.record(globalThis.gfx);
    scene(rec.gfx);
    var ops = rec.take();
    var original = sha(a.backend.raw);

    var b = load.fresh(80, 64);
    oprec.replay(ops, globalThis.gfx, 1);
    expect(sha(b.backend.raw)).toBe(original);
  });

  it('replays at 2x as a re-render, not a magnification', function () {
    load.fresh(80, 64);
    var rec = oprec.record(globalThis.gfx);
    scene(rec.gfx);
    var ops = rec.take();

    var big = load.fresh(160, 128);
    oprec.replay(ops, globalThis.gfx, 2);

    /* A magnified 80x64 bitmap has every pixel in 2x2 blocks. A re-render
       does not: text at size 2 has strokes a magnifier could not invent.
       So look for a row where two vertically adjacent rows differ — proof
       the detail is finer than the source's pixel grid. */
    var raw = big.backend.raw, stride = 160 * 3;
    var foundOddRow = false;
    for (var y = 0; y + 1 < 128 && !foundOddRow; y += 2) {
      for (var x = 0; x < stride; x++) {
        if (raw[y * stride + x] !== raw[(y + 1) * stride + x]) { foundOddRow = true; break; }
      }
    }
    expect(foundOddRow).toBe(true);
  });

  it('carries a real frame from the engine through a round trip', function () {
    var a = load.fresh(240, 280);
    globalThis.UI.mount(function () {
      return globalThis.h('box', { h: 280, pad: 8, gap: 6 }, [
        globalThis.h('text', { text: 'HELLO', size: 2, align: 'center' }),
        globalThis.h(globalThis.Button, { label: 'tap', onTap: function () {} })
      ]);
    });
    globalThis.UI.render();
    var rec = oprec.record(globalThis.gfx);
    var real = globalThis.gfx;
    globalThis.gfx = rec.gfx;
    globalThis.UI.render();
    globalThis.gfx = real;
    var ops = rec.take();
    /* a clear, the button's rect, and the two labels — small on purpose,
       so the assertion that matters is the pixel match below */
    expect(ops.length).toBeGreaterThan(2);
    var before = sha(a.backend.raw);

    var b = load.fresh(240, 280);
    oprec.replay(ops, globalThis.gfx, 1);
    expect(sha(b.backend.raw)).toBe(before);
  });
});
