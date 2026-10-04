import { describe, expect, it } from 'vitest';
import type { Fn1 } from '../engine/types';
import { MAX_PARAMETER_RANGE, sampleParametric, samplePolar } from './sampleParametric';
import type { Polyline, Viewport } from './types';
import { viewBounds } from './viewport';

function view(cx = 0, cy = 0, ppu = 40, width = 800, height = 600): Viewport {
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

function segments(poly: Polyline): [P, P][] {
  const pts = points(poly);
  const out: [P, P][] = [];
  for (let i = 1; i < pts.length; i++) {
    if (!Number.isNaN(pts[i - 1].x) && !Number.isNaN(pts[i].x)) out.push([pts[i - 1], pts[i]]);
  }
  return out;
}

function pieceCount(poly: Polyline): number {
  let n = poly.length ? 1 : 0;
  for (let i = 0; i < poly.length; i += 2) if (Number.isNaN(poly[i])) n++;
  return n;
}

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

describe('sampleParametric', () => {
  it('draws the unit circle accurately and closes the path', () => {
    const v = view();
    const poly = sampleParametric(Math.cos, Math.sin, 0, 2 * Math.PI, v);
    expectWellFormed(poly);
    expect(pieceCount(poly)).toBe(1);
    const pts = points(poly);
    for (const p of pts) expect(Math.abs(Math.hypot(p.x, p.y) - 1)).toBeLessThan(1e-3);
    // Chords stay within a fraction of a pixel of the circle.
    for (const [p, q] of segments(poly)) {
      const r = Math.hypot((p.x + q.x) / 2, (p.y + q.y) / 2);
      expect((1 - r) * v.ppuX).toBeLessThan(0.3);
    }
    const first = pts[0];
    const last = pts[pts.length - 1];
    expect(Math.hypot(first.x - last.x, first.y - last.y)).toBeLessThan(1e-9);
    expect(pts.length).toBeGreaterThanOrEqual(257);
    expect(pts.length).toBeLessThan(2000);
  });

  it('keeps a large circle smooth when zoomed in', () => {
    const v = view(0, 0, 4000);
    const poly = sampleParametric(Math.cos, Math.sin, 0, 2 * Math.PI, v);
    expectWellFormed(poly);
    const b = viewBounds(v);
    for (const [p, q] of segments(poly)) {
      const inView = (s: P) => s.x > b.xmin && s.x < b.xmax && s.y > b.ymin && s.y < b.ymax;
      if (!inView(p) && !inView(q)) continue;
      const r = Math.hypot((p.x + q.x) / 2, (p.y + q.y) / 2);
      expect((1 - r) * v.ppuX).toBeLessThan(0.3);
      expect(Math.hypot(q.x - p.x, q.y - p.y) * v.ppuX).toBeLessThanOrEqual(16.01);
    }
  });

  it('breaks (t, 1/t) at t = 0', () => {
    for (const [lo, hi] of [
      [-2, 2],
      [-2, 2.1],
      [-3.3, 1.7],
    ]) {
      const poly = sampleParametric(
        (t) => t,
        (t) => 1 / t,
        lo,
        hi,
        view(),
      );
      expectWellFormed(poly);
      for (const [p, q] of segments(poly)) expect(p.x < 0 && q.x > 0).toBe(false);
      expect(pieceCount(poly)).toBe(2);
      const b = viewBounds(view());
      const pts = points(poly);
      expect(pts.some((p) => p.x < 0 && p.y < b.ymin)).toBe(true);
      expect(pts.some((p) => p.x > 0 && p.y > b.ymax)).toBe(true);
    }
  });

  it('breaks (t, floor(t)) at integers', () => {
    const poly = sampleParametric((t) => t, Math.floor, -2.5, 2.7, view());
    expectWellFormed(poly);
    for (const [p, q] of segments(poly)) expect(q.y).toBe(p.y);
    expect(pieceCount(poly)).toBe(6);
  });

  it('starts (t, sqrt(t)) at the domain edge', () => {
    const poly = sampleParametric((t) => t, Math.sqrt, -1.03, 1, view());
    expectWellFormed(poly);
    const first = points(poly)[0];
    expect(first.x).toBeGreaterThanOrEqual(0);
    expect(first.x).toBeLessThan(1e-3);
  });

  it('returns nothing for invalid ranges', () => {
    const v = view();
    expect(sampleParametric(Math.cos, Math.sin, 1, 1, v).length).toBe(0);
    expect(sampleParametric(Math.cos, Math.sin, 2, 1, v).length).toBe(0);
    expect(sampleParametric(Math.cos, Math.sin, Number.NaN, 1, v).length).toBe(0);
    expect(sampleParametric(Math.cos, Math.sin, 0, Number.POSITIVE_INFINITY, v).length).toBe(0);
    expect(sampleParametric(() => Number.NaN, Math.sin, 0, 1, v).length).toBe(0);
  });

  it('caps huge ranges and respects the evaluation budget', () => {
    const fx = counting(Math.cos);
    const poly = sampleParametric(fx.f, Math.sin, 0, 1e300, view());
    expectWellFormed(poly);
    expect(poly.length).toBeGreaterThan(0);
    expect(fx.count()).toBeLessThanOrEqual(60000);

    const gx = counting((t) => t);
    const wild = sampleParametric(gx.f, (t) => Math.sin(1 / t), -1, 1, view(), { maxEvals: 3000 });
    expectWellFormed(wild);
    expect(gx.count()).toBeLessThanOrEqual(3000);
    expect(wild.length / 2).toBeGreaterThan(256);
  });

  it('samples more coarsely while interacting', () => {
    const fine = sampleParametric(Math.cos, Math.sin, 0, 2 * Math.PI, view());
    const coarse = sampleParametric(Math.cos, Math.sin, 0, 2 * Math.PI, view(), {
      quality: 'interactive',
    });
    expect(coarse.length).toBeLessThan(fine.length);
  });
});

describe('samplePolar', () => {
  it('draws the cardioid r = 1 + cos θ through its cusp', () => {
    const v = view();
    const r = (th: number) => 1 + Math.cos(th);
    const poly = samplePolar(r, 0, 2 * Math.PI, v);
    expectWellFormed(poly);
    expect(pieceCount(poly)).toBe(1);
    const pts = points(poly);
    expect(pts[0].x).toBeCloseTo(2, 12);
    expect(pts[0].y).toBeCloseTo(0, 12);
    expect(pts.some((p) => Math.hypot(p.x, p.y) < 1e-3)).toBe(true);
    for (const p of pts) {
      const th = Math.atan2(p.y, p.x);
      expect(Math.abs(Math.hypot(p.x, p.y) - r(th))).toBeLessThan(1e-9);
    }
  });

  it('draws the spiral r = θ over [0, 6π]', () => {
    const v = view();
    const poly = samplePolar((th) => th, 0, 6 * Math.PI, v);
    expectWellFormed(poly);
    expect(pieceCount(poly)).toBe(1);
    const pts = points(poly);
    expect(pts[0].x).toBe(0);
    const last = pts[pts.length - 1];
    expect(last.x).toBeCloseTo(6 * Math.PI, 9);
    expect(last.y).toBeCloseTo(0, 9);
    // Chords with an end on screen stay short (off-screen ones need no refinement).
    const b = viewBounds(v);
    const on = (p: P) => p.x >= b.xmin && p.x <= b.xmax && p.y >= b.ymin && p.y <= b.ymax;
    for (const [p, q] of segments(poly)) {
      if (!on(p) && !on(q)) continue;
      expect(Math.hypot(q.x - p.x, q.y - p.y) * v.ppuX).toBeLessThanOrEqual(16.01);
    }
  });

  it('allows negative r', () => {
    const poly = samplePolar(() => -1, 0, Math.PI, view());
    const pts = points(poly);
    expect(pts[0].x).toBeCloseTo(-1, 12);
    expect(pts[pts.length - 1].x).toBeCloseTo(1, 12);
    for (const p of pts) expect(Math.hypot(p.x, p.y)).toBeCloseTo(1, 12);
  });

  it('counts one evaluation of r per point', () => {
    const r = counting(() => 1);
    samplePolar(r.f, 0, 2 * Math.PI, view(), { maxEvals: 500 });
    expect(r.count()).toBeLessThanOrEqual(500);
  });
});

describe('parametric and polar singularities', () => {
  it('runs a polar log spike r = ln|θ - c| out of the view', () => {
    for (const ppu of [5, 15, 40]) {
      const v = view(0.01, -0.02, ppu);
      const b = viewBounds(v);
      for (let k = 0; k < 24; k++) {
        const c = k === 0 ? 1.2345 : 0.1 + 6 * ((k * 0.6180339887) % 1);
        const poly = samplePolar((th) => Math.log(Math.abs(th - c)), 0, 2 * Math.PI, v);
        expectWellFormed(poly);
        // Some point along the spike's ray (direction θ = c + π) lies beyond the view.
        const out = points(poly).some(
          (p) =>
            !Number.isNaN(p.x) &&
            -p.x * Math.cos(c) - p.y * Math.sin(c) > 0.99 * Math.hypot(p.x, p.y) &&
            (p.x < b.xmin || p.x > b.xmax || p.y < b.ymin || p.y > b.ymax),
        );
        expect(out).toBe(true);
      }
    }
  });

  it('continues (t, ln t) down past the view at t = 0', () => {
    for (const ppu of [40, 10, 5]) {
      const v = view(0, 0, ppu);
      const poly = sampleParametric((t) => t, Math.log, -1, 5, v);
      expectWellFormed(poly);
      const lowest = Math.min(...points(poly).map((p) => (Number.isNaN(p.y) ? 0 : p.y)));
      expect(lowest).toBeLessThan(viewBounds(v).ymin);
    }
  });
});

describe('parametric sampling grid and budget', () => {
  it('does not alias fast periodic curves with the grid', () => {
    const v = view();
    const circle = points(
      sampleParametric(
        (t) => Math.cos(512 * t),
        (t) => Math.sin(512 * t),
        0,
        2 * Math.PI,
        v,
      ),
    ).filter((p) => !Number.isNaN(p.x));
    expect(Math.min(...circle.map((p) => p.x))).toBeLessThan(-0.99);
    expect(Math.max(...circle.map((p) => p.y))).toBeGreaterThan(0.99);
    const rose = points(samplePolar((t) => Math.sin(256 * t), 0, 2 * Math.PI, v)).filter(
      (p) => !Number.isNaN(p.x),
    );
    expect(Math.max(...rose.map((p) => Math.hypot(p.x, p.y)))).toBeGreaterThan(0.99);
  });

  it('never draws chords across a circle traced over a long range', () => {
    const v = view();
    for (const tMax of [1000, 5000, 1e4, 1e5]) {
      const c = counting(Math.cos);
      const poly = sampleParametric(c.f, Math.sin, 0, tMax, v);
      expectWellFormed(poly);
      expect(c.count()).toBeLessThanOrEqual(60000);
      let drawn = 0;
      let worst = 0;
      for (let i = 2; i < poly.length; i += 2) {
        if (Number.isNaN(poly[i - 2]) || Number.isNaN(poly[i])) continue;
        drawn++;
        const r = Math.hypot((poly[i - 2] + poly[i]) / 2, (poly[i - 1] + poly[i + 1]) / 2);
        worst = Math.max(worst, (1 - r) * v.ppuX);
      }
      expect(worst).toBeLessThan(2);
      expect(drawn).toBeGreaterThan(200);
    }
  });

  it('keeps the part of a huge range around 0', () => {
    expect(MAX_PARAMETER_RANGE).toBe(1e6);
    const poly = sampleParametric(
      (t) => t / 1e5,
      (t) => (t / 1e5) ** 2,
      -1e6,
      1e6,
      view(),
    );
    const xs = points(poly)
      .map((p) => p.x)
      .filter((x) => !Number.isNaN(x));
    expect(Math.min(...xs)).toBeCloseTo(-5, 9);
    expect(Math.max(...xs)).toBeCloseTo(5, 9);
    // A range entirely on one side keeps its end nearest 0.
    const right = points(
      sampleParametric(
        (t) => t / 1e6,
        () => 0,
        3e6,
        1e9,
        view(),
      ),
    );
    expect(right[0].x).toBeCloseTo(3, 9);
    expect(right[right.length - 1].x).toBeCloseTo(4, 9);
  });
});

describe('parametric robustness', () => {
  it('returns well-formed output within budget for random views and hard curves', () => {
    let seed = 11;
    const rnd = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    const fns: ((t: number) => number)[] = [
      (t) => Math.sin(1 / t),
      (t) => Math.log(Math.abs(t - 1.3)),
      (t) => Math.tan(3 * t),
      (t) => Math.sqrt(Math.sin(t)),
      (t) => Math.floor(t * 3),
      () => Number.NaN,
      (t) => 1 / (t - 2),
    ];
    for (let k = 0; k < 80; k++) {
      const ppu = 10 ** (-3 + 9 * rnd());
      const v = view(rnd() - 0.5, rnd() - 0.5, ppu, 200 + 1400 * rnd(), 200 + 800 * rnd());
      const f = fns[k % fns.length];
      const counted = counting(f);
      const poly =
        k % 2
          ? samplePolar(counted.f, 0, 2 * Math.PI * (1 + 3 * rnd()), v)
          : sampleParametric((t) => t, counted.f, -10 * rnd(), 10 * rnd() + 0.1, v);
      expectWellFormed(poly);
      expect(counted.count()).toBeLessThanOrEqual(60000);
    }
  });
});
