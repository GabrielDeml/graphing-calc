// Shading for explicit inequalities: y > f(x), y < f(x), x > g(y), x < g(y).
//
// The boundary comes from sampleExplicit: world (x, y) pairs ordered along the input axis, with
// NaN pairs where the curve is undefined or jumps. Each continuous piece becomes one polygon: the
// piece itself, closed off by two corners beyond the viewport edge on the shaded side. Gaps
// between pieces stay unshaded, which is right where f is undefined (the inequality is false
// there) and sub-pixel at jumps. Boundary values are first clamped to a band 10% beyond the view,
// so a boundary far off-screen can never fold the polygon over itself.

import type { Polygons, Polyline, Viewport } from './types';

/** How far beyond the view the band reaches, as a fraction of the view size on the value axis. */
const MARGIN = 0.1;

/**
 * Region on one side of an explicit boundary produced by sampleExplicit (interleaved x,y with
 * NaN-pair breaks). axis 'x' means boundary y = f(x) and side 'greater' = above; axis 'y' means
 * boundary x = g(y) and side 'greater' = to the right. Polygons are counter-clockwise and never
 * overlap.
 */
export function explicitRegion(
  boundary: Polyline,
  view: Viewport,
  axis: 'x' | 'y',
  side: 'greater' | 'less',
): Polygons {
  const n = boundary.length >> 1;
  const alongX = axis === 'x';
  const ppu = alongX ? view.ppuY : view.ppuX;
  const size = (alongX ? view.height : view.width) / ppu;
  const center = alongX ? view.cy : view.cx;
  if (n < 2 || !Number.isFinite(size + center) || !(size > 0)) return new Float64Array(0);
  const lo = center - size * (0.5 + MARGIN);
  const hi = center + size * (0.5 + MARGIN);
  const far = side === 'greater' ? hi : lo;
  // u: input-axis offset in each pair, w: value-axis offset.
  const uo = alongX ? 0 : 1;
  const wo = 1 - uo;

  // Pass 1: size the output.
  let floats = 0;
  let run = 0;
  for (let i = 0; i <= n; i++) {
    if (i < n && Number.isFinite(boundary[2 * i + uo]) && !Number.isNaN(boundary[2 * i + wo])) {
      run++;
      continue;
    }
    if (run >= 2) floats += (floats > 0 ? 2 : 0) + 2 * (run + 2);
    run = 0;
  }
  const out = new Float64Array(floats);
  if (floats === 0) return out;

  // Pass 2: one polygon per piece.
  let o = 0;
  let start = 0;
  for (let i = 0; i <= n; i++) {
    if (i < n && Number.isFinite(boundary[2 * i + uo]) && !Number.isNaN(boundary[2 * i + wo])) {
      continue;
    }
    if (i - start >= 2) {
      if (o > 0) {
        out[o++] = Number.NaN;
        out[o++] = Number.NaN;
      }
      const first = o;
      for (let q = start; q < i; q++) {
        const w = boundary[2 * q + wo];
        out[o + uo] = boundary[2 * q + uo];
        out[o + wo] = w < lo ? lo : w > hi ? hi : w;
        o += 2;
      }
      out[o + uo] = boundary[2 * (i - 1) + uo];
      out[o + wo] = far;
      out[o + 2 + uo] = boundary[2 * start + uo];
      out[o + 2 + wo] = far;
      o += 4;
      if (signedArea(out, first, o) < 0) reversePairs(out, first, o);
    }
    start = i + 1;
  }
  return out;
}

/** Twice the signed area of the polygon stored as pairs in out[from, to). */
function signedArea(a: Float64Array, from: number, to: number): number {
  // Relative to the first vertex, to limit cancellation far from the origin.
  const x0 = a[from];
  const y0 = a[from + 1];
  let sum = 0;
  for (let i = from + 2; i + 3 < to; i += 2) {
    sum += (a[i] - x0) * (a[i + 3] - y0) - (a[i + 2] - x0) * (a[i + 1] - y0);
  }
  return sum;
}

function reversePairs(a: Float64Array, from: number, to: number): void {
  for (let i = from, j = to - 2; i < j; i += 2, j -= 2) {
    const x = a[i];
    const y = a[i + 1];
    a[i] = a[j];
    a[i + 1] = a[j + 1];
    a[j] = x;
    a[j + 1] = y;
  }
}
