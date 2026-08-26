/*
 * The camera, as canvas sources: the module drops a live frame into the
 * PREVIEW canvas (~8fps, small) and SNAP copies one full frame into the
 * PHOTO canvas. The UI just blits both -- the op stream stays tiny and
 * remote viewers get the pictures in-band like any canvas. Everything
 * arrives async: the module nudges state (camf, snap) and this view
 * simply renders.
 */
var HAVE_CAM = false;
if (typeof sys !== 'undefined' && typeof sys.mods === 'function') {
  try {
    var mods = JSON.parse('' + sys.mods());
    for (var mi = 0; mi < mods.length; mi++) {
      if (mods[mi].name === 'cam') HAVE_CAM = true;
    }
  } catch (e) {}
}
if (HAVE_CAM) {
  UI.set({ camOk: sys.modCtl('cam', 'start') ? 1 : 0 });
  /* leaving the example RELEASES the sensor: no background capture,
     no per-frame nudges re-rendering the menu */
  if (typeof UI.onCleanup === 'function') {
    UI.onCleanup(function () { sys.modCtl('cam', 'stop'); });
  }
}

function App() {
  var ok = UI.state.camOk;
  var rot = UI.state.camrot || 0;
  var odd = rot % 2 === 1;
  var w = gfx.width();
  var pw = Math.floor(w / 3);            /* the preview stays small */
  var ph = Math.floor(pw * 3 / 4);
  var bw = w - 16;
  var bh = Math.floor(bw * 3 / 4);
  if (odd) {
    /* quarter-turned: the sources are portrait now */
    ph = pw; pw = Math.floor(ph * 3 / 4);
    bh = Math.floor((gfx.height() - 140));
    bw = Math.floor(bh * 3 / 4);
  }

  return (
    <box h={gfx.height()} pad={8} gap={8}>
      {/* padR keeps the controls clear of the floating exit dot */}
      <row gap={8} padR={36}>
        <box gap={4}>
          <text text="PREVIEW" size={1} color={UI.theme.muted} />
          {h('canvas', { src: 2, w: pw, h: ph })}
        </box>
        <box gap={4} flex={1}>
          <text text={!HAVE_CAM ? 'no camera module here'
                    : ok ? 'LIVE  frame ' + (UI.state.camf || 0)
                    : 'camera failed to start'}
                size={1} color={ok ? UI.theme.ok : UI.theme.warn} />
          <row gap={8}>
            <Button label="SNAP" size={2} bg={UI.theme.accent}
                    onTap={function () {
                      if (HAVE_CAM) sys.modCtl('cam', 'snap');
                    }} />
            <Button label="ROT" size={2} bg={UI.theme.key}
                    onTap={function () {
                      if (HAVE_CAM) sys.modCtl('cam', 'rot');
                    }} />
          </row>
        </box>
      </row>
      <text text={'PHOTO' + (UI.state.snap ? '' : '  (none yet)')}
            size={1} color={UI.theme.muted} />
      {h('canvas', { src: 3, w: bw, h: bh })}
    </box>
  );
}

UI.mount(App);
