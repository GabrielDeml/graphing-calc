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
  private dpr = 1;
  private rows: readonly SceneRow[] = [];
  private values: ReadonlyMap<string, number> = new Map();
  private cache = new SceneCache();
  private geometries = new Map<string, RowGeometry>();
  private theme: Theme;
  private frame = 0;
  private quality: Quality = 'final';
  private idleTimer: ReturnType<typeof setTimeout> | undefined;
  private animation = 0;
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

  setScene(rows: readonly SceneRow[], values: ReadonlyMap<string, number>): void {
    this.rows = rows;
    this.values = values;
    this.invalidate();
  }

  setView(v: Viewport, interactive = true): void {
    this.view = v;
    if (interactive) this.markInteractive();
    this.onViewChange?.(v);
    this.invalidate();
  }

  /** Animate to a target view (zoom buttons, home). */
  animateTo(target: Viewport, ms = 180): void {
    cancelAnimationFrame(this.animation);
    const from = this.view;
    const start = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / ms);
      const eased = 1 - (1 - t) ** 3;
      this.setView(lerpViewport(from, target, eased, this.view));
      if (t < 1) this.animation = requestAnimationFrame(step);
    };
    this.animation = requestAnimationFrame(step);
  }

  zoomCenter(factor: number): void {
    this.animateTo(zoomAt(this.view, this.view.width / 2, this.view.height / 2, factor));
  }

  home(): void {
    this.animateTo(homeViewport(this.view.width, this.view.height));
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

  private markInteractive(): void {
    this.quality = 'interactive';
    clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      this.quality = 'final';
      this.invalidate();
    }, IDLE_MS);
  }

  private onResize(entry: ResizeObserverEntry | undefined): void {
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;
    if (width === 0 || height === 0) return;
    const dpr = window.devicePixelRatio || 1;
    const devBox = entry?.devicePixelContentBoxSize?.[0];
    const devW = devBox ? devBox.inlineSize : Math.round(width * dpr);
    const devH = devBox ? devBox.blockSize : Math.round(height * dpr);
    this.dpr = devW / width;
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
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    drawGrid(ctx, view, this.theme, this.dpr);

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
