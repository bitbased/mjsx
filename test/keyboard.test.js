/* Keyboard fitting: the keys that must exist, must exist.
 *
 * Written after a real regression: the QWERTY bottom row's side keys are
 * FIXED width, so on a narrow row (a portrait phone, and above all the
 * bottom chord of round glass) they ate the row and SPACE -- the one
 * flexing key -- collapsed to nothing. A keyboard with no space bar
 * shipped to a device before anyone noticed. Row three had the twin of
 * that bug: nine flex cells too narrow for a three-character label, so
 * DEL rendered as a blank slab.
 *
 * These tests read the CAPTURED TEXT OPS, so they check what the glass
 * would actually show rather than what the tree intended.
 */
var test = require('bun:test');
var describe = test.describe, it = test.it, expect = test.expect;
var load = require('./load.js');

/* every shape in the fleet, plus the two extremes that bracket it */
var SHAPES = [
  { name: '240x280 portrait', w: 240, h: 280, round: false },
  { name: '320x172 landscape', w: 320, h: 172, round: false },
  { name: '172x320 tall', w: 172, h: 320, round: false },
  { name: '480x320 large', w: 480, h: 320, round: false },
  { name: '240x240 round', w: 240, h: 240, round: true }
];

/* layouts that are text entry; `numbers` is a number pad and owes no
   space bar */
var TEXT_LAYOUTS = ['auto', 'qwerty', 't9', 'strip'];

function renderKb(shape, layout) {
  if (shape.round) {
    /* seed the host flag the way a round firmware does, then reload so
       UI.isRound() reads it fresh */
    var seed = load.fresh(shape.w, shape.h);
    seed.backend.sys.store('round', '1');
  }
  var t = load.fresh(shape.w, shape.h, { textMode: 'capture' });
  if (shape.round) t.backend.sys.store('round', '1');
  globalThis.UI.mount(function () {
    return globalThis.h('box', { h: globalThis.gfx.height() }, [
      globalThis.h('input', { id: 'f', size: 2, placeholder: 'x' }),
      globalThis.h(globalThis.Keyboard, {
        layout: layout, position: 'bottom',
        height: Math.floor(shape.h / 2.6)
      })
    ]);
  });
  globalThis.UI.render();
  globalThis.UI.focus('f');
  globalThis.UI.render();
  var ops = t.backend.textOps;
  return {
    ops: ops,
    labels: ops.map(function (o) { return o.str; })
  };
}

/* The space bar carries the drawn ␣ mark, not a word, so it cannot be
   found among the text ops -- it is found by TYPING one. Press its key
   and see whether a space reaches the field: the only definition of a
   working space bar that matters. T9 spells its own combined key
   "SPC @-", which is a real label rather than a truncation. */
function typesASpace(t) {
  /* Press every tappable rect in turn and watch the field: the space bar
     is whichever one puts a space in it. Keys that type something else
     are undone before moving on. */
  var val = function () {
    var st = globalThis.UI._inputs.f;
    return st && st.text ? st.text : '';
  };
  var before = val();
  var hits = globalThis.UI._hits || [];
  for (var i = 0; i < hits.length; i++) {
    var hit = hits[i];
    if (!hit.fn) continue;
    var cx = hit.x + hit.w / 2, cy = hit.y + hit.h / 2;
    /* a stray tap on the panel's shield blurs the field, and every key
       after that would type into nothing */
    globalThis.UI.focus('f');
    globalThis.UI.pointer(0, 0, cx, cy);   /* (id, phase, x, y) */
    globalThis.UI.pointer(0, 2, cx, cy);
    var now = val();
    if (now.length > before.length && now.charAt(now.length - 1) === ' ') return true;
    if (now !== before) {
      globalThis.UI.key('press', 'Backspace');
      before = val();
    }
  }
  return false;
}
function hasDel(labels) {
  return labels.indexOf('DEL') >= 0;
}

describe('keyboard fits its glass', function () {
  for (var si = 0; si < SHAPES.length; si++) {
    (function (shape) {
      for (var li = 0; li < TEXT_LAYOUTS.length; li++) {
        (function (layout) {
          it(shape.name + ' / ' + layout + ' keeps space, delete and commit', function () {
            var r = renderKb(shape, layout);
            expect(typesASpace(r)).toBe(true);
            expect(hasDel(r.labels)).toBe(true);
            expect(r.labels.indexOf('OK')).toBeGreaterThanOrEqual(0);
          });

          it(shape.name + ' / ' + layout + ' draws no label off the display', function () {
            var r = renderKb(shape, layout);
            var off = [];
            for (var i = 0; i < r.ops.length; i++) {
              var o = r.ops[i];
              /* the STRIP layout's scrolling row is content inside a
                 clipped, draggable box -- wider than its viewport on
                 purpose, so it is not an overflow */
              if (o.str.length > 30) continue;
              if (o.x < -1 || (o.x + o.str.length * o.adv) > shape.w + 1) {
                off.push(o.str + '@' + o.x);
              }
            }
            expect(off).toEqual([]);
          });
        })(TEXT_LAYOUTS[li]);
      }

      it(shape.name + ' / numbers keeps delete and commit', function () {
        var r = renderKb(shape, 'numbers');
        expect(hasDel(r.labels)).toBe(true);
        expect(r.labels.indexOf('OK')).toBeGreaterThanOrEqual(0);
      });
    })(SHAPES[si]);
  }

  it('auto picks by the width the keys actually get', function () {
    /* wide: ten columns fit */
    var wide = renderKb({ w: 480, h: 320, round: false }, 'auto');
    expect(wide.labels.indexOf('q')).toBeGreaterThanOrEqual(0);
    /* round 240: measures 240 across the middle but only ~178 where the
       bottom rows sit, so QWERTY does not fit and T9 is the honest pick */
    var round = renderKb({ w: 240, h: 240, round: true }, 'auto');
    expect(round.labels.indexOf('q')).toBe(-1);
    expect(round.labels.join(' ').indexOf('abc')).toBeGreaterThanOrEqual(0);
  });

  it('a named layout is honoured even where it is cramped', function () {
    /* the whole point of naming one: round glass would auto-pick T9, but
       an explicit qwerty stays qwerty -- inset, not replaced */
    var r = renderKb({ w: 240, h: 240, round: true }, 'qwerty');
    expect(r.labels.indexOf('q')).toBeGreaterThanOrEqual(0);
    expect(typesASpace(r)).toBe(true);
  });
});
