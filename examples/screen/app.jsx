/*
 * Screen settings, in JSX: brightness, sleep timeout, and what sleeping
 * means (dim to readable, or dark). The natives do the real work and
 * persist to flash themselves — sys.backlight(pct),
 * sys.sleepAfter(secs, dim), sys.screen() to read it all back — this
 * view is just state and taps. Detected by METHOD (Bun injects node
 * builtins as globals, so typeof alone lies on desktop); without the
 * natives it runs as a demo so the layout develops anywhere.
 *
 * The brightness slider applies LIVE while dragging (throttled: every
 * native call writes NVS, and a drag shouldn't cost a hundred flash
 * writes), with the final value applied on release.
 */

var HAVE = typeof sys !== 'undefined' && typeof sys.backlight === 'function';

function readScreen() {
  if (!HAVE) return { bl: 80, sleep: 30, dim: true };
  try { return JSON.parse('' + sys.screen()); }
  catch (e) { return { bl: 80, sleep: 30, dim: true }; }
}

var boot = readScreen();
UI.set({ bl: boot.bl, sleep: boot.sleep, dim: boot.dim ? 1 : 0,
         rot: boot.rot || 0, scale: boot.scale || 4,
         fmode: boot.fmode !== undefined ? boot.fmode
              : (boot.fnative === false ? 0 : 1) });

function applyBacklight(pct) {
  if (HAVE) sys.backlight(pct);
}
function applySleep() {
  if (HAVE) sys.sleepAfter(UI.state.sleep, UI.state.dim);
}

/* No OFF chip: NEVER in the mode row is the off switch, so the times
   stay a clean row of their own -- narrow screens fit both rows. */
var SLEEPS = [[15, '15s'], [30, '30s'], [60, '1m'], [300, '5m'], [900, '15m']];

/* The render-scale mode, sys.fonts(0|1|2): PIXEL renders logical and
   upscales uniformly (chunky); NATIVE composes every op at panel
   resolution (device-pixel sharp); HD adds Scale2x/3x-smoothed glyphs
   on top -- rounded diagonals once the glyph scale reaches 2. */
var HAVE_FONTS = HAVE && typeof sys.fonts === 'function';
var FMODES = ['PIXEL', 'NATIVE', 'HD'];
function applyFonts(n) {
  if (HAVE_FONTS) sys.fonts(n);
  UI.set({ fmode: n });
}

/* Rotation is a native concern too: sys.rotate(0..3) turns the panel,
   canvas, and touch mapping as one and persists. The layout here reads
   gfx.width()/height() every render, so the very next frame after a tap
   lays out for the new orientation. */
var HAVE_ROT = HAVE && typeof sys.rotate === 'function';
/* word labels: the 5x7 face has no degree glyph, and PORT/LAND says more
   than a number anyway. The starred pair is the same orientation flipped. */
var ROTS = [[0, 'PORT'], [1, 'LAND'], [2, 'PORT*'], [3, 'LAND*']];
function applyRotate(r) {
  if (HAVE_ROT) sys.rotate(r);
}

/* Display scale: sys.view() takes quarters, so 4 is 1:1 and 8 doubles
   every logical pixel. Inset and shift ride along unchanged -- this row
   only turns the one dial. Everything relaid out next frame, and the
   scale chips sit above the fold so 2x can always reach its way back. */
var HAVE_VIEW = HAVE && typeof sys.view === 'function';
var SCALES = [[4, '1x'], [5, '1.2x'], [6, '1.5x'], [8, '2x']];
function applyScale(q) {
  if (!HAVE_VIEW) return;
  var cur = readScreen();
  sys.view(q, cur.inset || 0, cur.shiftx || 0, cur.shifty || 0);
}

function App() {
  var bl = UI.state.bl || 80;

  var scaleChips = [];
  for (var s = 0; s < SCALES.length; s++) {
    scaleChips.push(h(Button, {
      label: SCALES[s][1], size: 1, pad: em(0.5),
      bg: UI.state.scale === SCALES[s][0] ? UI.theme.accent : UI.theme.key,
      onTap: (function (q) {
        return function () {
          applyScale(q);
          UI.set({ scale: HAVE_VIEW ? (readScreen().scale || 4) : q });
        };
      })(SCALES[s][0])
    }));
  }

  var rotChips = [];
  for (var r = 0; r < ROTS.length; r++) {
    rotChips.push(h(Button, {
      label: ROTS[r][1], size: 1, pad: em(0.5),
      bg: UI.state.rot === ROTS[r][0] ? UI.theme.accent : UI.theme.key,
      onTap: (function (rr) {
        return function () {
          applyRotate(rr);
          /* read the truth back rather than assuming: the native side may
             clamp, and the panel can be rotated from outside this view */
          UI.set({ rot: HAVE_ROT ? (readScreen().rot || 0) : rr });
        };
      })(ROTS[r][0])
    }));
  }

  var sleepChips = [];
  for (var i = 0; i < SLEEPS.length; i++) {
    sleepChips.push(h(Button, {
      label: SLEEPS[i][1], size: 1, pad: em(0.5),
      bg: UI.state.sleep === SLEEPS[i][0] ? UI.theme.accent : UI.theme.key,
      onTap: (function (secs) {
        return function () { UI.set({ sleep: secs }); applySleep(); };
      })(SLEEPS[i][0])
    }));
  }

  return (
    <box h={gfx.height()} pad={em(0.75)} gap={em(0.7)}>
      <text text="SCREEN" size={2} align="center" color={UI.theme.accent} />

      <box bg={UI.theme.panel} radius={6} pad={em(0.75)} gap={em(0.5)}>
        <row>
          <text text="BRIGHTNESS" size={1} color={UI.theme.muted} />
          <text text={bl + '%'} size={1} align="right" color={UI.theme.text} />
        </row>
        <box h={em(2.2)} bg={UI.theme.key} radius={8} clip={true}
             onDraw={function (phase, x, y, id) {
               /* the box is the slider: position -> percent, applied
                  live but at most every 150ms; the release is exact */
               var w = gfx.width() - em(3);
               var pct = Math.round((x / w) * 100);
               if (pct < 5) pct = 5;
               if (pct > 100) pct = 100;
               UI.set({ bl: pct });
               var now = sys.millis();
               if (phase === 2 || now - (UI.state._blAt || 0) > 150) {
                 UI.set({ _blAt: now });
                 applyBacklight(pct);
               }
             }}>
          <box w={Math.max(8, Math.floor((gfx.width() - em(3)) * bl / 100))}
               h={em(2.2)} bg={UI.theme.accent} radius={8} />
        </box>
      </box>

      <box bg={UI.theme.panel} radius={6} pad={em(0.75)} gap={em(0.5)}>
        <text text="SCALE" size={1} color={UI.theme.muted} />
        {h('row', { gap: 4 }, scaleChips.concat([
          h('box', { w: em(0.6) }),
          h(Button, { label: FMODES[UI.state.fmode] || 'NATIVE', size: 1, pad: em(0.5),
                      bg: UI.state.fmode ? UI.theme.accent : UI.theme.key,
                      onTap: function () { applyFonts(((UI.state.fmode || 0) + 1) % 3); } })
        ]))}
      </box>

      <box bg={UI.theme.panel} radius={6} pad={em(0.75)} gap={em(0.5)}>
        <text text="ROTATION" size={1} color={UI.theme.muted} />
        {h('row', { gap: 4 }, rotChips)}
      </box>

      <box bg={UI.theme.panel} radius={6} pad={em(0.75)} gap={em(0.5)}>
        <row>
          <text text="SLEEP" size={1} color={UI.theme.muted} />
          <text text="wakes on touch" size={1} align="right" color={0x555f6e} />
        </row>
        <row gap={4}>
          <Button label="NEVER" size={1} pad={em(0.5)}
                  bg={!UI.state.sleep ? UI.theme.accent : UI.theme.key}
                  onTap={function () { UI.set({ sleep: 0 }); applySleep(); }} />
          <Button label="DIM" size={1} pad={em(0.5)}
                  bg={UI.state.sleep && UI.state.dim ? UI.theme.accent : UI.theme.key}
                  onTap={function () {
                    UI.set({ dim: 1, sleep: UI.state.sleep || 30 });
                    applySleep();
                  }} />
          <Button label="DARK" size={1} pad={em(0.5)}
                  bg={UI.state.sleep && !UI.state.dim ? UI.theme.accent : UI.theme.key}
                  onTap={function () {
                    UI.set({ dim: 0, sleep: UI.state.sleep || 30 });
                    applySleep();
                  }} />
        </row>
        {h('row', { gap: 4 }, sleepChips)}
      </box>

      {HAVE ? null
        : <text text="demo mode - no panel to control here" size={1}
                align="center" color={0x555f6e} />}
    </box>
  );
}

UI.mount(App);
