import { createEffect, createMemo, createSignal, on, onCleanup, onMount, Show } from 'solid-js';
import { attachGestures } from '../interaction/gestures';
import type { Poi, PoiKind } from '../plot/poi';
import { GraphController, type SceneRow, type TraceHit } from '../render/controller';
import { analysis, steadyRows } from '../state/analysis';
import { noteView } from '../state/autosave';
import { doc } from '../state/doc';
import { isCoarsePointer, keypad } from '../state/keypad';
import { savedState } from '../state/persist';
import { palette } from '../state/theme';
import { ui } from '../state/ui';
import { GraphControls } from './GraphControls';
import { PoiLayer, type PoiLayerHandle, type PoiSet } from './PoiLayer';
import { type TraceKind, TraceMarker } from './TraceMarker';

const debug = typeof location !== 'undefined' && new URLSearchParams(location.search).has('debug');

/** How close (px) the pointer must come to a point of interest for the trace to snap to it. */
const SNAP_PX = 10;
/** The same for a finger, which hides what it is on. */
const SNAP_TOUCH_PX = 16;
/** A press this close to the pinned trace's dot picks it up to scrub. */
const GRAB_PX = 24;

const KIND_PILL_NAMES: Record<Exclude<PoiKind, 'intersection'>, string> = {
  max: 'Maximum',
  min: 'Minimum',
  root: 'Root',
  xIntercept: 'x-intercept',
  yIntercept: 'y-intercept',
};

type TraceAnchor =
  | { mode: 'hover'; sx: number; sy: number }
  | {
      mode: 'pinned';
      x: number;
      y: number;
      rowId: string;
      /**
       * Where the finger was, in world coordinates, when a tap picked a curve whose points of
       * interest were not found yet: once they are, the pin snaps to one near it.
       */
      seek?: { x: number; y: number };
    };

export function GraphView() {
  let container!: HTMLDivElement;
  let canvas!: HTMLCanvasElement;
  let debugEl: HTMLDivElement | undefined;
  let poiLayer: PoiLayerHandle | undefined;
  /** Pin the trace on a point of interest (from the keyboard, on the point's button). */
  let pinPoi: ((poi: Poi, rowId: string) => void) | undefined;
  const [controller, setController] = createSignal<GraphController | null>(null);
  const [trace, setTrace] = createSignal<TraceHit | null>(null);
  const [poiSet, setPoiSet] = createSignal<PoiSet | null>(null);

  /** A row's math as shown in labels ("y = x/3"). */
  const rowText = (id: string) => doc.rows.find((r) => r.id === id)?.source.trim() ?? '';
  const rowColor = (id: string) => {
    const row = doc.rows.find((r) => r.id === id);
    return palette()[row?.colorIndex ?? 0] ?? palette()[0];
  };

  /** What the traced point is, when the trace sits on a point of interest. */
  const traceKind = createMemo((): TraceKind | null => {
    const hit = trace();
    const set = poiSet();
    if (!hit?.poi || !set) return null;
    const names = hit.poi.kinds.flatMap((k) => (k === 'intersection' ? [] : [KIND_PILL_NAMES[k]]));
    // The curves it meets, other than the one traced.
    const ids = hit.poi.kinds.includes('intersection')
      ? [set.rowId, ...hit.poi.with].filter((id) => id !== hit.rowId)
      : [];
    return { meets: ids.map((id) => ({ color: rowColor(id), text: rowText(id) })), names };
  });

  onMount(() => {
    const c = new GraphController(container, canvas, savedState()?.view ?? null);
    setController(c);
    c.onViewChange = (v) => noteView(c.atHome ? null : v);
    let anchor: TraceAnchor | null = null;
    let hoverFrame = 0;
    /** The row a finger is scrubbing along. */
    let scrubRow: string | null = null;

    const showTrace = (hit: TraceHit | null) => {
      setTrace(hit);
      ui.setTracedRowId(hit?.rowId ?? null);
    };
    const pin = (hit: TraceHit, seek?: { sx: number; sy: number }) => {
      anchor = { mode: 'pinned', x: hit.x, y: hit.y, rowId: hit.rowId };
      if (seek && !hit.poi) {
        anchor.seek = {
          x: c.view.cx + (seek.sx - c.view.width / 2) / c.view.ppuX,
          y: c.view.cy + (c.view.height / 2 - seek.sy) / c.view.ppuY,
        };
      }
      showTrace(hit);
    };

    // Re-run the trace after every redraw so it follows pans, zooms and animating sliders.
    const retrace = () => {
      if (!anchor) {
        if (trace()) showTrace(null);
        return;
      }
      if (anchor.mode === 'hover') {
        showTrace(c.trace(anchor.sx, anchor.sy, 20, { snapPx: SNAP_PX }));
      } else {
        // A pin on a row that was hidden or deleted goes away (it would block hover otherwise).
        if (!c.hasRow(anchor.rowId)) {
          anchor = null;
          showTrace(null);
          return;
        }
        const sx = (anchor.x - c.view.cx) * c.view.ppuX + c.view.width / 2;
        const sy = c.view.height / 2 - (anchor.y - c.view.cy) * c.view.ppuY;
        // Pinned on a point of interest, it keeps naming it.
        const hit = c.trace(sx, sy, 32, { rowId: anchor.rowId, snapPx: 1 });
        showTrace(hit);
        if (hit) {
          anchor = { mode: 'pinned', x: hit.x, y: hit.y, rowId: hit.rowId, seek: anchor.seek };
        }
      }
    };
    c.onDraw = () => {
      poiLayer?.place(c.view);
      retrace();
      if (debugEl) debugEl.textContent = `${c.lastFrameMs.toFixed(1)} ms ${c.currentQuality}`;
    };
    pinPoi = (poi, rowId) => {
      const sx = (poi.x - c.view.cx) * c.view.ppuX + c.view.width / 2;
      const sy = c.view.height / 2 - (poi.y - c.view.cy) * c.view.ppuY;
      const hit = c.trace(sx, sy, 32, { rowId, snapPx: 1 });
      if (hit) pin(hit);
    };
    c.onPois = (pois, view, rowId) => {
      setPoiSet(pois.length > 0 && rowId !== null ? { rowId, pois, view } : null);
      // The points of the curve a tap just picked: snap the pin to one near the tap, if any.
      if (anchor?.mode === 'pinned' && anchor.seek && anchor.rowId === rowId) {
        const { seek } = anchor;
        anchor.seek = undefined;
        const sx = (seek.x - c.view.cx) * c.view.ppuX + c.view.width / 2;
        const sy = c.view.height / 2 - (seek.y - c.view.cy) * c.view.ppuY;
        const hit = c.trace(sx, sy, 32, { rowId, snapPx: SNAP_TOUCH_PX });
        if (hit?.poi) pin(hit);
      }
    };

    createEffect(on(ui.homeRequests, () => c.home(), { defer: true }));

    createEffect(() => {
      const a = analysis();
      const held = steadyRows().held;
      const rows: SceneRow[] = [];
      for (const row of doc.rows) {
        if (row.hidden) continue;
        const res = a.byId.get(row.id);
        if (res?.status === 'ok' && res.plot) {
          rows.push({ id: row.id, plot: res.plot, deps: res.deps, colorIndex: row.colorIndex });
          continue;
        }
        // Broken for a moment while it is being typed: its last good plot, faintly.
        const last = held.get(row.id);
        if (last?.plot) {
          rows.push({
            id: row.id,
            plot: last.plot,
            deps: last.deps,
            colorIndex: row.colorIndex,
            ghost: true,
          });
        }
      }
      palette(); // repaint when the scheme changes
      const active = document.activeElement;
      c.setScene(rows, a.values, !!active?.classList.contains('math-input'));
    });

    createEffect(() => c.setEmphasis(ui.emphasizedRowId()));

    /**
     * The curve under a press or click (a finger gets more room), which becomes the selected
     * row; snapped to one of its points of interest, found for it right away.
     */
    const pickAt = (sx: number, sy: number, touch: boolean) => {
      const opts = { snapPx: touch ? SNAP_TOUCH_PX : SNAP_PX };
      const hit = c.trace(sx, sy, touch ? 32 : 20, opts);
      if (!hit) return null;
      ui.pickRow(hit.rowId);
      c.refreshPois();
      return c.trace(sx, sy, touch ? 32 : 20, { ...opts, rowId: hit.rowId }) ?? hit;
    };

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
          showTrace(null);
        }
      },
      tap(sx, sy, pointerType) {
        // Tapping the graph on a phone dismisses the keypad and finishes editing. Only on a tap:
        // hiding it when a drag starts would re-layout the graph under the finger.
        const touch = pointerType === 'touch';
        if (touch || isCoarsePointer) {
          keypad.setOpen(false);
          const active = document.activeElement;
          if (active instanceof HTMLInputElement) active.blur();
        }
        // A tap on a curve selects its row (without editing it); away from every curve it
        // deselects.
        const hit = pickAt(sx, sy, touch);
        if (!hit) ui.setSelectedRowId(null);
        if (pointerType === 'mouse' && !hit?.poi) {
          // A mouse traces by hovering; a click (or double-click zoom) must not pin it, except
          // on a point of interest.
          anchor = { mode: 'hover', sx, sy };
          retrace();
          return;
        }
        if (hit) pin(hit, { sx, sy });
        else {
          anchor = null;
          showTrace(null);
        }
      },
      scrubStart(sx, sy) {
        const hit = trace();
        if (anchor?.mode !== 'pinned' || !hit) return false;
        if (Math.hypot(hit.sx - sx, hit.sy - sy) > GRAB_PX) return false;
        scrubRow = hit.rowId;
        return true;
      },
      hold(sx, sy) {
        const hit = pickAt(sx, sy, true);
        if (!hit) return false;
        scrubRow = hit.rowId;
        pin(hit, { sx, sy });
        return true;
      },
      scrub(sx, sy) {
        if (scrubRow === null) return;
        // Along the one curve, however far the finger strays from it.
        const hit = c.trace(sx, sy, Number.POSITIVE_INFINITY, {
          rowId: scrubRow,
          snapPx: SNAP_TOUCH_PX,
        });
        if (hit) pin(hit);
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
      <PoiLayer
        set={poiSet()}
        meets={(poi: Poi) =>
          poi.kinds.includes('intersection') ? poi.with.map((id) => rowText(id)) : []
        }
        onPin={(poi, rowId) => pinPoi?.(poi, rowId)}
        ref={(h) => {
          poiLayer = h;
        }}
      />
      <TraceMarker hit={trace()} kind={traceKind()} />
      <Show when={controller()}>{(c) => <GraphControls controller={c()} />}</Show>
      <Show when={debug}>
        <div class="debug-overlay" ref={debugEl} />
      </Show>
    </div>
  );
}
