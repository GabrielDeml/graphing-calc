import { createEffect, createRoot, createSignal } from 'solid-js';
import { doc } from './doc';
import { savedState } from './persist';

export type PanelSnap = 'collapsed' | 'half' | 'full';

/**
 * Layout state: desktop sidebar visibility and the mobile expression panel's snap height (both
 * restored from the last session), plus the selected row and requests to the graph's view.
 */
export const ui = createRoot(() => {
  const saved = savedState();
  const [sidebarOpen, setSidebarOpen] = createSignal(saved?.sidebarOpen ?? true);
  const [panelSnap, setPanelSnap] = createSignal<PanelSnap>(saved?.panelSnap ?? 'half');
  /** Explicit panel height while the mobile handle is being dragged. */
  const [panelDragPx, setPanelDragPx] = createSignal<number | null>(null);
  /**
   * The row the graph and tools are about. Set by focusing a row; unlike focus it survives
   * clicking the graph. Cleared by Esc (that nothing else used), a tap on empty graph, or the
   * row going away.
   */
  const [selectedRowId, setSelectedRowId] = createSignal<string | null>(null);
  createEffect(() => {
    const id = selectedRowId();
    if (id !== null && !doc.rows.some((r) => r.id === id)) setSelectedRowId(null);
  });
  /** Counts requests to fly the graph back to its home view (GraphView acts on them). */
  const [homeRequests, setHomeRequests] = createSignal(0);
  return {
    sidebarOpen,
    setSidebarOpen,
    panelSnap,
    setPanelSnap,
    panelDragPx,
    setPanelDragPx,
    selectedRowId,
    setSelectedRowId,
    homeRequests,
    /** Back to the home view, as "Reset view" does (New graph starts over there). */
    requestHome: () => setHomeRequests((n) => n + 1),
  };
});

/**
 * The stacked phone layout (graph over a snapping panel over the keypad). Short landscape phones
 * use the sidebar layout instead; keep in sync with the media queries in global.css.
 */
export const mobileQuery =
  typeof matchMedia === 'function'
    ? matchMedia(
        '(max-width: 767px) and (min-height: 501px), (max-width: 767px) and (orientation: portrait)',
      )
    : null;
