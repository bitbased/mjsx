/*
 * WiFi setup, in JSX — the native settings page's job, done by a script.
 *
 * Everything is ASYNC against the net.* natives the bridge exposes:
 * net.scan() starts a scan and returns immediately, net.results() says
 * "still looking" (-1 as a string parse failure) until it has a list,
 * net.join(ssid, psk) kicks a join and net.status() reports how it went
 * — this view just polls the cheap getters on its tick. Tapping a
 * network opens the password field with the on-screen Keyboard; open
 * networks join at a tap. On hosts without net.* (the sim, the browser)
 * canned networks stand in so the flow is developable anywhere.
 */

/* Bun injects node builtins as globals, so `typeof net` alone lies on
   the desktop -- the bridge's net object is the one with .scan on it. */
var HAVE_NET = typeof net !== 'undefined' && typeof net.scan === 'function';
var FAKE = [
  { ssid: 'workshop', rssi: -48, open: false },
  { ssid: 'HouseNet-5G', rssi: -61, open: false },
  { ssid: 'cafe-guest', rssi: -74, open: true }
];

function refresh() {
  if (!HAVE_NET) { UI.set({ nets: FAKE, scanning: false }); return; }
  var r = net.results();
  if (r === undefined || r === null) return;
  var txt = '' + r;
  if (txt && txt.charAt(0) === '[') {
    var list = JSON.parse(txt);
    if (list.length || !UI.state.scanning) UI.set({ nets: list, scanning: false });
  }
}

function startScan() {
  UI.set({ scanning: true, nets: [] });
  if (HAVE_NET) net.scan();
  else UI.setTimer(function () { refresh(); }, 600);
}

function statusLine() {
  if (!HAVE_NET) return 'demo mode - no radio here';
  var st = {};
  try { st = JSON.parse('' + net.status()); } catch (e) {}
  if (st.connected) return st.ssid + '  ' + st.ip;
  return 'not connected';
}

function join(ssid, psk) {
  if (HAVE_NET) net.join(ssid, psk);
  UI.set({ joining: ssid, picking: null });
}

function App() {
  var nets = UI.state.nets || [];
  var picking = UI.state.picking || null;
  var focused = UI.focused();

  var kids = [
    <text text="WIFI" size={2} align="center" color={UI.theme.accent} />,
    <text text={statusLine()} size={1} align="center" color={UI.theme.ok} />,
    <Button label={UI.state.scanning ? 'SCANNING...' : 'SCAN'} size={2}
            onTap={startScan} />
  ];

  if (picking !== null) {
    kids.push(
      <box bg={UI.theme.panel} radius={6} pad={em(0.75)} gap={em(0.5)}>
        <text text={'PASSWORD FOR ' + picking} size={1} color={UI.theme.muted} />
        <input id="psk" size={2} password={true} placeholder="password"
               onSubmit={function (v) { join(picking, v); }} />
        <row gap={em(0.5)}>
          <Button label="JOIN" size={1} bg={UI.theme.accent}
                  onTap={function () {
                    UI.key('press', 'Enter');
                  }} />
          <Button label="CANCEL" size={1}
                  onTap={function () { UI.blur(); UI.set({ picking: null }); }} />
        </row>
      </box>
    );
  }

  var list = [];
  for (var i = 0; i < nets.length; i++) {
    list.push(h(Button, {
      label: nets[i].ssid + (nets[i].open ? '' : ' *') + '  ' + nets[i].rssi,
      size: 1, pad: em(0.6),
      onTap: (function (n) {
        return function () {
          if (n.open) join(n.ssid, '');
          else { UI.set({ picking: n.ssid }); UI.focus('psk'); }
        };
      })(nets[i])
    }));
  }
  kids.push(h('box', { flex: 1, scroll: 'nets', gap: em(0.4) }, list));

  if (UI.state.joining) {
    kids.push(<text text={'joining ' + UI.state.joining + '...'} size={1}
                    align="center" color={UI.theme.warn} />);
  }
  if (focused) kids.push(h(Keyboard, { layout: 'qwerty', position: 'bottom',
                                       height: Math.floor(gfx.height() / 2.8) }));

  return h('box', { h: gfx.height(), pad: em(0.75), gap: em(0.6) }, kids);
}

/* poll the cheap getters while scanning or joining; renders come free */
UI.onTick = function () {
  if (UI.state.scanning) refresh();
  if (UI.state.joining) {
    UI.set({ joinTick: (UI.state.joinTick || 0) + 1 });
    if (UI.state.joinTick > 40) UI.set({ joining: null, joinTick: 0 });
  }
};

UI.mount(App);
startScan();
