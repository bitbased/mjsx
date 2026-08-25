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
  /* the example's own root, with a floating exit dot painted over it */
  UI.mount(function () {
    return h('box', {}, [
      h(appRoot, {}),
      h('abs', { x: gfx.width() - 24, y: 26 },
        h('box', { w: 20, h: 20, bg: 0x333a46, radius: 10, hitPad: 10,
                   vcenter: true, onTap: _menu },
          h('text', { text: 'x', size: 1, align: 'center', color: 0xf87171 })))
    ]);
  });
}

_menu();
