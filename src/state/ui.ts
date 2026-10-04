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

export const mobileQuery =
  typeof matchMedia === 'function' ? matchMedia('(max-width: 767px)') : null;
