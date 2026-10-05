import { batch, createEffect, createRoot, createSignal, on } from 'solid-js';
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
  /**
   * While the phone's panel is dragged by its handle, its height: its share (0…1) of the room it
   * splits with the graph.
   */
  const [panelDrag, setPanelDrag] = createSignal<number | null>(null);
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
  /**
   * Requests to pulse rows: a curve picked on the graph (scrolled into view too), rows that were
   * just added for the user (sliders for unknown names, a tangent).
   */
  const [flash, setFlash] = createSignal<{
    ids: readonly string[];
    reveal: boolean;
    seq: number;
  } | null>(null);
  const flashRows = (ids: readonly string[], reveal: boolean) =>
    setFlash((f) => ({ ids, reveal, seq: (f?.seq ?? 0) + 1 }));
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
  /** The last request to fly the graph to a point of a row's curve (an insight's chip). */
  const [flight, setFlight] = createSignal<Flight | null>(null);
  return {
    sidebarOpen,
    setSidebarOpen,
    sidebarWidth,
    setSidebarWidth,
    panelSnap,
    setPanelSnap,
    panelDrag,
    setPanelDrag,
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
    /** Pulse rows once (`reveal`: scrolled into view too). */
    flashRows,
    /** Select a row from the graph: it scrolls into view and pulses, without taking focus. */
    pickRow: (id: string) => {
      setSelectedRowId(id);
      flashRows([id], true);
    },
    homeRequests,
    /** Back to the home view, as "Reset view" does (New graph starts over there). */
    requestHome: () => setHomeRequests((n) => n + 1),
    flight,
    /**
     * Fly the graph to a point of a row's curve (GraphView acts on it), and pin the trace there
     * unless the point is off the curve (a circle's centre). The row becomes the selected one, as
     * a tap on its curve makes it (a pressed button doesn't take the focus everywhere).
     */
    flyTo: (rowId: string, x: number, y: number, pin: boolean) =>
      batch(() => {
        setSelectedRowId(rowId);
        setFlight((f) => ({ rowId, x, y, pin, seq: (f?.seq ?? 0) + 1 }));
      }),
  };
});

/** A request to fly the graph to (x, y); `seq` tells two requests for one point apart. */
export interface Flight {
  rowId: string;
  x: number;
  y: number;
  pin: boolean;
  seq: number;
}

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
