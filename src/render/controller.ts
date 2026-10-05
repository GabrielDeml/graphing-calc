import type { PlotItem } from '../engine/types';
import { nearestOnPolyline, nearestPoint, traceExplicit } from '../plot/nearest';
import { findPois, type Poi, type PoiCurve } from '../plot/poi';
import { SceneCache } from '../plot/scene';
import type { Quality, RowGeometry, ViewCenter, Viewport } from '../plot/types';
import {
  clampViewport,
  homeViewport,
  lerpViewport,
  resizeViewport,
  toScreenX,
  toScreenY,
  viewBounds,
  viewKey,
  zoomAt,
} from '../plot/viewport';
import { drawGrid } from './drawGrid';
import { type DrawRow, drawScene } from './drawScene';
import { onThemeChange, readTheme, type Theme } from './theme';

export interface SceneRow {
  id: string;
  plot: PlotItem;
  deps: ReadonlySet<string>;
  colorIndex: number;
  /**
   * The row is broken while it is being edited, and this is its last good plot: drawn faintly,
   * never traced, never a point of interest.
   */
  ghost?: boolean;
}

export interface TraceHit {
  rowId: string;
  x: number;
  y: number;
  sx: number;
  sy: number;
  color: string;
  /** Pixels per unit at trace time (sets the label precision). */
  ppu: number;
  viewWidth: number;
  viewHeight: number;
  /** The trace snapped to this point of interest. */
  poi?: Poi;
}

export interface TraceOptions {
  /** Trace only this row (scrubbing along one curve). */
  rowId?: string;
  /** Snap to a point of interest of the traced curve within this many px of (sx, sy). */
  snapPx?: number;
}

const reducedMotion =
  typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;

const IDLE_MS = 150;
/** Points of interest of a row being typed into wait until the typing pauses this long. */
const POI_SETTLE_MS = 250;
/** Typing switches to interactive quality after a frame slower than this… */
const HEAVY_FRAME_MS = 16;
/** …and settles to final quality once it pauses this long. */
const TYPING_IDLE_MS = 300;

/**
 * Owns the canvas, the viewport and the render loop. Deliberately not reactive: pans and zooms at
 * 60fps never touch Solid; the UI pushes scene changes in through setScene().
 */
export class GraphController {
  view: Viewport;
  onViewChange: ((v: Viewport) => void) | null = null;
  /** Called after every frame (trace re-targeting, debug stats). */
  onDraw: (() => void) | null = null;
  /**
   * Called when the points of interest change: found for the emphasised row (in `view`, at
   * final quality), or gone because what they were found on changed. They are world points, so
   * they stay valid while the view moves.
   */
  onPois: ((pois: readonly Poi[], view: Viewport, rowId: string | null) => void) | null = null;
  /** Milliseconds spent drawing the last frame (debug overlay). */
  lastFrameMs = 0;

  private ctx: CanvasRenderingContext2D;
  /** Device pixels per CSS pixel of the backing store, per axis. */
  private scale = { x: 1, y: 1 };
  private rows: readonly SceneRow[] = [];
  private values: ReadonlyMap<string, number> = new Map();
  private cache = new SceneCache();
  private geometries = new Map<string, RowGeometry>();
  /** The view `geometries` were sampled for. */
  private drawnView: Viewport | null = null;
  private theme: Theme;
  private frame = 0;
  private quality: Quality = 'final';
  private idleTimer: ReturnType<typeof setTimeout> | undefined;
  private animation = 0;
  /** Where the running zoom/home animation ends, so repeated presses compose. */
  private animTarget: Viewport | null = null;
  private hasView = false;
  /** When the last resize was drawn: a quick run of them (a list edge drag) is a gesture. */
  private lastResize = -Infinity;
  /** The view is the home view, or animating to it (a restored or moved view is not). */
  private isHome: boolean;
  private disposers: Array<() => void> = [];
  /** The row drawn on top, thicker, whose points of interest are found. */
  private emphasis: string | null = null;
  private pois: readonly Poi[] = [];
  /** What the current points of interest were found on (null: none were). */
  private poiInputs: { view: string; plots: PlotItem[]; values: string; id: string } | null = null;
  /** Until when the points of interest wait for typing to pause. */
  private poiSettle = 0;
  private poiTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private container: HTMLElement,
    private canvas: HTMLCanvasElement,
    /** Where to start instead of the home view (the last session's view). */
    private initialView: ViewCenter | null = null,
  ) {
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('Canvas 2D is not available');
    this.ctx = ctx;
    this.theme = readTheme();
    this.isHome = initialView === null;
    this.view = this.startView(container.clientWidth || 1, container.clientHeight || 1);

    const ro = new ResizeObserver((entries) => this.onResize(entries[0]));
    try {
      ro.observe(container, { box: 'device-pixel-content-box' });
    } catch {
      ro.observe(container);
    }
    this.disposers.push(() => ro.disconnect());
    this.disposers.push(
      onThemeChange(() => {
        this.theme = readTheme();
        this.invalidate();
      }),
    );
  }

  destroy(): void {
    cancelAnimationFrame(this.frame);
    cancelAnimationFrame(this.animation);
    clearTimeout(this.idleTimer);
    clearTimeout(this.poiTimer);
    for (const d of this.disposers) d();
  }

  get palette(): readonly string[] {
    return this.theme.palette;
  }

  /** Sampling quality of the current frame (shown in the ?debug overlay). */
  get currentQuality(): Quality {
    return this.quality;
  }

  /**
   * Whether the view is the home view (or animating to it). Resizes keep a view's center and
   * scale, so this is what a saved view should remember rather than the numbers: home follows
   * the window it is restored into.
   */
  get atHome(): boolean {
    return this.isHome;
  }

  /**
   * `typing`: the change comes from editing a row, and every keystroke makes new plots. Once a
   * frame is slow (a heavy implicit row), they are sampled at interactive quality while the
   * typing goes on and at final quality when it pauses, instead of at final quality per key.
   */
  setScene(rows: readonly SceneRow[], values: ReadonlyMap<string, number>, typing = false): void {
    if (sameItems(rows, this.rows)) {
      // Same plots with new variable values (a slider playing or being dragged): sample the rows
      // that depend on them at interactive quality, then settle to final once the values rest.
      if (changedValues(values, this.values)) this.markInteractive();
    } else {
      if (typing && (this.quality === 'interactive' || this.lastFrameMs > HEAVY_FRAME_MS)) {
        this.markInteractive(TYPING_IDLE_MS);
      }
      // Points of interest blooming at every keystroke would be busy: they wait for a pause.
      if (typing) {
        this.poiSettle = performance.now() + POI_SETTLE_MS;
        clearTimeout(this.poiTimer);
        this.poiTimer = setTimeout(() => this.invalidate(), POI_SETTLE_MS);
      }
    }
    this.rows = rows;
    this.values = values;
    this.invalidate();
  }

  /** The row to draw on top, thicker, and find points of interest on (null for none). */
  setEmphasis(id: string | null): void {
    if (id === this.emphasis) return;
    this.emphasis = id;
    this.invalidate();
  }

  /**
   * Find the emphasised row's points of interest now rather than on the next frame, from the
   * last frame's curves, so a tap that has just picked a curve can snap to one of them.
   */
  refreshPois(): void {
    if (this.drawnView === this.view) this.updatePois();
  }

  /** A view change from user input; it overrides any running zoom/home animation. */
  setView(v: Viewport, interactive = true): void {
    this.cancelAnimation();
    this.isHome = false;
    this.applyView(v, interactive);
  }

  /**
   * Animate to a target view (zoom buttons, home); a jump when motion is reduced. `home`: the
   * target is the home view, set before the first frame so even a jump reports it as home.
   */
  animateTo(target: Viewport, ms = 180, home = false): void {
    cancelAnimationFrame(this.animation);
    this.isHome = home;
    if (reducedMotion?.matches) {
      this.cancelAnimation();
      this.applyView(target);
      return;
    }
    const from = this.view;
    const start = performance.now();
    this.animTarget = target;
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / ms);
      const eased = 1 - (1 - t) ** 3;
      this.applyView(lerpViewport(from, target, eased, this.view));
      if (t < 1) this.animation = requestAnimationFrame(step);
      else this.cancelAnimation();
    };
    this.animation = requestAnimationFrame(step);
  }

  /**
   * Jump to the end of a running animation. Gestures, wheel and keys call this before reading
   * `view`, so input during a zoom applies on top of the zoom instead of being overwritten.
   */
  settle(): void {
    const target = this.animTarget;
    if (!target) return;
    this.cancelAnimation();
    this.applyView(lerpViewport(target, target, 1, this.view));
  }

  /** Zoom about the center; a press during an animation zooms from where that one ends. */
  zoomCenter(factor: number): void {
    const base = this.animTarget ?? this.view;
    this.animateTo(zoomAt(base, base.width / 2, base.height / 2, factor));
  }

  home(): void {
    this.animateTo(homeViewport(this.view.width, this.view.height), undefined, true);
  }

  /** Whether a row is in the current scene (a pinned trace drops its anchor when it isn't). */
  hasRow(id: string): boolean {
    return this.rows.some((r) => r.id === id && !r.ghost);
  }

  invalidate(): void {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.draw();
    });
  }

  /**
   * Nearest curve point to a screen position, for tracing, snapped to a point of interest of
   * that curve near the position (see TraceOptions).
   */
  trace(sx: number, sy: number, maxDistPx: number, opts: TraceOptions = {}): TraceHit | null {
    let best: TraceHit | null = null;
    let bestDist = maxDistPx;
    for (const row of this.rows) {
      if (row.ghost || (opts.rowId !== undefined && row.id !== opts.rowId)) continue;
      const geom = this.geometries.get(row.id);
      if (!geom) continue;
      const plot = row.plot;
      let hit = null;
      if ((plot.kind === 'explicitY' || plot.kind === 'explicitX') && !plot.ineq) {
        hit = traceExplicit(
          plot.f,
          this.view,
          plot.kind === 'explicitY' ? 'x' : 'y',
          sx,
          sy,
          bestDist,
        );
      }
      for (const curve of geom.curves) {
        const h = nearestOnPolyline(curve, this.view, sx, sy, bestDist);
        if (h && (!hit || h.distPx < hit.distPx)) hit = h;
      }
      if (geom.points) {
        const h = nearestPoint(geom.points, this.view, sx, sy, Math.max(bestDist, 16));
        if (h && (!hit || h.distPx < hit.distPx)) hit = h;
      }
      if (hit && hit.distPx <= bestDist) {
        bestDist = hit.distPx;
        best = {
          rowId: row.id,
          x: hit.x,
          y: hit.y,
          sx: toScreenX(this.view, hit.x),
          sy: toScreenY(this.view, hit.y),
          color: this.theme.palette[row.colorIndex] ?? this.theme.palette[0],
          ppu: this.view.ppuX,
          viewWidth: this.view.width,
          viewHeight: this.view.height,
        };
      }
    }
    return best && opts.snapPx ? this.snap(best, sx, sy, opts.snapPx) : best;
  }

  /** The hit moved onto the nearest point of interest on its curve within snapPx of (sx, sy). */
  private snap(hit: TraceHit, sx: number, sy: number, snapPx: number): TraceHit {
    const own = this.poiInputs?.id === hit.rowId;
    let best: Poi | null = null;
    let bestDist = snapPx;
    for (const poi of this.pois) {
      if (!own && !poi.with.includes(hit.rowId)) continue;
      const d = Math.hypot(toScreenX(this.view, poi.x) - sx, toScreenY(this.view, poi.y) - sy);
      if (d <= bestDist) {
        bestDist = d;
        best = poi;
      }
    }
    if (!best) return hit;
    return {
      ...hit,
      x: best.x,
      y: best.y,
      sx: toScreenX(this.view, best.x),
      sy: toScreenY(this.view, best.y),
      poi: best,
    };
  }

  private startView(width: number, height: number): Viewport {
    const v = this.initialView;
    return v ? clampViewport({ ...v, width, height }) : homeViewport(width, height);
  }

  private applyView(v: Viewport, interactive = true): void {
    this.view = v;
    if (interactive) this.markInteractive();
    this.onViewChange?.(v);
    this.invalidate();
  }

  private cancelAnimation(): void {
    cancelAnimationFrame(this.animation);
    this.animation = 0;
    this.animTarget = null;
  }

  private markInteractive(idleMs = IDLE_MS): void {
    this.quality = 'interactive';
    clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      this.quality = 'final';
      this.invalidate();
    }, idleMs);
  }

  private onResize(entry: ResizeObserverEntry | undefined): void {
    // Fractional CSS size: grid rows often give the graph heights like 461.4375px.
    const box = entry?.contentBoxSize?.[0];
    const rect = box ? null : this.container.getBoundingClientRect();
    const width = box ? box.inlineSize : (rect as DOMRect).width;
    const height = box ? box.blockSize : (rect as DOMRect).height;
    if (!(width > 0 && height > 0)) return;
    const dpr = window.devicePixelRatio || 1;
    // The exact device-pixel box gives crisp 1:1 pixels, but only trust it when it agrees with
    // devicePixelRatio (Chromium's DPR emulation reports it in CSS pixels).
    const devBox = entry?.devicePixelContentBoxSize?.[0];
    const exact = devBox && Math.abs(devBox.inlineSize / width - dpr) < 0.05;
    const devW = exact ? devBox.inlineSize : Math.max(1, Math.round(width * dpr));
    const devH = exact ? devBox.blockSize : Math.max(1, Math.round(height * dpr));
    // Separate scales so the drawing covers the whole backing store (no unpainted edge row).
    this.scale = { x: devW / width, y: devH / height };
    this.canvas.width = devW;
    this.canvas.height = devH;
    this.view = this.hasView
      ? resizeViewport(this.view, width, height)
      : this.startView(width, height);
    this.hasView = true;
    // Resizes in quick succession (dragging the list's edge, resizing the window) sample at
    // interactive quality, like a pan, and settle to final once they stop.
    if (performance.now() - this.lastResize < IDLE_MS) this.markInteractive();
    this.onViewChange?.(this.view);
    // Resizing clears the canvas; redraw synchronously to avoid a blank flash.
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.draw();
    // After drawing, so a slow frame doesn't break up the run.
    this.lastResize = performance.now();
  }

  private draw(): void {
    const t0 = performance.now();
    const { ctx, view } = this;
    ctx.setTransform(this.scale.x, 0, 0, this.scale.y, 0, 0);
    drawGrid(ctx, view, this.theme, this.scale);

    const drawRows: DrawRow[] = [];
    const geometries = new Map<string, RowGeometry>();
    for (const row of this.rows) {
      let geometry: RowGeometry;
      try {
        geometry = this.cache.geometry(row, this.values, view, this.quality);
      } catch (err) {
        console.warn('Failed to sample row', row.id, err);
        continue;
      }
      if (!row.ghost) geometries.set(row.id, geometry);
      drawRows.push({
        geometry,
        color: this.theme.palette[row.colorIndex] ?? this.theme.palette[0],
        ghost: row.ghost,
        emphasis: !row.ghost && row.id === this.emphasis,
      });
    }
    this.geometries = geometries;
    this.drawnView = view;
    drawScene(ctx, view, drawRows, this.theme.background);

    const b = viewBounds(view);
    this.container.dataset.view = [b.xmin, b.xmax, b.ymin, b.ymax]
      .map((n) => n.toPrecision(6))
      .join(',');
    this.lastFrameMs = performance.now() - t0;
    this.updatePois();
    this.onDraw?.();
  }

  /**
   * Find the emphasised row's points of interest when what they depend on changed: at final
   * quality only, and not while typing goes on. Old points stay while only the view moves (they
   * are world points) and go as soon as the plots or values they were found on change.
   */
  private updatePois(): void {
    const row = this.rows.find((r) => r.id === this.emphasis && !r.ghost);
    const geometry = row && this.geometries.get(row.id);
    if (!row || !geometry) {
      this.setPois([], null);
      return;
    }
    const others = this.rows.filter((r) => !r.ghost && r !== row && this.geometries.has(r.id));
    const plots = [row.plot, ...others.map((r) => r.plot)];
    let values = '';
    for (const r of [row, ...others]) {
      for (const dep of r.deps) values += `|${this.values.get(dep)}`;
    }
    const view = viewKey(this.view);
    const last = this.poiInputs;
    const same =
      last !== null &&
      last.id === row.id &&
      last.values === values &&
      last.plots.length === plots.length &&
      last.plots.every((p, i) => p === plots[i]);
    if (same && last.view === view) return;
    const ready = this.quality === 'final' && performance.now() >= this.poiSettle;
    if (!ready) {
      if (!same) this.setPois([], null);
      return;
    }
    const curve = (r: SceneRow): PoiCurve => ({
      id: r.id,
      plot: r.plot,
      geometry: this.geometries.get(r.id) as RowGeometry,
    });
    let pois: Poi[] = [];
    try {
      pois = findPois(curve(row), others.map(curve), this.view);
    } catch (err) {
      console.warn('Failed to find points of interest', row.id, err);
    }
    this.setPois(pois, { view, plots, values, id: row.id });
  }

  private setPois(pois: readonly Poi[], inputs: GraphController['poiInputs']): void {
    this.poiInputs = inputs;
    if (pois.length === 0 && this.pois.length === 0) return;
    this.pois = pois;
    this.onPois?.(pois, this.view, inputs?.id ?? null);
  }
}

function sameItems(a: readonly SceneRow[], b: readonly SceneRow[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (
      a[i].plot !== b[i].plot ||
      a[i].colorIndex !== b[i].colorIndex ||
      !a[i].ghost !== !b[i].ghost
    ) {
      return false;
    }
  }
  return true;
}

function changedValues(a: ReadonlyMap<string, number>, b: ReadonlyMap<string, number>): boolean {
  if (a === b) return false;
  if (a.size !== b.size) return true;
  for (const [name, v] of a) {
    const w = b.get(name);
    if (!(v === w || (Number.isNaN(v) && Number.isNaN(w)))) return true;
  }
  return false;
}
