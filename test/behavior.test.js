/*
 * Behavior tests for mjsx-core, driven headlessly through the pure-js
 * backend: synthetic UI.pointer strokes against the hit rects the render
 * actually registered, never hardcoded coordinates.
 */
import { test, expect } from 'bun:test';
const { fresh, sha256 } = require('./load.js');

/* Topmost registered tap target under a point — the same later-drawn-wins
   rule UI.tap uses, minus shields and draw-captures. */
function tapHitAt(UI, x, y) {
  for (var i = UI._hits.length - 1; i >= 0; i--) {
    var t = UI._hits[i];
    if (t.shield || !t.fn) continue;
    if (x >= t.x && x < t.x + t.w && y >= t.y && y < t.y + t.h) return t;
  }
  return null;
}

function tapCenter(UI, t) {
  var cx = t.x + (t.w >> 1), cy = t.y + (t.h >> 1);
  UI.pointer(0, 0, cx, cy);
  UI.pointer(0, 2, cx, cy);
}

test('tap: pointer press+release on a Button fires onTap, and the next render differs', () => {
  const { backend, UI, h } = fresh(240, 280);
  UI.mount(function () {
    var n = UI.state.n || 0;
    return h('box', { pad: 10, gap: 10 },
      h('text', { text: 'N=' + n, size: 2 }),
      h(Button, { label: '+1', onTap: function () { UI.set({ n: n + 1 }); } }));
  });
  UI.render();
  const before = sha256(backend.raw);

  expect(UI._hits.length).toBe(1); // only the Button registered a target
  expect(UI.dirty()).toBe(false);
  tapCenter(UI, UI._hits[0]);

  expect(UI.state.n).toBe(1);
  expect(UI.dirty()).toBe(true);   // UI.set marked the frame stale
  UI.render();
  expect(sha256(backend.raw)).not.toBe(before);
});

function mountList(UI, h, rows) {
  UI.mount(function () {
    var kids = [];
    for (var i = 0; i < rows; i++) {
      kids.push(h('box', { h: 50, bg: 0x333333 }, h('text', { text: 'ROW ' + i })));
    }
    return h('box', { scroll: 'list', h: 200, gap: 4 }, kids);
  });
  UI.render();
}

test('drag scroll: a vertical pointer stream moves the offset and clamps at maxOff', () => {
  const { UI, h } = fresh(240, 280);
  mountList(UI, h, 10);
  /* content 10*50 + 9*4 = 536, viewport 200 -> maxOff 336 */
  expect(UI._swipes.length).toBe(1);
  expect(UI._swipes[0].maxOff).toBe(336);

  UI.pointer(0, 0, 120, 150);
  UI.pointer(0, 1, 120, 100);          // finger up 50px -> content scrolls down 50
  expect(UI._scroll.list).toBe(50);
  UI.pointer(0, 1, 120, -800);         // way past the end
  expect(UI._scroll.list).toBe(336);   // clamped, not 950
  UI.pointer(0, 2, 120, -800);
  expect(UI._scroll.list).toBe(336);
});

test('round overscroll: round glass extends maxOff by height/4', () => {
  const { UI, h } = fresh(240, 280);
  UI._round = true;                    // what configStorage 'round'='1' seeds
  mountList(UI, h, 10);
  expect(UI._swipes[0].maxOff).toBe(336 + (280 >> 2));
  UI.pointer(0, 0, 120, 150);
  UI.pointer(0, 1, 120, -800);
  expect(UI._scroll.list).toBe(406);
  UI.pointer(0, 2, 120, -800);
});

test('round overscroll is unconditional: content that fits still gets the quarter-screen', () => {
  const { UI, h } = fresh(240, 280);
  UI._round = true;
  mountList(UI, h, 2);                 // content 104 < viewport 200 -> maxOff would be 0
  expect(UI._swipes[0].maxOff).toBe(280 >> 2);
  UI.pointer(0, 0, 120, 150);
  UI.pointer(0, 1, 120, -800);
  expect(UI._scroll.list).toBe(70);
  UI.pointer(0, 2, 120, -800);
});

test('round flag comes from configStorage before first isRound()', () => {
  const { UI, core } = fresh(240, 280);
  // pure-js sys.store/fetch back configStorage on this backend, like NVS
  core.configStorage.set('round', '1');
  expect(UI.isRound()).toBe(true);
});

test('edge-back: an edge press dragged inward is Escape once, and the release is not a tap', () => {
  const { UI, h } = fresh(240, 280);
  let taps = 0;
  const keys = [];
  UI.mount(function () {
    return h('box', {},
      h(Button, { label: 'BIG', h: 260, onTap: function () { taps++; } }));
  });
  UI.render();
  UI.onKey = function (type, key) { keys.push(type + '/' + key); };

  UI.pointer(0, 0, 4, 100);            // press inside the 12px edge band
  UI.pointer(0, 1, 60, 100);           // inward past the 40px threshold
  expect(keys).toEqual(['press/Escape']);
  UI.pointer(0, 1, 90, 104);           // keeps moving: must not re-fire
  UI.pointer(0, 2, 90, 104);           // release: the stroke was spent
  expect(keys).toEqual(['press/Escape']);
  expect(taps).toBe(0);                // the button underneath never heard it
});

test('T9 keyboard: tapping the same key again inside the window cycles the letter', () => {
  /* textMode 'capture' records gfx.text calls, which is how the test finds
     the abc2 key on screen: the digit hint '2' is drawn exactly once, and
     the hit rect around it is the key. */
  const { backend, UI, h } = fresh(240, 280, { textMode: 'capture' });
  UI.mount(function () {
    return h('box', { h: gfx.height(), gap: 4 },
      h('input', { id: 'f' }),
      h(Keyboard, { layout: 't9' }));
  });
  UI.render();
  UI.focus('f');
  UI.render();

  const hint = backend.textOps.filter(function (op) { return op.str === '2'; });
  expect(hint.length).toBe(1);
  const key = tapHitAt(UI, hint[0].x, hint[0].y);
  expect(key).not.toBe(null);

  tapCenter(UI, key);
  expect(UI._inputs.f.text).toBe('a'); // first tap: first letter of abc2
  tapCenter(UI, key);                  // same key, inside the 900ms window
  expect(UI._inputs.f.text).toBe('b'); // Backspace + next letter, one char kept
  expect(UI._inputs.f.cur).toBe(1);
});

/* A screen's whole-stroke handler must not outlive the screen.
   UI.onPointer returning true claims a press BEFORE hit-testing, so one
   left behind by a previous screen makes the next screen untouchable --
   which is exactly what happened on hardware: after visiting the
   asteroids example, the draw example's canvas accepted no strokes at
   all, and every ordinary button still worked, so nothing pointed at the
   cause. reset() clears onTick/onKey/onPatch; it has to clear this too. */
test('reset: a screen-wide onPointer does not survive into the next screen', () => {
  const { UI, h } = fresh(240, 280);

  var claimed = 0;
  UI.onPointer = function () { claimed++; return true; };   /* an asteroids-like grab */
  UI.mount(function () { return h('box', {}); });
  UI.render();
  UI.pointer(0, 0, 100, 100);
  expect(claimed).toBe(1);                                  /* it is in force */

  UI.reset();
  expect(UI.onPointer).toBe(null);

  /* and the next screen's capture control actually receives the stroke */
  var got = [];
  UI.mount(function () {
    return h('box', { h: 200,
      onDraw: function (phase, x, y, id) { got.push(phase); } });
  });
  UI.render();
  const box = UI._hits[UI._hits.length - 1];
  UI.pointer(0, 0, box.x + 10, box.y + 10);
  UI.pointer(0, 1, box.x + 20, box.y + 20);
  UI.pointer(0, 2, box.x + 30, box.y + 30);

  expect(claimed).toBe(1);            /* the old handler saw nothing more */
  expect(got).toEqual([0, 1, 2]);     /* the new screen owns its strokes */
});
