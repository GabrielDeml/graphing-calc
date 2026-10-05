import { createEffect, createSignal, on, onCleanup, onMount, Show } from 'solid-js';
import { attachGestures } from '../interaction/gestures';
import { GraphController, type SceneRow, type TraceHit } from '../render/controller';
import { analysis } from '../state/analysis';
import { noteView } from '../state/autosave';
import { doc } from '../state/doc';
import { isCoarsePointer, keypad } from '../state/keypad';
import { savedState } from '../state/persist';
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
    const c = new GraphController(container, canvas, savedState()?.view ?? null);
    setController(c);
    c.onViewChange = (v) => noteView(c.atHome ? null : v);
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
        // A pin on a row that was hidden or deleted goes away (it would block hover otherwise).
        if (!c.hasRow(anchor.rowId)) {
          anchor = null;
          setTrace(null);
          return;
        }
        const sx = (anchor.x - c.view.cx) * c.view.ppuX + c.view.width / 2;
        const sy = c.view.height / 2 - (anchor.y - c.view.cy) * c.view.ppuY;
        const hit = c.trace(sx, sy, 32);
        setTrace(hit);
        if (hit) anchor = { mode: 'pinned', x: hit.x, y: hit.y, rowId: hit.rowId };
      }
    };
    c.onDraw = () => {
      retrace();
      if (debugEl) debugEl.textContent = `${c.lastFrameMs.toFixed(1)} ms ${c.currentQuality}`;
    };

    createEffect(on(ui.homeRequests, () => c.home(), { defer: true }));

    createEffect(() => {
      const a = analysis();
      const rows: SceneRow[] = [];
      for (const row of doc.rows) {
        const res = a.byId.get(row.id);
        if (res?.status !== 'ok' || !res.plot || row.hidden) continue;
        rows.push({ id: row.id, plot: res.plot, deps: res.deps, colorIndex: row.colorIndex });
      }
      palette(); // repaint when the scheme changes
      const active = document.activeElement;
      c.setScene(rows, a.values, !!active?.classList.contains('math-input'));
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
        // Tapping the graph on a phone dismisses the keypad and finishes editing. Only on a tap:
        // hiding it when a drag starts would re-layout the graph under the finger.
        if (pointerType === 'touch' || isCoarsePointer) {
          keypad.setOpen(false);
          const active = document.activeElement;
          if (active instanceof HTMLInputElement) active.blur();
        }
        const hit = c.trace(sx, sy, pointerType === 'touch' ? 32 : 20);
        // A tap away from every curve deselects the row.
        if (!hit) ui.setSelectedRowId(null);
        if (pointerType === 'mouse') {
          // A mouse traces by hovering; a click (or double-click zoom) must not pin it.
          anchor = { mode: 'hover', sx, sy };
          retrace();
          return;
        }
        anchor = hit ? { mode: 'pinned', x: hit.x, y: hit.y, rowId: hit.rowId } : null;
        setTrace(hit);
      },
    });

    onCleanup(() => {
      detach();
      cancelAnimationFrame(hoverFrame);
      c.destroy();
    });
  });

  // A labelled group: it holds buttons and the trace's live region, which an img would hide.
  // The picture itself is the canvas.
  return (
    // biome-ignore lint/a11y/useSemanticElements: a focusable pan/zoom surface, not a form fieldset.
    <div
      class="graph"
      ref={container}
      tabindex="0"
      role="group"
      aria-roledescription="graph"
      aria-label="Graph area. Arrow keys pan, plus and minus zoom, 0 resets the view."
      data-testid="graph"
    >
      <canvas ref={canvas} class="graph-canvas" role="img" aria-label="Graph of the expressions" />
      <TraceMarker hit={trace()} />
      <Show when={controller()}>{(c) => <GraphControls controller={c()} />}</Show>
      <Show when={debug}>
        <div class="debug-overlay" ref={debugEl} />
      </Show>
    </div>
  );
}
