// Hit testing for tracing: nearest point on sampled geometry, and exact evaluation under the
// cursor for explicit curves. Single pass, no allocation besides the returned hit.

import type { Fn1 } from '../engine/types';
import type { Polyline, Viewport } from './types';
import { toScreenX, toScreenY, toWorldX, toWorldY } from './viewport';

export interface NearestHit {
  /** World coordinates of the hit. */
  x: number;
  y: number;
  /** Screen distance from the query point, in CSS px. */
  distPx: number;
}

/**
 * Closest point to (sx, sy) on the stroked segments of a polyline (NaN pairs break it) or on an
 * isolated single point, within maxDistPx.
 */
export function nearestOnPolyline(
  poly: Polyline,
  view: Viewport,
  sx: number,
  sy: number,
  maxDistPx: number,
): NearestHit | null {
  const { cx, cy, ppuX, ppuY } = view;
  const ox = view.width / 2;
  const oy = view.height / 2;
  const n = poly.length - 1;
  let best = maxDistPx * maxDistPx;
  let found = false;
  let bx = 0;
  let by = 0;
  // Previous point (world and screen) when it was finite.
  let havePrev = false;
  let pwx = 0;
  let pwy = 0;
  let psx = 0;
  let psy = 0;

  for (let i = 0; i < n; i += 2) {
    const wx = poly[i];
    const wy = poly[i + 1];
    if (!(Number.isFinite(wx) && Number.isFinite(wy))) {
      havePrev = false;
      continue;
    }
    const qx = (wx - cx) * ppuX + ox;
    const qy = oy - (wy - cy) * ppuY;
    if (havePrev) {
      const dx = qx - psx;
      const dy = qy - psy;
      const len2 = dx * dx + dy * dy;
      let t = len2 > 0 ? ((sx - psx) * dx + (sy - psy) * dy) / len2 : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const ex = psx + t * dx - sx;
      const ey = psy + t * dy - sy;
      const d2 = ex * ex + ey * ey;
      if (d2 <= best) {
        best = d2;
        found = true;
        bx = pwx + t * (wx - pwx);
        by = pwy + t * (wy - pwy);
      }
    } else if (!(i + 2 < n && Number.isFinite(poly[i + 2]) && Number.isFinite(poly[i + 3]))) {
      // Isolated point: no finite neighbour on either side.
      const ex = qx - sx;
      const ey = qy - sy;
      const d2 = ex * ex + ey * ey;
      if (d2 <= best) {
        best = d2;
        found = true;
        bx = wx;
        by = wy;
      }
    }
    havePrev = true;
    pwx = wx;
    pwy = wy;
    psx = qx;
    psy = qy;
  }
  return found ? { x: bx, y: by, distPx: Math.sqrt(best) } : null;
}

/** Closest of a set of interleaved (x, y) points (non-finite pairs skipped), within maxDistPx. */
export function nearestPoint(
  points: Float64Array,
  view: Viewport,
  sx: number,
  sy: number,
  maxDistPx: number,
): NearestHit | null {
  let best = maxDistPx * maxDistPx;
  let found = -1;
  for (let i = 0; i + 1 < points.length; i += 2) {
    const wx = points[i];
    const wy = points[i + 1];
    if (!(Number.isFinite(wx) && Number.isFinite(wy))) continue;
    const ex = toScreenX(view, wx) - sx;
    const ey = toScreenY(view, wy) - sy;
    const d2 = ex * ex + ey * ey;
    if (d2 <= best) {
      best = d2;
      found = i;
    }
  }
  return found < 0 ? null : { x: points[found], y: points[found + 1], distPx: Math.sqrt(best) };
}

/** Chords used to measure the distance from the cursor to the curve around it. */
const TRACE_CHORDS = 16;
/**
 * Sampled polylines stay within about 0.25px of the true curve. An exact trace hit is reported
 * this much closer, so a chord of the same curve never beats it, while the distance stays
 * comparable with nearestOnPolyline's for choosing between rows.
 */
const POLYLINE_TOLERANCE_PX = 0.3;

/**
 * Trace an explicit curve exactly: for axis 'x' (y = f(x)) evaluate at the cursor's x, and hit
 * when the curve is within maxDistPx vertically there; for axis 'y' (x = f(y)) the same,
 * transposed. distPx is the Euclidean screen distance from the cursor to the curve (measured on
 * a fine local sampling), less POLYLINE_TOLERANCE_PX, so it can be compared with polyline hits of
 * other rows; a caller should prefer this hit over the same row's sampled polyline.
 */
export function traceExplicit(
  f: Fn1,
  view: Viewport,
  axis: 'x' | 'y',
  sx: number,
  sy: number,
  maxDistPx: number,
): NearestHit | null {
  const alongX = axis === 'x';
  const u = alongX ? toWorldX(view, sx) : toWorldY(view, sy);
  const w = f(u);
  if (!Number.isFinite(w)) return null;
  const d = alongX ? Math.abs(toScreenY(view, w) - sy) : Math.abs(toScreenX(view, w) - sx);
  if (!(d <= maxDistPx)) return null;
  const dist = d > 0 ? localDistance(f, view, alongX, sx, sy, d) : 0;
  const distPx = dist > POLYLINE_TOLERANCE_PX ? dist - POLYLINE_TOLERANCE_PX : 0;
  return alongX ? { x: u, y: w, distPx } : { x: w, y: u, distPx };
}

/**
 * Distance from (sx, sy) to the curve sampled at TRACE_CHORDS + 1 points within `reach` px of the
 * cursor along the input axis (the nearest curve point cannot be farther than the axis-aligned
 * distance `reach`).
 */
function localDistance(
  f: Fn1,
  view: Viewport,
  alongX: boolean,
  sx: number,
  sy: number,
  reach: number,
): number {
  let best = reach * reach;
  let have = false;
  let px = 0;
  let py = 0;
  for (let k = 0; k <= TRACE_CHORDS; k++) {
    const o = reach * ((2 * k) / TRACE_CHORDS - 1);
    let qx: number;
    let qy: number;
    if (alongX) {
      qx = sx + o;
      qy = toScreenY(view, f(toWorldX(view, qx)));
    } else {
      qy = sy + o;
      qx = toScreenX(view, f(toWorldY(view, qy)));
    }
    if (!(Number.isFinite(qx) && Number.isFinite(qy))) {
      have = false;
      continue;
    }
    if (have) {
      const dx = qx - px;
      const dy = qy - py;
      const len2 = dx * dx + dy * dy;
      let t = len2 > 0 ? ((sx - px) * dx + (sy - py) * dy) / len2 : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const ex = px + t * dx - sx;
      const ey = py + t * dy - sy;
      const d2 = ex * ex + ey * ey;
      if (d2 < best) best = d2;
    }
    have = true;
    px = qx;
    py = qy;
  }
  return Math.sqrt(best);
}
