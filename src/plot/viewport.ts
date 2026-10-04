// Viewport math: world <-> screen transforms and the pure view transitions behind pan, zoom,
// pinch, wheel and animated zoom buttons.

import type { Bounds, Viewport } from './types';

export const MIN_PPU = 1e-6;
export const MAX_PPU = 1e12;
export const MAX_CENTER = 1e12;
/**
 * Upper bound on |center| · ppu. A double holds about 16 digits, so one ulp of a coordinate near
 * the center stays below about 0.2px; beyond that panning quantises, sampled curves turn into
 * staircases and tick indices stop being exact integers.
 */
export const MAX_PRECISION = 1e15;

/** Pixels per unit used when the view has no size yet (and as a fallback for a NaN ppu). */
const FALLBACK_PPU = 40;

export interface Pt {
  x: number;
  y: number;
}

export function homeViewport(width: number, height: number): Viewport {
  const w = width > 0 ? width : 0;
  const h = height > 0 ? height : 0;
  const m = Math.min(w, h);
  const ppu = m > 0 ? m / 20 : FALLBACK_PPU;
  return clampViewport({ cx: 0, cy: 0, ppuX: ppu, ppuY: ppu, width: w, height: h });
}

export function toScreenX(v: Viewport, x: number): number {
  return (x - v.cx) * v.ppuX + v.width / 2;
}

export function toScreenY(v: Viewport, y: number): number {
  return v.height / 2 - (y - v.cy) * v.ppuY;
}

export function toWorldX(v: Viewport, sx: number): number {
  return v.cx + (sx - v.width / 2) / v.ppuX;
}

export function toWorldY(v: Viewport, sy: number): number {
  return v.cy + (v.height / 2 - sy) / v.ppuY;
}

export function viewBounds(v: Viewport): Bounds {
  const hx = v.width / 2 / v.ppuX;
  const hy = v.height / 2 / v.ppuY;
  return { xmin: v.cx - hx, xmax: v.cx + hx, ymin: v.cy - hy, ymax: v.cy + hy };
}

/** Largest usable ppu for a view whose coordinates reach magnitude `extent`. */
function maxPpuFor(extent: number): number {
  const limit = MAX_PRECISION / (extent > 1 ? extent : 1);
  return limit < MAX_PPU ? limit : MAX_PPU;
}

function clampPpu(p: number, max: number): number {
  if (Number.isNaN(p)) return FALLBACK_PPU < max ? FALLBACK_PPU : max;
  return p < MIN_PPU ? MIN_PPU : p > max ? max : p;
}

function clampCenter(c: number): number {
  if (Number.isNaN(c)) return 0;
  return c < -MAX_CENTER ? -MAX_CENTER : c > MAX_CENTER ? MAX_CENTER : c;
}

function clampSize(s: number): number {
  return s > 0 && s < Number.POSITIVE_INFINITY ? s : 0;
}

/** Returns `v` itself when it is already within limits, so callers can compare by identity. */
export function clampViewport(v: Viewport): Viewport {
  const cx = clampCenter(v.cx);
  const cy = clampCenter(v.cy);
  // One limit for both axes, so equal scales stay equal (no aspect change at the limit).
  const maxPpu = maxPpuFor(Math.max(Math.abs(cx), Math.abs(cy)));
  const ppuX = clampPpu(v.ppuX, maxPpu);
  const ppuY = clampPpu(v.ppuY, maxPpu);
  const width = clampSize(v.width);
  const height = clampSize(v.height);
  if (
    cx === v.cx &&
    cy === v.cy &&
    ppuX === v.ppuX &&
    ppuY === v.ppuY &&
    width === v.width &&
    height === v.height
  ) {
    return v;
  }
  return { cx, cy, ppuX, ppuY, width, height };
}

/**
 * factor > 1 zooms in. The world point under (sx, sy) stays under (sx, sy). Returns `v` itself
 * when the scale would not change (factor 1, or already at a zoom limit), so a no-op wheel event
 * does not perturb the center in its last bit and invalidate cached geometry.
 */
export function zoomAt(v: Viewport, sx: number, sy: number, factor: number): Viewport {
  if (!(factor > 0) || !Number.isFinite(factor) || factor === 1) return v;
  const wx = toWorldX(v, sx);
  const wy = toWorldY(v, sy);
  // The new center lies between the old center and the cursor point when zooming in.
  const maxPpu = maxPpuFor(Math.max(Math.abs(v.cx), Math.abs(v.cy), Math.abs(wx), Math.abs(wy)));
  const ppuX = clampPpu(v.ppuX * factor, maxPpu);
  const ppuY = clampPpu(v.ppuY * factor, maxPpu);
  if (ppuX === v.ppuX && ppuY === v.ppuY) return v;
  return clampViewport({
    cx: wx - (sx - v.width / 2) / ppuX,
    cy: wy - (v.height / 2 - sy) / ppuY,
    ppuX,
    ppuY,
    width: v.width,
    height: v.height,
  });
}

/** (dx, dy) is the pointer movement in CSS px; the content follows the pointer. */
export function panBy(v: Viewport, dx: number, dy: number): Viewport {
  if (!Number.isFinite(dx) || !Number.isFinite(dy) || (dx === 0 && dy === 0)) return v;
  return clampViewport({
    ...v,
    cx: v.cx - dx / v.ppuX,
    cy: v.cy + dy / v.ppuY,
  });
}

export function resizeViewport(v: Viewport, width: number, height: number): Viewport {
  return clampViewport({ ...v, width, height });
}

/**
 * Two-finger gesture step: zoom by the ratio of finger distances about the previous centroid,
 * then pan by the centroid's movement. A zero (or non-finite) distance degrades to a pan.
 */
export function pinchViewport(v: Viewport, prevA: Pt, prevB: Pt, nextA: Pt, nextB: Pt): Viewport {
  const c0x = (prevA.x + prevB.x) / 2;
  const c0y = (prevA.y + prevB.y) / 2;
  const c1x = (nextA.x + nextB.x) / 2;
  const c1y = (nextA.y + nextB.y) / 2;
  const d0 = Math.hypot(prevA.x - prevB.x, prevA.y - prevB.y);
  const d1 = Math.hypot(nextA.x - nextB.x, nextA.y - nextB.y);
  const ratio = d1 / d0;
  const zoomed = d0 > 0 && d1 > 0 && Number.isFinite(ratio) ? zoomAt(v, c0x, c0y, ratio) : v;
  return panBy(zoomed, c1x - c0x, c1y - c0y);
}

const LINE_PX = 16;
const WHEEL_K = 0.0015;
/** Trackpad pinch arrives as ctrl+wheel with small deltas, so it needs a stronger response. */
const PINCH_K = 0.01;

export function wheelZoomFactor(
  deltaY: number,
  deltaMode: number,
  ctrlKey: boolean,
  pageHeight: number,
): number {
  let dy = deltaY;
  if (deltaMode === 1) dy *= LINE_PX;
  else if (deltaMode === 2) dy *= pageHeight > 0 ? pageHeight : 800;
  const f = Math.exp(-dy * (ctrlKey ? PINCH_K : WHEEL_K));
  if (Number.isNaN(f)) return 1;
  return f < 0.5 ? 0.5 : f > 2 ? 2 : f;
}

/** Below this relative scale change an animation is treated as a pure pan. */
const SAME_SCALE = 1e-9;

/**
 * Center at time t for one axis: ppu changes geometrically, and the center follows the fixed
 * point of the a → b transform, so the world point that sits at the same screen position in a
 * and b (the cursor of a double-click zoom) stays there throughout. Pure pans move linearly.
 */
function lerpAxis(ca: number, pa: number, cb: number, pb: number, t: number, p: number): number {
  if (!(Math.abs(pb / pa - 1) > SAME_SCALE)) return ca + (cb - ca) * t;
  // Fixed point w with (w - ca) * pa === (w - cb) * pb.
  const w = (cb * pb - ca * pa) / (pb - pa);
  return w - (w - ca) * (pa / p);
}

/**
 * Animation frame between views a and b (t in [0, 1]): ppu is interpolated geometrically and the
 * zoom keeps its anchor point fixed on screen. The size is not animated: it comes from `size`
 * (pass the live view so a resize during the animation is kept), or from b.
 */
export function lerpViewport(
  a: Viewport,
  b: Viewport,
  t: number,
  size?: { width: number; height: number },
): Viewport {
  const width = size ? size.width : b.width;
  const height = size ? size.height : b.height;
  if (t >= 1 || t <= 0) {
    const end = t >= 1 ? b : a;
    return end.width === width && end.height === height
      ? end
      : clampViewport({ ...end, width, height });
  }
  const ppuX = a.ppuX * (b.ppuX / a.ppuX) ** t;
  const ppuY = a.ppuY * (b.ppuY / a.ppuY) ** t;
  return clampViewport({
    cx: lerpAxis(a.cx, a.ppuX, b.cx, b.ppuX, t, ppuX),
    cy: lerpAxis(a.cy, a.ppuY, b.cy, b.ppuY, t, ppuY),
    ppuX,
    ppuY,
    width,
    height,
  });
}

/** Exact identity of a view, for cache keys. */
export function viewKey(v: Viewport): string {
  return `${v.cx},${v.cy},${v.ppuX},${v.ppuY},${v.width},${v.height}`;
}
