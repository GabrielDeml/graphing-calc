import { createEffect, createSignal, on, onCleanup, onMount, Show } from 'solid-js';
import { ExpressionPanel } from './components/ExpressionPanel';
import { GraphView } from './components/GraphView';
import { MathKeypad } from './components/MathKeypad';
import { Toast } from './components/Toast';
import { UpdatePrompt } from './components/UpdatePrompt';
import './state/autosave';
import { doc, isBlank } from './state/doc';
import { focusRow } from './state/focus';
import { attachHistoryKeys } from './state/historyUi';
import { keypad } from './state/keypad';
import { PANEL_SHARE } from './state/layout';
import { DUR_2, reducedMotion } from './state/motion';
import './state/sliderAnimation';
import { ui } from './state/ui';

/** A mouse or trackpad: a desk, where the caret can wait in a row (no keypad pops up). */
const finePointer = typeof matchMedia === 'function' && matchMedia('(pointer: fine)').matches;

/** How long the keypad sheet takes to slide away (--dur-2, as MathKeypad's slide). */
const KEYPAD_OUT_MS = DUR_2;

export default function App() {
  onMount(() => {
    onCleanup(attachHistoryKeys(document));
    // A first visit (or a blank graph) at a desk: the first row is ready to type in. Never on
    // touch, or in keypad mode, where focusing a row would bring up a keypad nobody asked for.
    if (finePointer && !keypad.enabled() && isBlank()) focusRow(doc.rows[0].id, 'end');
    // Esc deselects the row, from a field, the graph or anywhere, unless something else used it
    // (the menu and the color picker close). On window, so it runs after their listeners.
    const deselect = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented && !e.isComposing) ui.setSelectedRowId(null);
    };
    window.addEventListener('keydown', deselect);
    onCleanup(() => window.removeEventListener('keydown', deselect));
  });

  const keypadVisible = () => keypad.enabled() && keypad.open();
  /**
   * The keypad sheet stays a moment once hidden, to slide away out of the layout (the graph and
   * the list take its room at once); shown again meanwhile, it simply stays.
   */
  const [keypadShown, setKeypadShown] = createSignal(keypadVisible());
  const [keypadLeaving, setKeypadLeaving] = createSignal(false);
  let leaveTimer: ReturnType<typeof setTimeout> | undefined;
  createEffect(
    on(
      keypadVisible,
      (visible) => {
        clearTimeout(leaveTimer);
        if (visible || reducedMotion()) {
          setKeypadLeaving(false);
          setKeypadShown(visible);
          return;
        }
        setKeypadLeaving(true);
        leaveTimer = setTimeout(() => {
          setKeypadShown(false);
          setKeypadLeaving(false);
        }, KEYPAD_OUT_MS);
      },
      { defer: true },
    ),
  );
  onCleanup(() => clearTimeout(leaveTimer));

  let app!: HTMLDivElement;

  /**
   * The collapsed list's share (out of 100) of the room it splits with the graph: just its
   * minimum (--panel-collapsed, global.css), measured, so a snap to it eases all the way in
   * instead of running into that floor partway and stopping dead.
   */
  const [collapsedShare, setCollapsedShare] = createSignal(0);
  /**
   * Measure the room (the graph's height and the list's), which changes when the keypad comes or
   * goes or the window resizes, never as a snap moves the split.
   */
  const measureRoom = () => {
    const graph = app.querySelector(':scope > .graph');
    const panel = app.querySelector(':scope > .panel');
    if (!graph || !panel) return;
    const room = graph.getBoundingClientRect().height + panel.getBoundingClientRect().height;
    const floor = Number.parseFloat(getComputedStyle(app).getPropertyValue('--panel-collapsed'));
    if (!(room > 0 && floor > 0)) return;
    const share = Math.min(100, (100 * floor) / room);
    if (Math.abs(share - collapsedShare()) * room < 50) return;
    // A collapsed list keeps its height as the room changes, at once: only snaps glide.
    const still = ui.panelSnap() === 'collapsed' && ui.panelDrag() === null;
    if (still) app.style.transition = 'none';
    setCollapsedShare(share);
    if (still) {
      void app.offsetHeight;
      app.style.transition = '';
    }
  };
  onMount(() => {
    measureRoom();
    // The window: the app's own size, which the split inside it never changes.
    if (typeof ResizeObserver !== 'function') return;
    const ro = new ResizeObserver(measureRoom);
    ro.observe(app);
    onCleanup(() => ro.disconnect());
  });
  // The keypad: measured once it has come into the layout or gone out of it (all of this update
  // applied), before any frame.
  createEffect(
    on([keypadVisible, keypadShown, keypadLeaving], () => queueMicrotask(measureRoom), {
      defer: true,
    }),
  );

  /**
   * The phone's graph and list rows, as shares of the room they split (fr, summing to 100), so a
   * snap animates between any two heights, from wherever a drag let go. Collapsed, the list keeps
   * just its minimum (see collapsedShare).
   */
  const panelRows = () => {
    const drag = ui.panelDrag();
    if (drag !== null) return { graph: `${100 - 100 * drag}fr`, panel: `${100 * drag}fr` };
    const snap = ui.panelSnap();
    const share = snap === 'collapsed' ? collapsedShare() : PANEL_SHARE[snap];
    return { graph: `${100 - share}fr`, panel: `${share}fr` };
  };

  return (
    <div
      ref={app}
      class="app"
      classList={{
        'sidebar-collapsed': !ui.sidebarOpen(),
        'keypad-open': keypadVisible(),
        'panel-dragging': ui.panelDrag() !== null,
      }}
      style={{
        '--graph-row': panelRows().graph,
        '--panel-row': panelRows().panel,
        '--sidebar-w': `${ui.sidebarWidth()}px`,
      }}
      data-panel={ui.panelSnap()}
    >
      <ExpressionPanel />
      <GraphView />
      <Show when={keypadShown()}>
        <MathKeypad leaving={keypadLeaving()} />
      </Show>
      {/* Always there, so screen readers announce a toast when it appears in it. */}
      <div class="toasts" role="status">
        <Toast />
        <UpdatePrompt />
      </div>
    </div>
  );
}
