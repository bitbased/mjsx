/*
 * Text input, every way in at once.
 *
 * - Physical keyboard: just type — printable keys insert, Backspace/
 *   arrows/Home/End edit, Tab / shift-Tab walk the fields (scrolling
 *   them into view), Enter submits, Esc blurs.
 * - Touch: tap places the caret, a drag scrolls overflowing text
 *   sideways, press-and-hold then drag walks the caret under the finger.
 * - The framework's virtual keyboard: four layouts — QWERTY (shift +
 *   symbols page), T9 multi-tap, a number pad, and STRIP: a single
 *   scrolling row of characters (drag to scroll, tap to type) for
 *   displays with no room for a grid.
 * - A CUSTOM keyboard is nothing special: the PIN field below brings up
 *   PinPad, ordinary JSX whose taps call UI.type()/UI.key(). A host can
 *   also present a native keyboard entirely outside the JS VM (the http
 *   backend summons the phone's real one) — keystrokes all arrive the
 *   same way.
 */

var LAYOUTS = ['qwerty', 't9', 'numbers', 'strip'];

function Field(p) {
  return (
    <box gap={2}>
      <text text={p.label} size={1} color={UI.theme.muted} />
      <input id={p.id} size={p.size || 2} placeholder={p.placeholder}
             password={p.password} maxLen={p.maxLen}
             onSubmit={function (v) { UI.set({ last: p.label + ': ' + v }); }} />
    </box>
  );
}

/* A user-supplied keyboard: plain JSX, no registration. Digits go in with
   UI.type, the rest are the same named keys a physical board sends. */
function PinPad() {
  var rows = [['1', '2', '3'], ['4', '5', '6'], ['7', '8', '9'], ['DEL', '0', 'OK']];
  var kids = [];
  for (var r = 0; r < rows.length; r++) {
    var ks = [];
    for (var c = 0; c < 3; c++) {
      ks.push(h(Button, {
        label: rows[r][c], size: 2, pad: em(0.75),
        bg: rows[r][c] === 'OK' ? UI.theme.accent
          : rows[r][c] === 'DEL' ? UI.theme.panel : UI.theme.key,
        onTap: (function (k) {
          return function () {
            if (k === 'DEL') UI.key('press', 'Backspace');
            else if (k === 'OK') UI.key('press', 'Enter');
            else UI.type(k);
          };
        })(rows[r][c])
      }));
    }
    kids.push(h('row', { gap: 2 }, ks));
  }
  return h('box', { bg: UI.theme.panel, pad: 4, gap: 2 }, kids);
}

function App() {
  var kb = UI.state.kb || 'qwerty';
  var focused = UI.focused();

  var chips = [];
  for (var i = 0; i < LAYOUTS.length; i++) {
    chips.push(h(Button, {
      label: LAYOUTS[i].toUpperCase(), size: 1, pad: em(0.6),
      bg: kb === LAYOUTS[i] ? UI.theme.accent : UI.theme.key,
      onTap: (function (l) { return function () { UI.set({ kb: l }); }; })(LAYOUTS[i])
    }));
  }

  var kids = [
    <text text="INPUT" size={2} align="center" color={UI.theme.accent} />,
    <box flex={1} scroll="form" pad={em(1)} gap={em(0.75)}>
      <text text="virtual keyboard layout" size={1} color={UI.theme.muted} />
      {h('row', { gap: 4 }, chips)}
      <spacer h={2} />
      <Field id="name" label="NAME" placeholder="tap to type" />
      <Field id="email" label="EMAIL" placeholder="you@example.com" />
      <Field id="pin" label="PIN (custom PinPad keyboard)" password={true} maxLen={6} />
      <Field id="city" label="CITY" />
      <Field id="note" label="NOTE (long text scrolls in the field)" />
      <Field id="tag" label="TAG (tab reaches me below the fold)" />
      <text text={UI.state.last || 'enter submits: results show here'}
            size={1} color={UI.theme.ok} wrap={true} />
    </box>
  ];
  if (focused) kids.push(focused === 'pin' ? h(PinPad, {}) : h(Keyboard, { layout: kb }));
  return h('box', { h: gfx.height() }, kids);
}

UI.mount(App);
