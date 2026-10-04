import { createEffect, createSignal, onCleanup, onMount, Show } from 'solid-js';
import { attachGestures } from '../interaction/gestures';
import { GraphController, type SceneRow, type TraceHit } from '../render/controller';
import { analysis } from '../state/analysis';
import { doc } from '../state/doc';
import { isCoarsePointer, keypad } from '../state/keypad';
import { palette } from '../state/theme';
import { ui } from '../state/ui';
import { GraphControls } from './GraphControls';
import { TraceMarker } from './TraceMarker';

const debug = typeof location !== 'undefined' && new URLSearchParams(location.search).has('debug');

type TraceAnchor =
  | { mode: 'hover'; sx: number; sy: number }
  | { mode: 'pinned'; x: number; y: number; rowId: string };

export function GraphView() {
  let container!: HTMLDivElement;
  let canvas!: HTMLCanvasElement;
  let debugEl: HTMLDivElement | undefined;
  const [controller, setController] = createSignal<GraphController | null>(null);
  const [trace, setTrace] = createSignal<TraceHit | null>(null);

  onMount(() => {
    const c = new GraphController(container, canvas);
    setController(c);
    let anchor: TraceAnchor | null = null;
    let hoverFrame = 0;

    // Re-run the trace after every redraw so it follows pans, zooms and animating sliders.
    const retrace = () => {
      if (!anchor) {
        if (trace()) setTrace(null);
        return;
      }
      if (anchor.mode === 'hover') {
        setTrace(c.trace(anchor.sx, anchor.sy, 20));
      } else {
        const sx = (anchor.x - c.view.cx) * c.view.ppuX + c.view.width / 2;
        const sy = c.view.height / 2 - (anchor.y - c.view.cy) * c.view.ppuY;
        const hit = c.trace(sx, sy, 32);
        setTrace(hit);
        if (hit) anchor = { mode: 'pinned', x: hit.x, y: hit.y, rowId: hit.rowId };
      }
    };
    c.onDraw = () => {
      retrace();
      if (debugEl) debugEl.textContent = `${c.lastFrameMs.toFixed(1)} ms`;
    };

    createEffect(() => {
      const a = analysis();
      const rows: SceneRow[] = [];
      for (const row of doc.rows) {
        const res = a.byId.get(row.id);
        if (!res || res.status !== 'ok' || !res.plot || row.hidden) continue;
        rows.push({ id: row.id, plot: res.plot, deps: res.deps, colorIndex: row.colorIndex });
      }
      palette(); // repaint when the scheme changes
      c.setScene(rows, a.values);
    });

    const detach = attachGestures(container, c, {
      hover(sx, sy) {
        if (anchor?.mode === 'pinned') return;
        anchor = { mode: 'hover', sx, sy };
        if (!hoverFrame) {
          hoverFrame = requestAnimationFrame(() => {
            hoverFrame = 0;
            retrace();
          });
        }
      },
      leave() {
        if (anchor?.mode === 'hover') {
          anchor = null;
          setTrace(null);
        }
      },
      tap(sx, sy, pointerType) {
        const hit = c.trace(sx, sy, pointerType === 'touch' ? 32 : 20);
        anchor = hit ? { mode: 'pinned', x: hit.x, y: hit.y, rowId: hit.rowId } : null;
        setTrace(hit);
      },
      down(pointerType) {
        // Tapping the graph on a phone dismisses the keypad and finishes editing.
        if (pointerType === 'touch' || isCoarsePointer) {
          keypad.setOpen(false);
          const active = document.activeElement;
          if (active instanceof HTMLInputElement) active.blur();
        }
      },
    });

    onCleanup(() => {
      detach();
      cancelAnimationFrame(hoverFrame);
      c.destroy();
    });
  });

  return (
    <div
      class="graph"
      ref={container}
      tabindex="0"
      role="img"
      aria-roledescription="graph"
      aria-label="Graph area. Arrow keys pan, plus and minus zoom, 0 resets the view."
      data-testid="graph"
    >
      <canvas ref={canvas} class="graph-canvas" />
      <TraceMarker hit={trace()} />
      <Show when={controller()}>{(c) => <GraphControls controller={c()} />}</Show>
      <Show when={!ui.sidebarOpen()}>
        <button
          type="button"
          class="icon-button show-sidebar"
          aria-label="Show expression list"
          onClick={() => ui.setSidebarOpen(true)}
        >
          »
        </button>
      </Show>
      <Show when={debug}>
        <div class="debug-overlay" ref={debugEl} />
      </Show>
    </div>
  );
}
