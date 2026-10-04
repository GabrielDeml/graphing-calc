import { describe, expect, it } from 'vitest';
import { nearestOnPolyline, nearestPoint, traceExplicit } from './nearest';
import { sampleExplicit } from './sampleExplicit';
import type { Viewport } from './types';
import { toScreenX, toScreenY } from './viewport';

const view: Viewport = { cx: 0, cy: 0, ppuX: 40, ppuY: 40, width: 800, height: 600 };
const sx = (x: number) => toScreenX(view, x);
const sy = (y: number) => toScreenY(view, y);

describe('nearestOnPolyline', () => {
  it('projects onto the y = x polyline', () => {
    const poly = sampleExplicit((x) => x, view, 'x');
    // Cursor 3px straight above (1, 1) on screen: nearest point is on the diagonal.
    const hit = nearestOnPolyline(poly, view, sx(1), sy(1) - 3, 20);
    expect(hit).not.toBeNull();
    expect(hit?.x).toBeCloseTo(hit?.y ?? Number.NaN, 9);
    expect(hit?.distPx).toBeCloseTo(3 / Math.SQRT2, 6);
    expect(hit?.x).toBeCloseTo(1 + 3 / 2 / 40, 6);
  });

  it('respects maxDistPx', () => {
    const poly = new Float64Array([0, 0, 1, 0]);
    expect(nearestOnPolyline(poly, view, sx(0.5), sy(0) - 10, 9.99)).toBeNull();
    const hit = nearestOnPolyline(poly, view, sx(0.5), sy(0) - 10, 10);
    expect(hit?.distPx).toBeCloseTo(10, 9);
    expect(hit?.x).toBeCloseTo(0.5, 12);
    expect(hit?.y).toBe(0);
  });

  it('does not bridge NaN breaks', () => {
    const poly = new Float64Array([-1, 0, -0.5, 0, Number.NaN, Number.NaN, 0.5, 0, 1, 0]);
    // The gap between -0.5 and 0.5 is 40px wide; a cursor in its middle is 20px from both ends.
    const hit = nearestOnPolyline(poly, view, sx(0), sy(0), 15);
    expect(hit).toBeNull();
    const far = nearestOnPolyline(poly, view, sx(0), sy(0), 25);
    expect(far?.distPx).toBeCloseTo(20, 9);
    expect(Math.abs(far?.x ?? 0)).toBeCloseTo(0.5, 12);
  });

  it('handles isolated points and leading/trailing NaNs', () => {
    const poly = new Float64Array([Number.NaN, Number.NaN, 2, 1, Number.NaN, Number.NaN, 5, 5]);
    const a = nearestOnPolyline(poly, view, sx(2) + 3, sy(1) + 4, 10);
    expect(a).toEqual({ x: 2, y: 1, distPx: 5 });
    const b = nearestOnPolyline(poly, view, sx(5), sy(5), 1);
    expect(b).toEqual({ x: 5, y: 5, distPx: 0 });
    expect(nearestOnPolyline(new Float64Array(0), view, 0, 0, 100)).toBeNull();
  });

  it('picks the closest of several segments', () => {
    const poly = new Float64Array([0, 0, 0, 2, 2, 2]);
    const hit = nearestOnPolyline(poly, view, sx(1.9), sy(1.5), 50);
    expect(hit?.x).toBeCloseTo(1.9, 12);
    expect(hit?.y).toBeCloseTo(2, 12);
  });
});

describe('nearestPoint', () => {
  it('finds the closest finite point within range', () => {
    const pts = new Float64Array([0, 0, Number.NaN, 1, 1, 1, 3, 3]);
    const hit = nearestPoint(pts, view, sx(1) + 2, sy(1), 16);
    expect(hit).toEqual({ x: 1, y: 1, distPx: 2 });
    expect(nearestPoint(pts, view, sx(2), sy(2), 16)).toBeNull();
    expect(nearestPoint(new Float64Array(0), view, 0, 0, 16)).toBeNull();
  });
});

/** Euclidean distance (px) from a screen point to y = f(x), by dense sampling. */
function trueDistance(f: (x: number) => number, px: number, py: number): number {
  let best = Number.POSITIVE_INFINITY;
  for (let s = px - 40; s <= px + 40; s += 0.01) {
    const y = f((s - 400) / 40);
    best = Math.min(best, Math.hypot(s - px, sy(y) - py));
  }
  return best;
}

describe('traceExplicit', () => {
  it('evaluates y = f(x) at the cursor x', () => {
    const f = (x: number) => x * x;
    const hit = traceExplicit(f, view, 'x', sx(1.5), sy(2.25) + 7, 10);
    expect(hit?.x).toBeCloseTo(1.5, 12);
    expect(hit?.y).toBeCloseTo(2.25, 12);
    expect(traceExplicit(f, view, 'x', sx(1.5), sy(2.25) + 11, 10)).toBeNull();
  });

  it('evaluates x = f(y) at the cursor y', () => {
    const f = (y: number) => y * y - 1;
    const hit = traceExplicit(f, view, 'y', sx(3) - 4, sy(2), 10);
    expect(hit?.x).toBeCloseTo(3, 12);
    expect(hit?.y).toBeCloseTo(2, 12);
    expect(traceExplicit(f, view, 'y', sx(3) - 12, sy(2), 10)).toBeNull();
  });

  it('reports a distance comparable with nearestOnPolyline, and never larger', () => {
    // Cursors 3-6px off the curve: the exact trace must beat the sampled polyline of the same
    // curve (so the marker stays at the cursor x), yet measure the same Euclidean distance.
    for (const f of [(x: number) => x * x, Math.sin, Math.exp, (x: number) => (x * x * x) / 10]) {
      const poly = sampleExplicit(f, view, 'x');
      for (let x = -3; x <= 3; x += 0.37) {
        const y = f(x);
        if (Math.abs(y) > 7) continue;
        for (const off of [-6, -3, 3, 6]) {
          const px = sx(x);
          const py = sy(y) + off;
          const hit = traceExplicit(f, view, 'x', px, py, 20);
          const line = nearestOnPolyline(poly, view, px, py, 20);
          expect(hit).not.toBeNull();
          expect(line).not.toBeNull();
          if (!hit || !line) continue;
          expect(hit.x).toBe((px - 400) / 40);
          expect(hit.distPx).toBeLessThan(line.distPx);
          const d = trueDistance(f, px, py);
          expect(Math.abs(hit.distPx - d)).toBeLessThan(0.5);
        }
      }
    }
  });

  it('measures the perpendicular distance to y = x', () => {
    const hit = traceExplicit((x) => x, view, 'x', sx(1), sy(1) - 7, 20);
    expect(hit?.distPx).toBeCloseTo(7 / Math.SQRT2 - 0.3, 3);
  });

  it('misses where the function is undefined', () => {
    expect(traceExplicit(Math.sqrt, view, 'x', sx(-1), sy(0), 1000)).toBeNull();
    expect(traceExplicit((x) => 1 / x, view, 'x', sx(0), sy(0), 1e9)).toBeNull();
  });
});
