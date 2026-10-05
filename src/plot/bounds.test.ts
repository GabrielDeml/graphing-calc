import { describe, expect, it } from 'vitest';
import type { Fn1, Fn2, PlotItem } from '../engine/types';
import { drawsIn, fitViewport, plotBounds, robustRange, unionBounds } from './bounds';
import { buildRowGeometry } from './scene';
import type { Bounds, Viewport } from './types';
import { homeViewport, viewBounds } from './viewport';

/** 800 × 600 px, 30 px per unit: x in ±13.33, y in ±10. */
const home: Viewport = homeViewport(800, 600);

const fx = (f: Fn1): PlotItem => ({ kind: 'explicitY', f, isConstant: false });
const fy = (f: Fn1): PlotItem => ({ kind: 'explicitX', f, isConstant: false });
const implicit = (F: Fn2): PlotItem => ({ kind: 'implicit', F });
const parametric = (x: Fn1, y: Fn1, tMin = 0, tMax = 2 * Math.PI): PlotItem => ({
  kind: 'parametric',
  fx: x,
  fy: y,
  tMin: () => tMin,
  tMax: () => tMax,
});
const polar = (r: Fn1, thetaMax = 2 * Math.PI): PlotItem => ({
  kind: 'polar',
  r,
  thetaMin: () => 0,
  thetaMax: () => thetaMax,
});

function expectBox(box: Bounds | null, expected: Bounds, digits = 6) {
  expect(box).not.toBeNull();
  expect(box?.xmin).toBeCloseTo(expected.xmin, digits);
  expect(box?.xmax).toBeCloseTo(expected.xmax, digits);
  expect(box?.ymin).toBeCloseTo(expected.ymin, digits);
  expect(box?.ymax).toBeCloseTo(expected.ymax, digits);
}

describe('robustRange', () => {
  it('keeps every value of a smooth spread', () => {
    const vs = Array.from({ length: 101 }, (_, i) => (i - 50) ** 2);
    expect(robustRange(vs)).toEqual([0, 2500]);
  });

  it('leaves out the tail of a pole', () => {
    const vs = Array.from({ length: 1000 }, (_, i) => 1 / ((i + 0.5) / 50 - 10));
    const [lo, hi] = robustRange(vs) ?? [0, 0];
    expect(lo).toBeGreaterThan(-5);
    expect(hi).toBeLessThan(5);
    expect(lo).toBeLessThan(-1);
    expect(hi).toBeGreaterThan(1);
  });

  it('is null for nothing', () => {
    expect(robustRange([])).toBeNull();
    expect(robustRange([3])).toEqual([3, 3]);
  });
});

describe('plotBounds', () => {
  const b = viewBounds(home);

  it('y = f(x): its values over the x in view', () => {
    expectBox(
      plotBounds(
        fx((x) => x + 100),
        home,
      ),
      {
        xmin: b.xmin,
        xmax: b.xmax,
        ymin: b.xmin + 100,
        ymax: b.xmax + 100,
      },
    );
    // A constant: no height.
    expectBox(
      plotBounds(
        fx(() => 3),
        home,
      ),
      { xmin: b.xmin, xmax: b.xmax, ymin: 3, ymax: 3 },
    );
  });

  it('x = f(y): its values over the y in view', () => {
    expectBox(
      plotBounds(
        fy((y) => y * y),
        home,
      ),
      { xmin: 0, xmax: 100, ymin: -10, ymax: 10 },
      3,
    );
  });

  it('only where f is defined', () => {
    const box = plotBounds(
      fx((x) => Math.sqrt(4 - x * x)),
      home,
    );
    // To the sample nearest each end.
    expect(box?.xmin).toBeCloseTo(-2, 1);
    expect(box?.xmax).toBeCloseTo(2, 1);
    expect(box?.ymin).toBeLessThan(0.5);
    expect(box?.ymax).toBeCloseTo(2, 3);
  });

  it('leaves out the poles of 1/x and tan x', () => {
    for (const f of [(x: number) => 1 / x, Math.tan]) {
      const box = plotBounds(fx(f), home);
      expect(box).not.toBeNull();
      expect(box?.ymax).toBeLessThan(40);
      expect(box?.ymin).toBeGreaterThan(-40);
      expect(box?.ymax).toBeGreaterThan(1);
    }
  });

  it('looks farther out for y = f(x) defined nowhere in view', () => {
    const box = plotBounds(
      fx((x) => Math.sqrt(x - 1000)),
      home,
    );
    expect(box).not.toBeNull();
    expect(box?.xmin).toBeGreaterThanOrEqual(1000);
    expect(box?.xmax).toBeGreaterThan(1500);
    expect(
      plotBounds(
        fx(() => Number.NaN),
        home,
      ),
    ).toBeNull();
  });

  it('parametric and polar curves: their whole range', () => {
    expectBox(
      plotBounds(
        parametric(
          (t) => 3 * Math.cos(t) + 50,
          (t) => 2 * Math.sin(t),
        ),
        home,
      ),
      { xmin: 47, xmax: 53, ymin: -2, ymax: 2 },
      3,
    );
    expectBox(
      plotBounds(
        polar(() => 30),
        home,
      ),
      { xmin: -30, xmax: 30, ymin: -30, ymax: 30 },
      2,
    );
    // Half a turn of a circle.
    expectBox(
      plotBounds(
        polar(() => 1, Math.PI),
        home,
      ),
      { xmin: -1, xmax: 1, ymin: 0, ymax: 1 },
      3,
    );
    // An empty range draws nothing.
    expect(plotBounds(parametric(Math.cos, Math.sin, 1, 1), home)).toBeNull();
  });

  it('points', () => {
    const plot: PlotItem = {
      kind: 'points',
      points: [
        { x: () => 1, y: () => 2 },
        { x: () => -3, y: () => 4 },
        { x: () => Number.NaN, y: () => 9 },
      ],
    };
    expectBox(plotBounds(plot, home), { xmin: -3, xmax: 1, ymin: 2, ymax: 4 });
  });

  it('implicit curves: a circle in view, far away, bigger than the view, tiny', () => {
    const circle = (cx: number, cy: number, r: number) =>
      implicit((x, y) => (x - cx) ** 2 + (y - cy) ** 2 - r * r);
    expectBox(plotBounds(circle(0, 0, 3), home), { xmin: -3, xmax: 3, ymin: -3, ymax: 3 }, 1);
    expectBox(plotBounds(circle(200, 0, 5), home), { xmin: 195, xmax: 205, ymin: -5, ymax: 5 }, -1);
    expectBox(plotBounds(circle(0, 0, 50), home), { xmin: -50, xmax: 50, ymin: -50, ymax: 50 }, 0);
    expectBox(
      plotBounds(circle(0, 0, 0.02), home),
      { xmin: -0.02, xmax: 0.02, ymin: -0.02, ymax: 0.02 },
      3,
    );
  });

  it('an unending implicit curve: the part near the view', () => {
    const box = plotBounds(
      implicit((x, y) => x + y - 1),
      home,
    );
    expect(box).not.toBeNull();
    expect(box?.xmax).toBeGreaterThan(10);
    expect(box?.xmax).toBeLessThan(30);
  });

  it('never takes a pole for the curve', () => {
    // F = y - 1/x changes sign across x = 0 all the way up, but only meets zero on the hyperbola:
    // both branches, as far as the view's square reaches.
    const box = plotBounds(
      implicit((x, y) => y - 1 / x),
      home,
    );
    expect(box?.xmin).toBeLessThan(-10);
    expect(box?.xmax).toBeGreaterThan(10);
    expect(box?.ymax).toBeLessThan(20);
    expect(box?.ymin).toBeGreaterThan(-20);
  });

  it('is null for an implicit equation with no curve', () => {
    expect(
      plotBounds(
        implicit((x, y) => x * x + y * y + 1),
        home,
      ),
    ).toBeNull();
  });
});

describe('unionBounds', () => {
  it('holds both', () => {
    const a = { xmin: 0, xmax: 1, ymin: 0, ymax: 1 };
    const c = { xmin: -2, xmax: 0.5, ymin: 3, ymax: 4 };
    expect(unionBounds(a, c)).toEqual({ xmin: -2, xmax: 1, ymin: 0, ymax: 4 });
    expect(unionBounds(null, a)).toBe(a);
    expect(unionBounds(a, null)).toBe(a);
    expect(unionBounds(null, null)).toBeNull();
  });
});

describe('fitViewport', () => {
  it('shows the box whole, centred, equally scaled, with room around it', () => {
    const v = fitViewport({ xmin: 10, xmax: 30, ymin: -5, ymax: 5 }, home);
    expect(v.ppuX).toBe(v.ppuY);
    expect(v.cx).toBe(20);
    expect(v.cy).toBe(0);
    const b = viewBounds(v);
    expect(b.xmin).toBeLessThan(10);
    expect(b.xmax).toBeGreaterThan(30);
    // Width-limited: the margin is 48 px (8% of 600).
    expect(v.ppuX).toBeCloseTo((800 - 96) / 20, 9);
    // Height-limited.
    const tall = fitViewport({ xmin: 0, xmax: 1, ymin: 0, ymax: 100 }, home);
    expect(tall.ppuY).toBeCloseTo((600 - 96) / 100, 9);
    expect(tall.width).toBe(800);
  });

  it('keeps the scale for a point, and the other axis decides for a line', () => {
    const point = fitViewport({ xmin: 5, xmax: 5, ymin: 7, ymax: 7 }, home);
    expect(point).toMatchObject({ cx: 5, cy: 7, ppuX: home.ppuX, ppuY: home.ppuY });
    const line = fitViewport({ xmin: -10, xmax: 10, ymin: 3, ymax: 3 }, home);
    expect(line.cy).toBe(3);
    expect(line.ppuX).toBeCloseTo((800 - 96) / 20, 9);
  });
});

describe('drawsIn', () => {
  const b = viewBounds(home);

  it('tells a curve in view from one out of it', () => {
    const near = buildRowGeometry(
      fx((x) => x + 1),
      home,
      'final',
    );
    const far = buildRowGeometry(
      fx((x) => x + 100),
      home,
      'final',
    );
    expect(drawsIn(near, b)).toBe(true);
    expect(drawsIn(far, b)).toBe(false);
    const circle = buildRowGeometry(
      implicit((x, y) => x * x + y * y - 9),
      home,
      'final',
    );
    expect(drawsIn(circle, b)).toBe(true);
  });

  it('counts points and shaded regions', () => {
    const pts = { curves: [], dashed: false, fill: null, points: new Float64Array([50, 50]) };
    expect(drawsIn(pts, b)).toBe(false);
    expect(drawsIn({ ...pts, points: new Float64Array([1, 1]) }, b)).toBe(true);
    expect(drawsIn({ ...pts, fill: new Float64Array([0, 0, 1, 0, 1, 1]) }, b)).toBe(true);
  });
});
