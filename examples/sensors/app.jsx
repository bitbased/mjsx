/*
 * Two independent async sources, neither driven by input — an
 * accelerometer-shaped stream updating fast, a button press updating slow
 * — proving UI.on/emit/setTimer, not just that boxes can be laid out.
 *
 * A real native module would call UI.emit(...) from its own I2C poll or
 * GPIO interrupt, on whatever schedule the hardware gives it. Nothing here
 * has real hardware to poll, so UI.setTimer stands in for that — same
 * relayed-in-by-the-host shape, just simulated instead of real. Swap
 * tickAccel's body for an actual sensor read and nothing else changes.
 */
function App() {
  var a = UI.state.accel || { x: 0, y: 0, z: 0 };
  var presses = UI.state.presses || 0;
  return (
    <box pad={em(2)} gap={em(1.75)}>
      <text text="LIVE SENSORS" size={2} align="center" color={UI.theme.accent} />

      <box bg={UI.theme.panel} radius={8} pad={em(1.25)} gap={em(0.5)}>
        <text text="accelerometer (5x/sec)" size={1} color={UI.theme.muted} />
        <text text={'x' + a.x.toFixed(2) + ' y' + a.y.toFixed(2)}
              size={2} color={UI.theme.text} />
      </box>

      <box bg={UI.theme.panel} radius={8} pad={em(1.25)} gap={em(0.5)}>
        <text text="button (every 1.5s)" size={1} color={UI.theme.muted} />
        <text text={'presses: ' + presses} size={2} color={UI.theme.ok} />
      </box>

      <text text={'uptime ' + Math.floor(sys.millis() / 1000) + 's'} size={1} color={UI.theme.muted} />
    </box>
  );
}

UI.mount(App);

UI.on('accel', function (data) { UI.set({ accel: data }); });
UI.on('button', function () { UI.set({ presses: (UI.state.presses || 0) + 1 }); });

function tickAccel() {
  UI.emit('accel', {
    x: Math.sin(sys.millis() / 500),
    y: Math.cos(sys.millis() / 700),
    z: 9.8
  });
  UI.setTimer(tickAccel, 200); // a real driver would re-arm the same way
}
function tickButton() {
  UI.emit('button', {});
  UI.setTimer(tickButton, 1500);
}
UI.setTimer(tickAccel, 200);
UI.setTimer(tickButton, 1500);
