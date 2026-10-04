import { onCleanup, onMount } from 'solid-js';
import { doc } from '../state/doc';
import { focusRow, revealRow } from '../state/focus';
import { keypad } from '../state/keypad';
import { mobileQuery, type PanelSnap, ui } from '../state/ui';
import { ExpressionList } from './ExpressionList';
import { GraphMenu } from './GraphMenu';

const SNAPS: readonly PanelSnap[] = ['collapsed', 'half', 'full'];

/** Approximate panel height for each snap state, as a fraction of the space above the keypad. */
function snapFraction(snap: PanelSnap): number {
  return snap === 'collapsed' ? 0 : snap === 'half' ? 0.45 : 0.85;
}

export function ExpressionPanel() {
  let panel!: HTMLElement;
  let scroller!: HTMLDivElement;

  // When the list area shrinks (the keypad opening, a snap change, rotation), keep the row being
  // edited in view instead of leaving it below the fold.
  onMount(() => {
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => {
      const active = document.activeElement;
      if (active && scroller.contains(active)) revealRow(active);
    });
    ro.observe(scroller);
    onCleanup(() => ro.disconnect());
  });

  // Mobile: drag the handle to resize, tap it to cycle snap states.
  const onHandleDown = (e: PointerEvent) => {
    if (!mobileQuery?.matches) return;
    if ((e.target as HTMLElement).closest('button, [role="menu"]')) return;
    const handle = e.currentTarget as HTMLElement;
    handle.setPointerCapture(e.pointerId);
    const startY = e.clientY;
    const startH = panel.getBoundingClientRect().height;
    const avail = (panel.parentElement?.clientHeight ?? window.innerHeight) - keypadHeight();
    let moved = false;
    const move = (ev: PointerEvent) => {
      const dy = ev.clientY - startY;
      if (Math.abs(dy) > 6) moved = true;
      if (moved) ui.setPanelDragPx(Math.max(56, Math.min(avail * 0.9, startH - dy)));
    };
    const up = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      handle.removeEventListener('pointercancel', up);
      const h = ui.panelDragPx();
      if (!moved || h === null) {
        const i = SNAPS.indexOf(ui.panelSnap());
        ui.setPanelSnap(SNAPS[(i + 1) % SNAPS.length]);
      } else {
        const frac = h / Math.max(1, avail);
        let best: PanelSnap = 'half';
        for (const s of SNAPS) {
          if (Math.abs(snapFraction(s) - frac) < Math.abs(snapFraction(best) - frac)) best = s;
        }
        ui.setPanelSnap(best);
      }
      ui.setPanelDragPx(null);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
    handle.addEventListener('pointercancel', up);
  };

  const keypadHeight = () => document.querySelector('.keypad')?.getBoundingClientRect().height ?? 0;

  const addRow = () => {
    const last = doc.rows[doc.rows.length - 1];
    if (last) focusRow(last.id, 'end');
  };

  const toggleKeypad = () => {
    const on = !keypad.enabled();
    keypad.setEnabled(on);
    keypad.setOpen(on);
    const t = keypad.target();
    // Re-focus so the device keyboard appears/disappears to match the new mode.
    if (t?.el.isConnected && document.activeElement === t.el) {
      t.el.blur();
      t.el.focus();
    }
  };

  return (
    <section
      class="panel"
      aria-label="Expression list"
      ref={panel}
      onFocusIn={() => {
        if (mobileQuery?.matches && ui.panelSnap() === 'collapsed') ui.setPanelSnap('half');
      }}
    >
      <header class="panel-header" onPointerDown={onHandleDown}>
        <span class="panel-grip" aria-hidden="true" />
        <h1 class="panel-title">Graph</h1>
        <div class="panel-tools">
          <button type="button" class="icon-button" aria-label="Add expression" onClick={addRow}>
            +
          </button>
          <button
            type="button"
            class="icon-button"
            classList={{ active: keypad.enabled() }}
            aria-label={keypad.enabled() ? 'Use device keyboard' : 'Use math keypad'}
            aria-pressed={keypad.enabled()}
            data-testid="keypad-toggle"
            // Keep focus in the field, so the re-focus below can switch keyboards in place.
            onPointerDown={(e) => e.preventDefault()}
            onClick={toggleKeypad}
          >
            ⌨
          </button>
          <GraphMenu />
          <button
            type="button"
            class="icon-button desktop-only"
            aria-label="Hide expression list"
            onClick={() => ui.setSidebarOpen(false)}
          >
            «
          </button>
        </div>
      </header>
      <div class="panel-scroll" ref={scroller}>
        <ExpressionList />
      </div>
    </section>
  );
}
