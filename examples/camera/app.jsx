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
  /* the mounted rotation is a SETTING: restore it before first frame */
  var savedRot = parseInt(configStorage.get('cam.rot', '0')) || 0;
  if (savedRot) sys.modCtl('cam', 'rot' + savedRot);
  UI.set({ camrot: savedRot });
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
  var W = gfx.width(), H = gfx.height();
  /* the PHOTO is the background: contained in the screen at the
     mounted aspect, so any orientation just works */
  var aw = odd ? 3 : 4, ah = odd ? 4 : 3;
  var bw = Math.min(W, Math.floor(H * aw / ah));
  var bh = Math.floor(bw * ah / aw);
  if (bh > H) { bh = H; bw = Math.floor(bh * aw / ah); }
  var bx = Math.floor((W - bw) / 2), by = Math.floor((H - bh) / 2);
  /* the PREVIEW overlays as picture-in-picture, same aspect */
  var pw = Math.floor(W / 4);
  var ph = Math.floor(pw * ah / aw);

  return (
    <box h={H} bg={0x000000}>
      <abs x={bx} y={by}>
        {h('canvas', { src: 3, w: bw, h: bh })}
      </abs>
      <abs x={8} y={H - ph - 8}>
        <box border={0xffffff} borderW={1}>
          {h('canvas', { src: 2, w: pw, h: ph })}
        </box>
      </abs>
      <abs x={8} y={8}>
        <text text={!HAVE_CAM ? 'no camera module here'
                  : ok ? 'LIVE ' + (UI.state.camf || 0)
                  : 'camera failed to start'}
              size={1} color={ok ? UI.theme.ok : UI.theme.warn} />
      </abs>
      <abs x={0} y={H - 48}>
        {/* full-width row, flex spacer: right-aligned at ANY size */}
        <row w={W} padR={8} gap={8}>
          <box flex={1} />
          <Button label="SNAP" size={2} bg={UI.theme.accent}
                  onTap={function () {
                    if (HAVE_CAM) sys.modCtl('cam', 'snap');
                  }} />
          <Button label="ROT" size={2} bg={UI.theme.key}
                  onTap={function () {
                    if (!HAVE_CAM) return;
                    sys.modCtl('cam', 'rot');
                    configStorage.set('cam.rot', ((UI.state.camrot || 0) + 1) % 4);
                  }} />
        </row>
      </abs>
    </box>
  );
}

UI.mount(App);
