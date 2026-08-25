/*
 * Printer status, drawn from state alone.
 *
 * On the bridge board the firmware's printer module pushes a state patch
 * whenever the websocket feed changes; this view just renders
 * UI.state.printer. Everything arrives ASYNC -- there is nothing to
 * poll, nothing to await. On hosts without the printer module (the sim,
 * the browser) a little demo state stands in, so the layout is
 * developable anywhere.
 *
 *   state, progress, nozzle/nozzleSet, bed/bedSet, case, left,
 *   spool: {color,type,sel} | null,       the external holder
 *   slots: [{color,type,sel}, ...]        the CFS
 */

var DEMO = {
  state: 'printing', progress: 62,
  nozzle: 213, nozzleSet: 215, bed: 60, bedSet: 60, 'case': 34,
  left: 3820,
  spool: { color: 0xffffff, type: 'PETG', sel: 0 },
  slots: [
    { color: 0xdd4444, type: 'PLA', sel: 1 },
    { color: 0x3377dd, type: 'PLA', sel: 0 },
    { color: -1, type: '', sel: 0 },
    { color: 0x222222, type: 'TPU', sel: 0 }
  ]
};

function fmtLeft(s) {
  if (s === undefined || s < 0) return '';
  var h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return h > 0 ? h + 'h ' + m + 'm left' : m + 'm left';
}

function Temp(p) {
  var cur = p.cur === undefined || p.cur < 0 ? '--' : '' + p.cur;
  var set = p.set === undefined || p.set < 0 ? '' : ' / ' + p.set;
  return (
    <box bg={UI.theme.panel} radius={6} pad={em(0.6)} flex={1}>
      <text text={p.label} size={1} color={UI.theme.muted} />
      <text text={cur + set} size={2}
            color={p.set > 0 ? 0xffa657 : UI.theme.text} />
    </box>
  );
}

function Slot(p) {
  var empty = p.slot.color === undefined || p.slot.color < 0;
  return (
    <box flex={1} pad={2}>
      <box h={em(2.4)} radius={6}
           bg={empty ? UI.theme.panel : p.slot.color}
           border={p.slot.sel ? UI.theme.accent : 0x333a46}
           borderW={p.slot.sel ? 2 : 1} />
      <text text={empty ? '-' : (p.slot.type || '?')} size={1}
            align="center" color={p.slot.sel ? UI.theme.accent : UI.theme.muted} />
    </box>
  );
}

function App() {
  var pr = UI.state.printer || DEMO;
  var slots = pr.slots || [];
  var slotRow = [];
  for (var i = 0; i < slots.length; i++) slotRow.push(<Slot slot={slots[i]} />);

  return (
    <box h={gfx.height()} pad={em(0.75)} gap={em(0.6)}>
      <text text={'PRINTER - ' + (pr.state || 'idle').toUpperCase()}
            size={2} align="center" color={UI.theme.accent} />
      <pbar value={pr.progress || 0} max={100} h={10}
            color={UI.theme.ok} />
      <text text={fmtLeft(pr.left)} size={1} align="center" color={UI.theme.muted} />
      <row gap={em(0.5)}>
        <Temp label="NOZZLE" cur={pr.nozzle} set={pr.nozzleSet} />
        <Temp label="BED" cur={pr.bed} set={pr.bedSet} />
        <Temp label="CASE" cur={pr['case']} />
      </row>
      <box bg={UI.theme.panel} radius={6} pad={em(0.6)} gap={em(0.4)}>
        <text text="CFS" size={1} color={UI.theme.muted} />
        {h('row', { gap: 2 }, slotRow)}
      </box>
      <box bg={UI.theme.panel} radius={6} pad={em(0.6)} gap={em(0.4)}>
        <text text="EXTERNAL SPOOL" size={1} color={UI.theme.muted} />
        {pr.spool
          ? h('row', { gap: em(0.5) }, [
              h('box', { w: em(3), h: em(2), radius: 5,
                         bg: pr.spool.color < 0 ? UI.theme.panel : pr.spool.color,
                         border: pr.spool.sel ? UI.theme.accent : 0x333a46,
                         borderW: pr.spool.sel ? 2 : 1 }),
              h('text', { text: pr.spool.type || 'unknown', size: 2, middle: true })
            ])
          : h('text', { text: 'none reported', size: 1, color: UI.theme.muted })}
      </box>
      {UI.state.printer ? null
        : <text text="demo data - the bridge feeds this live" size={1}
                align="center" color={0x555f6e} />}
    </box>
  );
}

UI.mount(App);
