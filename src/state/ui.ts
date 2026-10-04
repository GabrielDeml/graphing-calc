import { createRoot, createSignal } from 'solid-js';

export type PanelSnap = 'collapsed' | 'half' | 'full';

/** Layout state: desktop sidebar visibility and the mobile expression panel's snap height. */
export const ui = createRoot(() => {
  const [sidebarOpen, setSidebarOpen] = createSignal(true);
  const [panelSnap, setPanelSnap] = createSignal<PanelSnap>('half');
  /** Explicit panel height while the mobile handle is being dragged. */
  const [panelDragPx, setPanelDragPx] = createSignal<number | null>(null);
  return { sidebarOpen, setSidebarOpen, panelSnap, setPanelSnap, panelDragPx, setPanelDragPx };
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
