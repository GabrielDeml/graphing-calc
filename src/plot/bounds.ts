// Where a curve is: the box around what a row draws, for Zoom to fit and for framing a curve that
// appears out of sight. Found from samples of the row's functions, not from the drawn polylines:
// a fit has to see what is off screen too.
//
//   - y = f(x) (and x = f(y)): what is worth seeing of it over the x the view shows (or, where f
//     is nowhere defined there, over wider and wider ranges around it): where it crosses the x
//     axis, turns, meets the y axis and ends. A curve with no end has no box of its own, and the
//     whole of x³ over the view would make a fit fly out a thousandfold to show its height. One
//     with none of these (1/x) is boxed by its values, kept robust: the tail a pole leaves (1/x
//     near 0) is no part of the box, or a fit would fly off to it, as it would to a pole's peak;
//   - parametric and polar curves: their whole parameter range, as drawn, just as robust;
//   - points: their coordinates;
//   - an implicit curve F = 0: where F changes sign on grids from the view outwards (and then
//     down into where |F| was least, for a curve too small to show on those grids: a small
//     circle far off). A curve that runs out of every square tried (a line, a hyperbola) has no
//     box of its own: the part in the first square it shows in stands for it.
// A box of a curve that goes on past it (y = f(x), a line) is `open`: where it is worth seeing,
// not all of it. fitViewport turns a box into a view that shows it with some room around,
// equally scaled; fitCurves does so for several, an open one counted at least so big.

import type { Fn1, Fn2, PlotItem } from '../engine/types';
import { parameterWindow } from './sampleParametric';
import type { Bounds, RowGeometry, Viewport } from './types';
import { clampViewport, viewBounds } from './viewport';

/** Samples of a function or a parameter range. */
const SAMPLES = 1024;
/** Share of the values left out at each end before the fences (see robustRange). */
const CLIP = 0.05;
/** Wider ranges (×4 each) tried for y = f(x) defined nowhere in view, and for implicit curves. */
const MAX_WIDEN = 8;
/** Grids (each GRID / 4 times finer) tried down into where |F| was least, for a tiny curve. */
const MAX_NARROW = 6;
/** Cells of an implicit search grid, per side. */
const GRID = 64;
/**
 * Evaluations of F an implicit search may make, so a search that finds nothing (x² + y² = −1,
 * sin(xy) = 2) is over in a few milliseconds: every grid outwards and down, about.
 */
const IMPLICIT_BUDGET = (MAX_WIDEN + 1 + MAX_NARROW) * (GRID + 1) ** 2;
/** Bisection steps on a grid edge where F changes sign. */
const EDGE_STEPS = 24;
/** A sign change is a crossing once |F| falls below this fraction of its values at the ends. */
const CROSS_RATIO = 1e-2;
/** Room kept around a fitted box: this share of the view's shorter side, and at least… */
const FIT_MARGIN = 0.08;
/** …this many px (the controls float over the top right corner). */
const FIT_MARGIN_PX = 32;
/**
 * How big an open curve's box counts as at least, in a fit: a quarter of what the home view
 * shows across (src/plot/viewport.ts: 20 units).
 */
export const FIT_MIN_OPEN = 5;
/** World-aligned offset, irrational so periodic functions cannot alias with the samples. */
const PHI = 0.3819660112501051;

/** n + 1 samples over [lo, hi]: both ends, and the inside offset by PHI of a step. */
function samples(lo: number, hi: number, n = SAMPLES): Float64Array {
  const h = (hi - lo) / (n - 2 + 2 * PHI);
  const out = new Float64Array(n + 1);
  for (let i = 0; i <= n; i++) out[i] = i <= 0 ? lo : i >= n ? hi : lo + h * (i - 1 + PHI);
  return out;
}

/**
 * The range of `values` without the outliers a pole leaves: the middle 90% of them, and the rest
 * only as far again beyond that as the middle spans. Null when there are none.
 */
export function robustRange(values: ArrayLike<number>): [number, number] | null {
  const n = values.length;
  if (n === 0) return null;
  const sorted = Float64Array.from(values).sort();
  const lo = sorted[Math.floor(CLIP * (n - 1))];
  const hi = sorted[Math.ceil((1 - CLIP) * (n - 1))];
  const reach = hi - lo;
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const v of sorted) {
    if (v < lo - reach || v > hi + reach) continue;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return [min, max];
}

/** The box of points (xs[i], ys[i]) (finite ones), robust on both axes. */
function robustBox(xs: ArrayLike<number>, ys: ArrayLike<number>): Bounds | null {
  const fx: number[] = [];
  const fy: number[] = [];
  for (let i = 0; i < xs.length; i++) {
    if (Number.isFinite(xs[i]) && Number.isFinite(ys[i])) {
      fx.push(xs[i]);
      fy.push(ys[i]);
    }
  }
  const rx = robustRange(fx);
  const ry = robustRange(fy);
  if (!rx || !ry) return null;
  let box: Bounds | null = null;
  for (let i = 0; i < fx.length; i++) {
    if (fx[i] >= rx[0] && fx[i] <= rx[1] && fy[i] >= ry[0] && fy[i] <= ry[1]) {
      box = extend(box, fx[i], fy[i]);
    }
  }
  return box;
}

/** Where a curve is, as seen from a view: its box, and whether it goes on past it (`open`). */
export interface CurveBounds {
  box: Bounds;
  open: boolean;
}

function extend(box: Bounds | null, x: number, y: number): Bounds {
  if (!box) return { xmin: x, xmax: x, ymin: y, ymax: y };
  return {
    xmin: Math.min(box.xmin, x),
    xmax: Math.max(box.xmax, x),
    ymin: Math.min(box.ymin, y),
    ymax: Math.max(box.ymax, y),
  };
}

/** The box holding both (either may be missing). */
export function unionBounds(a: Bounds | null, b: Bounds | null): Bounds | null {
  if (!a) return b;
  if (!b) return a;
  return {
    xmin: Math.min(a.xmin, b.xmin),
    xmax: Math.max(a.xmax, b.xmax),
    ymin: Math.min(a.ymin, b.ymin),
    ymax: Math.max(a.ymax, b.ymax),
  };
}

/**
 * What is worth seeing of v = f(u) on samples (us, vs), as points (u, v): where it crosses v = 0
 * (refined; a pole's change of sign is none), turns, meets u = 0, and ends (next to a sample where
 * it is undefined). All but the crossings must lie in the robust range of the values, so a pole's
 * peak (1/x² near 0) is none either.
 */
function features(f: Fn1, us: Float64Array, vs: Float64Array): { u: number; v: number }[] {
  const out: { u: number; v: number }[] = [];
  const finite: number[] = [];
  for (const v of vs) if (Number.isFinite(v)) finite.push(v);
  const range = robustRange(finite);
  if (!range) return out;
  const keep = (u: number, v: number) => {
    if (v >= range[0] && v <= range[1]) out.push({ u, v });
  };
  const n = us.length;
  if (us[0] <= 0 && us[n - 1] >= 0) {
    const v0 = f(0);
    if (Number.isFinite(v0)) keep(0, v0);
  }
  for (let i = 0; i < n; i++) {
    const v = vs[i];
    if (!Number.isFinite(v)) continue;
    // On the axis (a run of it, floor x over [0, 1), only where the run starts and ends).
    if (v === 0 && !(vs[i - 1] === 0 && vs[i + 1] === 0)) out.push({ u: us[i], v: 0 });
    const prev = vs[i - 1];
    const next = vs[i + 1];
    if ((i > 0 && !Number.isFinite(prev)) || (i < n - 1 && !Number.isFinite(next))) keep(us[i], v);
    // (Between finite values: next to a sample on a pole (1/x at 0) is no crossing.)
    if (Number.isFinite(next) && ((v < 0 && next > 0) || (v > 0 && next < 0))) {
      const u = edgeRoot(f, us[i], v, us[i + 1], next);
      if (u !== null) out.push({ u, v: 0 });
    }
    if (i > 0 && i < n - 1 && (v - prev) * (next - v) < 0) keep(us[i], v);
  }
  return out;
}

/**
 * v = f(u) over the u the view shows, or the nearest wider range where f is defined at all: the
 * box of its features there, else of its values. Open unless f ends on both sides in the range
 * (√(4 − x²)).
 */
function explicitBounds(f: Fn1, axis: 'x' | 'y', view: Bounds): CurveBounds | null {
  const [lo, hi] = axis === 'x' ? [view.xmin, view.xmax] : [view.ymin, view.ymax];
  const mid = (lo + hi) / 2;
  // A few samples past the ends, so a turn right at one (where a fit put it) is seen as one.
  const half = ((hi - lo) / 2) * (1 + 4 / SAMPLES);
  for (let k = 0; k <= MAX_WIDEN; k++) {
    const us = samples(mid - half * 4 ** k, mid + half * 4 ** k);
    const vs = us.map(f);
    let box: Bounds | null = null;
    for (const { u, v } of features(f, us, vs)) {
      box = axis === 'x' ? extend(box, u, v) : extend(box, v, u);
    }
    box ??= axis === 'x' ? robustBox(us, vs) : robustBox(vs, us);
    if (box) return { box, open: Number.isFinite(vs[0]) || Number.isFinite(vs[vs.length - 1]) };
  }
  return null;
}

function pathBounds(x: Fn1, y: Fn1, min: number, max: number): CurveBounds | null {
  // Over the parameter range drawn.
  const range = parameterWindow(min, max);
  if (!range) return null;
  const ts = samples(range[0], range[1], 4 * SAMPLES);
  const box = robustBox(ts.map(x), ts.map(y));
  return box && { box, open: false };
}

/** A root of g between a and b (g(a), g(b) of opposite signs), or null where g only jumps there. */
function edgeRoot(g: Fn1, a: number, ga: number, b: number, gb: number): number | null {
  let lo = a;
  let hi = b;
  let glo = ga;
  for (let i = 0; i < EDGE_STEPS; i++) {
    const m = 0.5 * (lo + hi);
    const gm = g(m);
    if (!Number.isFinite(gm)) return null;
    if (gm === 0) return m;
    if (gm < 0 === glo < 0) {
      lo = m;
      glo = gm;
    } else hi = m;
  }
  const m = 0.5 * (lo + hi);
  return Math.abs(g(m)) <= CROSS_RATIO * Math.max(Math.abs(ga), Math.abs(gb)) ? m : null;
}

/** A grid point where |F| was least, and its grid's cell (the size of a square to look in). */
interface Low {
  x: number;
  y: number;
  size: number;
  cell: number;
}

/**
 * The box of the points where F changes sign on a GRID × GRID grid over `sq`, and the grid
 * point where |F| is least.
 */
function crossings(F: Fn2, sq: Bounds): { box: Bounds | null; low: Low | null } {
  const n = GRID;
  const hx = (sq.xmax - sq.xmin) / n;
  const hy = (sq.ymax - sq.ymin) / n;
  const xs = Array.from({ length: n + 1 }, (_, i) => sq.xmin + i * hx);
  const ys = Array.from({ length: n + 1 }, (_, j) => sq.ymin + j * hy);
  const vals = new Float64Array((n + 1) * (n + 1));
  let low: Low | null = null;
  for (let j = 0; j <= n; j++) {
    for (let i = 0; i <= n; i++) {
      const v = F(xs[i], ys[j]);
      vals[j * (n + 1) + i] = v;
      const size = Math.abs(v);
      if (size < (low?.size ?? Number.POSITIVE_INFINITY)) {
        low = { x: xs[i], y: ys[j], size, cell: Math.max(hx, hy) };
      }
    }
  }
  let box: Bounds | null = null;
  const at = (i: number, j: number) => vals[j * (n + 1) + i];
  const opposite = (a: number, b: number) =>
    Number.isFinite(a) && Number.isFinite(b) && ((a < 0 && b > 0) || (a > 0 && b < 0));
  for (let j = 0; j <= n; j++) {
    for (let i = 0; i <= n; i++) {
      const v = at(i, j);
      if (v === 0) box = extend(box, xs[i], ys[j]);
      if (i < n && opposite(v, at(i + 1, j))) {
        const y = ys[j];
        const x = edgeRoot((u) => F(u, y), xs[i], v, xs[i + 1], at(i + 1, j));
        if (x !== null) box = extend(box, x, y);
      }
      if (j < n && opposite(v, at(i, j + 1))) {
        const x = xs[i];
        const y = edgeRoot((u) => F(x, u), ys[j], v, ys[j + 1], at(i, j + 1));
        if (y !== null) box = extend(box, x, y);
      }
    }
  }
  return { box, low };
}

/** Whether a box found on a grid over `sq` reaches its outer cells (the curve may go on). */
function reachesEdge(box: Bounds, sq: Bounds): boolean {
  const mx = (1.5 * (sq.xmax - sq.xmin)) / GRID;
  const my = (1.5 * (sq.ymax - sq.ymin)) / GRID;
  return (
    box.xmin < sq.xmin + mx ||
    box.xmax > sq.xmax - mx ||
    box.ymin < sq.ymin + my ||
    box.ymax > sq.ymax - my
  );
}

function implicitBounds(F0: Fn2, view: Bounds): CurveBounds | null {
  let evals = IMPLICIT_BUDGET;
  const F: Fn2 = (x, y) => {
    evals--;
    return F0(x, y);
  };
  const affordable = () => evals >= (GRID + 1) ** 2;
  const square = (h: number, x: number, y: number): Bounds => ({
    xmin: x - h,
    xmax: x + h,
    ymin: y - h,
    ymax: y + h,
  });

  /**
   * The curve found as `box` on the grid over square(h, x, y), followed: out while it runs out
   * of the square (a big circle closes in a wider one; a line never does, and its part in the
   * first square stands for it), in while it is only a few cells across (the grid may have
   * caught a small curve on a line or two, or at a point).
   */
  const follow = (box: Bounds, h: number, x: number, y: number): CurveBounds => {
    if (reachesEdge(box, square(h, x, y))) {
      for (let j = 1; j <= 2 && affordable(); j++) {
        const wide = square(h * 4 ** j, x, y);
        const all = crossings(F, wide).box;
        if (all && !reachesEdge(all, wide)) return { box: all, open: false };
      }
      return { box, open: true };
    }
    let found = box;
    let cell = (2 * h) / GRID;
    const size = (b: Bounds) => Math.max(b.xmax - b.xmin, b.ymax - b.ymin);
    for (let k = 0; k < MAX_NARROW && size(found) < 4 * cell && affordable(); k++) {
      const h2 = Math.max(2 * cell, size(found));
      const finer = crossings(
        F,
        square(h2, (found.xmin + found.xmax) / 2, (found.ymin + found.ymax) / 2),
      ).box;
      if (!finer) break;
      found = finer;
      cell = (2 * h2) / GRID;
    }
    return { box: found, open: false };
  };

  const cx = (view.xmin + view.xmax) / 2;
  const cy = (view.ymin + view.ymax) / 2;
  const half = Math.max(view.xmax - view.xmin, view.ymax - view.ymin) / 2;
  let low: Low | null = null;
  // Outwards from the view, until the curve shows…
  for (let k = 0; k <= MAX_WIDEN && affordable(); k++) {
    const h = half * 4 ** k;
    const found = crossings(F, square(h, cx, cy));
    if (found.box) return follow(found.box, h, cx, cy);
    if (found.low && found.low.size < (low?.size ?? Number.POSITIVE_INFINITY)) low = found.low;
  }
  // …or, too small for those grids (a small circle far off, a tiny one in view), down into
  // where |F| was least, a few cells around it each time.
  for (let k = 1; k <= MAX_NARROW && low && affordable(); k++) {
    const h = 2 * low.cell;
    const { x, y } = low;
    const found = crossings(F, square(h, x, y));
    if (found.box) return follow(found.box, h, x, y);
    low = found.low;
  }
  return null;
}

/**
 * Where a row's curve is, as seen from `view` (an explicit curve over the view's range, an
 * unending implicit one near it); null when it draws nothing anywhere this finds.
 */
export function curveBounds(plot: PlotItem, view: Viewport): CurveBounds | null {
  const b = viewBounds(view);
  switch (plot.kind) {
    case 'explicitY':
      return explicitBounds(plot.f, 'x', b);
    case 'explicitX':
      return explicitBounds(plot.f, 'y', b);
    case 'parametric':
      return pathBounds(plot.fx, plot.fy, plot.tMin(), plot.tMax());
    case 'polar': {
      const r = plot.r;
      return pathBounds(
        (t) => r(t) * Math.cos(t),
        (t) => r(t) * Math.sin(t),
        plot.thetaMin(),
        plot.thetaMax(),
      );
    }
    case 'points': {
      let box: Bounds | null = null;
      for (const p of plot.points) {
        const [x, y] = [p.x(), p.y()];
        if (Number.isFinite(x) && Number.isFinite(y)) box = extend(box, x, y);
      }
      return box && { box, open: false };
    }
    case 'implicit':
      return implicitBounds(plot.F, b);
  }
}

/** The box around what a row draws, as seen from `view` (see curveBounds). */
export function plotBounds(plot: PlotItem, view: Viewport): Bounds | null {
  return curveBounds(plot, view)?.box ?? null;
}

/** Room kept around a fitted box, in px. */
function fitMargin(view: Viewport): number {
  return Math.max(FIT_MARGIN_PX, FIT_MARGIN * Math.min(view.width, view.height));
}

/**
 * The part of `view` a fit fills (inside its margins). Read over this much of the view, a curve
 * that fills it (sin x) fits to the same view again, rather than a little wider at each press.
 */
export function fitWindow(view: Viewport): Viewport {
  const m = fitMargin(view);
  return {
    ...view,
    width: Math.max(1, view.width - 2 * m),
    height: Math.max(1, view.height - 2 * m),
  };
}

/** How much of the world the window of `view` shows across its shorter side. */
export function windowSpan(view: Viewport): number {
  const w = fitWindow(view);
  return Math.min(w.width / w.ppuX, w.height / w.ppuY);
}

/** `box`, grown about its middle to at least `min` across each way. */
function atLeast(box: Bounds, min: number): Bounds {
  const grow = (lo: number, hi: number): [number, number] => {
    const pad = Math.max(0, (min - (hi - lo)) / 2);
    return [lo - pad, hi + pad];
  };
  const [xmin, xmax] = grow(box.xmin, box.xmax);
  const [ymin, ymax] = grow(box.ymin, box.ymax);
  return { xmin, xmax, ymin, ymax };
}

/**
 * The box to fit for some curves: theirs together, an open one's counted at least `minOpen`
 * across (it is only where the curve is worth seeing: a fit must not dive into the intercepts
 * of y = x + 0.001, a hair apart). Null for none.
 */
export function curvesBox(curves: readonly CurveBounds[], minOpen: number): Bounds | null {
  let box: Bounds | null = null;
  for (const c of curves) box = unionBounds(box, c.open ? atLeast(c.box, minOpen) : c.box);
  return box;
}

/**
 * The view that shows `box` whole, with room around it (FIT_MARGIN), equally scaled on both axes,
 * at the size of `view`. A box with no width or height keeps the view's scale on that axis; a
 * single point is centred at the view's scale.
 */
export function fitViewport(box: Bounds, view: Viewport): Viewport {
  const margin = fitMargin(view);
  const w = Math.max(1, view.width - 2 * margin);
  const h = Math.max(1, view.height - 2 * margin);
  const cx = (box.xmin + box.xmax) / 2;
  const cy = (box.ymin + box.ymax) / 2;
  // Sizes lost in rounding next to the coordinates are no size.
  const tiny = 1e-9 * Math.max(1, Math.abs(cx), Math.abs(cy));
  const bw = box.xmax - box.xmin;
  const bh = box.ymax - box.ymin;
  const inf = Number.POSITIVE_INFINITY;
  let ppu = Math.min(bw > tiny ? w / bw : inf, bh > tiny ? h / bh : inf);
  if (!Number.isFinite(ppu)) ppu = view.ppuX;
  return clampViewport({ cx, cy, ppuX: ppu, ppuY: ppu, width: view.width, height: view.height });
}

/** Whether the segment (x0, y0)–(x1, y1) meets the box (Liang–Barsky clipping). */
function segmentMeets(box: Bounds, x0: number, y0: number, x1: number, y1: number): boolean {
  let t0 = 0;
  let t1 = 1;
  /** Clip to one side, p·t ≤ q; false when nothing is left. */
  const clip = (p: number, q: number) => {
    if (p === 0) return q >= 0;
    const r = q / p;
    if (p < 0) {
      if (r > t1) return false;
      t0 = Math.max(t0, r);
    } else {
      if (r < t0) return false;
      t1 = Math.min(t1, r);
    }
    return true;
  };
  const [dx, dy] = [x1 - x0, y1 - y0];
  return (
    clip(-dx, x0 - box.xmin) &&
    clip(dx, box.xmax - x0) &&
    clip(-dy, y0 - box.ymin) &&
    clip(dy, box.ymax - y0)
  );
}

/**
 * Whether drawn geometry shows anywhere in `box`: a curve's segment (a straight line is sampled
 * as a few vertices far out, none of them in view), a point marker, or a shaded region (which
 * may cover the view without a vertex in it).
 */
export function drawsIn(geometry: RowGeometry, box: Bounds): boolean {
  const inside = (x: number, y: number) =>
    x >= box.xmin && x <= box.xmax && y >= box.ymin && y <= box.ymax;
  const crosses = (a: Float64Array) => {
    for (let i = 0; i + 1 < a.length; i += 2) {
      const [x, y] = [a[i], a[i + 1]];
      if (inside(x, y)) return true;
      const [px, py] = [a[i - 2], a[i - 1]];
      if (
        i >= 2 &&
        Number.isFinite(px + py + x + y) &&
        segmentMeets(box, px as number, py as number, x, y)
      ) {
        return true;
      }
    }
    return false;
  };
  if (geometry.fill && geometry.fill.length > 0) return true;
  const points = geometry.points;
  if (points) {
    for (let i = 0; i + 1 < points.length; i += 2)
      if (inside(points[i], points[i + 1])) return true;
  }
  return geometry.curves.some(crosses);
}
