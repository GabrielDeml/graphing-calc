import { describe, expect, it } from 'vitest';
import type { Fn2 } from '../engine/types';
import { contourImplicit } from './marchingSquares';
import type { Viewport } from './types';

function view(ppu = 100, cx = 0, cy = 0, width = 1200, height = 800): Viewport {
  return { cx, cy, ppuX: ppu, ppuY: ppu, width, height };
}

/** Splits NaN-pair separated data into pieces of interleaved x,y. */
function pieces(buf: Float64Array): number[][] {
  const out: number[][] = [];
  let cur: number[] = [];
  for (let i = 0; i < buf.length; i += 2) {
    if (Number.isNaN(buf[i]) || Number.isNaN(buf[i + 1])) {
      if (cur.length > 0) out.push(cur);
      cur = [];
    } else {
      cur.push(buf[i], buf[i + 1]);
    }
  }
  if (cur.length > 0) out.push(cur);
  return out;
}

function vertices(buf: Float64Array): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let i = 0; i < buf.length; i += 2) {
    if (!Number.isNaN(buf[i])) out.push([buf[i], buf[i + 1]]);
  }
  return out;
}

/** Even-odd point-in-polygon over every polygon of a NaN-separated list. */
function pointInPolygons(polys: Float64Array, x: number, y: number): boolean {
  let inside = false;
  for (const p of pieces(polys)) {
    for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2) {
      const xi = p[i];
      const yi = p[i + 1];
      const xj = p[j];
      const yj = p[j + 1];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}

/** Number of polygons containing the point (each polygon tested on its own). */
function coverCount(polys: Float64Array, x: number, y: number): number {
  let n = 0;
  for (const p of pieces(polys)) {
    if (pointInPolygons(Float64Array.from(p), x, y)) n++;
  }
  return n;
}

function signedArea(p: number[]): number {
  let s = 0;
  for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2) {
    s += p[j] * p[i + 1] - p[i] * p[j + 1];
  }
  return s / 2;
}

function totalArea(polys: Float64Array): number {
  let s = 0;
  for (const p of pieces(polys)) s += signedArea(p);
  return s;
}

/** Distance from (x, y) to the nearest segment of a NaN-separated polyline. */
function distToCurve(curve: Float64Array, x: number, y: number): number {
  let best = Number.POSITIVE_INFINITY;
  for (const p of pieces(curve)) {
    for (let i = 0; i + 3 < p.length; i += 2) {
      const ax = p[i];
      const ay = p[i + 1];
      const dx = p[i + 2] - ax;
      const dy = p[i + 3] - ay;
      const len2 = dx * dx + dy * dy;
      const t = len2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / len2)) : 0;
      best = Math.min(best, Math.hypot(ax + t * dx - x, ay + t * dy - y));
    }
  }
  return best;
}

function counted(F: Fn2): { f: Fn2; count: () => number } {
  let n = 0;
  return {
    f: (x, y) => {
      n++;
      return F(x, y);
    },
    count: () => n,
  };
}

/**
 * Open-chain ends strictly inside the view (inset 1px). Chains of a curve that crosses the view
 * end in the grid margin outside it, so any end inside is a break in the curve.
 */
function interiorEnds(curve: Float64Array, v: Viewport): number {
  const hw = (v.width / 2 - 1) / v.ppuX;
  const hh = (v.height / 2 - 1) / v.ppuY;
  let n = 0;
  for (const p of pieces(curve)) {
    const m = p.length;
    if (m > 2 && p[0] === p[m - 2] && p[1] === p[m - 1]) continue;
    for (const i of [0, m - 2]) {
      if (Math.abs(p[i] - v.cx) < hw && Math.abs(p[i + 1] - v.cy) < hh) n++;
    }
  }
  return n;
}

/** Longest segment of a polyline, in pixels. */
function maxSegmentPx(curve: Float64Array, v: Viewport): number {
  let best = 0;
  for (const p of pieces(curve)) {
    for (let i = 0; i + 3 < p.length; i += 2) {
      const d = Math.hypot((p[i + 2] - p[i]) * v.ppuX, (p[i + 3] - p[i + 1]) * v.ppuY);
      best = Math.max(best, d);
    }
  }
  return best;
}

/** Deterministic pseudo-random numbers in [0, 1). */
function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** The home view: 20 units across the shorter side. */
function home(width: number, height: number): Viewport {
  return view(Math.min(width, height) / 20, 0, 0, width, height);
}

const circle: Fn2 = (x, y) => x * x + y * y - 1;
const disk: Fn2 = (x, y) => 1 - x * x - y * y;

describe('contourImplicit: curves', () => {
  it('traces x^2 + y^2 = 1 accurately as one closed polyline', () => {
    const { curve, region } = contourImplicit(circle, view());
    expect(region).toBeNull();
    const vs = vertices(curve);
    expect(vs.length).toBeGreaterThan(200);
    for (const [x, y] of vs) expect(Math.abs(Math.hypot(x, y) - 1)).toBeLessThan(0.01);
    const ps = pieces(curve);
    expect(ps.length).toBeLessThan(5);
    const main = ps.reduce((a, b) => (b.length > a.length ? b : a));
    expect(main.length / 2).toBeGreaterThan(0.9 * vs.length);
    const gap = Math.hypot(main[0] - main[main.length - 2], main[1] - main[main.length - 1]);
    expect(gap).toBeLessThan(0.03);
    // Covers the whole circle: every direction has a vertex nearby.
    for (let a = 0; a < 2 * Math.PI; a += 0.1) {
      expect(distToCurve(curve, Math.cos(a), Math.sin(a))).toBeLessThan(0.005);
    }
  });

  it('is accurate at interactive quality too', () => {
    const { curve } = contourImplicit(circle, view(), { quality: 'interactive' });
    const vs = vertices(curve);
    expect(vs.length).toBeGreaterThan(100);
    for (const [x, y] of vs) expect(Math.abs(Math.hypot(x, y) - 1)).toBeLessThan(0.01);
    expect(pieces(curve).length).toBeLessThan(5);
  });

  it('keeps vertices fixed in world space while panning', () => {
    const key = (x: number, y: number) => `${x},${y}`;
    const a = new Set(
      vertices(contourImplicit(circle, view(100, 0, 0)).curve).map(([x, y]) => key(x, y)),
    );
    const b = vertices(contourImplicit(circle, view(100, 0.3137, -0.271)).curve);
    expect(b.length).toBeGreaterThan(200);
    for (const [x, y] of b) expect(a.has(key(x, y))).toBe(true);
  });

  it('draws both branches of x*y = 1 and nothing along the axes', () => {
    const { curve } = contourImplicit((x, y) => x * y - 1, view());
    const ps = pieces(curve);
    expect(ps.length).toBe(2);
    let q1 = 0;
    let q3 = 0;
    for (const [x, y] of vertices(curve)) {
      expect(Math.abs(x * y - 1)).toBeLessThan(1e-9);
      if (x > 0 && y > 0) q1++;
      else if (x < 0 && y < 0) q3++;
    }
    expect(q1).toBeGreaterThan(100);
    expect(q3).toBeGreaterThan(100);
  });

  it('draws nothing for 1/(x - y) = 0 (pole, not a root)', () => {
    expect(contourImplicit((x, y) => 1 / (x - y), view()).curve.length).toBe(0);
    // Pole line not through grid vertices, and at interactive quality.
    expect(contourImplicit((x, y) => 1 / (x - y - 0.0123), view()).curve.length).toBe(0);
    const interactive = contourImplicit((x, y) => 1 / (x - 0.3 * y + 0.017), view(37), {
      quality: 'interactive',
    });
    expect(interactive.curve.length).toBe(0);
  });

  it('draws tan(x) - y = 0 without vertical lines at the poles', () => {
    const v = view();
    const { curve } = contourImplicit((x, y) => Math.tan(x) - y, v);
    expect(curve.length).toBeGreaterThan(0);
    for (const p of pieces(curve)) {
      for (let i = 0; i + 3 < p.length; i += 2) {
        const dx = (p[i + 2] - p[i]) * v.ppuX;
        const dy = (p[i + 3] - p[i + 1]) * v.ppuY;
        expect(Math.hypot(dx, dy)).toBeLessThan(v.height);
      }
    }
    // Every vertex lies on a branch of y = tan(x): x - atan(y) is a multiple of π.
    for (const [x, y] of vertices(curve)) {
      const d = x - Math.atan(y);
      const k = Math.round(d / Math.PI);
      expect(Math.abs(d - k * Math.PI)).toBeLessThan(0.01);
    }
    // One branch per period across the view (x in [-6, 6]): about 4 pieces, no pole segments.
    expect(pieces(curve).length).toBeLessThanOrEqual(5);
  });

  it('keeps steep but continuous roots (x^(1/3) style)', () => {
    const { curve } = contourImplicit((x, y) => Math.cbrt(x) - y, view());
    for (let y = -1.5; y <= 1.5; y += 0.25) {
      expect(distToCurve(curve, y * y * y, y)).toBeLessThan(0.01);
    }
    expect(pieces(curve).length).toBe(1);
  });

  it('renders the saddle x^2 - y^2 = 0 without gaps at the origin', () => {
    const { curve } = contourImplicit((x, y) => x * x - y * y, view());
    for (const s of [-1, -0.1, -0.05, -0.02, -0.01, 0.01, 0.02, 0.05, 0.1, 1]) {
      expect(distToCurve(curve, s, s)).toBeLessThan(1e-9);
      expect(distToCurve(curve, s, -s)).toBeLessThan(1e-9);
    }
    expect(distToCurve(curve, 0, 0)).toBeLessThan(1e-9);
  });

  it('resolves a saddle inside a cell', () => {
    const a = 0.0123;
    const b = 0.0071;
    const v = view();
    const { curve } = contourImplicit((x, y) => (x - a) ** 2 - (y - b) ** 2, v);
    for (const s of [-0.5, -0.1, -0.05, -0.03, 0.03, 0.05, 0.1, 0.5]) {
      expect(distToCurve(curve, a + s, b + s)).toBeLessThan(0.005);
      expect(distToCurve(curve, a + s, b - s)).toBeLessThan(0.005);
    }
    expect(distToCurve(curve, a, b)).toBeLessThan(0.015);
    // The X is two unbroken bent lines, not a chain with gaps beside the saddle.
    expect(pieces(curve).length).toBe(2);
    expect(interiorEnds(curve, v)).toBe(0);
  });

  it('keeps off-grid X-crossings connected: (x - a)^2 = (y - b)^2', () => {
    const rand = seeded(1);
    const v = view(100, 0, 0, 400, 300);
    for (let i = 0; i < 150; i++) {
      const a = rand() * 0.08;
      const b = rand() * 0.08;
      const { curve } = contourImplicit((x, y) => (x - a) ** 2 - (y - b) ** 2, v);
      expect(interiorEnds(curve, v)).toBe(0);
      expect(pieces(curve).length).toBe(2);
    }
  });

  it('draws trig lattices at the home view without breaks at the saddles', () => {
    const lattices: Fn2[] = [
      (x, y) => Math.sin(x) - Math.cos(y),
      (x, y) => Math.cos(x) + Math.cos(y),
      (x, y) => Math.sin(x) + Math.sin(y),
    ];
    for (const F of lattices) {
      for (const v of [home(1200, 800), home(400, 700), home(1920, 1080)]) {
        const { curve } = contourImplicit(F, v);
        expect(curve.length).toBeGreaterThan(0);
        expect(interiorEnds(curve, v)).toBe(0);
      }
    }
    const rand = seeded(2);
    for (let i = 0; i < 20; i++) {
      const a = rand();
      const b = rand();
      const v = view(40 + rand() * 80, rand() * 0.3, rand() * 0.3);
      const { curve } = contourImplicit((x, y) => Math.sin(x + a) - Math.cos(y + b), v);
      expect(interiorEnds(curve, v)).toBe(0);
    }
  });

  it('closes loops with corners and tangent points', () => {
    const rand = seeded(3);
    for (let i = 0; i < 40; i++) {
      const a = rand() * 0.5;
      const b = rand() * 0.5;
      const v = view(40 + rand() * 80, rand() * 0.3, rand() * 0.3);
      const diamond = contourImplicit((x, y) => Math.abs(x - a) + Math.abs(y - b) - 1, v).curve;
      const square = contourImplicit(
        (x, y) => Math.max(Math.abs(x - a), Math.abs(y - b)) - 1,
        v,
      ).curve;
      for (const curve of [diamond, square]) {
        expect(pieces(curve).length).toBe(1);
        expect(interiorEnds(curve, v)).toBe(0);
      }
      // A chord across a 2px cell cuts a corner by at most half a cell (diagonal arms) or half
      // its diagonal (axis-aligned arms); a gap at the corner would be much further away.
      for (const [dx, dy] of [
        [1, 0],
        [0, 1],
        [-1, 0],
        [0, -1],
      ]) {
        expect(distToCurve(diamond, a + dx, b + dy) * v.ppuX).toBeLessThan(1.05);
        expect(distToCurve(square, a + dx + dy, b + dy - dx) * v.ppuX).toBeLessThan(1.45);
      }
    }
    // Small circles touch grid lines tangentially at their extremes.
    for (let i = 0; i < 100; i++) {
      const r = 0.05 + rand() * 0.3;
      const cx = rand() - 0.5;
      const cy = rand() - 0.5;
      const v = view();
      const { curve } = contourImplicit((x, y) => (x - cx) ** 2 + (y - cy) ** 2 - r * r, v);
      expect(pieces(curve).length).toBe(1);
      expect(interiorEnds(curve, v)).toBe(0);
    }
  });

  it('handles zeros exactly on grid lines without duplicates', () => {
    const v = view();
    // About 420 fine rows / columns cover the view plus margin.
    for (const [F, onLine] of [
      [(x: number) => x, (x: number) => Math.abs(x)],
      [(_x: number, y: number) => y, (_x: number, y: number) => Math.abs(y)],
      [(x: number, y: number) => x - y, (x: number, y: number) => Math.abs(x - y)],
    ] as Array<[Fn2, Fn2]>) {
      for (const strict of [false, true]) {
        const { curve } = contourImplicit(F, v, { strict });
        const ps = pieces(curve);
        expect(ps.length).toBeGreaterThanOrEqual(1);
        expect(ps.length).toBeLessThanOrEqual(2);
        const vs = vertices(curve);
        for (const [x, y] of vs) expect(onLine(x, y)).toBeLessThan(1e-12);
        expect(vs.length).toBeLessThan(700);
        const keys = new Set(vs.map(([x, y]) => `${x},${y}`));
        expect(keys.size).toBeGreaterThan(vs.length * 0.95);
      }
    }
  });

  it('does not draw along domain edges', () => {
    const { curve } = contourImplicit((x, y) => Math.sqrt(x) - y, view());
    const vs = vertices(curve);
    expect(vs.length).toBeGreaterThan(100);
    for (const [x, y] of vs) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(y).toBeGreaterThanOrEqual(-1e-9);
      expect(Math.abs(x - y * y)).toBeLessThan(0.005);
    }
  });

  it('does not draw vertical lines at jumps: floor(x) - y = 0', () => {
    const { curve } = contourImplicit((x, y) => Math.floor(x) - y, view(100, 0.013, 0.021));
    const ps = pieces(curve);
    // Steps y = -4 … 4 are in view.
    expect(ps.length).toBeGreaterThanOrEqual(8);
    for (const p of ps) {
      let lo = Number.POSITIVE_INFINITY;
      let hi = Number.NEGATIVE_INFINITY;
      for (let i = 1; i < p.length; i += 2) {
        lo = Math.min(lo, p[i]);
        hi = Math.max(hi, p[i]);
      }
      expect(hi - lo).toBeLessThan(0.05);
    }
  });

  it('draws no connectors across jumps that F climbs through', () => {
    const v = view(100, 0.013, 0.021);
    const jumps: Fn2[] = [
      (x, y) => Math.floor(x) + x - y,
      (x, y) => Math.floor(x) - (y - x),
      (x, y) => Math.round(2 * x) + x - y,
      (x, y) => Math.sign(x) + x - y,
      (x, y) => Math.ceil(x) - x - y,
    ];
    for (const F of jumps) {
      const { curve } = contourImplicit(F, v);
      const vs = vertices(curve);
      expect(vs.length).toBeGreaterThan(100);
      // Every vertex is on a branch (a stub at a branch end is under a third of a fine cell).
      for (const [x, y] of vs) expect(Math.abs(F(x, y))).toBeLessThan(0.01);
      expect(maxSegmentPx(curve, v)).toBeLessThan(4);
    }
  });

  it('draws y = 1/(x - c) with the pole between grid lines', () => {
    const c = 0.0123;
    const { curve } = contourImplicit((x, y) => 1 / (x - c) - y, view());
    expect(pieces(curve).length).toBe(2);
    for (const [x, y] of vertices(curve)) {
      expect(Math.abs(x - c)).toBeGreaterThan(0.2);
      expect(Math.abs((x - c) * y - 1)).toBeLessThan(1e-3);
    }
  });

  it('draws y = 1/x implicitly without a line at the pole', () => {
    const { curve } = contourImplicit((x, y) => 1 / x - y, view(100, 0.0037, 0));
    expect(pieces(curve).length).toBe(2);
    for (const [x, y] of vertices(curve)) {
      expect(Math.abs(x)).toBeGreaterThan(0.2);
      expect(Math.abs(x * y - 1)).toBeLessThan(0.01);
    }
  });

  it('documents the tangential-zero limitation: (x^2 + y^2 - 1)^2 = 0 draws nothing', () => {
    expect(contourImplicit((x, y) => (x * x + y * y - 1) ** 2, view()).curve.length).toBe(0);
  });

  it('returns nothing for a degenerate view or when nothing is requested', () => {
    expect(contourImplicit(circle, view(100, 0, 0, 0, 800)).curve.length).toBe(0);
    expect(contourImplicit(circle, view(Number.NaN)).curve.length).toBe(0);
    const none = contourImplicit(circle, view(), { curve: false });
    expect(none.curve.length).toBe(0);
    expect(none.region).toBeNull();
    expect(contourImplicit(disk, view(100, 0, 0, 0, 0), { region: true }).region?.length).toBe(0);
  });

  it('handles huge world offsets without hanging', () => {
    const v: Viewport = { cx: 1e12, cy: -1e12, ppuX: 1e9, ppuY: 1e9, width: 300, height: 200 };
    const res = contourImplicit((x, y) => x - 1e12 + (y + 1e12), v, { region: true });
    expect(res.curve.length % 2).toBe(0);
  });
});

describe('contourImplicit: regions', () => {
  it('shades x^2 + y^2 <= 1 with the right area and no overlaps', () => {
    const { curve, region } = contourImplicit(disk, view(), { region: true });
    expect(region).not.toBeNull();
    const r = region as Float64Array;
    expect(curve.length).toBeGreaterThan(0);
    expect(pointInPolygons(r, 0, 0)).toBe(true);
    expect(pointInPolygons(r, 0.3, -0.2)).toBe(true);
    expect(pointInPolygons(r, 0.99, 0)).toBe(true);
    expect(pointInPolygons(r, 0, -0.99)).toBe(true);
    expect(pointInPolygons(r, 1.01, 0)).toBe(false);
    expect(pointInPolygons(r, 3, 3)).toBe(false);
    expect(totalArea(r)).toBeGreaterThan(Math.PI * 0.98);
    expect(totalArea(r)).toBeLessThan(Math.PI * 1.02);
    expect(Math.abs(totalArea(r) - Math.PI)).toBeLessThan(0.005);
    // Counter-clockwise, and no point is covered twice.
    for (const p of pieces(r)) expect(signedArea(p)).toBeGreaterThanOrEqual(0);
    for (let x = -1.05; x < 1.05; x += 0.0731) {
      for (let y = -1.05; y < 1.05; y += 0.0677) {
        const n = coverCount(r, x + 1e-7, y + 3e-7);
        expect(n).toBeLessThanOrEqual(1);
        expect(n === 1).toBe(x * x + y * y < 1);
      }
    }
  });

  it('merges fully-inside cells into a modest number of polygons', () => {
    const r = contourImplicit(disk, view(), { region: true }).region as Float64Array;
    expect(pieces(r).length).toBeLessThan(3000);
  });

  it('shades at interactive quality and for strict inequalities', () => {
    for (const quality of ['interactive', 'final'] as const) {
      for (const strict of [false, true]) {
        const r = contourImplicit(disk, view(), { region: true, strict, quality })
          .region as Float64Array;
        expect(Math.abs(totalArea(r) - Math.PI)).toBeLessThan(Math.PI * 0.02);
        expect(pointInPolygons(r, 0, 0)).toBe(true);
        expect(pointInPolygons(r, 3, 3)).toBe(false);
      }
    }
  });

  it('shades a region without its curve when asked', () => {
    const res = contourImplicit(disk, view(), { curve: false, region: true });
    expect(res.curve.length).toBe(0);
    expect(Math.abs(totalArea(res.region as Float64Array) - Math.PI)).toBeLessThan(0.01);
  });

  it('separates saddle regions correctly (x*y > 0 shades two quadrants)', () => {
    const v = view(100, 0.01, -0.013);
    const r = contourImplicit((x, y) => (x - 0.0123) * (y - 0.0071), v, {
      region: true,
      strict: true,
    }).region as Float64Array;
    expect(pointInPolygons(r, 1, 1)).toBe(true);
    expect(pointInPolygons(r, -1, -1)).toBe(true);
    expect(pointInPolygons(r, 1, -1)).toBe(false);
    expect(pointInPolygons(r, -1, 1)).toBe(false);
    for (let x = -0.1; x < 0.1; x += 0.0071) {
      for (let y = -0.1; y < 0.1; y += 0.0067) {
        expect(coverCount(r, x + 1e-7, y + 3e-7)).toBeLessThanOrEqual(1);
      }
    }
  });

  it('covers the whole grid for F > 0 everywhere and nothing for F < 0', () => {
    const v = view();
    const all = contourImplicit(() => 1, v, { region: true });
    expect(all.curve.length).toBe(0);
    const r = all.region as Float64Array;
    expect(totalArea(r)).toBeGreaterThanOrEqual((1200 / 100) * (800 / 100));
    expect(pieces(r).length).toBeLessThan(200);
    expect(pointInPolygons(r, 5.9, 3.9)).toBe(true);
    expect(contourImplicit(() => -1, v, { region: true }).region?.length).toBe(0);
  });

  it('bounds regions by domain edges (NaN is outside)', () => {
    const r = contourImplicit((x, y) => Math.sqrt(1 - x * x - y * y), view(), {
      region: true,
    }).region as Float64Array;
    expect(pointInPolygons(r, 0, 0)).toBe(true);
    expect(pointInPolygons(r, 1.05, 0)).toBe(false);
    expect(Math.abs(totalArea(r) - Math.PI)).toBeLessThan(Math.PI * 0.02);
  });

  it('shades across a pole boundary: 1/(x - y) > 0 is x > y', () => {
    const r = contourImplicit((x, y) => 1 / (x - y), view(), { region: true, strict: true })
      .region as Float64Array;
    expect(pointInPolygons(r, 1, 0)).toBe(true);
    expect(pointInPolygons(r, 0, 1)).toBe(false);
    expect(pointInPolygons(r, 2.5, -3)).toBe(true);
  });

  it('puts a region boundary at a pole on the pole line, not its mirror image', () => {
    const v = view();
    const step = 8 / 4 / v.ppuX;
    const onGrid = (u: number) => Math.abs(u / step - Math.round(u / step)) < 1e-6;
    for (const c of [0.007, 0.0123, 0.0031]) {
      for (const curve of [true, false]) {
        const r = contourImplicit((x, y) => 1 / (x - y - c), v, {
          region: true,
          strict: true,
          curve,
        }).region as Float64Array;
        let crossings = 0;
        for (let i = 0; i < r.length; i += 2) {
          const x = r[i];
          const y = r[i + 1];
          if (Number.isNaN(x) || (onGrid(x) && onGrid(y))) continue;
          crossings++;
          expect((Math.abs(x - y - c) / Math.SQRT2) * v.ppuX).toBeLessThan(0.05);
        }
        expect(crossings).toBeGreaterThan(500);
      }
    }
  });
});

describe('contourImplicit: budget', () => {
  it('degrades to the coarse grid instead of exceeding the budget', () => {
    const dense = counted((x, y) => Math.sin(40 * x) * Math.sin(40 * y) + 0.1);
    const res = contourImplicit(dense.f, view(), { maxEvals: 50_000, region: true });
    expect(dense.count()).toBeLessThanOrEqual(50_000);
    expect(res.curve.length).toBeGreaterThan(0);
    expect((res.region as Float64Array).length).toBeGreaterThan(0);
  });

  it('still approximates the circle on a small budget', () => {
    const c = counted(circle);
    const { curve } = contourImplicit(c.f, view(), { maxEvals: 20_000 });
    expect(c.count()).toBeLessThanOrEqual(20_000);
    const vs = vertices(curve);
    expect(vs.length).toBeGreaterThan(20);
    for (const [x, y] of vs) expect(Math.abs(Math.hypot(x, y) - 1)).toBeLessThan(0.05);
  });

  it('terminates on a tiny budget and on everywhere-dense input', () => {
    const tiny = counted((x, y) => Math.sin(1 / (x * y)));
    expect(() => contourImplicit(tiny.f, view(), { maxEvals: 100, region: true })).not.toThrow();
    expect(tiny.count()).toBeLessThan(5000);
    const dense = counted((x, y) => Math.sin(1000 * x) + Math.sin(1000 * y));
    contourImplicit(dense.f, view(), { region: true });
    expect(dense.count()).toBeLessThanOrEqual(400_000);
  });

  it('keeps curves connected when the budget forces the coarse grid', () => {
    const F: Fn2 = (x, y) => Math.sin(x) - Math.cos(y);
    for (const [v, maxEvals] of [
      [view(), 25_000],
      [view(30, 0.011, 0.007, 1920, 1080), 30_000],
    ] as Array<[Viewport, number]>) {
      const c = counted(F);
      const { curve } = contourImplicit(c.f, v, { maxEvals });
      expect(c.count()).toBeLessThanOrEqual(maxEvals);
      // 8px chords: the coarse grid was used.
      expect(maxSegmentPx(curve, v)).toBeGreaterThan(5);
      expect(interiorEnds(curve, v)).toBe(0);
    }
  });

  it('refines at a coarser fine-cell size instead of falling back on large views', () => {
    const v = home(3840, 2160);
    const c = counted((x, y) => Math.sin(x) + Math.sin(y) - 0.5);
    const { curve } = contourImplicit(c.f, v);
    expect(c.count()).toBeLessThanOrEqual(400_000);
    expect(maxSegmentPx(curve, v)).toBeLessThan(6);
    expect(interiorEnds(curve, v)).toBe(0);
    // Nearby zoom levels render alike instead of flipping between refined and coarse.
    for (const ppu of [30, 31]) {
      const w = view(ppu, 0, 0, 1920, 1080);
      const res = contourImplicit((x, y) => Math.sin(x) - Math.cos(y), w);
      expect(maxSegmentPx(res.curve, w)).toBeLessThan(6);
      expect(interiorEnds(res.curve, w)).toBe(0);
    }
  });

  it('uses a smaller default budget at interactive quality', () => {
    const heavy = counted((x, y) => Math.sin(10 * x) * Math.sin(10 * y));
    const res = contourImplicit(heavy.f, view(), { quality: 'interactive', region: true });
    expect(heavy.count()).toBeLessThanOrEqual(120_000);
    expect(res.curve.length).toBeGreaterThan(0);
    const dense = counted((x, y) => Math.tan(x * y) - 1);
    contourImplicit(dense.f, view(), { quality: 'interactive' });
    expect(dense.count()).toBeLessThanOrEqual(120_000);
  });

  it('stays within the default budget for ordinary curves without degrading', () => {
    const c = counted(circle);
    contourImplicit(c.f, view());
    // Coarse grid (~16k) plus refinement of the band around the circle.
    expect(c.count()).toBeLessThan(40_000);
  });
});
