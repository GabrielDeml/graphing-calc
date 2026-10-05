// Exact fits that tell what a curve is: a polynomial of low degree, an exponential, a periodic
// function, a conic. Each one is fitted on a few samples and then checked against the function at
// many more, near and far, to within rounding: a fit that only nearly works is no fit, so a label
// read from it is never a guess (src/plot/insights.ts words them).

import type { Fn1, Fn2 } from '../engine/types';

/** Agreement asked of a fit, relative to the size of the terms involved (rounding is ~1e-16). */
const REL_TOL = 1e-9;
/** Coefficients this much smaller than the largest are taken as zero (rounding in the fit). */
const SNAP = 1e-12;

/** Where polynomials are fitted: irregular, so no pattern in f (a period) lines up with them. */
const FIT_U = [-2.43, -1.71, -0.93, -0.18, 0.61, 1.37, 2.1, 2.87];
/** Where fits are checked: the fit points, and far beyond them. */
const CHECK_U = [...FIT_U, -9876.1, -97.3, -38.9, -11.3, -4.7, 3.9, 7.7, 13.1, 41.9, 103.7, 1234.5];
const MAX_DEGREE = 4;

/**
 * Least squares solution of a·c = b (rows of a are equations), by Householder QR with column
 * scaling. Null when the columns are (numerically) dependent.
 */
export function leastSquares(
  a: readonly (readonly number[])[],
  b: readonly number[],
): number[] | null {
  const m = a.length;
  const n = a[0]?.length ?? 0;
  if (n === 0 || m < n) return null;
  const r = a.map((row) => [...row]);
  const y = [...b];
  const scale: number[] = [];
  for (let j = 0; j < n; j++) {
    let s = 0;
    for (let i = 0; i < m; i++) s = Math.max(s, Math.abs(r[i][j]));
    if (!(s > 0) || !Number.isFinite(s)) return null;
    scale.push(s);
    for (let i = 0; i < m; i++) r[i][j] /= s;
  }
  for (let k = 0; k < n; k++) {
    let norm = 0;
    for (let i = k; i < m; i++) norm += r[i][k] * r[i][k];
    norm = Math.sqrt(norm);
    if (norm === 0) return null;
    const alpha = r[k][k] > 0 ? -norm : norm;
    const v: number[] = [];
    for (let i = k; i < m; i++) v.push(r[i][k]);
    v[0] -= alpha;
    let vv = 0;
    for (const e of v) vv += e * e;
    if (vv === 0) continue;
    for (let j = k; j < n; j++) {
      let s = 0;
      for (let i = 0; i < v.length; i++) s += v[i] * r[k + i][j];
      const f = (2 * s) / vv;
      for (let i = 0; i < v.length; i++) r[k + i][j] -= f * v[i];
    }
    let s = 0;
    for (let i = 0; i < v.length; i++) s += v[i] * y[k + i];
    const f = (2 * s) / vv;
    for (let i = 0; i < v.length; i++) y[k + i] -= f * v[i];
  }
  let maxDiag = 0;
  for (let k = 0; k < n; k++) maxDiag = Math.max(maxDiag, Math.abs(r[k][k]));
  for (let k = 0; k < n; k++) if (!(Math.abs(r[k][k]) > 1e-12 * maxDiag)) return null;
  const c = new Array<number>(n).fill(0);
  for (let k = n - 1; k >= 0; k--) {
    let s = y[k];
    for (let j = k + 1; j < n; j++) s -= r[k][j] * c[j];
    c[k] = s / r[k][k];
  }
  return c.map((v, j) => v / scale[j]);
}

/** Zeroes coefficients that are rounding next to the largest one. */
function snap(c: readonly number[]): number[] {
  let max = 0;
  for (const v of c) max = Math.max(max, Math.abs(v));
  return c.map((v) => (Math.abs(v) <= SNAP * max ? 0 : v));
}

// ---- polynomials (coefficients lowest power first) ----

export function polyEval(c: readonly number[], u: number): number {
  let s = 0;
  for (let k = c.length - 1; k >= 0; k--) s = s * u + c[k];
  return s;
}

/** Σ|c_k u^k|: the size of the terms, which rounding errors are relative to. */
function polyScale(c: readonly number[], u: number): number {
  let s = 0;
  let p = 1;
  for (const v of c) {
    s += Math.abs(v * p);
    p *= u;
  }
  return s;
}

/** Degree, ignoring zero leading coefficients (-1 for the zero polynomial). */
export function polyDegree(c: readonly number[]): number {
  let d = c.length - 1;
  while (d >= 0 && c[d] === 0) d--;
  return d;
}

export function polyDerivative(c: readonly number[]): number[] {
  return c.slice(1).map((v, k) => v * (k + 1));
}

/**
 * y = f(x) as an exact polynomial of degree ≤ 4: its coefficients, lowest power first (with
 * no zero leading ones), or null when f is no such polynomial (or isn't finite everywhere).
 */
export function polyFit(f: Fn1): number[] | null {
  const values = FIT_U.map(f);
  if (!values.every(Number.isFinite)) return null;
  const floor = 1e-12 * Math.max(...values.map(Math.abs));
  for (let d = 0; d <= MAX_DEGREE; d++) {
    const rows = FIT_U.map((u) => Array.from({ length: d + 1 }, (_, k) => u ** k));
    const fitted = leastSquares(rows, values);
    if (!fitted) continue;
    const c = snap(fitted);
    const ok = CHECK_U.every((u) => {
      const v = f(u);
      if (!Number.isFinite(v)) return false;
      return Math.abs(polyEval(c, u) - v) <= REL_TOL * (polyScale(c, u) + Math.abs(v)) + floor;
    });
    if (ok) return c.slice(0, polyDegree(c) + 1);
  }
  return null;
}

/** Bisection of a sign change of p on [a, b], to the last bit. */
function bisect(c: readonly number[], a0: number, b0: number): number {
  let a = a0;
  let b = b0;
  let pa = polyEval(c, a);
  for (let i = 0; i < 200; i++) {
    const m = 0.5 * (a + b);
    if (m === a || m === b) break;
    const pm = polyEval(c, m);
    if (pm === 0) return m;
    if (pm * pa < 0) b = m;
    else {
      a = m;
      pa = pm;
    }
  }
  return 0.5 * (a + b);
}

/**
 * The distinct real roots of a polynomial, ascending. A root where the curve only touches zero
 * (x², a double root) counts once.
 */
export function polyRoots(c0: readonly number[]): number[] {
  const c = snap(c0);
  const n = polyDegree(c);
  if (n <= 0) return [];
  if (n === 1) return [-c[0] / c[1]];
  if (n === 2) {
    const [cc, b, a] = c;
    const disc = b * b - 4 * a * cc;
    const tol = 1e-12 * (b * b + Math.abs(4 * a * cc));
    if (disc < -tol) return [];
    if (disc <= tol) return [-b / (2 * a)];
    // The stable pair: no cancellation between -b and the root of the discriminant.
    const q = -0.5 * (b + Math.sign(b || 1) * Math.sqrt(disc));
    const roots = [q / a, cc / q];
    return dedupe(roots.sort((p, r) => p - r));
  }
  // Between consecutive turning points p is monotonic: one sign change at most.
  const crit = polyRoots(polyDerivative(c));
  let bound = 1;
  for (let k = 0; k < n; k++) bound = Math.max(bound, 1 + Math.abs(c[k] / c[n]));
  const stops = [-bound, ...crit.filter((x) => x > -bound && x < bound), bound];
  const roots: number[] = [];
  for (let i = 0; i + 1 < stops.length; i++) {
    const a = stops[i];
    const b = stops[i + 1];
    const pa = polyEval(c, a);
    const pb = polyEval(c, b);
    if (pa === 0) roots.push(a);
    if (pa * pb < 0) roots.push(bisect(c, a, b));
  }
  if (polyEval(c, bound) === 0) roots.push(bound);
  // A turning point on the axis: a root of even multiplicity.
  for (const x of crit) {
    if (Math.abs(polyEval(c, x)) <= 1e-10 * polyScale(c, x)) roots.push(x);
  }
  return dedupe(roots.sort((p, r) => p - r));
}

/** Sorted values without near-duplicates (a root found twice). */
function dedupe(sorted: readonly number[]): number[] {
  const out: number[] = [];
  for (const v of sorted) {
    const last = out.at(-1);
    if (last === undefined || Math.abs(v - last) > 1e-9 * (1 + Math.abs(v))) out.push(v);
  }
  return out;
}

/** Where p turns (a local maximum or minimum): roots of p' where p' changes sign. */
export function polyTurningPoints(c: readonly number[]): number[] {
  const d = polyDerivative(c);
  return polyRoots(d).filter((x) => {
    const h = 1e-4 * (1 + Math.abs(x));
    return polyEval(d, x - h) * polyEval(d, x + h) < 0;
  });
}

// ---- exponentials ----

export interface ExpFit {
  /** f(x) = a·base^x + c. */
  a: number;
  base: number;
  c: number;
}

/**
 * y = f(x) as a·b^x + c with b > 0, b ≠ 1, a ≠ 0 (its first differences have a constant
 * ratio), checked over a range where b^x spans e^±20. Null otherwise.
 */
export function expFit(f: Fn1): ExpFit | null {
  const h = 0.5;
  const u0 = -1.37;
  const fs = Array.from({ length: 6 }, (_, k) => f(u0 + k * h));
  if (!fs.every(Number.isFinite)) return null;
  const d = fs.slice(1).map((v, k) => v - fs[k]);
  if (d.some((v) => v === 0)) return null;
  const r = d[1] / d[0];
  for (let k = 1; k < d.length; k++) {
    if (Math.abs(d[k] / d[k - 1] - r) > 1e-9 * Math.abs(r)) return null;
  }
  if (!(r > 0) || Math.abs(r - 1) < 1e-6) return null;
  const base = r ** (1 / h);
  const a = d[0] / ((r - 1) * base ** u0);
  let c = fs[0] - a * base ** u0;
  if (Math.abs(c) <= 1e-9 * (Math.abs(a * base ** u0) + Math.abs(fs[0]))) c = 0;
  if (!Number.isFinite(a) || !Number.isFinite(c) || a === 0) return null;
  const s = 1 / Math.abs(Math.log(base));
  for (const t of [-20, -9.3, -3.1, 0.7, 4.4, 11.2, 20]) {
    const x = t * s;
    const v = f(x);
    const model = a * base ** x + c;
    if (!Number.isFinite(v)) return null;
    if (Math.abs(model - v) > REL_TOL * (Math.abs(a * base ** x) + Math.abs(c) + Math.abs(v))) {
      return null;
    }
  }
  return { a, base, c };
}

// ---- periods ----

/** Base periods of the trig functions DocumentEngine.trigArguments reports. */
const TWO_PI = 2 * Math.PI;

/**
 * The slope k of an argument g(u) = k·u + c, or null when g is not affine.
 */
export function affineSlope(g: Fn1): number | null {
  const g0 = g(0);
  const k = (g(1.3) - g(-0.7)) / 2;
  if (!Number.isFinite(g0) || !Number.isFinite(k)) return null;
  for (const u of [-31.7, -2.9, 0.37, 5.3, 47.9]) {
    const v = g(u);
    if (!(Math.abs(v - (k * u + g0)) <= 1e-9 * (Math.abs(k * u) + Math.abs(g0) + 1))) return null;
  }
  return k;
}

/** Whether f repeats every `period`, at points spread over a few periods and farther out. */
function repeats(f: Fn1, period: number): boolean {
  let scale = 0;
  const xs: number[] = [];
  for (let i = 0; i < 24; i++) xs.push(period * (-3 + (6 * (i + 0.3819660112501051)) / 24));
  xs.push(period * 17.31, -period * 41.7);
  const pairs = xs.map((x) => [f(x), f(x + period)] as const);
  for (const [a] of pairs) if (Number.isFinite(a)) scale = Math.max(scale, Math.abs(a));
  return pairs.every(([a, b]) => {
    if (!Number.isFinite(a) || !Number.isFinite(b))
      return !Number.isFinite(a) && !Number.isFinite(b);
    return Math.abs(a - b) <= 1e-8 * (Math.abs(a) + Math.abs(b) + scale) + 1e-300;
  });
}

/**
 * The smallest period of f, from the slopes of its trig arguments: their periods (2π/k, π/k
 * for tan and cot, as `halfTurn`) must have a common multiple, and f must repeat after it (or
 * after a fraction of it: sin² x every π). Null when f has no period this way.
 */
export function periodOf(
  f: Fn1,
  args: readonly { slope: number; halfTurn: boolean }[],
): number | null {
  const periods: number[] = [];
  for (const { slope, halfTurn } of args) {
    if (slope === 0) continue;
    periods.push((halfTurn ? Math.PI : TWO_PI) / Math.abs(slope));
  }
  if (periods.length === 0) return null;
  const p0 = Math.min(...periods);
  let common: number | null = null;
  for (let n = 1; n <= 24 && common === null; n++) {
    const candidate = p0 * n;
    if (periods.every((p) => Math.abs(candidate / p - Math.round(candidate / p)) < 1e-9)) {
      common = candidate;
    }
  }
  if (common === null) return null;
  for (let m = 12; m >= 1; m--) {
    if (repeats(f, common / m)) return common / m;
  }
  return null;
}

/**
 * The highest and lowest values of f over one period, refined around the best samples. Null
 * where f jumps (a pole, a sawtooth) or isn't finite.
 */
export function extremesOver(
  f: Fn1,
  start: number,
  period: number,
): { max: number; min: number; argMax: number } | null {
  const n = 1024;
  const h = period / n;
  let max = Number.NEGATIVE_INFINITY;
  let min = Number.POSITIVE_INFINITY;
  let iMax = 0;
  let iMin = 0;
  const vs: number[] = [];
  for (let i = 0; i <= n + 1; i++) {
    const v = f(start + (i - 0.5) * h);
    if (!Number.isFinite(v)) return null;
    vs.push(v);
  }
  // A jump (a pole, a sawtooth's drop) between samples: no extremes to speak of.
  let jump = 0;
  for (let i = 1; i <= n + 1; i++) jump = Math.max(jump, Math.abs(vs[i] - vs[i - 1]));
  for (let i = 1; i <= n; i++) {
    if (vs[i] > max) {
      max = vs[i];
      iMax = i;
    }
    if (vs[i] < min) {
      min = vs[i];
      iMin = i;
    }
  }
  if (jump > (max - min) / 16) return null;
  // A parabola through the best sample and its neighbours.
  const refine = (i: number, sign: 1 | -1) => {
    const a = vs[i - 1];
    const b = vs[i];
    const c = vs[i + 1];
    const den = a - 2 * b + c;
    if (den === 0) return { x: start + (i - 0.5) * h, v: b };
    const t = Math.max(-1, Math.min(1, (0.5 * (a - c)) / den));
    const x = start + (i - 0.5 + t) * h;
    const v = f(x);
    return Number.isFinite(v) && sign * v >= sign * b
      ? { x, v }
      : { x: start + (i - 0.5) * h, v: b };
  };
  const top = refine(iMax, 1);
  const bottom = refine(iMin, -1);
  return { max: top.v, min: bottom.v, argMax: top.x };
}

// ---- conics ----

/** A x² + B xy + C y² + D x + E y + F = 0, scaled so the largest coefficient is ±1. */
export interface Conic {
  A: number;
  B: number;
  C: number;
  D: number;
  E: number;
  F: number;
}

const CONIC_FIT = [-1.7, -0.3, 0.9, 2.2];
const CONIC_CHECK = [-41.3, -13.7, 0.45, 6.1, 29.9];

/**
 * F(x, y) as an exact quadratic polynomial in x and y: the conic F = 0. Null when it is not
 * (or isn't finite everywhere).
 */
export function conicFit(F: Fn2): Conic | null {
  const rows: number[][] = [];
  const values: number[] = [];
  for (const x of CONIC_FIT) {
    for (const y of CONIC_FIT) {
      const v = F(x, y);
      if (!Number.isFinite(v)) return null;
      rows.push([x * x, x * y, y * y, x, y, 1]);
      values.push(v);
    }
  }
  const fitted = leastSquares(rows, values);
  if (!fitted) return null;
  const c = snap(fitted);
  const terms = (x: number, y: number) => [x * x, x * y, y * y, x, y, 1];
  const floor = 1e-12 * Math.max(...values.map(Math.abs));
  for (const x of [...CONIC_FIT, ...CONIC_CHECK]) {
    for (const y of CONIC_CHECK) {
      const v = F(x, y);
      if (!Number.isFinite(v)) return null;
      const t = terms(x, y).map((e, k) => e * c[k]);
      const q = t.reduce((s, e) => s + e, 0);
      const size = t.reduce((s, e) => s + Math.abs(e), 0);
      if (Math.abs(q - v) > REL_TOL * (size + Math.abs(v)) + floor) return null;
    }
  }
  const max = Math.max(...c.map(Math.abs));
  if (!(max > 0)) return null;
  const [A, B, C, D, E, F0] = c.map((v) => v / max);
  return { A, B, C, D, E, F: F0 };
}

// ---- trig series ----

/**
 * Coefficients of f(u) = Σ_j w_j(u) c_j over the basis `basis`, checked at many points; null when
 * f is not of that form.
 */
export function basisFit(f: Fn1, basis: readonly Fn1[], span: number): number[] | null {
  const fitU = Array.from({ length: 16 }, (_, i) => span * ((i + 0.3819660112501051) / 16));
  const values = fitU.map(f);
  if (!values.every(Number.isFinite)) return null;
  const fitted = leastSquares(
    fitU.map((u) => basis.map((b) => b(u))),
    values,
  );
  if (!fitted) return null;
  const c = snap(fitted);
  const floor = 1e-12 * Math.max(...values.map(Math.abs));
  for (let i = 0; i < 40; i++) {
    const u = span * ((i + Math.SQRT1_2) / 40) * 1.7 - 0.35 * span;
    const v = f(u);
    if (!Number.isFinite(v)) return null;
    let q = 0;
    let size = 0;
    basis.forEach((b, j) => {
      const t = b(u) * c[j];
      q += t;
      size += Math.abs(t);
    });
    if (Math.abs(q - v) > REL_TOL * (size + Math.abs(v)) + floor) return null;
  }
  return c;
}
