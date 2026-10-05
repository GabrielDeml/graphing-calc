import { describe, expect, it } from 'vitest';
import type { Fn1, Fn2, PlotItem } from '../engine/types';
import { findPois, type Poi, type PoiCurve, type PoiKind } from './poi';
import { buildRowGeometry } from './scene';
import type { Viewport } from './types';

const view: Viewport = { cx: 0, cy: 0, ppuX: 40, ppuY: 40, width: 800, height: 600 };

function curve(id: string, plot: PlotItem, v: Viewport = view): PoiCurve {
  return { id, plot, geometry: buildRowGeometry(plot, v, 'final') };
}

const fx = (f: Fn1, isConstant = false): PlotItem => ({ kind: 'explicitY', f, isConstant });
const fy = (f: Fn1): PlotItem => ({ kind: 'explicitX', f, isConstant: false });
const implicit = (F: Fn2): PlotItem => ({ kind: 'implicit', F });
const parametric = (x: Fn1, y: Fn1, tMax = 2 * Math.PI, tMin = 0): PlotItem => ({
  kind: 'parametric',
  fx: x,
  fy: y,
  tMin: () => tMin,
  tMax: () => tMax,
});
const polar = (r: Fn1): PlotItem => ({
  kind: 'polar',
  r,
  thetaMin: () => 0,
  thetaMax: () => 2 * Math.PI,
});

function pois(plot: PlotItem, others: PlotItem[] = [], v: Viewport = view): Poi[] {
  return findPois(
    curve('t', plot, v),
    others.map((p, i) => curve(`o${i}`, p, v)),
    v,
  );
}

const ofKind = (list: Poi[], kind: PoiKind) => list.filter((p) => p.kinds.includes(kind));
const xs = (list: Poi[]) => list.map((p) => p.x).sort((a, b) => a - b);

/** Each expected point has its own found point, matched by distance, within `digits`. */
function expectPoints(list: Poi[], expected: [number, number][], digits = 9) {
  expect(list.length).toBe(expected.length);
  const left = [...list];
  for (const [x, y] of expected) {
    let best = 0;
    for (let i = 1; i < left.length; i++) {
      const d = (p: Poi) => Math.hypot(p.x - x, p.y - y);
      if (d(left[i]) < d(left[best])) best = i;
    }
    const [p] = left.splice(best, 1);
    expect(p.x).toBeCloseTo(x, digits);
    expect(p.y).toBeCloseTo(y, digits);
  }
}

describe('findPois: polynomials', () => {
  it('finds the roots, vertex and intercept of x² - 2', () => {
    const list = pois(fx((x) => x * x - 2));
    expectPoints(ofKind(list, 'root'), [
      [-Math.SQRT2, 0],
      [Math.SQRT2, 0],
    ]);
    const [vertex] = ofKind(list, 'min');
    expect(vertex.kinds).toEqual(['min', 'yIntercept']);
    expect(vertex.x).toBe(0);
    expect(vertex.y).toBeCloseTo(-2, 12);
    expect(list).toHaveLength(3);
    expect(ofKind(list, 'max')).toHaveLength(0);
  });

  it('gives roots exactly y = 0, and intercepts exactly x = 0', () => {
    for (const p of pois(fx((x) => x * x - 3))) {
      if (p.kinds.includes('root')) expect(p.y).toBe(0);
      if (p.kinds.includes('yIntercept')) expect(p.x).toBe(0);
    }
  });

  it('reports the double root of x² as one point that is all three', () => {
    const list = pois(fx((x) => x * x));
    expect(list).toHaveLength(1);
    expect(list[0]).toEqual({ x: 0, y: 0, kinds: ['min', 'root', 'yIntercept'], with: [] });
  });

  it('finds a double root away from the origin, even expanded', () => {
    const list = pois(fx((x) => x * x - 2 * x + 1));
    const [touch] = ofKind(list, 'root');
    expect(touch.kinds).toEqual(['min', 'root']);
    expect(touch.x).toBeCloseTo(1, 6);
    expect(touch.y).toBe(0);
  });

  it('does not count a dip that stays clear of zero as a root', () => {
    const list = pois(fx((x) => x * x + 1e-4));
    expect(ofKind(list, 'root')).toHaveLength(0);
    expect(ofKind(list, 'min')).toHaveLength(1);
  });

  it('finds both extrema and all three roots of a cubic', () => {
    const list = pois(fx((x) => x * x * x - 3 * x));
    // An extremum is flat: its place is only defined to about √ε.
    expectPoints(ofKind(list, 'max'), [[-1, 2]], 6);
    expectPoints(ofKind(list, 'min'), [[1, -2]], 6);
    expectPoints(ofKind(list, 'root'), [
      [-Math.sqrt(3), 0],
      [0, 0],
      [Math.sqrt(3), 0],
    ]);
    // The middle root is the y-intercept too.
    expect(list.find((p) => p.x === 0)?.kinds).toEqual(['root', 'yIntercept']);
  });

  it('locates extrema to well under a pixel', () => {
    const [max] = ofKind(pois(fx((x) => -((x - 1.234567) ** 2) + 3)), 'max');
    expect(max.x).toBeCloseTo(1.234567, 6);
    expect(max.y).toBeCloseTo(3, 12);
  });

  it('only reports points inside the view', () => {
    // Roots at ±12 and ±0.5: the view spans x in [-10, 10].
    const list = pois(fx((x) => (x * x - 144) * (x * x - 0.25)));
    expect(xs(ofKind(list, 'root'))).toEqual([expect.closeTo(-0.5, 9), expect.closeTo(0.5, 9)]);
    // The local maximum at 0 is at y = 36, far above the view; the minima are below it too.
    expect(ofKind(list, 'max')).toHaveLength(0);
  });

  it('finds nothing but the intercept on a horizontal line', () => {
    expect(pois(fx(() => 2, true))).toEqual([{ x: 0, y: 2, kinds: ['yIntercept'], with: [] }]);
    // On the axis itself every point is a root: none is shown.
    expect(pois(fx(() => 0, true))).toEqual([{ x: 0, y: 0, kinds: ['yIntercept'], with: [] }]);
    expect(ofKind(pois(fx((x) => 0 * x)), 'root')).toHaveLength(0);
  });
});

describe('findPois: trig, poles and jumps', () => {
  it('finds the roots and extrema of sin x', () => {
    const list = pois(fx(Math.sin));
    const roots = xs(ofKind(list, 'root'));
    // x in [-10, 10]: -3π … 3π.
    expect(roots).toHaveLength(7);
    roots.forEach((x, i) => {
      expect(x).toBeCloseTo((i - 3) * Math.PI, 9);
    });
    const maxima = ofKind(list, 'max');
    expect(maxima.length).toBe(3);
    for (const m of maxima) expect(m.y).toBeCloseTo(1, 12);
    expect(ofKind(list, 'min').length).toBe(3);
  });

  it('never takes the poles of tan x for roots', () => {
    const list = pois(fx(Math.tan));
    const roots = xs(ofKind(list, 'root'));
    expect(roots).toHaveLength(7);
    roots.forEach((x, i) => {
      expect(x).toBeCloseTo((i - 3) * Math.PI, 9);
    });
    expect(ofKind(list, 'max')).toHaveLength(0);
    expect(ofKind(list, 'min')).toHaveLength(0);
  });

  it('finds nothing on 1/x', () => {
    expect(pois(fx((x) => 1 / x))).toEqual([]);
  });

  it('sees the asymptote of 1/x², not an extremum at it', () => {
    const list = pois(fx((x) => 1 / (x * x)));
    expect(list).toEqual([]);
  });

  it('takes no jump of floor(x) - 0.5 for a root', () => {
    const list = pois(fx((x) => Math.floor(x) - 0.5));
    expect(ofKind(list, 'root')).toHaveLength(0);
  });

  it('takes no drop of a sawtooth for an extremum', () => {
    // x - floor(x) climbs toward 1 and drops to 0 at each integer, never reaching 1.
    const saw = pois(fx((x) => x - Math.floor(x)));
    expect(ofKind(saw, 'max')).toHaveLength(0);
    expect(ofKind(saw, 'min')).toHaveLength(0);
    // mod(x, 2) - 1: its roots at the odd integers, and no extrema at its drops.
    const mod = pois(fx((x) => (((x % 2) + 2) % 2) - 1));
    expect(ofKind(mod, 'max')).toHaveLength(0);
    expect(ofKind(mod, 'min')).toHaveLength(0);
    expect(xs(ofKind(mod, 'root'))).toEqual(
      [-9, -7, -5, -3, -1, 1, 3, 5, 7, 9].map((x) => expect.closeTo(x, 9)),
    );
  });

  it('finds the corner of |x| as a root and a minimum', () => {
    const list = pois(fx(Math.abs));
    expect(list).toHaveLength(1);
    expect(list[0].kinds).toEqual(['min', 'root', 'yIntercept']);
  });

  it('finds where tan x meets a line, skipping the poles', () => {
    const list = pois(fx(Math.tan), [fx(() => 1, true)]);
    const meets = ofKind(list, 'intersection');
    expect(meets).toHaveLength(6);
    for (const p of meets) {
      expect(Math.tan(p.x)).toBeCloseTo(1, 9);
      expect(p.with).toEqual(['o0']);
    }
  });

  it('stays within its evaluation budget on sin(1/x)', () => {
    let evals = 0;
    const f = (x: number) => {
      evals++;
      return Math.sin(1 / x);
    };
    const target = curve('t', fx(f));
    evals = 0;
    const list = findPois(target, [], view, { maxEvals: 20000 });
    expect(evals).toBeLessThanOrEqual(20000 + 400);
    // The pile of roots and extrema near 0 is too dense to show.
    expect(list.length).toBeLessThanOrEqual(20);
  });
});

describe('findPois: roots where a curve ends', () => {
  it('finds the roots at the ends of a semicircle', () => {
    const list = pois(fx((x) => Math.sqrt(4 - x * x)));
    expectPoints(ofKind(list, 'root'), [
      [-2, 0],
      [2, 0],
    ]);
    expect(ofKind(list, 'max')[0].kinds).toEqual(['max', 'yIntercept']);
    expect(list).toHaveLength(3);
  });

  it('finds where a square root starts', () => {
    expectPoints(pois(fx((x) => Math.sqrt(x - 2))), [[2, 0]]);
    expect(pois(fx(Math.sqrt))).toEqual([{ x: 0, y: 0, kinds: ['root', 'yIntercept'], with: [] }]);
    // Ending off the axis, or running off to infinity, is no root.
    expect(ofKind(pois(fx((x) => Math.sqrt(x - 2) + 1)), 'root')).toHaveLength(0);
    expect(ofKind(pois(fx(Math.log)), 'root')).toEqual([
      expect.objectContaining({ x: expect.closeTo(1, 9) }),
    ]);
  });

  it('finds an edge root at an irrational end of the domain', () => {
    const list = ofKind(pois(fx((x) => Math.sqrt(2 - x * x))), 'root');
    expectPoints(
      list,
      [
        [-Math.SQRT2, 0],
        [Math.SQRT2, 0],
      ],
      12,
    );
  });

  it('meets a curve where its domain ends', () => {
    const meets = ofKind(
      pois(
        fx((x) => Math.sqrt(4 - x * x)),
        [fx(() => 0, true)],
      ),
      'intersection',
    );
    expectPoints(meets, [
      [-2, 0],
      [2, 0],
    ]);
  });

  it('finds an axis crossing at the end of a parameter range', () => {
    const list = pois(parametric(Math.cos, Math.sin, Math.PI, -Math.PI));
    expectPoints(
      list,
      [
        [-1, 0],
        [0, -1],
        [0, 1],
        [1, 0],
      ],
      12,
    );
  });
});

describe('findPois: density', () => {
  it('drops the extrema of sin x first when zoomed out, then the roots', () => {
    // Zoomed out twice: roots and extrema together would be 25, 31 px apart.
    const out2: Viewport = { ...view, ppuX: 20, ppuY: 20 };
    const list = pois(fx(Math.sin), [fx((x) => x / 3)], out2);
    expect(ofKind(list, 'max')).toHaveLength(0);
    expect(ofKind(list, 'min')).toHaveLength(0);
    // x in [-20, 20]: 13 roots, one of them on the line too, and its other two crossings.
    expect(ofKind(list, 'root')).toHaveLength(13);
    expect(ofKind(list, 'intersection')).toHaveLength(3);
    expect(list).toHaveLength(15);
    // Four times: the roots alone are 31 px apart and 25 of them; only the intersections stay.
    const out4: Viewport = { ...view, ppuX: 10, ppuY: 10 };
    expect(pois(fx(Math.sin), [fx((x) => x / 3)], out4).map((p) => p.kinds[0])).toEqual([
      'intersection',
      'intersection',
      'intersection',
    ]);
    const wider: Viewport = { ...view, ppuX: 1, ppuY: 1 };
    // Roots π px apart: too close to read; only the intercept stays.
    expect(pois(fx(Math.sin), [], wider)).toEqual([
      { x: 0, y: 0, kinds: ['yIntercept'], with: [] },
    ]);
  });

  it('keeps points apart from a pair of close crossings', () => {
    // x² - 3 meets sin x and x/3 twice each, in pairs 12 and 20 px apart.
    const list = pois(
      fx((x) => x * x - 3),
      [fx(Math.sin), fx((x) => x / 3)],
    );
    expect(ofKind(list, 'intersection')).toHaveLength(4);
    expectPoints(ofKind(list, 'root'), [
      [-Math.sqrt(3), 0],
      [Math.sqrt(3), 0],
    ]);
    expect(ofKind(list, 'min')[0].kinds).toEqual(['min', 'yIntercept']);
  });

  it('keeps a few points that are close but readable', () => {
    // x³ - x: three roots and two extrema, under 30 px apart at this scale.
    const list = pois(fx((x) => x * x * x - x));
    expect(ofKind(list, 'root')).toHaveLength(3);
    expect(ofKind(list, 'max')).toHaveLength(1);
    expect(ofKind(list, 'min')).toHaveLength(1);
  });

  it('caps the number of points', () => {
    const many = Array.from({ length: 30 }, (_, k) => fx((x) => x + k / 10 - 1.5));
    const list = findPois(
      curve(
        't',
        fx((x) => -x),
      ),
      many.map((p, i) => curve(`o${i}`, p)),
      view,
      { maxPois: 12 },
    );
    expect(list.length).toBeLessThanOrEqual(12);
  });
});

describe('findPois: intersections of explicit curves', () => {
  it('finds y = x and y = 5 - x at (2.5, 2.5)', () => {
    const list = pois(
      fx((x) => x),
      [fx((x) => 5 - x)],
    );
    const [meet] = ofKind(list, 'intersection');
    expect(meet.x).toBeCloseTo(2.5, 12);
    expect(meet.y).toBeCloseTo(2.5, 12);
    expect(meet.with).toEqual(['o0']);
  });

  it('finds a tangent line meeting a parabola', () => {
    const meets = ofKind(
      pois(
        fx((x) => x * x),
        [fx((x) => 2 * x - 1)],
      ),
      'intersection',
    );
    expect(meets).toHaveLength(1);
    expect(meets[0].x).toBeCloseTo(1, 6);
    expect(meets[0].y).toBeCloseTo(1, 6);
  });

  it('separates two crossings a few pixels apart', () => {
    const meets = ofKind(
      pois(
        fx((x) => x * x),
        [fx(() => 0.01, true)],
      ),
      'intersection',
    );
    expect(xs(meets)).toEqual([expect.closeTo(-0.1, 9), expect.closeTo(0.1, 9)]);
  });

  it('finds sin x and x/3 meeting three times', () => {
    const meets = ofKind(pois(fx(Math.sin), [fx((x) => x / 3)]), 'intersection');
    expect(meets).toHaveLength(3);
    const [a, b, c] = xs(meets);
    expect(b).toBe(0);
    expect(c).toBeCloseTo(2.278862660075828, 9);
    expect(a).toBeCloseTo(-c, 9);
  });

  it('shows no intersections between a curve and itself', () => {
    expect(
      ofKind(
        pois(
          fx((x) => x),
          [fx((x) => x)],
        ),
        'intersection',
      ),
    ).toHaveLength(0);
  });

  it('merges an intersection on the axis with the root there', () => {
    const list = pois(
      fx((x) => x),
      [fx((x) => -x)],
    );
    expect(list).toEqual([
      { x: 0, y: 0, kinds: ['intersection', 'root', 'yIntercept'], with: ['o0'] },
    ]);
  });

  it('meets x = f(y) curves', () => {
    const meets = ofKind(
      pois(
        fx((x) => x * x),
        [fy((y) => y * y)],
      ),
      'intersection',
    );
    expectPoints(meets, [
      [0, 0],
      [1, 1],
    ]);
  });

  it('gives x = f(y) its own intercepts', () => {
    const list = pois(fy((y) => y * y - 1));
    expectPoints(ofKind(list, 'yIntercept'), [
      [0, -1],
      [0, 1],
    ]);
    // The vertex (-1, 0): a minimum of x and the x-intercept.
    expect(ofKind(list, 'xIntercept')[0].kinds).toEqual(['min', 'xIntercept']);
  });
});

describe('findPois: implicit, parametric and polar curves', () => {
  const circle = implicit((x, y) => x * x + y * y - 9);

  it('finds where an implicit circle crosses the axes', () => {
    const list = pois(circle);
    expectPoints(ofKind(list, 'xIntercept'), [
      [-3, 0],
      [3, 0],
    ]);
    expectPoints(ofKind(list, 'yIntercept'), [
      [0, -3],
      [0, 3],
    ]);
  });

  it('finds a line through an implicit circle', () => {
    const meets = ofKind(pois(circle, [fx((x) => x)]), 'intersection');
    const r = 3 / Math.SQRT2;
    expectPoints(meets, [
      [-r, -r],
      [r, r],
    ]);
  });

  it('finds two implicit curves meeting, refined past the polylines', () => {
    const hyperbola = implicit((x, y) => x * x - y * y - 1);
    const meets = ofKind(pois(circle, [hyperbola]), 'intersection');
    const a = Math.sqrt(5);
    expectPoints(
      meets,
      [
        [-a, -2],
        [-a, 2],
        [a, -2],
        [a, 2],
      ],
      6,
    );
  });

  it('finds a tangent circle touching the axis', () => {
    const list = pois(implicit((x, y) => x * x + (y - 1) * (y - 1) - 1));
    expect(ofKind(list, 'xIntercept')).toHaveLength(1);
    expect(ofKind(list, 'xIntercept')[0].x).toBeCloseTo(0, 6);
  });

  it('finds the axis crossings of a parametric circle exactly', () => {
    const list = pois(
      parametric(
        (t) => 2 * Math.cos(t),
        (t) => 2 * Math.sin(t),
      ),
    );
    expectPoints(list, [
      [-2, 0],
      [0, -2],
      [0, 2],
      [2, 0],
    ]);
  });

  it('finds a parametric curve meeting explicit and implicit curves', () => {
    const p = parametric(
      (t) => 2 * Math.cos(t),
      (t) => 2 * Math.sin(t),
    );
    const withLine = ofKind(pois(p, [fx(() => 1, true)]), 'intersection');
    expectPoints(withLine, [
      [-Math.sqrt(3), 1],
      [Math.sqrt(3), 1],
    ]);
    const withCircle = ofKind(
      pois(p, [implicit((x, y) => (x - 2) ** 2 + y * y - 4)]),
      'intersection',
    );
    expectPoints(withCircle, [
      [1, -Math.sqrt(3)],
      [1, Math.sqrt(3)],
    ]);
  });

  it('crosses two parametric curves by their polylines', () => {
    const a = parametric(
      (t) => 2 * Math.cos(t),
      (t) => 2 * Math.sin(t),
    );
    const b = parametric(
      (t) => t - 5,
      () => 0.5,
      10,
    );
    const meets = ofKind(pois(a, [b]), 'intersection');
    expect(meets).toHaveLength(2);
    for (const m of meets) {
      expect(Math.abs(m.x)).toBeCloseTo(Math.sqrt(4 - 0.25), 2);
      expect(m.y).toBeCloseTo(0.5, 2);
    }
  });

  it('counts a point a curve passes through more than once as one', () => {
    // A circle traced twice.
    expectPoints(
      pois(parametric(Math.cos, Math.sin, 4 * Math.PI)),
      [
        [-1, 0],
        [0, -1],
        [0, 1],
        [1, 0],
      ],
      12,
    );
    // r = 2 sin θ goes round its circle twice over [0, 2π].
    const circle = polar((t) => 2 * Math.sin(t));
    expectPoints(ofKind(pois(circle), 'yIntercept'), [
      [0, 0],
      [0, 2],
    ]);
    expectPoints(ofKind(pois(circle, [fx(() => 1, true)]), 'intersection'), [
      [-1, 1],
      [1, 1],
    ]);
    // Every petal of a rose passes through the origin.
    const rose = pois(polar((t) => Math.cos(2 * t)));
    expectPoints(
      rose,
      [
        [-1, 0],
        [0, -1],
        [0, 0],
        [0, 1],
        [1, 0],
      ],
      6,
    );
    expect(rose.find((p) => p.x === 0 && p.y === 0)?.kinds).toEqual(['xIntercept', 'yIntercept']);
  });

  it('finds the axis crossings of a cardioid', () => {
    const list = pois(polar((t) => 1 + Math.cos(t)));
    expectPoints(ofKind(list, 'yIntercept'), [
      [0, -1],
      [0, 0],
      [0, 1],
    ]);
    expectPoints(ofKind(list, 'xIntercept'), [
      [0, 0],
      [2, 0],
    ]);
  });

  it('has no points of interest for point rows', () => {
    const pts: PlotItem = { kind: 'points', points: [{ x: () => 1, y: () => 0 }] };
    expect(pois(pts)).toEqual([]);
    expect(
      pois(
        fx((x) => x + 1),
        [pts],
      ),
    ).toEqual(pois(fx((x) => x + 1)));
  });
});

describe('findPois: robustness', () => {
  const fns: Fn1[] = [
    () => Number.NaN,
    () => Number.POSITIVE_INFINITY,
    (x) => Math.sqrt(x),
    (x) => Math.log(x),
    (x) => 1 / (x - 1e-9),
    (x) => Math.sin(1 / x) * x,
    (x) => x ** 7 - x,
    (x) => Math.floor(x * 3),
    (x) => (Math.abs(x) < 1 ? Number.NaN : x),
    (x) => Math.exp(x),
    (x) => 1e300 * x,
  ];
  const views: Viewport[] = [
    view,
    { ...view, ppuX: 1e10, ppuY: 1e10 },
    { ...view, ppuX: 1e-5, ppuY: 1e-5 },
    { ...view, cx: 1e6, cy: -3e5, ppuX: 1e3, ppuY: 1e3 },
    { ...view, ppuX: 40, ppuY: 0.01 },
  ];

  it('never throws, and keeps every point inside the view', () => {
    for (const v of views) {
      const b = {
        xmin: v.cx - v.width / 2 / v.ppuX,
        xmax: v.cx + v.width / 2 / v.ppuX,
        ymin: v.cy - v.height / 2 / v.ppuY,
        ymax: v.cy + v.height / 2 / v.ppuY,
      };
      for (const f of fns) {
        const list = pois(fx(f), [fx((x) => x), fy(f), circleAt(v)], v);
        expect(list.length).toBeLessThanOrEqual(20);
        for (const p of list) {
          expect(p.x).toBeGreaterThanOrEqual(b.xmin);
          expect(p.x).toBeLessThanOrEqual(b.xmax);
          expect(p.y).toBeGreaterThanOrEqual(b.ymin);
          expect(p.y).toBeLessThanOrEqual(b.ymax);
          expect(p.kinds.length).toBeGreaterThan(0);
        }
      }
    }
  });

  /** A circle around the middle of a view, a third of its height across. */
  function circleAt(v: Viewport): PlotItem {
    const r = v.height / 6 / v.ppuY;
    return implicit((x, y) => ((x - v.cx) / r) ** 2 + ((y - v.cy) / r) ** 2 - 1);
  }
});
