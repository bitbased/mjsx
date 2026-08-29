/*
 * Direct pin access through sys.gpio(pin, op, value):
 *   op 0 reads (the firmware sets INPUT_PULLUP first, so an open pin reads 1)
 *   op 1 writes (sets OUTPUT, drives value)
 *   op 2 reads the ADC
 * The firmware refuses pins the active board's display or touch controller
 * own and answers -1; that refusal is shown here rather than hidden.
 *
 * Reading reconfigures the pin (INPUT_PULLUP), so while DRIVE is selected
 * this app stops polling — otherwise every tick would release the pin it
 * just drove.
 *
 * On hosts without the native (browser, sim, terminal) the page says so
 * instead of crashing.
 */
var HAVE = typeof sys !== 'undefined' && typeof sys.gpio === 'function';

function pin() { return UI.state.pin === undefined ? 16 : UI.state.pin; }
function mode() { return UI.state.mode || 'read'; }

function step(d) {
  var p = pin() + d;
  if (p < 0) p = 0;
  if (p > 48) p = 48;
  UI.set({ pin: p, val: null, level: 0, mode: mode() === 'drive' ? 'read' : mode() });
}

function setMode(m) {
  UI.set({ mode: m, val: null });
  if (m === 'drive' && HAVE) UI.set({ level: 0, val: sys.gpio(pin(), 1, 0) });
}

function toggle() {
  var lv = UI.state.level ? 0 : 1;
  UI.set({ level: lv });
  if (HAVE) UI.set({ val: sys.gpio(pin(), 1, lv) });
}

/* Poll only in the reading modes; renders come free when nothing changed. */
UI.onTick = function () {
  if (!HAVE || mode() === 'drive') return;
  var v = sys.gpio(pin(), mode() === 'adc' ? 2 : 0);
  if (v !== UI.state.val) UI.set({ val: v });
};

function valueLine() {
  if (!HAVE) return 'n/a';
  var v = UI.state.val;
  if (v === null || v === undefined) return '...';
  if (v === -1) return 'refused (display/touch pin)';
  if (mode() === 'adc') return 'adc ' + v;
  if (mode() === 'drive') return 'driving ' + (UI.state.level ? 'HIGH' : 'LOW');
  return v ? 'HIGH (1)' : 'LOW (0)';
}

function ModeBtn(props) {
  return h(Button, {
    label: props.label, size: 1, flex: 1,
    bg: mode() === props.m ? UI.theme.accent : UI.theme.panel,
    onTap: function () { setMode(props.m); }
  });
}

function App() {
  return (
    <box h={gfx.height()} scroll="gpio" pad={em(1)} gap={em(0.75)}>
      <text text="GPIO" size={2} align="center" color={UI.theme.accent} />
      {HAVE ? null : <text text="host has no gpio" size={1} align="center"
                           color={UI.theme.warn} />}

      <row gap={em(0.5)} align="center">
        <Button label="-" size={2} onTap={function () { step(-1); }} />
        <text text={'PIN ' + pin()} size={2} flex={1} align="center"
              color={UI.theme.text} />
        <Button label="+" size={2} onTap={function () { step(1); }} />
      </row>

      <row gap={em(0.5)}>
        <ModeBtn label="READ" m="read" />
        <ModeBtn label="ANALOG" m="adc" />
        <ModeBtn label="DRIVE" m="drive" />
      </row>

      <box bg={UI.theme.panel} radius={8} pad={em(1.25)} gap={em(0.5)}>
        <text text={mode() === 'drive' ? 'output' : 'live ' + mode()}
              size={1} color={UI.theme.muted} />
        <text text={valueLine()} size={2}
              color={UI.state.val === -1 ? UI.theme.warn : UI.theme.ok} />
      </box>

      {mode() === 'drive' ?
        <Button label={UI.state.level ? 'SET LOW' : 'SET HIGH'} size={2}
                bg={UI.theme.accent} onTap={toggle} /> : null}
    </box>
  );
}

UI.mount(App);
