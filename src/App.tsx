import { onCleanup, onMount, Show } from 'solid-js';
import { ExpressionPanel } from './components/ExpressionPanel';
import { GraphView } from './components/GraphView';
import { MathKeypad } from './components/MathKeypad';
import { Toast } from './components/Toast';
import { UpdatePrompt } from './components/UpdatePrompt';
import './state/autosave';
import { attachHistoryKeys } from './state/historyUi';
import { keypad } from './state/keypad';
import './state/sliderAnimation';
import { ui } from './state/ui';

export default function App() {
  onMount(() => {
    onCleanup(attachHistoryKeys(document));
    // Esc deselects the row, from a field, the graph or anywhere, unless something else used it
    // (the menu and the color picker close). On window, so it runs after their listeners.
    const deselect = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented && !e.isComposing) ui.setSelectedRowId(null);
    };
    window.addEventListener('keydown', deselect);
    onCleanup(() => window.removeEventListener('keydown', deselect));
  });

  const keypadVisible = () => keypad.enabled() && keypad.open();
  const panelRows = () => {
    const drag = ui.panelDragPx();
    if (drag !== null) return { graph: '1fr', panel: `${drag}px` };
    switch (ui.panelSnap()) {
      case 'collapsed':
        return { graph: '1fr', panel: 'var(--panel-collapsed)' };
      case 'full':
        return { graph: '15fr', panel: '85fr' };
      default:
        return { graph: '55fr', panel: '45fr' };
    }
  };

  return (
    <div
      class="app"
      classList={{ 'sidebar-collapsed': !ui.sidebarOpen(), 'keypad-open': keypadVisible() }}
      style={{
        '--graph-row': panelRows().graph,
        '--panel-row': panelRows().panel,
        '--sidebar-w': `${ui.sidebarWidth()}px`,
      }}
      data-panel={ui.panelSnap()}
    >
      <ExpressionPanel />
      <GraphView />
      <Show when={keypadVisible()}>
        <MathKeypad />
      </Show>
      {/* Always there, so screen readers announce a toast when it appears in it. */}
      <div class="toasts" role="status">
        <Toast />
        <UpdatePrompt />
      </div>
    </div>
  );
}
