/*
 * Layering / scrolling / cropping torture test:
 *
 *  - fixed header and footer with a flex scroll region between them - list
 *    content must crop cleanly at both boundaries while scrolling
 *  - a badge overlapping the header edge (abs, drawn after the header)
 *  - cards whose swatches overlap each other (abs inside a fixed box)
 *  - a floating action button drawn over the scrolling list (abs after the
 *    scroll box in tree order - later-drawn wins hits too, so it stays
 *    tappable wherever the list is)
 *  - a modal (UI.openModal) - drawn last, owns ALL input; everything under
 *    it must stop responding until closed
 */
function ListItem(p) {
  var picked = UI.state.picked === p.n;
  return (
    <box bg={picked ? 0x2e4a37 : UI.theme.panel} radius={6} pad={em(0.75)}
         border={picked ? 0x44dd88 : undefined}
         onTap={function () { UI.set({ picked: p.n }); }}>
      <text text={'Item ' + p.n + (picked ? ' *' : '')} size={1}
            color={picked ? 0x9fe8b9 : UI.theme.text} />
    </box>
  );
}

function App() {
  var kids = [];
  for (var i = 1; i <= 14; i++) {
    if (i === 4) {
      kids.push(
        <box bg={UI.theme.panel} radius={6} pad={em(0.75)} gap={em(0.5)}>
          <text text="wrapped: the quick brown fox jumps over the lazy dog while the list scrolls and crops" size={1} color={UI.theme.muted} wrap={true} />
        </box>
      );
    }
    kids.push(<ListItem n={i} />);
  }

  return (
    <box h={gfx.height()}>
      {/* fixed header */}
      <box bg={0x223048} pad={em(0.75)} h={em(3.4)}>
        <text text="LAYERS" size={2} color={0x8fb8ff} />
        <text text="fixed header - list crops under me" size={1} color={UI.theme.muted} />
      </box>

      {/* the scroll region takes whatever the header+footer leave */}
      <box flex={1} scroll="main" pad={em(0.75)} gap={em(0.5)}>
        {kids}
      </box>

      {/* fixed footer */}
      <box bg={0x223048} pad={em(0.6)} h={em(3)}>
        <row>
          <text text={'picked: ' + (UI.state.picked || '-')} size={1} color={UI.theme.text} />
          <Button label="MODAL" size={1} pad={em(0.4)}
                  onTap={function () { UI.openModal(Modal); }} />
        </row>
      </box>

      {/* badge overlapping the header/list boundary - drawn after both */}
      <abs x={gfx.width() - em(5.5)} y={em(2.4)}>
        <box w={em(5)} bg={0xdd6644} radius={99} pad={em(0.35)}>
          <text text="badge" size={1} align="center" color={0xffffff} />
        </box>
      </abs>

      {/* floating action button over the scrolling list */}
      <abs x={gfx.width() - em(4.6)} y={gfx.height() - em(7)}>
        <box w={em(4)} bg={0x44dd88} radius={99} pad={em(0.6)}
             onTap={function () { UI.set({ fab: (UI.state.fab || 0) + 1 }); }}>
          <text text={'+' + (UI.state.fab || 0)} size={1} align="center" color={0x0c2216} />
        </box>
      </abs>
    </box>
  );
}

function Modal() {
  return (
    <box pad={em(2.5)}>
      <abs x={em(2.5)} y={em(6)}>
        <box w={gfx.width() - em(5)} bg={0x1c2230} border={0x8fb8ff} borderW={2}
             radius={10} pad={em(1)} gap={em(0.75)}>
          <text text="MODAL" size={2} align="center" color={0x8fb8ff} />
          <text text="everything under me is dead until closed" size={1}
                color={UI.theme.muted} wrap={true} />
          <Button label="CLOSE" size={1}
                  onTap={function () { UI.closeModal(); }} />
        </box>
      </abs>
    </box>
  );
}

UI.mount(App);
