import { createSignal, onCleanup, onMount } from 'solid-js';
import { doc } from '../state/doc';
import { focusRow, revealRow } from '../state/focus';
import { keypad } from '../state/keypad';
import { clampSidebarWidth, SIDEBAR_DEFAULT, SIDEBAR_MIN, sidebarMaxWidth } from '../state/layout';
import { mobileQuery, type PanelSnap, ui } from '../state/ui';
import { Examples } from './Examples';
import { ExpressionList } from './ExpressionList';
import { GraphMenu } from './GraphMenu';
import { Icon } from './icons';

/** Arrow keys on the sidebar's edge resize it by this much (Shift: four times as much). */
const RESIZE_STEP_PX = 16;

const SNAPS: readonly PanelSnap[] = ['collapsed', 'half', 'full'];

/** Approximate panel height for each snap state: its share of the room it splits with the graph. */
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
    // The room the list splits with the graph (the keypad's is apart).
    const graphH = document.querySelector('.graph')?.getBoundingClientRect().height ?? 0;
    const avail = Math.max(1, startH + graphH);
    let moved = false;
    const move = (ev: PointerEvent) => {
      const dy = ev.clientY - startY;
      if (Math.abs(dy) > 6) moved = true;
      if (moved) ui.setPanelDrag(Math.max(0, Math.min(0.9, (startH - dy) / avail)));
    };
    const up = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      handle.removeEventListener('pointercancel', up);
      const frac = ui.panelDrag();
      if (!moved || frac === null) {
        const i = SNAPS.indexOf(ui.panelSnap());
        ui.setPanelSnap(SNAPS[(i + 1) % SNAPS.length]);
      } else {
        let best: PanelSnap = 'half';
        for (const s of SNAPS) {
          if (Math.abs(snapFraction(s) - frac) < Math.abs(snapFraction(best) - frac)) best = s;
        }
        ui.setPanelSnap(best);
      }
      // Together with the snap, so it glides there from where the finger let go.
      ui.setPanelDrag(null);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
    handle.addEventListener('pointercancel', up);
  };

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
      onFocusIn={(e) => {
        // A field getting focus brings the list up. The header's buttons leave the panel be: one
        // moving under a tap sends the tap's click to whatever slid beneath the finger.
        if ((e.target as HTMLElement).closest('.panel-header')) return;
        if (mobileQuery?.matches && ui.panelSnap() === 'collapsed') ui.setPanelSnap('half');
      }}
    >
      <header class="panel-header" onPointerDown={onHandleDown}>
        <span class="panel-grip" aria-hidden="true" />
        <h1 class="panel-title">Graph</h1>
        <div class="panel-tools">
          <button type="button" class="icon-button" aria-label="Add expression" onClick={addRow}>
            <Icon name="plus" />
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
            <Icon name="keyboard" />
          </button>
          <GraphMenu />
          <button
            type="button"
            class="icon-button desktop-only"
            aria-label="Hide expression list"
            onClick={() => ui.setSidebarOpen(false)}
          >
            <Icon name="sidebar-hide" />
          </button>
        </div>
      </header>
      <div class="panel-scroll" ref={scroller}>
        <ExpressionList />
        <Examples />
      </div>
      <SidebarResizer />
    </section>
  );
}

/**
 * The sidebar's right edge (desktop): drag it, or focus it and use the arrow keys, to resize the
 * list; double-click puts the default width back.
 */
function SidebarResizer() {
  const [dragging, setDragging] = createSignal(false);
  const [windowWidth, setWindowWidth] = createSignal(window.innerWidth);
  onMount(() => {
    const resize = () => setWindowWidth(window.innerWidth);
    window.addEventListener('resize', resize);
    onCleanup(() => window.removeEventListener('resize', resize));
  });
  const set = (px: number) => ui.setSidebarWidth(clampSidebarWidth(px, windowWidth()));
  /** The width the layout shows (the saved one can be wider than a small window allows). */
  const shown = () => clampSidebarWidth(ui.sidebarWidth(), windowWidth());

  const onPointerDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const startX = e.clientX;
    const startW = shown();
    const app = el.closest('.app');
    setDragging(true);
    app?.classList.add('resizing');
    const move = (ev: PointerEvent) => set(startW + ev.clientX - startX);
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      app?.classList.remove('resizing');
      setDragging(false);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  };

  const onKeyDown = (e: KeyboardEvent) => {
    const step = e.shiftKey ? 4 * RESIZE_STEP_PX : RESIZE_STEP_PX;
    if (e.key === 'ArrowLeft') set(shown() - step);
    else if (e.key === 'ArrowRight') set(shown() + step);
    else if (e.key === 'Home') set(SIDEBAR_MIN);
    else if (e.key === 'End') set(sidebarMaxWidth(windowWidth()));
    else return;
    e.preventDefault();
  };

  return (
    // biome-ignore lint/a11y/useSemanticElements: a focusable splitter has no native element.
    <div
      class="sidebar-resizer"
      classList={{ dragging: dragging() }}
      role="separator"
      tabindex="0"
      aria-orientation="vertical"
      aria-label="Resize expression list"
      aria-valuemin={SIDEBAR_MIN}
      aria-valuemax={sidebarMaxWidth(windowWidth())}
      aria-valuenow={shown()}
      data-testid="sidebar-resizer"
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
      onDblClick={() => ui.setSidebarWidth(SIDEBAR_DEFAULT)}
    />
  );
}
