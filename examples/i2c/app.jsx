/*
 * Bus scan and register peek through sys.i2c(addr, reg, value):
 * value < 0 (or omitted) reads one byte of that register, value >= 0
 * writes one — the same write-reg-then-repeated-start-read the bridge's
 * `reg` TCP command does. -1 means no answer.
 *
 * The scan probes 8..119 by reading register 0 of each address, a few
 * per tick so the UI stays live while it walks the bus. Tap a responder
 * to peek registers 0..15. Peeking is a read like any other: some
 * devices clear interrupt flags on read, so a peek is not always free.
 *
 * On hosts without the native (browser, sim, terminal) the page says so
 * instead of crashing.
 *
 * LAYOUT, and why it is the way it is: the page is a FIXED-HEIGHT FLEX
 * COLUMN, not a scroll viewport. Only that shape makes the address list
 * work -- `flex` is honoured by a pinned-height box that is not itself
 * scrolling, and `scroll` becomes a real viewport only once a parent
 * hands the box a height. Making the PAGE the scroller instead (which
 * this example used to do) silently kills both on the list: it lays out
 * at its full natural height, the register panel it is supposed to share
 * the screen with is pushed off the bottom -- on a short or round panel
 * the viewport culls the panel entirely, so it is never drawn at all --
 * and a tap on a row looks like it did nothing. The peek fired; there
 * was just nowhere on the glass for it to land.
 */
var HAVE = typeof sys !== 'undefined' && typeof sys.i2c === 'function';

function hex(n) {
  var s = n.toString(16).toUpperCase();
  return s.length < 2 ? '0' + s : s;
}

function startScan() {
  if (!HAVE) return;
  UI.set({ found: [], next: 8, sel: null, regs: null });
}

/* A few addresses per tick: a missing device NACKs fast, but 112 probes
   in one tap would still stall a frame noticeably. */
UI.onTick = function () {
  var next = UI.state.next;
  if (!HAVE || next === undefined || next === null) return;
  var found = UI.state.found || [];
  var stop = next + 8;
  for (; next < stop && next <= 119; next++) {
    if (sys.i2c(next, 0) >= 0) found = found.concat([next]);
  }
  UI.set({ found: found, next: next > 119 ? null : next });
};

function peek(addr) {
  var regs = [];
  for (var r = 0; r < 16; r++) regs.push(sys.i2c(addr, r));
  UI.set({ sel: addr, regs: regs });
}

function regRows() {
  var rows = [];
  var regs = UI.state.regs || [];
  for (var r = 0; r < 4; r++) {
    var line = '';
    for (var c = 0; c < 4; c++) {
      var i = r * 4 + c;
      line += hex(i) + ':' + (regs[i] < 0 ? '--' : hex(regs[i])) + '  ';
    }
    rows.push(<text text={line} size={1} color={UI.theme.text} />);
  }
  return rows;
}

function App() {
  var found = UI.state.found || [];
  var scanning = UI.state.next !== undefined && UI.state.next !== null;

  var kids = [
    <text text="I2C SCAN" size={2} align="center" color={UI.theme.accent} />
  ];

  if (!HAVE) {
    kids.push(<text text="host has no i2c" size={1} align="center"
                    color={UI.theme.warn} />);
  } else {
    kids.push(<Button label={scanning ? 'SCANNING ' + UI.state.next + '...' : 'SCAN'}
                      size={2} onTap={startScan} />);
    if (!scanning && UI.state.found) {
      kids.push(<text text={found.length + ' responding'} size={1}
                      align="center" color={UI.theme.muted} />);
    }
  }

  var list = [];
  for (var i = 0; i < found.length; i++) {
    list.push(h(Button, {
      label: '0x' + hex(found[i]) + '  (' + found[i] + ')',
      size: 1, pad: em(0.6),
      bg: UI.state.sel === found[i] ? UI.theme.accent : UI.theme.panel,
      onTap: (function (a) { return function () { peek(a); }; })(found[i])
    }));
  }
  /* The list takes whatever the fixed rows above and the register panel
     leave over, and scrolls INSIDE that -- so the panel stays on screen
     however many devices answer. */
  var listBox = h('box', { flex: 1, scroll: 'addrs', gap: em(0.4) }, list);

  var panel = null;
  if (UI.state.regs) {
    panel = (
      <box bg={UI.theme.panel} radius={8} pad={em(1)} gap={em(0.3)}>
        <text text={'0x' + hex(UI.state.sel) + ' registers 0..15'}
              size={1} color={UI.theme.muted} />
        {regRows()}
      </box>
    );
  }

  /* Square glass: the panel sits under the list, so opening it only
     shortens the list from the bottom and the row under the finger stays
     put. Round glass has no room down there -- a full-width register row
     runs straight into the rim -- so the panel takes the wide middle and
     the LIST, which scrolls anyway, gets the narrow arc. */
  if (panel && UI.isRound()) {
    kids.push(panel);
    kids.push(listBox);
  } else {
    kids.push(listBox);
    if (panel) kids.push(panel);
  }

  return h('box', { h: gfx.height(), pad: em(1), gap: em(0.6) }, kids);
}

UI.mount(App);
if (HAVE) startScan();
