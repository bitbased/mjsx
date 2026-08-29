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
 * On hosts without the native (browser, sim, terminal, the gallery
 * renderer) a SIMULATED board stands in — see simGpio below — so the whole
 * flow stays clickable and self-checkable anywhere. Every call goes
 * through gpio(); when the native exists that is a straight pass-through
 * and this page behaves exactly as it does on the bridge.
 */
var HAVE = typeof sys !== 'undefined' && typeof sys.gpio === 'function';

/* ---- the no-hardware board -------------------------------------------
 * An UNWIRED board, modelled off the 1.69" 240x280 build (BOARD 1 in
 * docs/hardware-api.md): its display and touch pins answer -1 exactly as
 * the firmware's denylist does, every other pin is open so a read sees
 * the pullup (1), a write reports the 1 the native reports, and the ADC
 * gives a stable per-pin count — an unconnected analog pin floats, and a
 * fixed number is the version of that a headless render can reproduce
 * frame to frame. Nothing here reads a clock, on purpose: the gallery
 * PNG and the golden hashes must not move between runs.
 *
 * The one value this board cannot show you is a genuine LOW — nothing is
 * pulling any pin down. That needs the real thing.
 */
var SIM_REFUSED = [4, 5, 6, 7, 8, 10, 11, 13, 14, 15];

function simRefused(p) {
  for (var i = 0; i < SIM_REFUSED.length; i++) {
    if (SIM_REFUSED[i] === p) return true;
  }
  return false;
}

function simGpio(p, op, value) {
  if (simRefused(p)) return -1;
  if (op === 1) return 1;                       /* write: OUTPUT, driven */
  if (op === 2) return (p >= 1 && p <= 20) ? (p * 173) % 4096 : 0;
  if (op === 0) return 1;                       /* INPUT_PULLUP, open pin */
  return -1;                                    /* unknown op, as firmware */
}

/* The single door to the hardware. Same argument order, same return
   codes, so nothing below this line knows which board it is talking to.
   A read is forwarded as TWO arguments, never as a third `undefined`:
   "value omitted" is how the native is told this is a read, and handing
   it an explicit undefined would arrive as a write of 0. */
function gpio(p, op, value) {
  if (!HAVE) return simGpio(p, op, value);
  if (value === undefined) return sys.gpio(p, op);
  return sys.gpio(p, op, value);
}

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
  if (m === 'drive') UI.set({ level: 0, val: gpio(pin(), 1, 0) });
}

function toggle() {
  var lv = UI.state.level ? 0 : 1;
  UI.set({ level: lv });
  UI.set({ val: gpio(pin(), 1, lv) });
}

/* Poll only in the reading modes; renders come free when nothing changed. */
UI.onTick = function () {
  if (mode() === 'drive') return;
  var v = gpio(pin(), mode() === 'adc' ? 2 : 0);
  if (v !== UI.state.val) UI.set({ val: v });
};

function valueLine() {
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
      {HAVE ? null : <text text="simulated - no gpio native" size={1} align="center"
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
/* Seed the first frame on a simulated board so a single-frame render (the
   gallery, a golden) shows a live reading rather than '...'. The native
   path is left untouched: there, the first tick does the first read, as
   it always has. */
if (!HAVE) UI.set({ val: gpio(pin(), 0) });
