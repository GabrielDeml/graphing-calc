import {
  batch,
  createEffect,
  createMemo,
  createSignal,
  on,
  onCleanup,
  onMount,
  Show,
} from 'solid-js';
import { attachGestures } from '../interaction/gestures';
import type { Poi, PoiKind } from '../plot/poi';
import { isStraight, pointRow, slopeAt, tangentRow } from '../plot/tangent';
import { GraphController, type SceneRow, type TraceHit } from '../render/controller';
import { analysis, steadyRows } from '../state/analysis';
import { noteView } from '../state/autosave';
import { doc } from '../state/doc';
import { offerUndo } from '../state/historyUi';
import { isCoarsePointer, keypad } from '../state/keypad';
import { savedState } from '../state/persist';
import { addTraceRow } from '../state/rowActions';
import { palette } from '../state/theme';
import { ui } from '../state/ui';
import { GraphControls } from './GraphControls';
import { PoiLayer, type PoiLayerHandle, type PoiSet } from './PoiLayer';
import { type Rect, type TraceActions, type TraceKind, TraceMarker } from './TraceMarker';

const debug = typeof location !== 'undefined' && new URLSearchParams(location.search).has('debug');

/** How close (px) the pointer must come to a point of interest for the trace to snap to it. */
const SNAP_PX = 10;
/** The same for a finger, which hides what it is on. */
const SNAP_TOUCH_PX = 16;
/** Hovering traces a curve this close to the pointer. */
const HOVER_PX = 20;
/** A click this close to a curve selects it; farther out it deselects (a mouse is precise). */
const PICK_PX = 8;
/** A tap this close to a curve selects it. */
const PICK_TOUCH_PX = 32;
/** A drag from this close to the pinned trace's dot scrubs along its curve. */
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
       * interest were not found yet: when they are (the next search), the pin snaps to one near
       * it.
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
  /** A finger is scrubbing along the traced curve. */
  const [scrubbing, setScrubbing] = createSignal(false);
  /** The trace is pinned (not following a hovering mouse). */
  const [pinned, setPinned] = createSignal(false);
  /** Where the floating controls are, for the trace pill to keep clear of. */
  const [controlsBox, setControlsBox] = createSignal<Rect | null>(null);
  const watchControls = (el: HTMLElement) => {
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => {
      const [left, top] = [el.offsetLeft, el.offsetTop];
      setControlsBox({ left, top, right: left + el.offsetWidth, bottom: top + el.offsetHeight });
    });
    // Its own size, and the graph's (it sits at the graph's right edge).
    ro.observe(el);
    ro.observe(container);
    onCleanup(() => ro.disconnect());
  };

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

  /**
   * At a pinned point of an explicit curve: "Tangent here" adds the tangent line there (its slope
   * by central differences; not on a line, its own tangent), "Keep point" the point, as rows
   * below the curve's, written as the trace shows the numbers. On touch, with no undo key, a
   * toast offers to undo it; a second tap adds nothing more.
   */
  const traceActions = createMemo((): TraceActions | null => {
    const hit = trace();
    if (!hit || !pinned() || scrubbing()) return null;
    const res = analysis().byId.get(hit.rowId);
    const plot = res?.status === 'ok' ? res.plot : undefined;
    if (plot?.kind !== 'explicitY' && plot?.kind !== 'explicitX') return null;
    const variable = plot.kind === 'explicitY' ? 'x' : 'y';
    const [u, v] = variable === 'x' ? [hit.x, hit.y] : [hit.y, hit.x];
    const m = slopeAt(plot.f, u);
    const { rowId, x, y, ppu } = hit;
    const span = Math.hypot(hit.viewWidth, hit.viewHeight);
    const add = (source: string, message: string) => {
      if (addTraceRow(rowId, source) && isCoarsePointer) offerUndo(message);
    };
    return {
      tangent:
        m === null || isStraight(plot.f, u, m)
          ? undefined
          : () => add(tangentRow(variable, u, v, m, { ppu, span }), 'Added tangent'),
      keep: () => add(pointRow(x, y, ppu), 'Added point'),
    };
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
      batch(() => {
        setTrace(hit);
        setPinned(hit !== null && anchor?.mode === 'pinned');
        ui.setTracedRowId(hit?.rowId ?? null);
      });
    };
    const pin = (hit: TraceHit, seek?: { sx: number; sy: number }) => {
      anchor = { mode: 'pinned', x: hit.x, y: hit.y, rowId: hit.rowId };
      if (seek) {
        anchor.seek = {
          x: c.view.cx + (seek.sx - c.view.width / 2) / c.view.ppuX,
          y: c.view.cy + (c.view.height / 2 - seek.sy) / c.view.ppuY,
        };
      }
      showTrace(hit);
    };
    /** Pin where a finger picked a curve, and look for a point there once its points are in. */
    const pinPick = (hit: TraceHit, sx: number, sy: number) =>
      pin(hit, hit.poi || c.poisReady(hit.rowId) ? undefined : { sx, sy });

    // Re-run the trace after every redraw so it follows pans, zooms and animating sliders.
    const retrace = () => {
      if (!anchor) {
        if (trace()) showTrace(null);
        return;
      }
      if (anchor.mode === 'hover') {
        showTrace(c.trace(anchor.sx, anchor.sy, HOVER_PX, { snapPx: SNAP_PX }));
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
        const hit = c.trace(sx, sy, PICK_TOUCH_PX, { rowId: anchor.rowId, snapPx: 1 });
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
      const hit = c.trace(sx, sy, PICK_TOUCH_PX, { rowId, snapPx: 1 });
      if (hit) pin(hit);
    };
    c.onPois = (pois, view, rowId, stale) => {
      setPoiSet(pois.length > 0 && rowId !== null ? { rowId, pois, view, stale } : null);
      if (stale || anchor?.mode !== 'pinned' || !anchor.seek) return;
      // The first search since a tap picked a curve: snap the pin to a point near the tap, if
      // it found one on that curve. Either way the tap stops looking (a later zoom or slider
      // must not move the pin).
      const { seek } = anchor;
      anchor.seek = undefined;
      if (anchor.rowId !== rowId) return;
      const sx = (seek.x - c.view.cx) * c.view.ppuX + c.view.width / 2;
      const sy = c.view.height / 2 - (seek.y - c.view.cy) * c.view.ppuY;
      const hit = c.trace(sx, sy, PICK_TOUCH_PX, { rowId, snapPx: SNAP_TOUCH_PX });
      if (hit?.poi) pin(hit);
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

    // Deselecting (Esc, or the selected row going away) lets go of a pinned trace too, as a tap
    // on empty graph does.
    createEffect(
      on(
        ui.selectedRowId,
        (id) => {
          if (id !== null || anchor?.mode !== 'pinned') return;
          anchor = null;
          showTrace(null);
        },
        { defer: true },
      ),
    );

    /** On a phone, a tap or a hold on the graph puts the keypad away and finishes editing. */
    const leaveEditing = () => {
      keypad.setOpen(false);
      const active = document.activeElement;
      if (active instanceof HTMLInputElement) active.blur();
    };

    /**
     * The curve under a press or click (a finger gets more room), which becomes the selected
     * row. A finger also snaps to one of its points of interest, found for it right away, so a
     * tap meant for a root lands on it; a mouse snaps only to the rings it can see.
     */
    const pickAt = (sx: number, sy: number, touch: boolean) => {
      const snapPx = touch ? SNAP_TOUCH_PX : SNAP_PX;
      const hit = c.trace(sx, sy, touch ? PICK_TOUCH_PX : PICK_PX, { snapPx });
      if (!hit) return null;
      ui.pickRow(hit.rowId);
      if (!touch || hit.poi) return hit;
      c.refreshPois();
      return c.trace(sx, sy, PICK_TOUCH_PX, { snapPx, rowId: hit.rowId }) ?? hit;
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
        if (touch || isCoarsePointer) leaveEditing();
        // A tap on a curve selects its row (without editing it); away from every curve it
        // deselects.
        const selected = ui.selectedRowId();
        const hit = pickAt(sx, sy, touch);
        if (!hit) ui.setSelectedRowId(null);
        if (pointerType === 'mouse' && !hit?.poi && hit?.rowId !== selected) {
          // A mouse traces by hovering; a click that picks a curve (or a double-click zoom)
          // must not pin it, except on a point of interest it can see. A click on the curve
          // already selected pins it there (for its one-tap actions).
          anchor = { mode: 'hover', sx, sy };
          retrace();
          return;
        }
        if (hit) pinPick(hit, sx, sy);
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
        // What the tap this press is no longer would have done.
        leaveEditing();
        scrubRow = hit.rowId;
        setScrubbing(true);
        pinPick(hit, sx, sy);
        return true;
      },
      scrub(sx, sy) {
        if (scrubRow === null) return;
        setScrubbing(true);
        // Along the one curve, however far the finger strays from it.
        const hit = c.trace(sx, sy, Number.POSITIVE_INFINITY, {
          rowId: scrubRow,
          snapPx: SNAP_TOUCH_PX,
        });
        if (hit) pin(hit);
      },
      scrubEnd() {
        scrubRow = null;
        setScrubbing(false);
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
        current={trace()?.poi ?? null}
        meets={(poi: Poi) =>
          poi.kinds.includes('intersection') ? poi.with.map((id) => rowText(id)) : []
        }
        onPin={(poi, rowId) => pinPoi?.(poi, rowId)}
        ref={(h) => {
          poiLayer = h;
        }}
      />
      <TraceMarker
        hit={trace()}
        kind={traceKind()}
        scrubbing={scrubbing()}
        actions={traceActions()}
        avoid={controlsBox()}
      />
      <Show when={controller()}>
        {(c) => <GraphControls controller={c()} ref={watchControls} />}
      </Show>
      <Show when={debug}>
        <div class="debug-overlay" ref={debugEl} />
      </Show>
    </div>
  );
}
