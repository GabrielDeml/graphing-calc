import { describe, expect, it } from 'vitest';
import { explicitRegion } from './regions';
import type { Viewport } from './types';

// 1200×800 at 100 px/unit: x in [-6, 6], y in [-4, 4]; margins 0.8 vertically, 1.2 horizontally.
const view: Viewport = { cx: 0, cy: 0, ppuX: 100, ppuY: 100, width: 1200, height: 800 };

/** Boundary y = f(x) sampled on [a, b], as sampleExplicit would emit it (NaN where undefined). */
function sampleX(f: (x: number) => number, a: number, b: number, n = 400): Float64Array {
  const out = new Float64Array(2 * (n + 1));
  for (let i = 0; i <= n; i++) {
    const x = a + ((b - a) * i) / n;
    const y = f(x);
    out[2 * i] = Number.isFinite(y) ? x : Number.NaN;
    out[2 * i + 1] = Number.isFinite(y) ? y : Number.NaN;
  }
  return out;
}

/** Boundary x = g(y) sampled on [a, b]. */
function sampleY(g: (y: number) => number, a: number, b: number, n = 400): Float64Array {
  const s = sampleX(g, a, b, n);
  const out = new Float64Array(s.length);
  for (let i = 0; i < s.length; i += 2) {
    out[i] = s[i + 1];
    out[i + 1] = s[i];
  }
  return out;
}

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

function expectCounterClockwise(polys: Float64Array): void {
  for (const p of pieces(polys)) expect(signedArea(p)).toBeGreaterThanOrEqual(-1e-9);
}

describe('explicitRegion', () => {
  it('shades above y = x for y > x', () => {
    const r = explicitRegion(
      sampleX((x) => x, -7.2, 7.2),
      view,
      'x',
      'greater',
    );
    expect(pieces(r).length).toBe(1);
    expect(pointInPolygons(r, 0, 1)).toBe(true);
    expect(pointInPolygons(r, -3, 3.5)).toBe(true);
    expect(pointInPolygons(r, 0, -1)).toBe(false);
    expect(pointInPolygons(r, 3, 2)).toBe(false);
    expectCounterClockwise(r);
  });

  it('shades below y = x for y < x', () => {
    const r = explicitRegion(
      sampleX((x) => x, -7.2, 7.2),
      view,
      'x',
      'less',
    );
    expect(pointInPolygons(r, 0, -1)).toBe(true);
    expect(pointInPolygons(r, 0, 1)).toBe(false);
    expectCounterClockwise(r);
    // The two sides tile the band [-7.2, 7.2] × [-4.8, 4.8] exactly.
    const above = explicitRegion(
      sampleX((x) => x, -7.2, 7.2),
      view,
      'x',
      'greater',
    );
    expect(totalArea(r) + totalArea(above)).toBeCloseTo(14.4 * 9.6, 6);
  });

  it('leaves gaps unshaded: y < 1/x', () => {
    const b = sampleX((x) => (Math.abs(x) < 0.01 ? Number.NaN : 1 / x), -7, 7, 701);
    const r = explicitRegion(b, view, 'x', 'less');
    expect(pieces(r).length).toBe(2);
    expect(pointInPolygons(r, 1, 0.5)).toBe(true);
    expect(pointInPolygons(r, 1, 2)).toBe(false);
    expect(pointInPolygons(r, 0.5, 1.9)).toBe(true);
    expect(pointInPolygons(r, -1, -2)).toBe(true);
    expect(pointInPolygons(r, -1, 0)).toBe(false);
    expect(pointInPolygons(r, 0, 0)).toBe(false);
    expectCounterClockwise(r);
  });

  it('leaves undefined parts unshaded: y > sqrt(x)', () => {
    const b = sampleX(Math.sqrt, -7, 7);
    const r = explicitRegion(b, view, 'x', 'greater');
    expect(pointInPolygons(r, 1, 2)).toBe(true);
    expect(pointInPolygons(r, 4, 1)).toBe(false);
    expect(pointInPolygons(r, -1, 3)).toBe(false);
  });

  it('tolerates leading, trailing and repeated NaN pairs and skips single points', () => {
    const N = Number.NaN;
    const b = Float64Array.from([N, N, 0, 0, N, N, N, N, 1, 1, 2, 2, N, N, 3, 3, N, N]);
    const r = explicitRegion(b, view, 'x', 'greater');
    expect(pieces(r).length).toBe(1);
    expect(Number.isNaN(r[0])).toBe(false);
    expect(Number.isNaN(r[r.length - 1])).toBe(false);
    expect(pointInPolygons(r, 1.5, 3)).toBe(true);
    expect(pointInPolygons(r, 0.5, 3)).toBe(false);
    expect(explicitRegion(new Float64Array(0), view, 'x', 'greater').length).toBe(0);
    expect(explicitRegion(Float64Array.from([1, 1]), view, 'x', 'less').length).toBe(0);
  });

  it('clamps a boundary far above the view instead of inverting the polygon', () => {
    const b = sampleX(() => 1000, -6, 6);
    const below = explicitRegion(b, view, 'x', 'less');
    expectCounterClockwise(below);
    expect(totalArea(below)).toBeCloseTo(12 * 9.6, 6);
    expect(pointInPolygons(below, 0, 0)).toBe(true);
    for (let i = 1; i < below.length; i += 2) {
      expect(below[i]).toBeGreaterThanOrEqual(-4.8 - 1e-9);
      expect(below[i]).toBeLessThanOrEqual(4.8 + 1e-9);
    }
    const above = explicitRegion(b, view, 'x', 'greater');
    expectCounterClockwise(above);
    expect(totalArea(above)).toBeLessThan(1e-9);
    expect(pointInPolygons(above, 0, 0)).toBe(false);
    expect(pointInPolygons(above, 0, 4.5)).toBe(false);
  });

  it('clamps infinite and wildly oscillating boundary values', () => {
    const b = sampleX((x) => (x < 0 ? -1e300 : 1e300), -6, 6, 400);
    b[2 * 100 + 1] = Number.POSITIVE_INFINITY;
    b[2 * 300 + 1] = Number.NEGATIVE_INFINITY;
    const r = explicitRegion(b, view, 'x', 'greater');
    expectCounterClockwise(r);
    expect(totalArea(r)).toBeLessThanOrEqual(12 * 9.6 + 1e-9);
    // Left of 0 is shaded except a sliver under the +Infinity spike at x = -3; right of 0 is
    // unshaded except a sliver above the -Infinity spike at x = 3.
    expect(pointInPolygons(r, -4, 0)).toBe(true);
    expect(pointInPolygons(r, -2, 4.7)).toBe(true);
    expect(pointInPolygons(r, -3, 0)).toBe(false);
    expect(pointInPolygons(r, 2, 0)).toBe(false);
    expect(pointInPolygons(r, 1.5, 4.7)).toBe(false);
    expect(pointInPolygons(r, 3, 0)).toBe(true);
  });

  it('shades to the right of x = y^2 for x > y^2 (axis y)', () => {
    const r = explicitRegion(
      sampleY((y) => y * y, -5, 5),
      view,
      'y',
      'greater',
    );
    expectCounterClockwise(r);
    expect(pointInPolygons(r, 2, 0)).toBe(true);
    expect(pointInPolygons(r, 5, 2)).toBe(true);
    expect(pointInPolygons(r, -1, 0)).toBe(false);
    expect(pointInPolygons(r, 0.5, 1)).toBe(false);
    const left = explicitRegion(
      sampleY((y) => y * y, -5, 5),
      view,
      'y',
      'less',
    );
    expectCounterClockwise(left);
    expect(pointInPolygons(left, -1, 0)).toBe(true);
    expect(pointInPolygons(left, 0.5, 1)).toBe(true);
    expect(pointInPolygons(left, 2, 0)).toBe(false);
    // Clamped to [-7.2, 7.2] horizontally, so the two sides tile 10 × 14.4.
    expect(totalArea(r) + totalArea(left)).toBeCloseTo(10 * 14.4, 6);
  });

  it('keeps orientation when the boundary runs backwards', () => {
    const fwd = sampleX((x) => x / 2, -6, 6);
    const back = new Float64Array(fwd.length);
    for (let i = 0; i < fwd.length; i += 2) {
      back[i] = fwd[fwd.length - 2 - i];
      back[i + 1] = fwd[fwd.length - 1 - i];
    }
    const r = explicitRegion(back, view, 'x', 'greater');
    expectCounterClockwise(r);
    expect(pointInPolygons(r, 0, 1)).toBe(true);
    expect(totalArea(r)).toBeCloseTo(totalArea(explicitRegion(fwd, view, 'x', 'greater')), 9);
  });

  it('returns nothing for a degenerate view', () => {
    const b = sampleX((x) => x, -6, 6);
    expect(explicitRegion(b, { ...view, height: 0 }, 'x', 'greater').length).toBe(0);
    expect(explicitRegion(b, { ...view, ppuY: Number.NaN }, 'x', 'greater').length).toBe(0);
  });
});
