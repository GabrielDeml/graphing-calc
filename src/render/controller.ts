import type { PlotItem } from '../engine/types';
import { nearestOnPolyline, nearestPoint, traceExplicit } from '../plot/nearest';
import { SceneCache } from '../plot/scene';
import type { Quality, RowGeometry, Viewport } from '../plot/types';
import {
  homeViewport,
  lerpViewport,
  resizeViewport,
  toScreenX,
  toScreenY,
  viewBounds,
  zoomAt,
} from '../plot/viewport';
import { drawGrid } from './drawGrid';
import { drawScene } from './drawScene';
import { onThemeChange, readTheme, type Theme } from './theme';

export interface SceneRow {
  id: string;
  plot: PlotItem;
  deps: ReadonlySet<string>;
  colorIndex: number;
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
}

const IDLE_MS = 150;

/**
 * Owns the canvas, the viewport and the render loop. Deliberately not reactive: pans and zooms at
 * 60fps never touch Solid; the UI pushes scene changes in through setScene().
 */
export class GraphController {
  view: Viewport;
  onViewChange: ((v: Viewport) => void) | null = null;
  /** Called after every frame (trace re-targeting, debug stats). */
  onDraw: (() => void) | null = null;
  /** Milliseconds spent drawing the last frame (debug overlay). */
  lastFrameMs = 0;

  private ctx: CanvasRenderingContext2D;
  /** Device pixels per CSS pixel of the backing store, per axis. */
  private scale = { x: 1, y: 1 };
  private rows: readonly SceneRow[] = [];
  private values: ReadonlyMap<string, number> = new Map();
  private cache = new SceneCache();
  private geometries = new Map<string, RowGeometry>();
  private theme: Theme;
  private frame = 0;
  private quality: Quality = 'final';
  private idleTimer: ReturnType<typeof setTimeout> | undefined;
  private animation = 0;
  /** Where the running zoom/home animation ends, so repeated presses compose. */
  private animTarget: Viewport | null = null;
  private hasView = false;
  private disposers: Array<() => void> = [];

  constructor(
    private container: HTMLElement,
    private canvas: HTMLCanvasElement,
  ) {
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('Canvas 2D is not available');
    this.ctx = ctx;
    this.theme = readTheme();
    this.view = homeViewport(container.clientWidth || 1, container.clientHeight || 1);

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
    for (const d of this.disposers) d();
  }

  get palette(): readonly string[] {
    return this.theme.palette;
  }

  /** Sampling quality of the current frame (shown in the ?debug overlay). */
  get currentQuality(): Quality {
    return this.quality;
  }

  setScene(rows: readonly SceneRow[], values: ReadonlyMap<string, number>): void {
    // Same plots with new variable values (a slider playing or being dragged): sample the rows
    // that depend on them at interactive quality, then settle to final once the values rest.
    if (sameItems(rows, this.rows) && changedValues(values, this.values)) this.markInteractive();
    this.rows = rows;
    this.values = values;
    this.invalidate();
  }

  /** A view change from user input; it overrides any running zoom/home animation. */
  setView(v: Viewport, interactive = true): void {
    this.cancelAnimation();
    this.applyView(v, interactive);
  }

  /** Animate to a target view (zoom buttons, home). */
  animateTo(target: Viewport, ms = 180): void {
    cancelAnimationFrame(this.animation);
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
    this.animateTo(homeViewport(this.view.width, this.view.height));
  }

  /** Whether a row is in the current scene (a pinned trace drops its anchor when it isn't). */
  hasRow(id: string): boolean {
    return this.rows.some((r) => r.id === id);
  }

  invalidate(): void {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.draw();
    });
  }

  /** Nearest curve point to a screen position, for tracing. */
  trace(sx: number, sy: number, maxDistPx: number): TraceHit | null {
    let best: TraceHit | null = null;
    let bestDist = maxDistPx;
    for (const row of this.rows) {
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
    return best;
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

  private markInteractive(): void {
    this.quality = 'interactive';
    clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      this.quality = 'final';
      this.invalidate();
    }, IDLE_MS);
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
      : homeViewport(width, height);
    this.hasView = true;
    this.onViewChange?.(this.view);
    // Resizing clears the canvas; redraw synchronously to avoid a blank flash.
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.draw();
  }

  private draw(): void {
    const t0 = performance.now();
    const { ctx, view } = this;
    ctx.setTransform(this.scale.x, 0, 0, this.scale.y, 0, 0);
    drawGrid(ctx, view, this.theme, this.scale);

    const drawRows = [];
    const geometries = new Map<string, RowGeometry>();
    for (const row of this.rows) {
      let geometry: RowGeometry;
      try {
        geometry = this.cache.geometry(row, this.values, view, this.quality);
      } catch (err) {
        console.warn('Failed to sample row', row.id, err);
        continue;
      }
      geometries.set(row.id, geometry);
      drawRows.push({
        geometry,
        color: this.theme.palette[row.colorIndex] ?? this.theme.palette[0],
      });
    }
    this.geometries = geometries;
    drawScene(ctx, view, drawRows, this.theme.background);

    const b = viewBounds(view);
    this.container.dataset.view = [b.xmin, b.xmax, b.ymin, b.ymax]
      .map((n) => n.toPrecision(6))
      .join(',');
    this.lastFrameMs = performance.now() - t0;
    this.onDraw?.();
  }
}

function sameItems(a: readonly SceneRow[], b: readonly SceneRow[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].plot !== b[i].plot || a[i].colorIndex !== b[i].colorIndex) return false;
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
