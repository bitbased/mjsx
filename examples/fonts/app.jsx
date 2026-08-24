/*
 * Font showcase: the active font at sizes 1-3, plus the glyph repertoire.
 * WHICH font is active belongs to the host, not the app — the sim's FONT
 * toolbar button or a runner's --font=4x6|6x8|12x16 flag swaps it, and this
 * screen re-renders in it; em() spacing follows the metrics automatically,
 * which is half of what this example demonstrates.
 */
function App() {
  return (
    <box pad={em(1)} gap={em(0.75)} h={gfx.height()} scroll="fonts">
      <text text="FONTS" size={2} align="center" color={UI.theme.accent} />
      <text text={'1EM = ' + em(1) + 'PX'} size={1} align="center" color={UI.theme.muted} />

      <box bg={UI.theme.panel} radius={6} pad={em(0.75)} gap={em(0.5)}>
        <text text="SIZE 1" size={1} color={UI.theme.muted} />
        <text text="THE QUICK BROWN FOX" size={1} color={UI.theme.text} />
      </box>

      <box bg={UI.theme.panel} radius={6} pad={em(0.75)} gap={em(0.5)}>
        <text text="SIZE 2" size={1} color={UI.theme.muted} />
        <text text="QUICK FOX" size={2} color={UI.theme.text} />
      </box>

      <box bg={UI.theme.panel} radius={6} pad={em(0.75)} gap={em(0.5)}>
        <text text="SIZE 3" size={1} color={UI.theme.muted} />
        <text text="FOX 42" size={3} color={UI.theme.text} />
      </box>

      <box bg={UI.theme.panel} radius={6} pad={em(0.75)} gap={em(0.5)}>
        <text text="FULL CHARSET, SIZE 1" size={1} color={UI.theme.muted} />
        <text text="ABCDEFGHIJKLMNOPQRSTUVWXYZ" size={1} color={UI.theme.text} />
        <text text="abcdefghijklmnopqrstuvwxyz" size={1} color={UI.theme.text} />
        <text text="0123456789" size={1} color={UI.theme.text} />
        <text text={'!"#$%&\'()*+,-./'} size={1} color={UI.theme.text} />
        <text text={':;<=>?@'} size={1} color={UI.theme.text} />
        <text text={'[\\]^_`{|}~'} size={1} color={UI.theme.text} />
      </box>

      <box bg={UI.theme.panel} radius={6} pad={em(0.75)} gap={em(0.5)}>
        <text text="FULL CHARSET, SIZE 2" size={1} color={UI.theme.muted} />
        <text text="ABCDEFGHIJKLMNOPQ" size={2} color={UI.theme.text} />
        <text text="RSTUVWXYZ" size={2} color={UI.theme.text} />
        <text text="abcdefghijklmnopq" size={2} color={UI.theme.text} />
        <text text="rstuvwxyz" size={2} color={UI.theme.text} />
        <text text="0123456789" size={2} color={UI.theme.text} />
        <text text={'!"#$%&\'()*+,-./'} size={2} color={UI.theme.text} />
        <text text={':;<=>?@'} size={2} color={UI.theme.text} />
        <text text={'[\\]^_`{|}~'} size={2} color={UI.theme.text} />
        <text text="Sphinx of black quartz, judge my vow" size={2} color={UI.theme.text} wrap={true} />
      </box>

      <text text="AUTO: EACH SIZE PICKS ITS FONT. FONT BTN / --FONT=NAME FORCES ONE." size={1} align="center" color={UI.theme.muted} wrap={true} />
    </box>
  );
}

UI.mount(App);
