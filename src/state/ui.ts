import { createEffect, createRoot, createSignal, on } from 'solid-js';
import { doc } from './doc';
import { SIDEBAR_DEFAULT } from './layout';
import { savedState } from './persist';

export type PanelSnap = 'collapsed' | 'half' | 'full';

/**
 * Layout state: desktop sidebar visibility and width and the mobile expression panel's snap height
 * (all restored from the last session), plus which rows the graph and the list are about (the
 * selected one, the one pointed at, the one being edited) and requests to the graph's view.
 */
export const ui = createRoot(() => {
  const saved = savedState();
  const [sidebarOpen, setSidebarOpen] = createSignal(saved?.sidebarOpen ?? true);
  /** Desktop sidebar width (CSS px), set by dragging its edge. */
  const [sidebarWidth, setSidebarWidth] = createSignal(saved?.sidebarWidth ?? SIDEBAR_DEFAULT);
  const [panelSnap, setPanelSnap] = createSignal<PanelSnap>(saved?.panelSnap ?? 'half');
  /** Explicit panel height while the mobile handle is being dragged. */
  const [panelDragPx, setPanelDragPx] = createSignal<number | null>(null);
  /**
   * The row the graph and tools are about. Set by focusing a row; unlike focus it survives
   * clicking the graph. Cleared by Esc (that nothing else used), a tap on empty graph, or the
   * row going away.
   */
  const [selectedRowId, setSelectedRowId] = createSignal<string | null>(null);
  /**
   * The row a mouse rests on in the list: its curve stands out meanwhile. A new selection (a
   * row focused from the keyboard, Esc) takes over until the mouse moves again.
   */
  const [hoveredRowId, setHoveredRowId] = createSignal<string | null>(null);
  createEffect(on(selectedRowId, () => setHoveredRowId(null), { defer: true }));
  /** The row whose curve the graph is tracing: the list tints it. */
  const [tracedRowId, setTracedRowId] = createSignal<string | null>(null);
  /** The row whose text (its math or a range field) has focus: see state/steady.ts. */
  const [editingRowId, setEditingRowId] = createSignal<string | null>(null);
  /** Requests to scroll a row into view and pulse it (a curve was picked on the graph). */
  const [flash, setFlash] = createSignal<{ id: string; seq: number } | null>(null);
  createEffect(() => {
    const ids = new Set(doc.rows.map((r) => r.id));
    for (const [get, set] of [
      [selectedRowId, setSelectedRowId],
      [hoveredRowId, setHoveredRowId],
      [tracedRowId, setTracedRowId],
      [editingRowId, setEditingRowId],
    ] as const) {
      const id = get();
      if (id !== null && !ids.has(id)) set(null);
    }
  });
  /** Counts requests to fly the graph back to its home view (GraphView acts on them). */
  const [homeRequests, setHomeRequests] = createSignal(0);
  return {
    sidebarOpen,
    setSidebarOpen,
    sidebarWidth,
    setSidebarWidth,
    panelSnap,
    setPanelSnap,
    panelDragPx,
    setPanelDragPx,
    selectedRowId,
    setSelectedRowId,
    hoveredRowId,
    setHoveredRowId,
    tracedRowId,
    setTracedRowId,
    editingRowId,
    setEditingRowId,
    /** The row the graph emphasises: the one pointed at in the list, else the selected one. */
    emphasizedRowId: () => hoveredRowId() ?? selectedRowId(),
    flash,
    /** Select a row from the graph: it scrolls into view and pulses, without taking focus. */
    pickRow: (id: string) => {
      setSelectedRowId(id);
      setFlash((f) => ({ id, seq: (f?.seq ?? 0) + 1 }));
    },
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
