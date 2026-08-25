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
UI.set({ bl: boot.bl, sleep: boot.sleep, dim: boot.dim ? 1 : 0 });

function applyBacklight(pct) {
  if (HAVE) sys.backlight(pct);
}
function applySleep() {
  if (HAVE) sys.sleepAfter(UI.state.sleep, UI.state.dim);
}

var SLEEPS = [[0, 'OFF'], [15, '15s'], [30, '30s'], [60, '1m'], [300, '5m'], [900, '15m']];

function App() {
  var bl = UI.state.bl || 80;

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
        <text text="SLEEP AFTER" size={1} color={UI.theme.muted} />
        {h('row', { gap: 4 }, sleepChips)}
      </box>

      <box bg={UI.theme.panel} radius={6} pad={em(0.75)} gap={em(0.5)}>
        <text text="WHEN SLEEPING" size={1} color={UI.theme.muted} />
        <row gap={em(0.5)}>
          <Button label="DIM" size={1} pad={em(0.5)}
                  bg={UI.state.dim ? UI.theme.accent : UI.theme.key}
                  onTap={function () { UI.set({ dim: 1 }); applySleep(); }} />
          <Button label="DARK" size={1} pad={em(0.5)}
                  bg={UI.state.dim ? UI.theme.key : UI.theme.accent}
                  onTap={function () { UI.set({ dim: 0 }); applySleep(); }} />
        </row>
        <text text="a sleeping screen wakes on touch; the waking tap only wakes"
              size={1} color={0x555f6e} wrap={true} />
      </box>

      {HAVE ? null
        : <text text="demo mode - no panel to control here" size={1}
                align="center" color={0x555f6e} />}
    </box>
  );
}

UI.mount(App);
