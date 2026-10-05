// What the trace's one-tap actions write into a new row: the tangent line at the traced point of
// an explicit curve, and the point itself. Coordinates are written to the precision the trace
// shows them at (formatCoordinate), so the new row reads like the trace pill; a slope to what
// keeps the line on the curve's tangent across the view, just as precisely.

import { formatCoordinate, formatDecimals } from '../engine/format';
import type { Fn1 } from '../engine/types';

/** The one-sided slopes of f at u, h either side, and how far apart they are. */
function sides(f: Fn1, u: number, h: number): { gap: number; noise: number } | null {
  const [a, b, c] = [f(u - h), f(u), f(u + h)];
  if (!Number.isFinite(a) || !Number.isFinite(b) || !Number.isFinite(c)) return null;
  const left = (b - a) / h;
  const right = (c - b) / h;
  // What rounding alone can put between them: the values' last bits, and those of u ± h, over h.
  const size = Math.max(Math.abs(a), Math.abs(b), Math.abs(c));
  const slope = Math.max(Math.abs(left), Math.abs(right));
  const noise = (16 * Number.EPSILON * (size + slope * Math.max(1, Math.abs(u)))) / h;
  return { gap: Math.abs(right - left), noise };
}

/**
 * The slope of f at u by central differences, or null where it has none to speak of: off the
 * curve's domain, at a pole, or at a corner (|x| at 0), where the slopes on either side differ.
 * On a smooth curve that difference is its bending over the step, so it shrinks with the step
 * (tenfold for a tenth of it); at a corner it stays, however small the corner (0.001|x|) and
 * however sharply a smooth curve bends (1000x² at 0).
 */
export function slopeAt(f: Fn1, u: number): number | null {
  const h = 1e-5 * Math.max(1, Math.abs(u));
  const wide = sides(f, u, h);
  const narrow = sides(f, u, h / 10);
  if (!wide || !narrow) return null;
  if (narrow.gap > narrow.noise && narrow.gap > 0.3 * wide.gap) return null;
  const m = (f(u + h) - f(u - h)) / (2 * h);
  return Number.isFinite(m) ? m : null;
}

/**
 * Whether f is a straight line, slope m through u (its tangent there would be itself): it keeps
 * to that line far out on both sides.
 */
export function isStraight(f: Fn1, u: number, m: number): boolean {
  const v = f(u);
  const scale = Math.max(1, Math.abs(u));
  for (const d of [-37.3, -1.7, 2.9, 61.1]) {
    const w = f(u + d * scale);
    const line = v + m * d * scale;
    if (!Number.isFinite(w) || Math.abs(w - line) > 1e-7 * Math.max(1, Math.abs(v), Math.abs(line)))
      return false;
  }
  return true;
}

/**
 * A slope, rounded only as far as keeps a line through the traced point within a tenth of a
 * pixel of the true tangent across a view `span` px across (its diagonal), as precise as the
 * trace's coordinates: the line's angle may be off by 0.1/span radians, so a steep slope needs
 * fewer decimals and a gentle one more (but the same at any zoom: slopes have no units). Plain
 * decimals; 0 when it is level to the eye.
 */
export function formatSlope(m: number, span: number): string {
  const tolerance = (0.1 * (1 + m * m)) / Math.max(1, span);
  return formatDecimals(m, Math.ceil(-Math.log10(2 * tolerance)));
}

/** `v - a` (or `v + a`, or `v`), for a number `a` already written out. */
function shifted(v: string, a: string): string {
  if (a === '0') return v;
  return a.startsWith('-') ? `(${v} + ${a.slice(1)})` : `(${v} - ${a})`;
}

/**
 * The tangent at (u0, v0) of a curve written as v = f(u), with slope m, as a row: `y = m(x - x₀)
 * + y₀` for y = f(x) (u is x), `x = m(y - y₀) + x₀` for x = f(y) (u is y). The view sets the
 * precision: `ppu` the point's, its size in px (`span`, the diagonal) the slope's.
 */
export function tangentRow(
  variable: 'x' | 'y',
  u0: number,
  v0: number,
  m: number,
  view: { ppu: number; span: number },
): string {
  const { ppu, span } = view;
  const dependent = variable === 'x' ? 'y' : 'x';
  const slope = formatSlope(m, span);
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
