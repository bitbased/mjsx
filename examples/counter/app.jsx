/*
 * A stateful example: tap the button, the count changes, the screen
 * redraws to match. Proves the actual point of the framework — no
 * reconciler, no retained tree, state -> UI.set -> full redraw — not just
 * that boxes can be laid out.
 *
 * Only one tappable control on purpose: the pure-js runner drives a real
 * simulated touch (not a direct function call) by reading UI._hits[0]
 * after the first render, and a single control keeps that unambiguous
 * without hardcoding screen coordinates that would silently rot if the
 * layout above it changed.
 */
function App() {
  var count = UI.state.count || 0;
  return (
    <box pad={em(2)} gap={em(2)}>
      <text text={'COUNT: ' + count} size={3} color={UI.theme.text} align="center" />
      <Button label="+1" size={2}
              onTap={function () { UI.set({ count: count + 1 }); }} />
    </box>
  );
}

UI.mount(App);

module.exports.demo = function (UI, backend) {
  var hit = UI._hits[0];
  if (!hit) { console.error('no tappable control found after first render'); return; }
  var x = hit.x + 4, y = hit.y + 4;
  UI.pointer(0, 0, x, y); // pointer id 0, phase 0 = press
  UI.pointer(0, 2, x, y); // release -> tap -> onTap -> UI.set({count: 1})
  console.log('simulated tap at ' + x + ',' + y + ' -> count is now ' + UI.state.count);
};
