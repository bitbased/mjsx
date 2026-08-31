/*
 * The smallest real mjsx app: a panel, a border, some centred text.
 * Written the way it would be on a chip — h and UI are ambient globals,
 * no imports — because that's the actual contract mjsx-core makes.
 *
 * It also says hello on the CONSOLE, which is the same console on every
 * host: stderr under the terminal runner, the pane in the simulator, and
 * on a board whichever of the three sinks is on — `mjsx logs <ip>` reads
 * the ring, and /remote?log=1 shows the line beside the pixels it
 * describes. See docs/logging.md.
 */
function App() {
  return (
    <box pad={em(2)} gap={em(1.5)}>
      <box bg={UI.theme.panel} radius={8} border={UI.theme.accent} borderW={2}
           pad={em(1.5)}>
        <text text="Hello mjsx!" size={2} color={UI.theme.text} align="center" />
      </box>
      <text text="one core. esp32, pi, node, browser." size={1}
            color={UI.theme.muted} align="center" wrap={true} />
    </box>
  );
}

console.log('hello from mjsx', gfx.width() + 'x' + gfx.height());

UI.mount(App);
