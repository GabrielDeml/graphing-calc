// What the trace's one-tap actions write into a new row: the tangent line at the traced point of
// an explicit curve, and the point itself. Numbers are written to the precision the trace shows
// them at (formatCoordinate), so the new row reads like the trace pill.

import { formatCoordinate } from '../engine/format';
import type { Fn1 } from '../engine/types';

/**
 * The slope of f at u by central differences, or null where it has none to speak of: off the
 * curve's domain, at a pole, or at a corner (|x| at 0), where the slopes on either side differ.
 */
export function slopeAt(f: Fn1, u: number): number | null {
  const h = 1e-5 * Math.max(1, Math.abs(u));
  const [a, b, c] = [f(u - h), f(u), f(u + h)];
  if (!Number.isFinite(a) || !Number.isFinite(b) || !Number.isFinite(c)) return null;
  const left = (b - a) / h;
  const right = (c - b) / h;
  // Smooth: the one-sided slopes agree up to the curve's bending over 2h.
  if (Math.abs(right - left) > 1e-2 * Math.max(1, Math.abs(left), Math.abs(right))) return null;
  const m = (c - a) / (2 * h);
  return Number.isFinite(m) ? m : null;
}

/** `v - a` (or `v + a`, or `v`), for a number `a` already written out. */
function shifted(v: string, a: string): string {
  if (a === '0') return v;
  return a.startsWith('-') ? `(${v} + ${a.slice(1)})` : `(${v} - ${a})`;
}

/**
 * The tangent at (u0, v0) of a curve written as v = f(u), with slope m, as a row: `y = m(x - x₀)
 * + y₀` for y = f(x) (u is x), `x = m(y - y₀) + x₀` for x = f(y) (u is y). `ppu` sets the
 * precision.
 */
export function tangentRow(
  variable: 'x' | 'y',
  u0: number,
  v0: number,
  m: number,
  ppu: number,
): string {
  const dependent = variable === 'x' ? 'y' : 'x';
  const slope = formatCoordinate(m, ppu);
  const at = formatCoordinate(u0, ppu);
  const value = formatCoordinate(v0, ppu);
  if (slope === '0') return `${dependent} = ${value}`;
  const factor = slope === '1' ? '' : slope === '-1' ? '-' : slope;
  const offset =
    value === '0' ? '' : value.startsWith('-') ? ` - ${value.slice(1)}` : ` + ${value}`;
  return `${dependent} = ${factor}${shifted(variable, at)}${offset}`;
}

/** The point (x, y) as a row, to the precision `ppu` gives. */
export function pointRow(x: number, y: number, ppu: number): string {
  return `(${formatCoordinate(x, ppu)}, ${formatCoordinate(y, ppu)})`;
}
