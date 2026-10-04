import { Show } from 'solid-js';
import { ExpressionPanel } from './components/ExpressionPanel';
import { GraphView } from './components/GraphView';
import { MathKeypad } from './components/MathKeypad';
import { UpdatePrompt } from './components/UpdatePrompt';
import { keypad } from './state/keypad';
import './state/sliderAnimation';
import { ui } from './state/ui';

export default function App() {
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
      style={{ '--graph-row': panelRows().graph, '--panel-row': panelRows().panel }}
      data-panel={ui.panelSnap()}
    >
      <ExpressionPanel />
      <GraphView />
      <Show when={keypadVisible()}>
        <MathKeypad />
      </Show>
      <UpdatePrompt />
    </div>
  );
}
