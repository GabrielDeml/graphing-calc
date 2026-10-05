// What a row's curve is, in one quiet line under it: "Parabola · vertex (1, −2) · roots −0.414,
// 2.414 · axis x = 1". Nothing in it is a guess. The models come from src/plot/fit.ts, which fits
// each on a few samples and then holds it to the function at many more, near and far; what is
// read off a model (a vertex, a circle's radius) is checked on the curve again here. Where no
// model holds, the line only counts what the graph found in view for the selected row, or says
// nothing.
//
//   - y = f(x) (and x = f(y)): an exact polynomial of degree ≤ 4 (a line, a parabola, a cubic, a
//     quartic: their roots, vertex, turning points), an exponential a·bˣ + c (its base and
//     asymptote), a periodic function (its period, from the slopes of its trig arguments and
//     checked as f(x + P) = f(x); its amplitude and midline), else the roots, turning points and
//     vertical asymptotes in view;
//   - an implicit equation: a conic (circle, ellipse, hyperbola, parabola, line, a pair of lines);
//   - r = f(θ): a circle, a cardioid or limaçon, a k-petal rose, an Archimedean spiral;
//   - parametric: a segment, a circle or an ellipse, else whether it closes;
//   - a variable or function: the rows that use it;
//   - the selected curve: where it meets the others (exactly, for two polynomials), after what
//     the curve is first, so it shows in the one line.
// Numbers read as words do: four significant digits, true minus signs, multiples of π as such.

import { formatPlain, formatValue } from '../engine/format';
import type { Fn1, Fn2, PlotItem, RowKind } from '../engine/types';
import {
  affineSlope,
  basisFit,
  type Conic,
  conicFit,
  expFit,
  extremesOver,
  periodOf,
  polyDerivative,
  polyEval,
  polyFit,
  polyRoots,
  polyTurningPoints,
} from './fit';
import type { PoiKind } from './poi';
import type { Bounds } from './types';

export interface Point {
  x: number;
  y: number;
}

/**
 * A number the line shows, as a chip; one `at` a point is a button that flies the graph there,
 * and pins the trace on it unless it is `offCurve` (a circle's centre).
 */
export interface InsightValue {
  /** As shown: "(1, −2)", "2π", "−0.414", "y = 2x + 1". */
  text: string;
  /** What it is ("Vertex", "Root"): its accessible name is this and the text, "Vertex (1, −2)". */
  name: string;
  at?: Point;
  offCurve?: boolean;
}

/** One part of the line: words, then values or rows, then more words. */
export interface InsightFact {
  /** Words before the values ("vertex", "used by"). */
  label: string;
  values?: InsightValue[];
  /** Other rows it names, by id (a dot in their color and their math). */
  rows?: string[];
  /** Words after them ("at 3 points"). */
  tail?: string;
}

export interface Insight {
  /** What the curve is ("Parabola"), when that is known. */
  title?: string;
  facts: InsightFact[];
}

/** What the graph found in view for the selected row (its points of interest, before any were
 * left out to keep the graph readable). */
export interface InViewFacts {
  /** The view the counts are for. */
  bounds: Bounds;
  /** Points of each kind in view; a kind missing was not found (or too many to count). */
  counts: Partial<Record<PoiKind, number>>;
  /** How many points it meets each other curve at in view, by row id. */
  meets: ReadonlyMap<string, number>;
}

export interface InsightInput {
  kind: RowKind;
  plot?: PlotItem;
  /** Arguments of the trig calls in what the row plots (DocumentEngine.trigArguments). */
  trigArgs?: readonly Fn1[] | null;
  /** For a variable or a function: the rows that use it, in list order. */
  usedBy?: readonly string[];
  /** The selected row: the other curves on the graph… */
  others?: readonly { id: string; plot: PlotItem }[];
  /** …and what the graph found in view. */
  inView?: InViewFacts | null;
}

const MINUS = '−';
const TAU = 2 * Math.PI;
/** Users named before "+2 more". */
const MAX_USERS = 3;
/** Curves named as met. */
const MAX_MEETS = 3;
/** Poles named in view (more are counted). */
const MAX_POLES = 3;
/** Agreement asked of a value read off a model, checked on the curve. */
const CHECK_TOL = 1e-7;

/** A number as the line shows it: 4 significant digits, a true minus sign. */
export function num(v: number): string {
  const s = Math.abs(v) >= 1e10 ? formatValue(v) : formatPlain(v, 4);
  return s.replace('-', MINUS);
}

/** "(1, −2)". */
export function pointText(p: Point): string {
  return `(${num(p.x)}, ${num(p.y)})`;
}

/** A multiple of π as one ("2π", "π/2", "−3π/4"), else the number. */
export function piText(v: number): string {
  for (let q = 1; q <= 12; q++) {
    const p = Math.round((v * q) / Math.PI);
    if (p !== 0 && Math.abs(v - (p * Math.PI) / q) <= 1e-9 * Math.abs(v)) {
      const head = p === 1 ? 'π' : p === -1 ? `${MINUS}π` : `${num(p)}π`;
      return q === 1 ? head : `${head}/${q}`;
    }
  }
  return num(v);
}

/** "y = 2x − 1", "y = −x", "y = 3": `v = m·u + b`. */
export function lineText(v: string, u: string, m: number, b: number): string {
  const mt = num(m);
  let s = mt === '0' ? '' : mt === '1' ? u : mt === `${MINUS}1` ? `${MINUS}${u}` : `${mt}${u}`;
  const bt = num(b);
  if (bt !== '0') {
    if (s === '') s = bt;
    else s = bt.startsWith(MINUS) ? `${s} ${MINUS} ${bt.slice(1)}` : `${s} + ${bt}`;
  }
  return `${v} = ${s === '' ? '0' : s}`;
}

/** A centre: flying there shows it, but it is not on the curve to pin the trace on. */
function centreValue(p: Point): InsightValue {
  return { text: pointText(p), name: 'Centre', at: p, offCurve: true };
}

/** "1 root", "3 roots". */
function count(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

// ---- y = f(x) and x = f(y) ----

/** v = f(u): y = f(x) (axis 'x') or x = f(y) (axis 'y'). */
interface Explicit {
  f: Fn1;
  axis: 'x' | 'y';
}

// (+ 0 turns a -0 into 0.)
const pt = (e: Explicit, u: number, v: number): Point =>
  e.axis === 'x' ? { x: u + 0, y: v + 0 } : { x: v + 0, y: u + 0 };
const valueAxis = (e: Explicit) => (e.axis === 'x' ? 'y' : 'x');
/** Where the curve crosses v = 0: a root of y = f(x), a y-intercept of x = f(y). */
const rootWords = (e: Explicit) =>
  e.axis === 'x'
    ? (['Root', 'root', 'roots'] as const)
    : (['y-intercept', 'y-intercept', 'y-intercepts'] as const);
/** Where u = 0. */
const interceptWords = (e: Explicit) => (e.axis === 'x' ? 'y-intercept' : 'x-intercept');

/** Values as shown, each once (two roots closer than four digits tell apart read as one). */
function distinct(values: InsightValue[]): InsightValue[] {
  return values.filter((v, i) => values.findIndex((w) => w.text === v.text) === i);
}

function rootsFact(e: Explicit, roots: readonly number[]): InsightFact[] {
  if (roots.length === 0) return [];
  const [name, one, many] = rootWords(e);
  const values = distinct(roots.map((r) => ({ text: num(r), name, at: pt(e, r, 0) })));
  return [{ label: values.length === 1 ? one : many, values }];
}

function polynomialInsight(e: Explicit, c: readonly number[]): Insight {
  const d = c.length - 1;
  const p = (u: number) => polyEval(c, u);
  const v = valueAxis(e);
  if (d <= 0) {
    const v0 = c[0] ?? 0;
    return {
      title: e.axis === 'x' ? 'Horizontal line' : 'Vertical line',
      facts: [
        { label: `${v} =`, values: [{ text: num(v0), name: interceptWords(e), at: pt(e, 0, v0) }] },
      ],
    };
  }
  if (d === 1) {
    const [b, m] = c;
    const [root] = polyRoots(c);
    // dy/dx: m for y = m x + b, 1/m for x = m y + b.
    const slope = e.axis === 'x' ? m : 1 / m;
    const facts: InsightFact[] = [
      { label: 'slope', values: [{ text: num(slope), name: 'Slope' }] },
    ];
    if (num(b) === '0') {
      facts.push({
        label: 'through',
        values: [{ text: '(0, 0)', name: 'Origin', at: { x: 0, y: 0 } }],
      });
    } else {
      const atU0 = { label: interceptWords(e), text: num(b), at: pt(e, 0, b) };
      const atV0 = { label: `${e.axis}-intercept`, text: num(root), at: pt(e, root, 0) };
      // The y-intercept first, then the x-intercept, whichever way the line is written.
      for (const f of e.axis === 'x' ? [atU0, atV0] : [atV0, atU0]) {
        facts.push({ label: f.label, values: [{ text: f.text, name: f.label, at: f.at }] });
      }
    }
    return { title: 'Line', facts };
  }
  const facts: InsightFact[] = [];
  if (d === 2) {
    const u0 = -c[1] / (2 * c[2]);
    const vertex = pt(e, u0, p(u0));
    facts.push({
      label: 'vertex',
      values: [{ text: pointText(vertex), name: 'Vertex', at: vertex }],
    });
    facts.push(...rootsFact(e, polyRoots(c)));
    facts.push({
      label: 'axis',
      values: [{ text: `${e.axis} = ${num(u0)}`, name: 'Axis of symmetry' }],
    });
    return { title: 'Parabola', facts };
  }
  facts.push(...rootsFact(e, polyRoots(c)));
  const second = polyDerivative(polyDerivative(c));
  const turns = distinct(
    polyTurningPoints(c).map((u) => {
      const at = pt(e, u, p(u));
      const name =
        e.axis === 'y'
          ? 'Turning point'
          : polyEval(second, u) < 0
            ? 'Local maximum'
            : 'Local minimum';
      return { text: pointText(at), name, at };
    }),
  );
  if (turns.length > 0) {
    facts.push({
      label: turns.length === 1 ? 'turning point' : 'turning points',
      values: turns,
    });
  } else if (d === 3) {
    // A cubic that never turns still bends one way and then the other, once.
    const u = -c[2] / (3 * c[3]);
    const at = pt(e, u, p(u));
    facts.push({
      label: 'inflection point',
      values: [{ text: pointText(at), name: 'Inflection point', at }],
    });
  }
  return { title: d === 3 ? 'Cubic' : 'Quartic', facts };
}

function exponentialInsight(e: Explicit): Insight | null {
  const fit = expFit(e.f);
  if (!fit) return null;
  const { a, base, c } = fit;
  const v = valueAxis(e);
  const baseText = Math.abs(base - Math.E) <= 1e-9 * Math.E ? 'e' : num(base);
  const at0 = pt(e, 0, a + c);
  return {
    title: base > 1 ? 'Exponential growth' : 'Exponential decay',
    facts: [
      { label: 'base', values: [{ text: baseText, name: 'Base' }] },
      { label: 'asymptote', values: [{ text: `${v} = ${num(c)}`, name: 'Asymptote' }] },
      {
        label: interceptWords(e),
        values: [{ text: num(a + c), name: interceptWords(e), at: at0 }],
      },
    ],
  };
}

function periodicInsight(e: Explicit, args: readonly Fn1[] | null | undefined): Insight | null {
  if (!args || args.length === 0) return null;
  const slopes: { slope: number; halfTurn: boolean }[] = [];
  for (const g of args) {
    const slope = affineSlope(g);
    // An argument like x² has no period to give.
    if (slope === null) return null;
    // The base period 2π for all: periodOf also tries fractions of it (tan x repeats every π).
    slopes.push({ slope, halfTurn: false });
  }
  const period = periodOf(e.f, slopes);
  if (period === null) return null;
  const facts: InsightFact[] = [
    { label: 'period', values: [{ text: piText(period), name: 'Period' }] },
  ];
  let title = 'Periodic';
  const ext = extremesOver(e.f, 0, period);
  if (ext && ext.max > ext.min) {
    const top = pt(e, ext.argMax, ext.max);
    facts.push({
      label: 'amplitude',
      values: [{ text: num((ext.max - ext.min) / 2), name: 'Amplitude', at: top }],
    });
    facts.push({
      label: 'midline',
      values: [{ text: `${valueAxis(e)} = ${num((ext.max + ext.min) / 2)}`, name: 'Midline' }],
    });
    const w = TAU / period;
    const wave = [() => 1, (u: number) => Math.cos(w * u), (u: number) => Math.sin(w * u)];
    if (basisFit(e.f, wave, period)) title = 'Sine wave';
  }
  return { title, facts };
}

/**
 * Where f has a pole in [lo, hi] (x = 0 for 1/x and 1/x², π/2 for tan x): where its samples change
 * sign or peak in size, refined, and only where |f| then keeps growing as a pole's does (a
 * hundredfold, at least, a thousand times nearer). A jump (floor x) or a slow climb (ln|x|) is
 * none. Ascending; null when there are more than `max`.
 */
export function polesIn(f: Fn1, lo: number, hi: number, max = 8): number[] | null {
  const w = hi - lo;
  if (!(w > 0) || !Number.isFinite(w)) return [];
  const n = 512;
  const us = Array.from({ length: n }, (_, i) => lo + (w * (i + 0.3819660112501051)) / n);
  const vs = us.map(f);
  const found: number[] = [];
  const keep = (x: number) => {
    if (isPole(f, x, w) && !found.some((p) => Math.abs(p - x) <= 1e-9 * w)) found.push(x);
  };
  for (let i = 0; i + 1 < n; i++) {
    const [a, b] = [vs[i], vs[i + 1]];
    if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
    if ((a < 0 && b > 0) || (a > 0 && b < 0)) keep(bisectSign(f, us[i], a, us[i + 1]));
    const prev = vs[i - 1];
    if (
      i > 0 &&
      Number.isFinite(prev) &&
      Math.abs(a) > Math.abs(prev) &&
      Math.abs(a) >= Math.abs(b) &&
      Math.sign(a) === Math.sign(prev) &&
      Math.sign(a) === Math.sign(b)
    ) {
      keep(peakOf(f, us[i - 1], us[i + 1]));
    }
    if (found.length > max) return null;
  }
  return found.sort((p, q) => p - q);
}

/** Bisection of a sign change of f on [a, b] (f(a) = fa), to where it is (a root or a pole). */
function bisectSign(f: Fn1, a0: number, fa: number, b0: number): number {
  let [a, b, flo] = [a0, b0, fa];
  for (let i = 0; i < 100; i++) {
    const m = 0.5 * (a + b);
    if (m === a || m === b) break;
    const fm = f(m);
    if (!Number.isFinite(fm)) return m;
    if (fm < 0 === flo < 0) {
      a = m;
      flo = fm;
    } else b = m;
  }
  return 0.5 * (a + b);
}

/** Where |f| is largest on [a, b], by golden section (non-finite counts as largest). */
function peakOf(f: Fn1, a0: number, b0: number): number {
  const size = (u: number) => {
    const v = Math.abs(f(u));
    return Number.isNaN(v) ? Number.NEGATIVE_INFINITY : v;
  };
  const g = 0.6180339887498949;
  let [a, b] = [a0, b0];
  let c = b - g * (b - a);
  let d = a + g * (b - a);
  let [fc, fd] = [size(c), size(d)];
  for (let i = 0; i < 80 && c < d; i++) {
    if (fc >= fd) {
      b = d;
      d = c;
      fd = fc;
      c = b - g * (b - a);
      fc = size(c);
    } else {
      a = c;
      c = d;
      fc = fd;
      d = a + g * (b - a);
      fd = size(d);
    }
  }
  return 0.5 * (a + b);
}

/** Whether |f| grows as a pole's does toward x, on the side it grows on (`w`: the range's width). */
function isPole(f: Fn1, x: number, w: number): boolean {
  const near = (d: number) => Math.max(Math.abs(f(x - d)), Math.abs(f(x + d)));
  const far = near(1e-4 * w);
  const close = near(1e-7 * w);
  if (!Number.isFinite(far) || !(far > 0)) return false;
  return !Number.isFinite(close) ? close > 0 : close >= 100 * far;
}

/** What the graph counted in view, for a curve no model fits. */
function inViewInsight(e: Explicit, inView: InViewFacts): InsightFact[] {
  const { counts, bounds } = inView;
  const words: string[] = [];
  const roots = counts[e.axis === 'x' ? 'root' : 'yIntercept'];
  if (roots) words.push(count(roots, rootWords(e)[1], rootWords(e)[2]));
  const turns = (counts.max ?? 0) + (counts.min ?? 0);
  if (turns) words.push(count(turns, 'turning point', 'turning points'));
  const [lo, hi] = e.axis === 'x' ? [bounds.xmin, bounds.xmax] : [bounds.ymin, bounds.ymax];
  const poles = polesIn(e.f, lo, hi, MAX_POLES * 4);
  const kind = e.axis === 'x' ? 'vertical asymptote' : 'horizontal asymptote';
  const facts: InsightFact[] = [];
  if (poles && poles.length > MAX_POLES) words.push(count(poles.length, kind, `${kind}s`));
  if (words.length > 0) facts.push({ label: `in view: ${words.join(', ')}` });
  if (poles && poles.length > 0 && poles.length <= MAX_POLES) {
    facts.push({
      label: poles.length === 1 ? kind : `${kind}s`,
      values: poles.map((u) => ({ text: `${e.axis} = ${num(u)}`, name: 'Asymptote' })),
    });
  }
  return facts;
}

function explicitInsight(e: Explicit, input: InsightInput): Insight | null {
  const poly = polyFit(e.f);
  if (poly) return polynomialInsight(e, poly);
  const found = exponentialInsight(e) ?? periodicInsight(e, input.trigArgs);
  if (found) return found;
  const facts = input.inView ? inViewInsight(e, input.inView) : [];
  return facts.length > 0 ? { facts } : null;
}

// ---- conics ----

/** Whether a point lies on the conic, to rounding relative to the size of its terms. */
function onConic(q: Conic, p: Point): boolean {
  const { x, y } = p;
  const terms = [q.A * x * x, q.B * x * y, q.C * y * y, q.D * x, q.E * y, q.F];
  let sum = 0;
  let size = 0;
  for (const t of terms) {
    sum += t;
    size += Math.abs(t);
  }
  return Number.isFinite(sum) && Math.abs(sum) <= CHECK_TOL * size;
}

/** The line through p with direction d, as text ("y = 2x + 1", "x = 3"). */
function lineThrough(p: Point, d: Point): string {
  if (Math.abs(d.x) <= 1e-12 * Math.abs(d.y)) return `x = ${num(p.x)}`;
  const m = d.y / d.x;
  return lineText('y', 'x', m, p.y - m * p.x);
}

/**
 * What the conic A x² + B xy + C y² + D x + E y + F = 0 is (coefficients scaled to a largest of
 * ±1), read in axes turned to take its xy term away, and checked: every point named lies on it.
 */
export function describeConic(q: Conic): Insight | null {
  const tol = 1e-9;
  const { A, B, C, D, E, F } = q;
  const phi = B === 0 ? 0 : 0.5 * Math.atan2(B, A - C);
  const [cs, sn] = [Math.cos(phi), Math.sin(phi)];
  const toXY = (u: number, v: number): Point => ({ x: u * cs - v * sn, y: u * sn + v * cs });
  // In the turned axes (u, v): a u² + c v² + d u + e v + F = 0.
  let a = A * cs * cs + B * cs * sn + C * sn * sn;
  let c = A * sn * sn - B * sn * cs + C * cs * cs;
  const d = D * cs + E * sn;
  const e = -D * sn + E * cs;
  if (Math.abs(a) <= tol) a = 0;
  if (Math.abs(c) <= tol) c = 0;
  const checked = (insight: Insight, points: Point[]) =>
    points.every((p) => onConic(q, p)) ? insight : null;
  const at = (name: string, p: Point): InsightValue => ({ text: pointText(p), name, at: p });

  if (a === 0 && c === 0) {
    // D x + E y + F = 0 (no turn was needed).
    if (Math.abs(E) > tol) {
      const m = -D / E;
      const b = -F / E;
      const p0 = { x: 0, y: b };
      const facts: InsightFact[] = [{ label: 'slope', values: [{ text: num(m), name: 'Slope' }] }];
      facts.push({ label: 'y-intercept', values: [{ text: num(b), name: 'y-intercept', at: p0 }] });
      return checked({ title: 'Line', facts }, [p0, { x: 1, y: m + b }]);
    }
    if (Math.abs(D) <= tol) return null;
    const x0 = -F / D;
    const p0 = { x: x0, y: 0 };
    return checked(
      {
        title: 'Vertical line',
        facts: [{ label: 'x =', values: [{ text: num(x0), name: 'x-intercept', at: p0 }] }],
      },
      [p0, { x: x0, y: 1 }],
    );
  }

  if (a !== 0 && c !== 0) {
    const u0 = -d / (2 * a);
    const v0 = -e / (2 * c);
    const centre = toXY(u0, v0);
    // a (u - u0)² + c (v - v0)² = -k.
    const k = F - (d * d) / (4 * a) - (e * e) / (4 * c);
    const kTol = tol * (Math.abs(F) + (d * d) / Math.abs(4 * a) + (e * e) / Math.abs(4 * c));
    if (a * c > 0) {
      if (Math.abs(k) <= kTol || -k / a < 0) return null; // a single point, or nothing
      const ru = Math.sqrt(-k / a);
      const rv = Math.sqrt(-k / c);
      const ends = [toXY(u0 + ru, v0), toXY(u0, v0 + rv), toXY(u0 - ru, v0), toXY(u0, v0 - rv)];
      if (Math.abs(ru - rv) <= 1e-9 * Math.max(ru, rv)) {
        return checked(
          {
            title: 'Circle',
            facts: [
              { label: 'centre', values: [centreValue(centre)] },
              {
                label: 'radius',
                values: [{ text: num(ru), name: 'Radius', at: ends[0] }],
              },
            ],
          },
          ends,
        );
      }
      const [major, minor] = ru >= rv ? [ru, rv] : [rv, ru];
      const [majorEnd, minorEnd] = ru >= rv ? [ends[0], ends[1]] : [ends[1], ends[0]];
      const facts: InsightFact[] = [
        { label: 'centre', values: [centreValue(centre)] },
        {
          label: 'semi-axes',
          values: [
            { text: num(major), name: 'Semi-major axis', at: majorEnd },
            { text: num(minor), name: 'Semi-minor axis', at: minorEnd },
          ],
        },
      ];
      // The major axis's angle, in (-90°, 90°].
      let angle = ((ru >= rv ? phi : phi + Math.PI / 2) * 180) / Math.PI;
      while (angle > 90) angle -= 180;
      while (angle <= -90) angle += 180;
      if (num(angle) !== '0' && num(angle) !== '90') {
        facts.push({ label: 'tilted', values: [{ text: `${num(angle)}°`, name: 'Tilt' }] });
      }
      return checked({ title: 'Ellipse', facts }, ends);
    }
    // a, c of opposite signs: a hyperbola, or two lines crossing at the centre.
    const slope = Math.sqrt(-a / c);
    const dirs = [toXY(1, slope), toXY(1, -slope)];
    const asymptotes = dirs.map((dir) => lineThrough(centre, dir));
    if (Math.abs(k) <= kTol) {
      const facts: InsightFact[] = [
        { label: 'meeting at', values: [at('Crossing', centre)] },
        {
          label: '',
          values: asymptotes.map((text) => ({ text, name: 'Line' })),
        },
      ];
      const along = dirs.map((dir) => ({ x: centre.x + dir.x, y: centre.y + dir.y }));
      return checked({ title: 'Two lines', facts }, [centre, ...along]);
    }
    const vertices =
      -k / a > 0
        ? [toXY(u0 + Math.sqrt(-k / a), v0), toXY(u0 - Math.sqrt(-k / a), v0)]
        : [toXY(u0, v0 + Math.sqrt(-k / c)), toXY(u0, v0 - Math.sqrt(-k / c))];
    return checked(
      {
        title: 'Hyperbola',
        facts: [
          { label: 'centre', values: [centreValue(centre)] },
          { label: 'vertices', values: vertices.map((p) => at('Vertex', p)) },
          { label: 'asymptotes', values: asymptotes.map((text) => ({ text, name: 'Asymptote' })) },
        ],
      },
      vertices,
    );
  }

  // One square term: a parabola, or lines parallel to an axis (turned back).
  const [sq, lin, other] = a !== 0 ? [a, e, d] : [c, d, e];
  /** (s, t): s along the squared axis, t along the other. */
  const toXY2 = (s: number, t: number) => (a !== 0 ? toXY(s, t) : toXY(t, s));
  const s0 = -other / (2 * sq);
  if (Math.abs(lin) > tol) {
    // sq s² + other s + lin t + F = 0: t = -(sq s² + other s + F) / lin.
    const t = (s: number) => -(sq * s * s + other * s + F) / lin;
    const vertex = toXY2(s0, t(s0));
    const axisDir = toXY2(0, 1);
    return checked(
      {
        title: 'Parabola',
        facts: [
          { label: 'vertex', values: [at('Vertex', vertex)] },
          {
            label: 'axis',
            values: [{ text: lineThrough(vertex, axisDir), name: 'Axis of symmetry' }],
          },
        ],
      },
      [vertex, toXY2(s0 + 1, t(s0 + 1)), toXY2(s0 - 1, t(s0 - 1))],
    );
  }
  // sq s² + other s + F = 0: s at its roots, any t.
  const roots = polyRoots([F, other, sq]);
  if (roots.length === 0) return null;
  const lines = roots.map((s) => ({ p: toXY2(s, 0), q: toXY2(s, 1) }));
  const dir = toXY2(0, 1);
  return checked(
    {
      title: roots.length === 1 ? 'Line' : 'Two parallel lines',
      facts: [
        {
          label: '',
          values: lines.map(({ p }) => ({ text: lineThrough(p, dir), name: 'Line' })),
        },
      ],
    },
    lines.flatMap(({ p, q: r }) => [p, r]),
  );
}

function implicitInsight(F: Fn2): Insight | null {
  const q = conicFit(F);
  return q ? describeConic(q) : null;
}

// ---- polar and parametric curves ----

/** The parameter range is at least this long (a full turn: 2π), to rounding. */
const covers = (span: number, needed: number) => span >= needed * (1 - 1e-9);

/** Integer slopes 2…24 of the trig arguments (a rose's k). */
function integerSlopes(args: readonly Fn1[] | null | undefined): number[] {
  const ks = new Set<number>();
  for (const g of args ?? []) {
    const k = affineSlope(g);
    if (k === null) continue;
    const r = Math.round(Math.abs(k));
    if (r >= 2 && r <= 24 && Math.abs(Math.abs(k) - r) <= 1e-9 * r) ks.add(r);
  }
  return [...ks];
}

export function polarInsight(
  r: Fn1,
  thetaMin: number,
  thetaMax: number,
  args?: readonly Fn1[] | null,
): Insight | null {
  const span = thetaMax - thetaMin;
  if (!Number.isFinite(span) || !(span > 0)) return null;
  const polar = (t: number): Point => ({ x: r(t) * Math.cos(t), y: r(t) * Math.sin(t) });
  const on = (p: Point) => (t: number) => {
    const q = polar(t);
    return Math.hypot(q.x - p.x, q.y - p.y) <= CHECK_TOL * (1 + Math.hypot(p.x, p.y));
  };
  const at = (name: string, p: Point): InsightValue => ({ text: pointText(p), name, at: p });
  // r = a + b cos θ + c sin θ: a circle, a cardioid or a limaçon.
  const lim = basisFit(r, [() => 1, Math.cos, Math.sin], TAU);
  if (lim) {
    const [a, b, c] = lim;
    const R = Math.hypot(b, c);
    if (R === 0) {
      if (a === 0 || !covers(span, TAU)) return null;
      const edge = polar(0);
      return {
        title: 'Circle',
        facts: [
          { label: 'centre', values: [centreValue({ x: 0, y: 0 })] },
          {
            label: 'radius',
            values: [{ text: num(Math.abs(a)), name: 'Radius', at: edge }],
          },
        ],
      };
    }
    const phi = Math.atan2(c, b);
    if (a === 0) {
      // Through the origin: once round every half turn.
      if (!covers(span, Math.PI)) return null;
      const far = { x: b, y: c };
      if (!on(far)(phi)) return null;
      return {
        title: 'Circle',
        facts: [
          { label: 'centre', values: [centreValue({ x: b / 2, y: c / 2 })] },
          {
            label: 'radius',
            values: [{ text: num(R / 2), name: 'Radius', at: far }],
          },
        ],
      };
    }
    if (!covers(span, TAU)) return null;
    // Farthest from the pole where r and its cosine term add up.
    const tf = a > 0 ? phi : phi + Math.PI;
    const far = polar(tf);
    if (Math.abs(Math.abs(a) - R) <= 1e-9 * R) {
      return {
        title: 'Cardioid',
        facts: [
          { label: 'cusp', values: [{ text: '(0, 0)', name: 'Cusp', at: { x: 0, y: 0 } }] },
          { label: 'farthest point', values: [at('Farthest point', far)] },
        ],
      };
    }
    const title =
      Math.abs(a) < R
        ? 'Limaçon with an inner loop'
        : Math.abs(a) < 2 * R
          ? 'Dimpled limaçon'
          : 'Convex limaçon';
    return { title, facts: [{ label: 'farthest point', values: [at('Farthest point', far)] }] };
  }
  // r = A cos(kθ - φ): a rose of k petals (k odd), or 2k (k even).
  for (const k of integerSlopes(args)) {
    const fit = basisFit(r, [(t) => Math.cos(k * t), (t) => Math.sin(k * t)], TAU);
    if (!fit) continue;
    const [p, q] = fit;
    const A = Math.hypot(p, q);
    if (!(A > 0)) continue;
    if (!covers(span, k % 2 === 1 ? Math.PI : TAU)) return null;
    const t0 = Math.atan2(q, p) / k;
    const tip = polar(t0);
    if (Math.abs(r(t0) - A) > CHECK_TOL * A) return null;
    const petals = k % 2 === 1 ? k : 2 * k;
    return {
      title: `Rose with ${petals} petals`,
      facts: [{ label: 'petal length', values: [{ text: num(A), name: 'Petal length', at: tip }] }],
    };
  }
  // r = a + bθ.
  const b = affineSlope(r);
  if (b !== null && b !== 0) {
    const turns = span / TAU;
    const facts: InsightFact[] = [
      { label: 'gap between turns', values: [{ text: piText(TAU * Math.abs(b)), name: 'Gap' }] },
    ];
    if (Math.abs(turns - Math.round(turns)) <= 1e-9 * turns && Math.round(turns) >= 1) {
      facts.unshift({ label: count(Math.round(turns), 'turn', 'turns') });
    }
    return { title: 'Archimedean spiral', facts };
  }
  return null;
}

export function parametricInsight(
  fx: Fn1,
  fy: Fn1,
  tMin: number,
  tMax: number,
  args?: readonly Fn1[] | null,
): Insight | null {
  const span = tMax - tMin;
  if (!Number.isFinite(span) || !(span > 0)) return null;
  const at = (name: string, p: Point): InsightValue => ({ text: pointText(p), name, at: p });
  const point = (t: number): Point => ({ x: fx(t), y: fy(t) });
  // Both coordinates linear in t: a segment.
  const mx = affineSlope(fx);
  const my = affineSlope(fy);
  if (mx !== null && my !== null) {
    if (mx === 0 && my === 0) return null;
    return {
      title: 'Line segment',
      facts: [
        { label: 'from', values: [at('Start', point(tMin))] },
        { label: 'to', values: [at('End', point(tMax))] },
      ],
    };
  }
  // Both in span{1, cos kt, sin kt}, one k: an ellipse (a circle), traced whole over 2π/k.
  const ks = new Set<number>();
  for (const g of args ?? []) {
    const k = affineSlope(g);
    if (k !== null && k !== 0) ks.add(Math.abs(k));
  }
  for (const k of ks) {
    const basis = [() => 1, (t: number) => Math.cos(k * t), (t: number) => Math.sin(k * t)];
    const X = basisFit(fx, basis, TAU / k);
    const Y = basisFit(fy, basis, TAU / k);
    if (!X || !Y) continue;
    const [x0, x1, x2] = X;
    const [y0, y1, y2] = Y;
    const norm = x1 * x1 + x2 * x2 + y1 * y1 + y2 * y2;
    const det = x1 * y2 - x2 * y1;
    if (!(Math.abs(det) > 1e-9 * norm) || !covers(span * k, TAU)) continue;
    const centre = { x: x0, y: y0 };
    if (
      Math.abs(x1 * x1 + y1 * y1 - (x2 * x2 + y2 * y2)) <= 1e-9 * norm &&
      Math.abs(x1 * x2 + y1 * y2) <= 1e-9 * norm
    ) {
      return {
        title: 'Circle',
        facts: [
          { label: 'centre', values: [centreValue(centre)] },
          {
            label: 'radius',
            values: [
              {
                text: num(Math.hypot(x1, y1)),
                name: 'Radius',
                at: { x: x0 + x1, y: y0 + y1 },
              },
            ],
          },
        ],
      };
    }
    // The semi-axes are M's singular values, along the eigenvectors of M Mᵀ.
    const [p, q, s] = [x1 * x1 + x2 * x2, x1 * y1 + x2 * y2, y1 * y1 + y2 * y2];
    const mid = (p + s) / 2;
    const rad = Math.hypot((p - s) / 2, q);
    const major = Math.sqrt(mid + rad);
    const minor = Math.sqrt(Math.max(0, mid - rad));
    const theta = 0.5 * Math.atan2(2 * q, p - s);
    const end = (r: number, t: number) => ({ x: x0 + r * Math.cos(t), y: y0 + r * Math.sin(t) });
    return {
      title: 'Ellipse',
      facts: [
        { label: 'centre', values: [centreValue(centre)] },
        {
          label: 'semi-axes',
          values: [
            { text: num(major), name: 'Semi-major axis', at: end(major, theta) },
            {
              text: num(minor),
              name: 'Semi-minor axis',
              at: end(minor, theta + Math.PI / 2),
            },
          ],
        },
      ],
    };
  }
  // Whether it ends where it starts.
  const [p0, p1] = [point(tMin), point(tMax)];
  if (![p0.x, p0.y, p1.x, p1.y].every(Number.isFinite)) return null;
  const size = 1 + Math.hypot(p0.x, p0.y);
  if (Math.hypot(p1.x - p0.x, p1.y - p0.y) <= 1e-9 * size) {
    return { title: 'Closed curve', facts: [{ label: 'through', values: [at('Start', p0)] }] };
  }
  return {
    title: 'Open curve',
    facts: [
      { label: 'from', values: [at('Start', p0)] },
      { label: 'to', values: [at('End', p1)] },
    ],
  };
}

// ---- rows that use a name, curves that meet ----

function usedByFact(users: readonly string[] | undefined): InsightFact[] {
  if (!users || users.length === 0) return [];
  const more = users.length - MAX_USERS;
  return [
    { label: 'used by', rows: users.slice(0, MAX_USERS), tail: more > 0 ? `+${more} more` : '' },
  ];
}

/**
 * Where the selected curve meets the others: exactly for two polynomials, else in view. The
 * exact ones first, so a count found in view later (the graph searches once the row settles)
 * adds to the line rather than changing it; past MAX_MEETS, how many more.
 */
function meetsFacts(input: InsightInput): InsightFact[] {
  const plot = input.plot;
  if (!plot || !input.others) return [];
  const own = isExplicitPlot(plot) ? polyFit(plot.f) : null;
  const same: InsightFact[] = [];
  const exact: InsightFact[] = [];
  const inView: InsightFact[] = [];
  for (const other of input.others) {
    const theirs =
      own && isExplicitPlot(other.plot) && other.plot.kind === plot.kind
        ? polyFit(other.plot.f)
        : null;
    if (own && theirs) {
      const diff = Array.from(
        { length: Math.max(own.length, theirs.length) },
        (_, i) => (own[i] ?? 0) - (theirs[i] ?? 0),
      );
      const scale = Math.max(...own.map(Math.abs), ...theirs.map(Math.abs));
      if (diff.every((v) => Math.abs(v) <= 1e-12 * scale)) {
        same.push({ label: 'same curve as', rows: [other.id] });
        continue;
      }
      // Each point once, however the curves meet there (touching, crossing flat).
      const n = polyRoots(diff).length;
      if (n > 0)
        exact.push({ label: 'meets', rows: [other.id], tail: `at ${count(n, 'point', 'points')}` });
      continue;
    }
    const n = input.inView?.meets.get(other.id);
    if (n) {
      inView.push({
        label: 'meets',
        rows: [other.id],
        tail: `at ${count(n, 'point', 'points')} in view`,
      });
    }
  }
  const meets = [...exact, ...inView];
  if (meets.length <= MAX_MEETS + 1) return [...same, ...meets];
  const more = meets.length - MAX_MEETS;
  return [
    ...same,
    ...meets.slice(0, MAX_MEETS),
    { label: `meets ${count(more, 'more curve', 'more curves')}` },
  ];
}

type ExplicitPlot = Extract<PlotItem, { kind: 'explicitY' | 'explicitX' }>;

function isExplicitPlot(plot: PlotItem): plot is ExplicitPlot {
  return (plot.kind === 'explicitY' || plot.kind === 'explicitX') && !plot.ineq;
}

/** What a row's curve is (null for none, or nothing to say). */
function curveInsight(input: InsightInput): Insight | null {
  const plot = input.plot;
  switch (plot?.kind) {
    case 'explicitY':
    case 'explicitX':
      if (!isExplicitPlot(plot)) return null;
      return explicitInsight({ f: plot.f, axis: plot.kind === 'explicitY' ? 'x' : 'y' }, input);
    case 'implicit':
      return plot.ineq ? null : implicitInsight(plot.F);
    case 'polar':
      return polarInsight(plot.r, plot.thetaMin(), plot.thetaMax(), input.trigArgs);
    case 'parametric':
      return parametricInsight(plot.fx, plot.fy, plot.tMin(), plot.tMax(), input.trigArgs);
    default:
      return null;
  }
}

/** What to say about a row, or null for nothing. */
export function rowInsight(input: InsightInput): Insight | null {
  const { kind } = input;
  let used: InsightFact[] = [];
  switch (kind) {
    case 'slider':
    case 'varDef': {
      const facts = usedByFact(input.usedBy);
      return facts.length > 0 ? { facts } : null;
    }
    case 'funcDef':
      // A function of one variable is drawn too (f(x) = x²): its curve, after its users.
      used = usedByFact(input.usedBy);
      break;
    case 'explicitY':
    case 'explicitX':
    case 'implicit':
    case 'polar':
    case 'parametric':
      break;
    default:
      return null;
  }
  const insight = curveInsight(input);
  // The line is one line, cut short at its end: where the selected curve meets the others comes
  // right after what the curve is first (its vertex, its roots), before the rest.
  const [first = [], rest = []] = insight
    ? [insight.facts.slice(0, 1), insight.facts.slice(1)]
    : [];
  const facts = [...used, ...first, ...meetsFacts(input), ...rest];
  if (facts.length === 0) return insight?.title ? { title: insight.title, facts } : null;
  return { title: insight?.title, facts };
}

/**
 * The line as plain text, rows named by `rowText` ("Parabola · vertex (1, −2) · roots −1, 1");
 * what assistive technology reads, and what tests compare.
 */
export function insightText(insight: Insight, rowText: (id: string) => string): string {
  const parts: string[] = insight.title ? [insight.title] : [];
  for (const fact of insight.facts) {
    const words = [
      fact.label,
      (fact.values ?? []).map((v) => v.text).join(', '),
      (fact.rows ?? []).map(rowText).join(', '),
      fact.tail ?? '',
    ].filter((w) => w !== '');
    parts.push(words.join(' '));
  }
  const text = parts.join(' · ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}
