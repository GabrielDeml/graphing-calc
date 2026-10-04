import { describe, expect, it } from 'vitest';
import type { Fn1 } from '../engine/types';
import { sampleExplicit } from './sampleExplicit';
import type { Polyline, Viewport } from './types';
import { toScreenY, viewBounds } from './viewport';

const W = 800;
const H = 600;

function view(cx = 0, cy = 0, ppu = 40, width = W, height = H): Viewport {
  return { cx, cy, ppuX: ppu, ppuY: ppu, width, height };
}

interface P {
  x: number;
  y: number;
}

function points(poly: Polyline): P[] {
  const out: P[] = [];
  for (let i = 0; i < poly.length; i += 2) out.push({ x: poly[i], y: poly[i + 1] });
  return out;
}

/** Consecutive pairs of finite points (the segments that get stroked). */
function segments(poly: Polyline): [P, P][] {
  const pts = points(poly);
  const out: [P, P][] = [];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    if (
      Number.isFinite(a.x) &&
      Number.isFinite(a.y) &&
      Number.isFinite(b.x) &&
      Number.isFinite(b.y)
    ) {
      out.push([a, b]);
    }
  }
  return out;
}

function pieces(poly: Polyline): P[][] {
  const out: P[][] = [];
  let cur: P[] = [];
  for (const p of points(poly)) {
    if (Number.isNaN(p.x)) {
      if (cur.length) out.push(cur);
      cur = [];
    } else {
      cur.push(p);
    }
  }
  if (cur.length) out.push(cur);
  return out;
}

function counting(f: Fn1): { f: Fn1; count: () => number } {
  let n = 0;
  return {
    f: (v) => {
      n++;
      return f(v);
    },
    count: () => n,
  };
}

/** Every coordinate is finite, or both of a pair are NaN; no leading/trailing/double NaNs. */
function expectWellFormed(poly: Polyline): void {
  expect(poly.length % 2).toBe(0);
  let prevNaN = true;
  for (let i = 0; i < poly.length; i += 2) {
    const x = poly[i];
    const y = poly[i + 1];
    if (Number.isNaN(x) || Number.isNaN(y)) {
      expect(Number.isNaN(x) && Number.isNaN(y)).toBe(true);
      expect(prevNaN).toBe(false);
      prevNaN = true;
    } else {
      expect(Number.isFinite(x) && Number.isFinite(y)).toBe(true);
      prevNaN = false;
    }
  }
  if (poly.length) expect(prevNaN).toBe(false);
}

/** Max vertical distance (px) between each stroked chord's midpoint and the true curve. */
function maxChordErrorPx(poly: Polyline, f: Fn1, v: Viewport): number {
  const b = viewBounds(v);
  let worst = 0;
  for (const [p, q] of segments(poly)) {
    if (p.y < b.ymin || p.y > b.ymax || q.y < b.ymin || q.y > b.ymax) continue;
    const mx = (p.x + q.x) / 2;
    const err = Math.abs(f(mx) - (p.y + q.y) / 2) * v.ppuY;
    worst = Math.max(worst, err);
  }
  return worst;
}

describe('sampleExplicit basics', () => {
  it('samples y = x with about one point per 2px and no breaks', () => {
    const v = view();
    const poly = sampleExplicit((x) => x, v, 'x');
    expectWellFormed(poly);
    const pts = points(poly);
    expect(pts.length).toBeLessThanOrEqual(W / 2 + 6);
    expect(pts.every((p) => Number.isFinite(p.x) && p.y === p.x)).toBe(true);
    const b = viewBounds(v);
    expect(pts[0].x).toBeLessThan(b.xmin);
    expect(pts[pts.length - 1].x).toBeGreaterThan(b.xmax);
    for (let i = 1; i < pts.length; i++) expect(pts[i].x).toBeGreaterThan(pts[i - 1].x);
  });

  it('uses half the grid at interactive quality', () => {
    const v = view();
    const fine = sampleExplicit((x) => x, v, 'x');
    const coarse = sampleExplicit((x) => x, v, 'x', { quality: 'interactive' });
    expect(coarse.length / 2).toBeLessThanOrEqual(W / 4 + 6);
    expect(coarse.length).toBeLessThan(fine.length);
  });

  it('draws y = x^2 and y = sin(x) smoothly', () => {
    const v = view();
    for (const f of [(x: number) => x * x, Math.sin, (x: number) => Math.sin(5 * x) * 3]) {
      const poly = sampleExplicit(f, v, 'x');
      expectWellFormed(poly);
      expect(pieces(poly)).toHaveLength(1);
      expect(maxChordErrorPx(poly, f, v)).toBeLessThan(0.5);
      expect(poly.length / 2).toBeLessThan(3000);
    }
  });

  it('returns nothing for a function that is NaN everywhere', () => {
    const poly = sampleExplicit(() => Number.NaN, view(), 'x');
    expect(poly.length).toBe(0);
  });

  it('returns nothing for a degenerate view', () => {
    expect(sampleExplicit((x) => x, view(0, 0, 40, 0, 0), 'x').length).toBe(0);
    expect(sampleExplicit((x) => x, view(0, 0, Number.NaN), 'x').length).toBe(0);
  });

  it('draws constants as a single two-point segment', () => {
    const v = view();
    const poly = sampleExplicit(() => 2, v, 'x', { constant: true });
    const pts = points(poly);
    expect(pts).toHaveLength(2);
    expect(pts[0].y).toBe(2);
    expect(pts[1].y).toBe(2);
    const b = viewBounds(v);
    expect(pts[0].x).toBeLessThan(b.xmin);
    expect(pts[1].x).toBeGreaterThan(b.xmax);
    expect(sampleExplicit(() => Number.NaN, v, 'x', { constant: true }).length).toBe(0);
  });

  it('keeps far off-screen values bounded and never emits Infinity', () => {
    const v = view();
    for (const f of [(x: number) => 1e300 * x, () => 1e308, (x: number) => Math.exp(x * 100)]) {
      const poly = sampleExplicit(f, v, 'x');
      expectWellFormed(poly);
      expect(poly.length).toBeGreaterThan(0);
      for (const p of points(poly)) {
        if (Number.isNaN(p.y)) continue;
        expect(Math.abs(p.y)).toBeLessThanOrEqual(3 * (H / 2 / 40) + 1e-9);
      }
    }
  });

  it('draws the steep line y = 1e300 x as one connected vertical stroke', () => {
    const v = view();
    const poly = sampleExplicit((x) => 1e300 * x, v, 'x');
    expect(pieces(poly)).toHaveLength(1);
    const b = viewBounds(v);
    const pts = points(poly);
    const visible = pts.filter((p) => p.y >= b.ymin && p.y <= b.ymax);
    expect(visible.every((p) => Math.abs(p.x) < 1e-6)).toBe(true);
    expect(pts.some((p) => p.y < b.ymin && Math.abs(p.x) < 1e-6)).toBe(true);
    expect(pts.some((p) => p.y > b.ymax && Math.abs(p.x) < 1e-6)).toBe(true);
  });
});

describe('sampleExplicit discontinuities', () => {
  it('breaks 1/x at 0 with no connector between the branches', () => {
    for (const v of [view(), view(0.0137, 0.3, 37), view(0, 0, 40, 801, 600)]) {
      const poly = sampleExplicit((x) => 1 / x, v, 'x');
      expectWellFormed(poly);
      for (const [p, q] of segments(poly)) expect(p.x < 0 && q.x > 0).toBe(false);
      const ps = pieces(poly);
      expect(ps).toHaveLength(2);
      const b = viewBounds(v);
      // Each branch runs all the way to the edge of the view near the asymptote.
      const left = ps[0];
      const right = ps[1];
      expect(left[left.length - 1].y).toBeLessThan(b.ymin);
      expect(Math.abs(left[left.length - 1].x)).toBeLessThan(1e-3);
      expect(right[0].y).toBeGreaterThan(b.ymax);
      expect(Math.abs(right[0].x)).toBeLessThan(1e-3);
    }
  });

  it('breaks tan(x) at every pole without tall connectors', () => {
    for (const v of [view(), view(0.3, 0.1, 23), view(0, 0, 40, 1200, 300)]) {
      const poly = sampleExplicit(Math.tan, v, 'x');
      expectWellFormed(poly);
      const b = viewBounds(v);
      const poles: number[] = [];
      for (let k = Math.ceil(b.xmin / Math.PI - 0.5); (k + 0.5) * Math.PI < b.xmax; k++) {
        poles.push((k + 0.5) * Math.PI);
      }
      expect(poles.length).toBeGreaterThan(2);
      for (const [p, q] of segments(poly)) {
        for (const pole of poles) expect(p.x < pole && q.x > pole).toBe(false);
        const dy = Math.abs(toScreenY(v, p.y) - toScreenY(v, q.y));
        expect(dy).toBeLessThanOrEqual(1.5 * v.height);
      }
      expect(pieces(poly)).toHaveLength(poles.length + 1);
      expect(maxChordErrorPx(poly, Math.tan, v)).toBeLessThan(0.5);
    }
  });

  it('draws floor(x) as horizontal steps that break at integers', () => {
    for (const v of [view(0.01, 0, 37), view(0, 0, 40, 800, 900)]) {
      const poly = sampleExplicit(Math.floor, v, 'x');
      expectWellFormed(poly);
      const b = viewBounds(v);
      // On screen, no risers: every segment is horizontal. (Beyond the visible edges risers are
      // invisible and allowed.)
      const onScreen = (p: P) => p.y >= b.ymin && p.y <= b.ymax;
      for (const [p, q] of segments(poly)) if (onScreen(p) || onScreen(q)) expect(q.y).toBe(p.y);
      // Each visible step reaches (almost) the next integer, then the pen lifts.
      for (let n = Math.ceil(b.xmin); n <= b.xmax; n++) {
        if (n - 1 < b.ymin || n > b.ymax) continue;
        for (const [p, q] of segments(poly)) expect(p.x < n && q.x > n).toBe(false);
        const left = points(poly).filter((p) => p.y === n - 1 && p.x < n);
        const end = Math.max(...left.map((p) => p.x));
        expect((n - end) * v.ppuX).toBeLessThan(0.01);
      }
    }
  });

  it('breaks sign(x) at 0', () => {
    const poly = sampleExplicit(Math.sign, view(0.0137, 0, 37), 'x');
    for (const [p, q] of segments(poly)) expect(p.y === q.y).toBe(true);
    expect(pieces(poly).length).toBeGreaterThanOrEqual(2);
  });

  it('does not connect the two sides of the pole of 1/x^2 on screen', () => {
    for (const [f, pole] of [
      [(x: number) => 1 / (x * x), 0],
      [(x: number) => 1 / ((x - 0.01234) * (x - 0.01234)), 0.01234],
      [(x: number) => 1e-5 / ((x - 0.01234) * (x - 0.01234)), 0.01234],
    ] as const) {
      const v = view();
      const poly = sampleExplicit(f, v, 'x');
      expectWellFormed(poly);
      const b = viewBounds(v);
      for (const [p, q] of segments(poly)) {
        if (p.x < pole && q.x > pole) {
          expect(p.y).toBeGreaterThan(b.ymax);
          expect(q.y).toBeGreaterThan(b.ymax);
        }
      }
      // Both sides climb out of the top of the view near the pole.
      const near = points(poly).filter((p) => Math.abs(p.x - pole) < 0.5 && p.y > b.ymax);
      expect(near.some((p) => p.x < pole)).toBe(true);
      expect(near.some((p) => p.x > pole)).toBe(true);
    }
  });

  it('connects x^(1/3) through 0', () => {
    for (const v of [view(), view(0.0137, 0, 37), view(0, 0, 1e4)]) {
      const poly = sampleExplicit(Math.cbrt, v, 'x');
      expectWellFormed(poly);
      expect(pieces(poly)).toHaveLength(1);
      const crossing = segments(poly).find(([p, q]) => p.x <= 0 && q.x >= 0);
      expect(crossing).toBeDefined();
    }
  });
});

describe('sampleExplicit domain edges', () => {
  it('starts sqrt(x) at x = 0', () => {
    for (const [f, edge] of [
      [Math.sqrt, 0],
      [(x: number) => Math.sqrt(x - 0.0123), 0.0123],
    ] as const) {
      for (const v of [view(), view(0.0137, 0, 37)]) {
        const poly = sampleExplicit(f, v, 'x');
        expectWellFormed(poly);
        const first = points(poly)[0];
        expect(first.x - edge).toBeGreaterThanOrEqual(0);
        expect(first.x - edge).toBeLessThan(1e-3);
        expect(pieces(poly)).toHaveLength(1);
      }
    }
  });

  it('closes a semicircle onto the x-axis at both ends', () => {
    const f = (x: number) => Math.sqrt(1 - x * x);
    for (const v of [view(), view(0.0137, 0.02, 37), view(0.3, 0, 211)]) {
      const poly = sampleExplicit(f, v, 'x');
      expectWellFormed(poly);
      const pts = points(poly);
      const first = pts[0];
      const last = pts[pts.length - 1];
      expect(Math.abs(first.x + 1)).toBeLessThan(1e-3);
      expect(Math.abs(first.y)).toBeLessThan(1e-3);
      expect(Math.abs(last.x - 1)).toBeLessThan(1e-3);
      expect(Math.abs(last.y)).toBeLessThan(1e-3);
      expect(maxChordErrorPx(poly, f, v)).toBeLessThan(0.5);
    }
  });

  it('handles holes in the domain (sqrt(x^2 - 1))', () => {
    const v = view(0.0137, 0, 37);
    const poly = sampleExplicit((x) => Math.sqrt(x * x - 1), v, 'x');
    expectWellFormed(poly);
    const ps = pieces(poly);
    expect(ps).toHaveLength(2);
    expect(Math.abs(ps[0][ps[0].length - 1].x + 1)).toBeLessThan(1e-3);
    expect(Math.abs(ps[1][0].x - 1)).toBeLessThan(1e-3);
  });
});

describe('sampleExplicit budget and extreme views', () => {
  it('finishes sin(1/x) within the default budget and still draws it', () => {
    const c = counting((x) => Math.sin(1 / x));
    const t0 = performance.now();
    const poly = sampleExplicit(c.f, view(), 'x');
    const ms = performance.now() - t0;
    expect(c.count()).toBeLessThanOrEqual(40000);
    expect(poly.length / 2).toBeGreaterThan(W / 2);
    expect(ms).toBeLessThan(500);
    expectWellFormed(poly);
  });

  it('respects a custom budget', () => {
    const c = counting((x) => Math.sin(1 / x));
    const poly = sampleExplicit(c.f, view(), 'x', { maxEvals: 1000 });
    expect(c.count()).toBeLessThanOrEqual(1000);
    expect(poly.length / 2).toBeGreaterThan(W / 4);
    // A budget smaller than the grid still evaluates the grid once.
    const c2 = counting(Math.tan);
    const poly2 = sampleExplicit(c2.f, view(), 'x', { maxEvals: 10 });
    expect(c2.count()).toBeLessThanOrEqual(W / 2 + 4);
    expect(poly2.length).toBeGreaterThan(0);
  });

  it('uses few evaluations on ordinary curves', () => {
    for (const f of [(x: number) => x, Math.sin, (x: number) => x * x, Math.tan]) {
      const c = counting(f);
      sampleExplicit(c.f, view(), 'x');
      expect(c.count()).toBeLessThan(8000);
    }
  });

  it('stays accurate when zoomed far in (ppu 1e10 around x = 1)', () => {
    const v = view(1, 1, 1e10);
    const f = (x: number) => x * x;
    const poly = sampleExplicit(f, v, 'x');
    expectWellFormed(poly);
    expect(pieces(poly)).toHaveLength(1);
    expect(points(poly).length).toBeLessThanOrEqual(W / 2 + 6);
    expect(maxChordErrorPx(poly, f, v)).toBeLessThan(0.5);
    const b = viewBounds(v);
    for (const p of points(poly)) {
      expect(p.x).toBeGreaterThan(b.xmin - 1e-9);
      expect(p.x).toBeLessThan(b.xmax + 1e-9);
    }
  });

  it('copes when zoomed far out (ppu 1e-5)', () => {
    const v = view(0, 0, 1e-5);
    for (const f of [(x: number) => x, (x: number) => x * x, Math.sin, (x: number) => 1 / x]) {
      const c = counting(f);
      const poly = sampleExplicit(c.f, v, 'x');
      expectWellFormed(poly);
      expect(poly.length).toBeGreaterThan(0);
      expect(c.count()).toBeLessThanOrEqual(40000);
    }
  });

  it('does not hang at the precision limit (center 1e12, ppu 1e12)', () => {
    const c = counting((x) => x);
    const poly = sampleExplicit(c.f, view(1e12, 1e12, 1e12), 'x');
    expectWellFormed(poly);
    expect(c.count()).toBeLessThanOrEqual(40000);
  });
});

describe('sampleExplicit with axis y (x = f(y))', () => {
  it('outputs (f(y), y) pairs ordered by y', () => {
    const v = view(0.5, 0.2, 40);
    const f = (y: number) => y * y - 2;
    const poly = sampleExplicit(f, v, 'y');
    expectWellFormed(poly);
    const pts = points(poly);
    const b = viewBounds(v);
    expect(pts[0].y).toBeLessThan(b.ymin);
    expect(pts[pts.length - 1].y).toBeGreaterThan(b.ymax);
    expect(pts.length).toBeLessThanOrEqual(H / 2 + 200);
    for (let i = 1; i < pts.length; i++) expect(pts[i].y).toBeGreaterThan(pts[i - 1].y);
    for (const p of pts) {
      if (p.x > b.xmin && p.x < b.xmax) expect(p.x).toBeCloseTo(f(p.y), 9);
    }
  });

  it('breaks x = 1/y at y = 0', () => {
    const poly = sampleExplicit((y) => 1 / y, view(0, 0.0137, 37), 'y');
    expectWellFormed(poly);
    for (const [p, q] of segments(poly)) expect(p.y < 0 && q.y > 0).toBe(false);
    expect(pieces(poly)).toHaveLength(2);
  });
});

/** Lowest y drawn within dx of u on the left and on the right. */
function lowestNear(poly: Polyline, u: number, dx: number): [number, number] {
  let l = Number.POSITIVE_INFINITY;
  let r = Number.POSITIVE_INFINITY;
  for (const p of points(poly)) {
    if (Number.isNaN(p.x)) continue;
    if (p.x <= u && p.x > u - dx) l = Math.min(l, p.y);
    if (p.x >= u && p.x < u + dx) r = Math.min(r, p.y);
  }
  return [l, r];
}

describe('sampleExplicit log singularities', () => {
  it('runs both sides of an off-grid log pole off the bottom of the view', () => {
    // The reported cases: home views and ppu 20-40; ln|x - c| has its pole between samples.
    const views = [
      view(0, 0, 30),
      view(0, 0, 40, 1200, 800),
      view(0, 0, 19.5, 390, 400),
      view(0, 0, 20),
      view(0, 0, 15),
      view(0.013, -0.02, 5),
    ];
    const cases: [Fn1, number[]][] = [
      [(x) => Math.log(Math.abs(x - 0.4321)), [0.4321]],
      [(x) => Math.log(Math.abs(x - 1.2345)), [1.2345]],
      [(x) => Math.log(Math.abs(x - 2.7177)), [2.7177]],
      [(x) => Math.log(Math.abs(x * x - 2)), [-Math.SQRT2, Math.SQRT2]],
      [(x) => Math.log(Math.abs(Math.sin(x))), [-Math.PI, Math.PI, 2 * Math.PI]],
      [(x) => Math.log(Math.abs(x + 3)), [-3]], // pole exactly on a double
    ];
    for (const v of views) {
      const b = viewBounds(v);
      for (const [f, poles] of cases) {
        const poly = sampleExplicit(f, v, 'x');
        expectWellFormed(poly);
        for (const c of poles) {
          if (c < b.xmin || c > b.xmax) continue;
          const [l, r] = lowestNear(poly, c, 2 / v.ppuX);
          expect(l).toBeLessThan(b.ymin);
          expect(r).toBeLessThan(b.ymin);
        }
      }
    }
  });

  it('finds log poles wherever they fall between samples', () => {
    for (const ppu of [5, 15, 20, 40]) {
      const v = view(0.013, -0.02, ppu);
      const b = viewBounds(v);
      for (let k = 0; k < 40; k++) {
        const c = -3 + 6 * ((k * 0.6180339887) % 1);
        const poly = sampleExplicit((x) => Math.log(Math.abs(x - c)), v, 'x');
        const [l, r] = lowestNear(poly, c, 2 / ppu);
        expect(Math.max(l, r)).toBeLessThan(b.ymin);
      }
    }
  });

  it('continues log curves down past the view at their domain edge, at any zoom', () => {
    for (const ppu of [40, 20, 15, 10, 5, 1, 0.1]) {
      const v = view(0, 0, ppu);
      const b = viewBounds(v);
      for (const [f, e] of [
        [Math.log10, 0],
        [Math.log, 0],
        [(x: number) => Math.log(x - 0.37), 0.37],
      ] as const) {
        const poly = sampleExplicit(f, v, 'x');
        expectWellFormed(poly);
        const [, r] = lowestNear(poly, e, 2 / ppu);
        expect(r).toBeLessThan(b.ymin);
        expect(pieces(poly)).toHaveLength(1);
      }
    }
  });

  it('still ends converging curves exactly at their edge (no false extension)', () => {
    const v = view(0, 0, 1000);
    for (const f of [Math.sqrt, (x: number) => x ** 0.1, (x: number) => x * Math.log(x)]) {
      const poly = sampleExplicit(f, v, 'x');
      const pts = points(poly);
      expect(pts[0].x).toBeGreaterThanOrEqual(0);
      expect(pts[0].x).toBeLessThan(1e-6);
      expect(Math.abs(pts[0].y)).toBeLessThan(0.05);
    }
  });
});

/** Segments with an end on screen that join two branches of tan(kx) across a pole. */
function tanConnectors(poly: Polyline, k: number, v: Viewport): number {
  const b = viewBounds(v);
  let n = 0;
  for (const [p, q] of segments(poly)) {
    const branch = (x: number) => Math.floor((k * x) / Math.PI - 0.5);
    const on = (s: P) => s.y > b.ymin && s.y < b.ymax;
    if (branch(p.x) !== branch(q.x) && (on(p) || on(q))) n++;
  }
  return n;
}

describe('sampleExplicit budget sharing', () => {
  it('draws tan(kx) at home views without connectors across poles', () => {
    for (const [w, h, ks] of [
      [1200, 800, [8, 10, 20]],
      [1600, 900, [8, 10, 20]],
      [800, 600, [20]],
    ] as const) {
      const v = view(0, 0, Math.min(w, h) / 20, w, h);
      for (const k of ks) {
        const c = counting((x) => Math.tan(k * x));
        const poly = sampleExplicit(c.f, v, 'x');
        expectWellFormed(poly);
        expect(c.count()).toBeLessThanOrEqual(40000);
        expect(tanConnectors(poly, k, v)).toBe(0);
      }
    }
  });

  it('does not join a pole once the budget is spent', () => {
    const v = view(0, 0, 40, 1200, 800);
    for (const maxEvals of [700, 1500, 4000]) {
      const poly = sampleExplicit((x) => Math.tan(10 * x), v, 'x', { maxEvals });
      expectWellFormed(poly);
      const b = viewBounds(v);
      for (const [p, q] of segments(poly)) {
        const branch = (x: number) => Math.floor((10 * x) / Math.PI - 0.5);
        if (branch(p.x) === branch(q.x)) continue;
        // Any chord across a pole is short (both ends near the same height) or off screen.
        const on = p.y > b.ymin && p.y < b.ymax && q.y > b.ymin && q.y < b.ymax;
        if (on) expect(Math.abs(p.y - q.y) * v.ppuY).toBeLessThanOrEqual(v.height / 8);
      }
    }
  });

  it('keeps refining the right side of the screen when the left is expensive', () => {
    // The left half alone could eat the whole budget; the right half must still be smooth.
    const v = view();
    const f = (x: number) => (x < 0 ? Math.sin(1e4 * x) : 0.5 * Math.sin(20 * x));
    const c = counting(f);
    const poly = sampleExplicit(c.f, v, 'x');
    expect(c.count()).toBeLessThanOrEqual(40000);
    const right = new Float64Array(
      points(poly)
        .filter((p) => p.x > 0.5)
        .flatMap((p) => [p.x, p.y]),
    );
    expect(maxChordErrorPx(right, f, v)).toBeLessThan(0.5);
  });
});

describe('sampleExplicit sampling grid', () => {
  it('does not alias periodic functions with the grid', () => {
    const range = (poly: Polyline) => {
      const ys = points(poly)
        .map((p) => p.y)
        .filter((y) => !Number.isNaN(y));
      return [Math.min(...ys), Math.max(...ys)];
    };
    for (const [n, v, quality] of [
      [30, view(0, 0, 30), 'final'],
      [40, view(0, 0, 40, 1000, 800), 'final'],
      [40, view(5.3, 0, 40, 1200, 800), 'final'],
      [60, view(0, 0, 60), 'final'],
      [15, view(0, 0, 30), 'interactive'],
      [30, view(0, 0, 30), 'interactive'],
    ] as const) {
      const poly = sampleExplicit((x) => Math.sin(n * Math.PI * x), v, 'x', { quality });
      const [lo, hi] = range(poly);
      expect(lo).toBeLessThan(-0.99);
      expect(hi).toBeGreaterThan(0.99);
    }
  });

  it('draws a steep line far from the origin as one stroke at the precision limit', () => {
    // Consecutive doubles there are about a pixel apart: a staircase, not a broken line.
    for (const [f, cy] of [
      [(x: number) => 3 * x, 3e6],
      [(x: number) => 10 * x, 1e7],
    ] as const) {
      const poly = sampleExplicit(f, view(1e6, cy, 1e10), 'x');
      expectWellFormed(poly);
      expect(pieces(poly)).toHaveLength(1);
    }
  });
});

describe('sampleExplicit robustness', () => {
  it('returns well-formed output within budget for random views and hard functions', () => {
    let seed = 7;
    const rnd = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    const fns: Fn1[] = [
      (x) => Math.sin(1 / x),
      (x) => 1 / Math.sin(x),
      (x) => Math.tan(x) * Math.log(Math.abs(x)),
      (x) => Math.floor(1 / x),
      (x) => Math.sqrt(Math.sin(x)),
      (x) => Math.log(Math.sin(x)),
      (x) => 1 / Math.log(Math.abs(x)),
      () => Number.POSITIVE_INFINITY,
      (x) => Math.sin(100 * x),
      (x) => x - Math.floor(x),
    ];
    for (let k = 0; k < 120; k++) {
      const ppu = 10 ** (-5 + 15 * rnd());
      const c = (rnd() - 0.5) * 10 ** (8 * rnd());
      const v = view(Math.abs(c) * ppu > 1e15 ? 0 : c, rnd() - 0.5, ppu, 200 + 1400 * rnd());
      const counted = counting(fns[k % fns.length]);
      const poly = sampleExplicit(counted.f, v, rnd() < 0.5 ? 'x' : 'y', {
        quality: rnd() < 0.3 ? 'interactive' : 'final',
      });
      expectWellFormed(poly);
      expect(counted.count()).toBeLessThanOrEqual(40000);
    }
  });
});
