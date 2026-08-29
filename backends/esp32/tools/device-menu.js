/* ---- example picker for the device ----
 *
 * Every example was bundled as a lazy function that runs its module code
 * (ending in its own UI.mount) when picked — nothing mounts at load
 * except this menu. A floating dot overlays whichever example runs;
 * tapping it returns here. UI.reset() between the two is the same boot
 * boundary the sim's launcher uses, in the one persistent JS context.
 */
function _deviceSafe() {
  UI.safe.top = 24;
  UI.safe.bottom = 25;
}

function _menu() {
  UI.reset();
  _deviceSafe();
  __replayFeed();
  UI.mount(function () {
    /* static after load: built once, reused every frame (scroll offset
       lives outside the tree, so scrolling needs no rebuild) */
    return UI.memo('_menuPage', [gfx.height()], function () {
      var kids = [
        h('text', { text: 'MJSX', size: 2, align: 'center', color: UI.theme.accent }),
        h('spacer', { h: 4 })
      ];
      for (var i = 0; i < EXAMPLES.length; i++) {
        kids.push(h(Button, {
          label: EXAMPLES[i][0], size: 2, pad: 8,
          onTap: (function (j) { return function () { _runExample(j); }; })(i)
        }));
      }
      return h('box', { h: gfx.height(), scroll: '_menu', pad: 10, padT: 26, gap: 6 }, kids);
    });
  });
}

function _runExample(i) {
  UI.reset();
  _deviceSafe();
  __replayFeed();
  EXAMPLES[i][1]();
  var appRoot = UI.root;
  /* the app gets first refusal on every key; an Escape nobody claims
     (the edge-back swipe, the BOOT button) walks back to the menu */
  var appKey = UI.onKey;
  UI.onKey = function (type, key) {
    if (appKey && appKey(type, key)) return true;
    if (type === 'press' && key === 'Escape') { _menu(); return true; }
  };
  /* the example's own root, with a floating exit dot painted over it.
     On round glass the top-right corner does not exist, so the dot sits
     top-CENTRE instead -- and the edge-back swipe reaches the menu too. */
  var dotX = UI.isRound() ? (gfx.width() >> 1) - 10 : gfx.width() - 24;
  var dotY = UI.isRound() ? 6 : 26;
  UI.mount(function () {
    return h('box', {}, [
      h(appRoot, {}),
      h('abs', { x: dotX, y: dotY },
        h('box', { w: 20, h: 20, bg: 0x333a46, radius: 10, hitPad: 10,
                   vcenter: true, onTap: _menu },
          /* the star, not lowercase x: x inks rows 2-6 (baseline) and
             sits visibly low in the dot; * inks rows 1-5, dead centre */
          h('text', { text: '*', size: 1, align: 'center', color: 0xf87171 })))
    ]);
  });
}

_menu();
