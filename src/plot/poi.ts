// Points of interest of one curve in the current view: roots, local extrema, axis intercepts and
// intersections with the other curves.
//
// Everything reduces to one-dimensional root finding on samples:
//   - y = f(x) (and x = f(y)): roots and extrema from the sampled polyline (sign changes and
//     slope sign changes between finite samples of one piece, so NaN gaps and the breaks the
//     sampler puts at poles are never bracketed), refined by Brent's methods on f itself. The
//     points the sampler invents on its clipping band, where a curve leaves the view far behind,
//     take their true value first: the band's flat edge would read as an extremum;
//   - intersections of two curves of the same axis: f1 - f2 on the samples of both polylines;
//   - a curve against one with an equation R(x, y) = 0 (y - f(x), x - g(y), an implicit F):
//     R along the first curve, on a world-aligned grid in x or y, or in t for parametric and
//     polar curves; axis intercepts are the same with R = y or R = x;
//   - two implicit curves, or two parametric/polar ones: their polylines' segment crossings
//     (implicit pairs refined by Newton's method).
// A sign change is a root only once Brent gets |f| well below the bracket's values: poles
// (tan x, 1/x) and jumps (floor x) never do. Where the samples dip toward zero without crossing
// (x², a tangent line) the dip is minimised, and touching counts as a root (a double root). A
// turn of the samples is an extremum only where f is continuous: a sawtooth's drop is not a
// maximum. A piece of the curve that ends at the edge of f's domain (sqrt(4 - x²) at ±2), or at
// the end of a parameter range, ends with a root when f goes to zero there.
//
// The result is capped and kept calm: kinds of points are shown or left out as a whole, most
// notable first (intersections, then crossings of the axes, then extrema; the curve's own keep
// some room however many curves cross it), while they stay few and far enough apart to read; so
// zooming out on sin x drops its extrema, then its roots, rather than thinning them at random. Evaluations are budgeted (sin(1/x) cannot hang).

import type { Fn1, Fn2, PlotItem } from '../engine/types';
import type { RowGeometry, Viewport } from './types';
import { toScreenX, toScreenY, viewBounds } from './viewport';

export type PoiKind = 'max' | 'min' | 'root' | 'xIntercept' | 'yIntercept' | 'intersection';

export interface Poi {
  x: number;
  y: number;
  /** What the point is, most notable first (one point can be several: the vertex of x²). */
  kinds: PoiKind[];
  /** Intersections: the ids of the other curves through the point, else empty. */
  with: string[];
}

export interface PoiCurve {
  id: string;
  plot: PlotItem;
  /** The plot's geometry for the same view (final quality). */
  geometry: RowGeometry;
}

export interface PoiOptions {
  /** Most points returned (default 20). */
  maxPois?: number;
  /** Evaluation budget for the whole search (default 60000). */
  maxEvals?: number;
  /** Filled with what the search found in view, before any is left out (see PoiCensus). */
  census?: PoiCensus;
}

/**
 * How many points of each kind a search found in view, and at how many it met each other curve
 * (by id), before kinds were left out to keep the graph readable: the insight line counts them.
 * A kind is missing when none was found in view, or there were too many to find them all.
 */
export interface PoiCensus {
  kinds: Partial<Record<PoiKind, number>>;
  meets: Map<string, number>;
  /**
   * Some other curves were not counted (the search ran out of time, or one met it too often to
   * find): `meets` may leave out some that meet it.
   */
  partial?: boolean;
}

const DEFAULT_MAX_POIS = 20;
const DEFAULT_MAX_EVALS = 60000;
/** Kinds in label order: the most notable first. */
const KIND_ORDER: readonly PoiKind[] = [
  'intersection',
  'max',
  'min',
  'root',
  'xIntercept',
  'yIntercept',
];
/** Grid spacing of the residual scans, px (the explicit sampler's final grid). */
const SCAN_PX = 2;
/** Points closer than this on screen are one point (with the kinds of both). */
const MERGE_PX = 1.5;
/**
 * Points whose neighbours are typically closer than this are too crowded to read (a ring is
 * 10 px across, its hit area 22 px).
 */
const MIN_GAP_PX = 20;
/** A Brent root is real once |f| is below this fraction of the bracket's end values. */
const ROOT_RATIO = 1e-3;
/** A dip whose minimum |f| is below this fraction of its neighbours' touches zero. */
const TOUCH_RATIO = 1e-6;
const MAX_ITER = 100;
const EPS = Number.EPSILON;
/** 2 - golden ratio. */
const GOLD = 0.3819660112501051;
/** Parameter samples per turn (2π) for parametric and polar scans, and their bounds. */
const T_PER_TURN = 256;
const T_MIN_SAMPLES = 512;
const T_MAX_SAMPLES = 4096;
/** Parameter ranges longer than this are scanned in a window (as the sampler draws them). */
const MAX_PARAMETER_RANGE = 1e6;
/** World-aligned grid offset, irrational so periodic inputs cannot alias with the grid. */
const PHI = 0.3819660112501051;

/** Shared evaluation budget; a search that runs out gives up on what it was finding. */
class Budget {
  constructor(public left: number) {}

  wrap1(f: Fn1): Fn1 {
    return (u) => {
      this.left--;
      return f(u);
    };
  }

  wrap2(f: Fn2): Fn2 {
    return (x, y) => {
      this.left--;
      return f(x, y);
    };
  }
}

/** Ran out of budget or candidates: the class of points is dropped. */
class TooMany extends Error {}

interface Candidate {
  x: number;
  y: number;
  kind: PoiKind;
  with: string | null;
}

/**
 * Brent's zeroin on [a, b] with f(a), f(b) of opposite signs. Returns NaN when the bracket holds
 * no root after all: f is not finite somewhere inside, or never gets well below the end values
 * (a pole or a jump).
 */
function brentRoot(f: Fn1, a0: number, fa0: number, b0: number, fb0: number): number {
  let a = a0;
  let b = b0;
  let fa = fa0;
  let fb = fb0;
  let c = a;
  let fc = fa;
  let d = b - a;
  let e = d;
  let iter = 0;
  for (;;) {
    if (Math.abs(fc) < Math.abs(fb)) {
      a = b;
      b = c;
      c = a;
      fa = fb;
      fb = fc;
      fc = fa;
    }
    const tol = 2 * EPS * Math.abs(b) + 1e-300;
    const m = 0.5 * (c - b);
    if (Math.abs(m) <= tol || fb === 0 || ++iter > MAX_ITER) break;
    if (Math.abs(e) < tol || Math.abs(fa) <= Math.abs(fb)) {
      d = m;
      e = m;
    } else {
      const s = fb / fa;
      let p: number;
      let q: number;
      if (a === c) {
        p = 2 * m * s;
        q = 1 - s;
      } else {
        const qa = fa / fc;
        const r = fb / fc;
        p = s * (2 * m * qa * (qa - r) - (b - a) * (r - 1));
        q = (qa - 1) * (r - 1) * (s - 1);
      }
      if (p > 0) q = -q;
      else p = -p;
      if (2 * p < 3 * m * q - Math.abs(tol * q) && p < Math.abs(0.5 * e * q)) {
        e = d;
        d = p / q;
      } else {
        d = m;
        e = m;
      }
    }
    a = b;
    fa = fb;
    b += Math.abs(d) > tol ? d : m > 0 ? tol : -tol;
    fb = f(b);
    if (!Number.isFinite(fb)) return Number.NaN;
    if ((fb > 0 && fc > 0) || (fb < 0 && fc < 0)) {
      c = a;
      fc = fa;
      d = b - a;
      e = d;
    }
  }
  return Math.abs(fb) <= ROOT_RATIO * Math.max(Math.abs(fa0), Math.abs(fb0)) ? b : Number.NaN;
}

/**
 * Brent's localmin of phi on [a, b], starting from x inside it with phi(x) = fx no larger than
 * at the ends. Non-finite values count as +∞. Returns the minimiser.
 */
function brentMin(phi: Fn1, a0: number, b0: number, x0: number, fx0: number): number {
  let a = a0;
  let b = b0;
  let x = x0;
  let fx = fx0;
  let w = x;
  let fw = fx;
  let v = x;
  let fv = fx;
  let d = 0;
  let e = 0;
  const abs = 1e-10 * (b0 - a0);
  for (let iter = 0; iter < MAX_ITER; iter++) {
    const xm = 0.5 * (a + b);
    const tol1 = 1e-10 * Math.abs(x) + abs;
    const tol2 = 2 * tol1;
    if (Math.abs(x - xm) <= tol2 - 0.5 * (b - a)) break;
    let golden = true;
    if (Math.abs(e) > tol1) {
      const r = (x - w) * (fx - fv);
      let q = (x - v) * (fx - fw);
      let p = (x - v) * q - (x - w) * r;
      q = 2 * (q - r);
      if (q > 0) p = -p;
      else q = -q;
      const etemp = e;
      e = d;
      if (Math.abs(p) < Math.abs(0.5 * q * etemp) && p > q * (a - x) && p < q * (b - x)) {
        d = p / q;
        const u = x + d;
        if (u - a < tol2 || b - u < tol2) d = xm >= x ? tol1 : -tol1;
        golden = false;
      }
    }
    if (golden) {
      e = x >= xm ? a - x : b - x;
      d = GOLD * e;
    }
    const u = Math.abs(d) >= tol1 ? x + d : x + (d > 0 ? tol1 : -tol1);
    let fu = phi(u);
    if (!Number.isFinite(fu)) fu = Number.POSITIVE_INFINITY;
    if (fu <= fx) {
      if (u >= x) a = x;
      else b = x;
      v = w;
      fv = fw;
      w = x;
      fw = fx;
      x = u;
      fx = fu;
    } else {
      if (u < x) a = u;
      else b = u;
      if (fu <= fw || w === x) {
        v = w;
        fv = fw;
        w = u;
        fw = fu;
      } else if (fu <= fv || v === x || v === w) {
        v = u;
        fv = fu;
      }
    }
  }
  return x;
}

interface Solved {
  roots: number[];
  maxima: number[];
  minima: number[];
}

/**
 * Whether f jumps at x (a sawtooth's drop) rather than turning there: the values either side
 * of a turning point close in on f(x) as they come nearer, a jump's stay a jump apart.
 * `width` is the bracket x was found in.
 */
function jumpsAt(f: Fn1, x: number, fx: number, width: number): boolean {
  // Well past the minimiser's tolerance, and far enough out to rise above rounding.
  const near = Math.max(1e-4 * width, 16e-10 * (Math.abs(x) + width));
  const spread = (d: number) => Math.max(Math.abs(f(x - d) - fx), Math.abs(f(x + d) - fx));
  const far = spread(10 * near);
  const close = spread(near);
  if (!Number.isFinite(far) || !Number.isFinite(close)) return true;
  // Too flat to tell apart from rounding: take it as a turn.
  if (far <= 1e-13 * Math.max(1, Math.abs(fx))) return false;
  return close > 0.5 * far;
}

/**
 * The root where a piece of samples ends at u (value v, `inner` the next sample in), if the
 * piece ends at the edge of f's domain and f goes to zero there, compared with `scale` (the
 * size of f near the end). `outside` is a known input past u where f is not finite, or NaN to
 * look for one close to u. NaN when there is none.
 */
function edgeRoot(f: Fn1, u: number, v: number, inner: number, scale: number, outside: number) {
  let bad = outside;
  if (Number.isNaN(bad)) {
    // The piece may also end at a pole or a jump, or where the samples stop (the view's edge).
    const step = u - inner;
    for (let k = 1; k <= 4096; k *= 16) {
      const probe = u + step / k;
      if (!Number.isFinite(f(probe))) {
        bad = probe;
        break;
      }
    }
    if (Number.isNaN(bad)) return Number.NaN;
  }
  let ok = u;
  let fok = v;
  for (let k = 0; k < 64; k++) {
    const m = 0.5 * (ok + bad);
    if (m === ok || m === bad) break;
    const fm = f(m);
    if (Number.isFinite(fm)) {
      ok = m;
      fok = fm;
    } else {
      bad = m;
    }
  }
  return Math.abs(fok) <= TOUCH_RATIO * scale ? ok : Number.NaN;
}

/**
 * Roots (and with `extrema`, local maxima and minima) of f from samples vs[i] = f(us[i]) at
 * increasing us. A non-finite value breaks the samples into pieces that are never bridged; an
 * NaN input separates pieces whose gap was not sampled (a polyline's pen-up). `rangeEnds`: the
 * first and last samples are where f's range ends (a parameter range), rather than where the
 * sampling happens to stop. Throws TooMany past `maxCandidates` brackets, or when f is zero all
 * along (a curve on the axis, two equal curves).
 */
function solveSamples(
  f: Fn1,
  us: ArrayLike<number>,
  vs: ArrayLike<number>,
  extrema: boolean,
  maxCandidates: number,
  budget: Budget,
  rangeEnds = false,
): Solved {
  const out: Solved = { roots: [], maxima: [], minima: [] };
  const n = Math.min(us.length, vs.length);
  const usable = (i: number) => i >= 0 && i < n && Number.isFinite(vs[i]);
  // First pass: count the brackets and the ends of pieces, so a dense curve costs no refinement.
  let candidates = 0;
  let zeros = 0;
  for (let i = 0; i < n; i++) {
    if (!usable(i)) continue;
    if (!usable(i - 1) || !usable(i + 1)) candidates++;
    if (!usable(i + 1)) continue;
    const a = vs[i];
    const b = vs[i + 1];
    if (a * b < 0) candidates++;
    if (a === 0 && b === 0 && ++zeros > 2) throw new TooMany();
    if (usable(i - 1)) {
      const d1 = a - vs[i - 1];
      const d2 = b - a;
      if (d1 * d2 < 0) candidates++;
    }
  }
  if (candidates > maxCandidates) throw new TooMany();

  for (let i = 0; i < n; i++) {
    if (budget.left <= 0) throw new TooMany();
    if (!usable(i)) continue;
    const v = vs[i];
    if (v === 0) {
      out.roots.push(us[i]);
      continue;
    }
    // The end of a piece: where the domain or the parameter range ends.
    for (const dir of [-1, 1]) {
      const j = i + dir;
      const k = i - dir;
      if (usable(j) || !usable(k)) continue;
      // The size of f near the end, past the points the sampler crowds at a domain's edge.
      let scale = 0;
      for (let q = i, m = 0; m < 4 && usable(q); q -= dir, m++) {
        scale = Math.max(scale, Math.abs(vs[q]));
      }
      const atEnd = j < 0 || j >= n;
      const r =
        atEnd && rangeEnds
          ? Math.abs(v) <= TOUCH_RATIO * scale
            ? us[i]
            : Number.NaN
          : edgeRoot(f, us[i], v, us[k], scale, atEnd ? Number.NaN : us[j]);
      if (!Number.isNaN(r)) out.roots.push(r);
    }
    if (usable(i + 1) && v * vs[i + 1] < 0) {
      const r = brentRoot(f, us[i], v, us[i + 1], vs[i + 1]);
      if (!Number.isNaN(r)) out.roots.push(r);
    }
    if (!usable(i - 1) || !usable(i + 1)) continue;
    const l = vs[i - 1];
    const r = vs[i + 1];
    const isMax = v > l && v > r;
    const isMin = v < l && v < r;
    if (!isMax && !isMin) continue;
    // A dip toward zero that stays on one side: a double root if it touches.
    const dip = l * v > 0 && v * r > 0 && (isMax ? v < 0 : v > 0);
    if (!extrema && !dip) continue;
    const sign = isMax ? -1 : 1;
    const x = brentMin((u) => sign * f(u), us[i - 1], us[i + 1], us[i], sign * v);
    const fx = f(x);
    if (!Number.isFinite(fx) || sign * fx > sign * v) continue;
    if (extrema && !jumpsAt(f, x, fx, us[i + 1] - us[i - 1])) {
      (isMax ? out.maxima : out.minima).push(x);
    }
    // At a jump too: x - floor(x) does reach 0 at each integer.
    if (dip && Math.abs(fx) <= TOUCH_RATIO * Math.max(Math.abs(l), Math.abs(r))) {
      out.roots.push(x);
    }
  }
  return out;
}

/** World-aligned grid over [lo, hi] (one step beyond each end), `step` apart. */
function grid(lo: number, hi: number, step: number): Float64Array {
  if (!(hi > lo) || !(step > 0)) return new Float64Array(0);
  const k0 = Math.floor(lo / step - PHI) - 1;
  const k1 = Math.ceil(hi / step - PHI) + 1;
  const n = k1 - k0 + 1;
  if (!(n > 1 && n < 1e6)) return new Float64Array(0);
  const out = new Float64Array(n);
  const aligned = Math.abs(k0) < 2 ** 52 && Math.abs(k1) < 2 ** 52;
  for (let i = 0; i < n; i++) out[i] = aligned ? (k0 + i + PHI) * step : lo + (i - 1) * step;
  return out;
}

function sampleAll(f: Fn1, us: Float64Array): Float64Array {
  const vs = new Float64Array(us.length);
  for (let i = 0; i < us.length; i++) vs[i] = f(us[i]);
  return vs;
}

/** The parameter range a parametric or polar curve is drawn over, and the scan's samples. */
function paramSamples(min: number, max: number): Float64Array {
  if (!Number.isFinite(min) || !Number.isFinite(max) || !(max > min)) return new Float64Array(0);
  let lo = min;
  let hi = max;
  if (!(hi - lo <= MAX_PARAMETER_RANGE)) {
    const near0 = lo > 0 ? lo : hi < 0 ? hi : 0;
    lo = Math.max(min, near0 - MAX_PARAMETER_RANGE / 2);
    hi = Math.min(max, lo + MAX_PARAMETER_RANGE);
  }
  let n = Math.ceil((T_PER_TURN * (hi - lo)) / (2 * Math.PI));
  n = n < T_MIN_SAMPLES ? T_MIN_SAMPLES : n > T_MAX_SAMPLES ? T_MAX_SAMPLES : n;
  const h = (hi - lo) / (n - 2 + 2 * PHI);
  const out = new Float64Array(n + 1);
  for (let i = 0; i <= n; i++) out[i] = i <= 0 ? lo : i >= n ? hi : lo + h * (i - 1 + PHI);
  return out;
}

/** A curve given by a parameter: x(t), y(t) over its range. */
interface ParamCurve {
  x: Fn1;
  y: Fn1;
  ts: Float64Array;
}

function paramCurve(plot: PlotItem, budget: Budget): ParamCurve | null {
  if (plot.kind === 'parametric') {
    return {
      x: budget.wrap1(plot.fx),
      y: budget.wrap1(plot.fy),
      ts: paramSamples(plot.tMin(), plot.tMax()),
    };
  }
  if (plot.kind === 'polar') {
    const r = budget.wrap1(plot.r);
    return {
      x: (t) => r(t) * Math.cos(t),
      y: (t) => r(t) * Math.sin(t),
      ts: paramSamples(plot.thetaMin(), plot.thetaMax()),
    };
  }
  return null;
}

/** R(x, y) = 0 form of a curve that has one: y - f(x), x - g(y), or the implicit F. */
function residual(plot: PlotItem, budget: Budget): Fn2 | null {
  switch (plot.kind) {
    case 'explicitY': {
      const f = budget.wrap1(plot.f);
      return (x, y) => y - f(x);
    }
    case 'explicitX': {
      const g = budget.wrap1(plot.f);
      return (x, y) => x - g(y);
    }
    case 'implicit':
      return budget.wrap2(plot.F);
    default:
      return null;
  }
}

/** Splits a polyline into increasing input (u) and value (w) samples, NaN between pieces. */
function polylineSamples(
  poly: Float64Array,
  swap: boolean,
): { us: Float64Array; ws: Float64Array } {
  const n = poly.length >> 1;
  const us = new Float64Array(n);
  const ws = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const x = poly[2 * i];
    const y = poly[2 * i + 1];
    us[i] = swap ? y : x;
    ws[i] = swap ? x : y;
    if (Number.isNaN(x) || Number.isNaN(y)) ws[i] = Number.NaN;
  }
  return { us, ws };
}

/** The finite inputs of two explicit polylines, sorted and deduplicated, within [lo, hi]. */
function mergedInputs(a: Float64Array, b: Float64Array, lo: number, hi: number): Float64Array {
  const all: number[] = [];
  for (const us of [a, b]) {
    for (let i = 0; i < us.length; i++) {
      const u = us[i];
      if (u >= lo && u <= hi) all.push(u);
    }
  }
  const sorted = Float64Array.from(all).sort();
  let k = 0;
  for (let i = 0; i < sorted.length; i++) {
    if (k === 0 || sorted[i] !== sorted[k - 1]) sorted[k++] = sorted[i];
  }
  return sorted.subarray(0, k);
}

type Explicit = Extract<PlotItem, { kind: 'explicitY' | 'explicitX' }>;

function isExplicit(plot: PlotItem): plot is Explicit {
  return plot.kind === 'explicitY' || plot.kind === 'explicitX';
}

/** Search context shared by the finders. */
interface Ctx {
  view: Viewport;
  budget: Budget;
  maxCandidates: number;
  xmin: number;
  xmax: number;
  ymin: number;
  ymax: number;
}

/** Roots, extrema and the intercept of y = f(x) or x = f(y), from its sampled polyline. */
function explicitPoints(curve: PoiCurve & { plot: Explicit }, ctx: Ctx, add: AddFn): void {
  const { plot, geometry } = curve;
  const swap = plot.kind === 'explicitX';
  const f = ctx.budget.wrap1(plot.f);
  const at = (u: number, w: number): [number, number] => (swap ? [w, u] : [u, w]);
  const rootKind: PoiKind = swap ? 'yIntercept' : 'root';
  const interceptKind: PoiKind = swap ? 'xIntercept' : 'yIntercept';

  // Where the input axis is 0: x = 0 for y = f(x).
  const uLo = swap ? ctx.ymin : ctx.xmin;
  const uHi = swap ? ctx.ymax : ctx.xmax;
  if (uLo <= 0 && uHi >= 0) {
    const w = f(0);
    if (Number.isFinite(w)) add(interceptKind, null, () => [at(0, w)]);
  }
  if (plot.isConstant) return;

  const poly = geometry.curves[0];
  if (!poly) return;
  const { us, ws } = polylineSamples(poly, swap);
  // The sampler clips values to a band one view beyond each edge, inventing points on it.
  const v = ctx.view;
  const wC = swap ? v.cx : v.cy;
  const band = (3 * (swap ? v.width / v.ppuX : v.height / v.ppuY)) / 2;
  for (let i = 0; i < ws.length; i++) {
    if (Math.abs(ws[i] - wC) >= band * (1 - 1e-9)) ws[i] = f(us[i]);
  }
  let solved: Solved | null = null;
  const solve = () => {
    solved ??= solveSamples(f, us, ws, true, ctx.maxCandidates, ctx.budget);
    return solved;
  };
  add(rootKind, null, () => solve().roots.map((u) => at(u, 0)));
  add('max', null, () => solve().maxima.map((u) => at(u, f(u))));
  add('min', null, () => solve().minima.map((u) => at(u, f(u))));
}

/** Where a parametric or polar curve crosses the axes. */
function paramIntercepts(p: ParamCurve, ctx: Ctx, add: AddFn): void {
  const { maxCandidates, budget } = ctx;
  add('xIntercept', null, () => {
    const s = solveSamples(p.y, p.ts, sampleAll(p.y, p.ts), false, maxCandidates, budget, true);
    return s.roots.map((t) => [p.x(t), 0]);
  });
  add('yIntercept', null, () => {
    const s = solveSamples(p.x, p.ts, sampleAll(p.x, p.ts), false, maxCandidates, budget, true);
    return s.roots.map((t) => [0, p.y(t)]);
  });
}

/** Where an implicit curve F = 0 crosses the axes: F along each axis. */
function implicitIntercepts(F: Fn2, ctx: Ctx, add: AddFn): void {
  const { view } = ctx;
  if (ctx.ymin <= 0 && ctx.ymax >= 0) {
    add('xIntercept', null, () => {
      const g = (x: number) => F(x, 0);
      const xs = grid(ctx.xmin, ctx.xmax, SCAN_PX / view.ppuX);
      const s = solveSamples(g, xs, sampleAll(g, xs), false, ctx.maxCandidates, ctx.budget);
      return s.roots.map((x) => [x, 0]);
    });
  }
  if (ctx.xmin <= 0 && ctx.xmax >= 0) {
    add('yIntercept', null, () => {
      const g = (y: number) => F(0, y);
      const ys = grid(ctx.ymin, ctx.ymax, SCAN_PX / view.ppuY);
      const s = solveSamples(g, ys, sampleAll(g, ys), false, ctx.maxCandidates, ctx.budget);
      return s.roots.map((y) => [0, y]);
    });
  }
}

/** Points where two curves meet. */
function intersections(a: PoiCurve, b: PoiCurve, ctx: Ctx): [number, number][] {
  const { view, budget } = ctx;
  const pa = a.plot;
  const pb = b.plot;
  // Same-axis explicit curves: f1 - f2 on the samples of both.
  if (isExplicit(pa) && isExplicit(pb) && pa.kind === pb.kind) {
    const swap = pa.kind === 'explicitX';
    const f1 = budget.wrap1(pa.f);
    const f2 = budget.wrap1(pb.f);
    const d = (u: number) => f1(u) - f2(u);
    const lo = swap ? ctx.ymin : ctx.xmin;
    const hi = swap ? ctx.ymax : ctx.xmax;
    const ua = polylineSamples(a.geometry.curves[0] ?? new Float64Array(0), swap).us;
    const ub = polylineSamples(b.geometry.curves[0] ?? new Float64Array(0), swap).us;
    let us = mergedInputs(ua, ub, lo, hi);
    // Two constants, or curves without samples in view: a plain grid.
    if (us.length < 2) us = grid(lo, hi, SCAN_PX / (swap ? view.ppuY : view.ppuX));
    const s = solveSamples(d, us, sampleAll(d, us), false, ctx.maxCandidates, budget);
    return s.roots.map((u) => {
      const w = f1(u);
      return swap ? [w, u] : [u, w];
    });
  }
  // One curve has an equation R = 0: R along the other one.
  for (const [p, q] of [
    [pa, pb],
    [pb, pa],
  ] as const) {
    const R = residual(q, budget);
    if (R === null) continue;
    if (p.kind === 'explicitY' || p.kind === 'explicitX') {
      const swap = p.kind === 'explicitX';
      const f = budget.wrap1(p.f);
      const g = swap ? (y: number) => R(f(y), y) : (x: number) => R(x, f(x));
      const us = swap
        ? grid(ctx.ymin, ctx.ymax, SCAN_PX / view.ppuY)
        : grid(ctx.xmin, ctx.xmax, SCAN_PX / view.ppuX);
      const s = solveSamples(g, us, sampleAll(g, us), false, ctx.maxCandidates, budget);
      return s.roots.map((u) => (swap ? [f(u), u] : [u, f(u)]));
    }
    const pc = paramCurve(p, budget);
    if (pc !== null) {
      const g = (t: number) => R(pc.x(t), pc.y(t));
      const s = solveSamples(g, pc.ts, sampleAll(g, pc.ts), false, ctx.maxCandidates, budget, true);
      return s.roots.map((t) => [pc.x(t), pc.y(t)]);
    }
  }
  // Neither has a usable equation form along the other: cross the polylines.
  const hits = polylineCrossings(a.geometry.curves, b.geometry.curves, ctx);
  if (pa.kind === 'implicit' && pb.kind === 'implicit') {
    const F = budget.wrap2(pa.F);
    const G = budget.wrap2(pb.F);
    return hits.map((h) => newton2(F, G, h, view) ?? h);
  }
  return hits;
}

/**
 * Crossings of two sets of polylines inside the view, by segment tests within a grid of buckets.
 * Collinear overlaps (the same curve twice) are not crossings.
 */
function polylineCrossings(
  as: readonly Float64Array[],
  bs: readonly Float64Array[],
  ctx: Ctx,
): [number, number][] {
  const { view } = ctx;
  const CELL = 32;
  const cols = Math.max(1, Math.ceil(view.width / CELL));
  const rows = Math.max(1, Math.ceil(view.height / CELL));
  const buckets: number[][] = Array.from({ length: cols * rows }, () => []);
  // Segments of b as screen coordinates [x0, y0, x1, y1].
  const segs: number[] = [];
  const cellOf = (s: number, n: number) => Math.min(n - 1, Math.max(0, Math.floor(s / CELL)));
  const forSegments = (
    polys: readonly Float64Array[],
    fn: (x0: number, y0: number, x1: number, y1: number) => void,
  ) => {
    for (const poly of polys) {
      for (let i = 0; i + 3 < poly.length; i += 2) {
        const x0 = toScreenX(view, poly[i]);
        const y0 = toScreenY(view, poly[i + 1]);
        const x1 = toScreenX(view, poly[i + 2]);
        const y1 = toScreenY(view, poly[i + 3]);
        if (!Number.isFinite(x0 + y0 + x1 + y1)) continue;
        // Entirely off screen.
        if (Math.max(x0, x1) < 0 || Math.min(x0, x1) > view.width) continue;
        if (Math.max(y0, y1) < 0 || Math.min(y0, y1) > view.height) continue;
        fn(x0, y0, x1, y1);
      }
    }
  };
  forSegments(bs, (x0, y0, x1, y1) => {
    const k = segs.length / 4;
    segs.push(x0, y0, x1, y1);
    const c0 = cellOf(Math.min(x0, x1), cols);
    const c1 = cellOf(Math.max(x0, x1), cols);
    const r0 = cellOf(Math.min(y0, y1), rows);
    const r1 = cellOf(Math.max(y0, y1), rows);
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) buckets[r * cols + c].push(k);
  });
  const seen = new Int32Array(segs.length / 4).fill(-1);
  const out: [number, number][] = [];
  let a = 0;
  forSegments(as, (x0, y0, x1, y1) => {
    a++;
    const c0 = cellOf(Math.min(x0, x1), cols);
    const c1 = cellOf(Math.max(x0, x1), cols);
    const r0 = cellOf(Math.min(y0, y1), rows);
    const r1 = cellOf(Math.max(y0, y1), rows);
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        for (const k of buckets[r * cols + c]) {
          if (seen[k] === a) continue;
          seen[k] = a;
          const hit = segmentCrossing(x0, y0, x1, y1, segs, 4 * k);
          if (hit === null) continue;
          if (out.length >= ctx.maxCandidates) throw new TooMany();
          out.push([
            view.cx + (hit[0] - view.width / 2) / view.ppuX,
            view.cy + (view.height / 2 - hit[1]) / view.ppuY,
          ]);
        }
      }
    }
  });
  return out;
}

/** Crossing point of segment p and segment q = segs[k..k+3] (half-open at their ends), or null. */
function segmentCrossing(
  px0: number,
  py0: number,
  px1: number,
  py1: number,
  segs: readonly number[],
  k: number,
): [number, number] | null {
  const qx0 = segs[k];
  const qy0 = segs[k + 1];
  const rx = px1 - px0;
  const ry = py1 - py0;
  const sx = segs[k + 2] - qx0;
  const sy = segs[k + 3] - qy0;
  const den = rx * sy - ry * sx;
  if (den === 0) return null;
  const ox = qx0 - px0;
  const oy = qy0 - py0;
  const t = (ox * sy - oy * sx) / den;
  const u = (ox * ry - oy * rx) / den;
  // Half-open, so a crossing at a shared vertex is counted once.
  if (!(t >= 0 && t < 1 && u >= 0 && u < 1)) return null;
  return [px0 + t * rx, py0 + t * ry];
}

/**
 * Newton's method for F = G = 0 from a polyline crossing; null unless it converges within a
 * couple of pixels of the start.
 */
function newton2(F: Fn2, G: Fn2, start: [number, number], view: Viewport): [number, number] | null {
  let [x, y] = start;
  const hx = 1e-3 / view.ppuX;
  const hy = 1e-3 / view.ppuY;
  for (let i = 0; i < 12; i++) {
    const f = F(x, y);
    const g = G(x, y);
    const fx = (F(x + hx, y) - F(x - hx, y)) / (2 * hx);
    const fy = (F(x, y + hy) - F(x, y - hy)) / (2 * hy);
    const gx = (G(x + hx, y) - G(x - hx, y)) / (2 * hx);
    const gy = (G(x, y + hy) - G(x, y - hy)) / (2 * hy);
    const det = fx * gy - fy * gx;
    if (!Number.isFinite(det) || det === 0) return null;
    const dx = (f * gy - g * fy) / det;
    const dy = (g * fx - f * gx) / det;
    x -= dx;
    y -= dy;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    if (Math.abs(dx) * view.ppuX < 1e-6 && Math.abs(dy) * view.ppuY < 1e-6) {
      const off = Math.hypot((x - start[0]) * view.ppuX, (y - start[1]) * view.ppuY);
      return off <= 2 ? [x, y] : null;
    }
  }
  return null;
}

type AddFn = (kind: PoiKind, other: string | null, find: () => [number, number][]) => void;

/**
 * Points of interest of `target` in `view`: its roots, local extrema and intercepts with the
 * axes, and where it meets each of `others`. Merged where they coincide (the vertex of x² is a
 * minimum, a root and the y-intercept), limited to the view and to `maxPois`, and left out by
 * kind where they would crowd (see the top of this file).
 */
export function findPois(
  target: PoiCurve,
  others: readonly PoiCurve[],
  view: Viewport,
  opts: PoiOptions = {},
): Poi[] {
  const maxPois = opts.maxPois ?? DEFAULT_MAX_POIS;
  if (!(view.width > 0 && view.height > 0 && view.ppuX > 0 && view.ppuY > 0)) return [];
  const b = viewBounds(view);
  const ctx: Ctx = {
    view,
    budget: new Budget(opts.maxEvals ?? DEFAULT_MAX_EVALS),
    maxCandidates: 4 * maxPois,
    ...b,
  };
  const inView = (x: number, y: number) => x >= b.xmin && x <= b.xmax && y >= b.ymin && y <= b.ymax;

  // Each class (a kind, or the intersections with one curve) is found whole or not at all.
  const classes: { kind: PoiKind; other: string | null; points: Candidate[] }[] = [];
  const uncounted = (other: string | null) => {
    if (other !== null && opts.census) opts.census.partial = true;
  };
  const add: AddFn = (kind, other, find) => {
    if (ctx.budget.left <= 0) return uncounted(other);
    let found: [number, number][];
    try {
      found = find();
    } catch (e) {
      if (e instanceof TooMany) return uncounted(other);
      throw e;
    }
    if (ctx.budget.left < 0) return uncounted(other);
    const points: Candidate[] = [];
    for (const [x, y] of found) {
      if (Number.isFinite(x) && Number.isFinite(y) && inView(x, y)) {
        points.push({ x, y, kind, with: other });
      }
    }
    if (points.length === 0) return;
    classes.push({ kind, other, points });
    const census = opts.census;
    if (census) {
      const n = spots(points, view).length;
      if (other === null) census.kinds[kind] = n;
      else census.meets.set(other, n);
    }
  };

  const plot = target.plot;
  if (isExplicit(plot)) {
    explicitPoints(target as PoiCurve & { plot: Explicit }, ctx, add);
  } else if (plot.kind === 'implicit') {
    implicitIntercepts(ctx.budget.wrap2(plot.F), ctx, add);
  } else {
    const p = paramCurve(plot, ctx.budget);
    if (p === null) return [];
    paramIntercepts(p, ctx, add);
  }
  for (const other of others) {
    if (other.id === target.id || other.plot.kind === 'points') continue;
    add('intersection', other.id, () => intersections(target, other, ctx));
  }

  // Shown or left out together: the intersections with one curve, the crossings of one axis,
  // the extrema (maxima without the minima between them would mislead).
  const groups = new Map<string, { rank: number; points: Candidate[] }>();
  for (const c of classes) {
    const extremum = c.kind === 'max' || c.kind === 'min';
    const key = c.other !== null ? `with ${c.other}` : extremum ? 'extrema' : c.kind;
    const rank = c.other !== null ? 0 : extremum ? 2 : 1;
    const group = groups.get(key) ?? { rank, points: [] };
    group.points.push(...c.points);
    groups.set(key, group);
  }
  const ranked = [...groups.values()].sort((p, q) => p.rank - q.rank);

  // The curve's own points (its roots, extrema, intercepts) keep some room, as far as they would
  // show on their own: many other curves crossing it leave its vertex its dot. (Up to half: a
  // curve with many of its own still shows where it meets the others.)
  let own: Candidate[] = [];
  for (const g of ranked) {
    if (g.rank !== 0 && !crowded(own, g.points, view, maxPois)) own = [...own, ...g.points];
  }
  const room = maxPois - Math.min(spots(own, view).length, Math.floor(maxPois / 2));
  // The intersections first, as many as fit beside those, nearest the middle of the view…
  const d = (p: Candidate) => Math.hypot((p.x - view.cx) * view.ppuX, (p.y - view.cy) * view.ppuY);
  let shown: Candidate[] = [];
  for (const g of ranked) {
    if (g.rank === 0 && !crowded([], g.points, view, maxPois)) shown.push(...g.points);
  }
  if (spots(shown, view).length > room) {
    const kept: Candidate[] = [];
    for (const p of shown.sort((p, q) => d(p) - d(q))) {
      if (spots([...kept, p], view).length <= room) kept.push(p);
    }
    shown = kept;
  }
  // …then each other group, unless it would crowd the graph.
  for (const g of ranked) {
    if (g.rank !== 0 && !crowded(shown, g.points, view, maxPois)) shown = [...shown, ...g.points];
  }
  return merge(shown, view);
}

type Spot = { sx: number; sy: number };

/** One screen spot per point: candidates within MERGE_PX of one another are one spot. */
function spots(points: readonly Candidate[], view: Viewport, into: Spot[] = []): Spot[] {
  for (const p of points) {
    const sx = p.x * view.ppuX;
    const sy = p.y * view.ppuY;
    if (!into.some((q) => Math.hypot(q.sx - sx, q.sy - sy) < MERGE_PX)) into.push({ sx, sy });
  }
  return into;
}

/**
 * Whether `added` would crowd the graph next to `shown`: more than `max` spots in all, or many
 * new spots (three or more) typically closer than MIN_GAP_PX to their nearest neighbour. Only
 * the new spots are judged, so points already shown close together (two crossings a few pixels
 * apart) keep nothing else out; repeat passes through one spot (a rose's petals all meet at the
 * origin) are one spot.
 */
function crowded(
  shown: readonly Candidate[],
  added: readonly Candidate[],
  view: Viewport,
  max: number,
): boolean {
  const all = spots(shown, view);
  const before = all.length;
  spots(added, view, all);
  if (all.length > max) return true;
  const fresh = all.slice(before);
  if (fresh.length < 3) return false;
  const gaps = fresh.map((p) => {
    let best = Number.POSITIVE_INFINITY;
    for (const q of all) {
      if (q !== p) best = Math.min(best, Math.hypot(p.sx - q.sx, p.sy - q.sy));
    }
    return best;
  });
  gaps.sort((a, b) => a - b);
  return gaps[gaps.length >> 1] < MIN_GAP_PX;
}

/** One point per spot: candidates within MERGE_PX share it, with all their kinds. */
function merge(candidates: readonly Candidate[], view: Viewport): Poi[] {
  // Most notable first, so a merged point sits where the most exact finder put it.
  const sorted = [...candidates].sort(
    (a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind),
  );
  const out: Poi[] = [];
  for (const c of sorted) {
    const same = out.find(
      (p) => Math.hypot((p.x - c.x) * view.ppuX, (p.y - c.y) * view.ppuY) < MERGE_PX,
    );
    if (same) {
      if (!same.kinds.includes(c.kind)) same.kinds.push(c.kind);
      if (c.with !== null && !same.with.includes(c.with)) same.with.push(c.with);
      continue;
    }
    out.push({ x: c.x, y: c.y, kinds: [c.kind], with: c.with === null ? [] : [c.with] });
  }
  // Exact axis values where a crossing of the axis is part of the point.
  for (const p of out) {
    p.kinds.sort((a, b) => KIND_ORDER.indexOf(a) - KIND_ORDER.indexOf(b));
    if (p.kinds.includes('root') || p.kinds.includes('xIntercept')) p.y = 0;
    if (p.kinds.includes('yIntercept')) p.x = 0;
  }
  return out;
}
