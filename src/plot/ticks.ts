// Axis tick selection (1-2-5 steps) and float-noise-free tick labels.

export interface TickSet {
  /** Major step; 0 when the input range or scale is unusable. */
  step: number;
  minorStep: number;
  /** Major tick values, ascending. */
  major: number[];
  /** Minor tick values, ascending, excluding positions that are also major ticks. */
  minor: number[];
}

const MAX_MAJOR = 1000;
const MAX_MINOR = 5000;

/**
 * m · 10^n as the double nearest to the exact decimal: for negative n divide by an exact power of
 * ten instead of multiplying by an inexact one, so 3 · 10^-1 is 0.3 and not 0.30000000000000004.
 */
function decimal(m: number, n: number): number {
  return n >= 0 ? m * 10 ** n : m / 10 ** -n;
}

function pow10(n: number): number {
  return decimal(1, n);
}

function empty(step: number, minorStep: number): TickSet {
  return { step, minorStep, major: [], minor: [] };
}

/**
 * Largest tick index handled. Beyond it `i * m` stops being an exact integer and, past 2^53,
 * `i + 1 === i`, so stepping would stall; such views (far from the origin at extreme zoom) get no
 * ticks instead.
 */
const MAX_INDEX = 2 ** 50;

/** Values k · (m · 10^n) for every integer k with min <= value <= max, skipping k % skip === 0. */
function multiples(
  min: number,
  max: number,
  m: number,
  n: number,
  step: number,
  skip: number,
  limit: number,
): number[] | null {
  // The slack keeps a tick that sits exactly on an edge despite rounding in the division.
  const i0 = Math.ceil(min / step - 1e-9);
  const i1 = Math.floor(max / step + 1e-9);
  const count = i1 - i0 + 1;
  if (!(count <= limit)) return null;
  if (!(Math.abs(i0) <= MAX_INDEX && Math.abs(i1) <= MAX_INDEX)) return null;
  const out: number[] = [];
  // An integer offset k bounds the loop by count even if the indices were inexact.
  for (let k = 0; k < count; k++) {
    const i = i0 + k;
    if (skip > 0 && i % skip === 0) continue;
    // `+ 0` turns -0 (from i = -0) into 0.
    out.push(decimal(i * m, n) + 0);
  }
  return out;
}

export function computeTicks(min: number, max: number, ppu: number, targetPx = 100): TickSet {
  const raw = targetPx / ppu;
  if (!(raw > 0) || !Number.isFinite(raw)) return empty(0, 0);

  let n = Math.floor(Math.log10(raw));
  let norm = raw / pow10(n);
  // log10 can land one off at exact powers of ten.
  if (norm > 10) {
    n += 1;
    norm = raw / pow10(n);
  } else if (norm < 1) {
    n -= 1;
    norm = raw / pow10(n);
  }
  // The 1-2-5 step nearest to raw in log space (boundaries at the geometric means √2, √10, √50),
  // so spacing stays within about 0.63–1.58 × targetPx.
  let m: number;
  if (norm < Math.SQRT2) m = 1;
  else if (norm < Math.sqrt(10)) m = 2;
  else if (norm < Math.sqrt(50)) m = 5;
  else {
    m = 1;
    n += 1;
  }
  const step = decimal(m, n);

  // Minor: 1 → 0.2, 2 → 0.5, 5 → 1 (one decade down where needed), as exact decimals.
  const minorM = m === 1 ? 2 : m === 2 ? 5 : 1;
  const minorN = m === 5 ? n : n - 1;
  const minorStep = decimal(minorM, minorN);
  const ratio = m === 2 ? 4 : 5;

  if (!Number.isFinite(min) || !Number.isFinite(max) || max < min) return empty(step, minorStep);

  const major = multiples(min, max, m, n, step, 0, MAX_MAJOR);
  if (!major) return empty(step, minorStep);
  const minor = multiples(min, max, minorM, minorN, minorStep, ratio, MAX_MINOR) ?? [];
  return { step, minorStep, major, minor };
}

const SUPERSCRIPT = ['⁰', '¹', '²', '³', '⁴', '⁵', '⁶', '⁷', '⁸', '⁹'];

function superscript(n: number): string {
  let s = n < 0 ? '⁻' : '';
  for (const ch of String(Math.abs(n))) s += SUPERSCRIPT[ch.charCodeAt(0) - 48];
  return s;
}

/** Floor of log10(|x|), corrected for log10 rounding at exact powers of ten. */
function exponentOf(x: number): number {
  const a = Math.abs(x);
  let e = Math.floor(Math.log10(a));
  if (pow10(e + 1) <= a * (1 + 1e-12)) e += 1;
  else if (pow10(e) > a * (1 + 1e-12)) e -= 1;
  return e;
}

/** Fewest decimals that represent every multiple of `step` exactly (step 0.25 → 2). */
function decimalsFor(step: number): number {
  let d = Math.max(0, -exponentOf(step));
  for (; d < 20; d++) {
    const s = step * pow10(d);
    if (Math.abs(s - Math.round(s)) <= 1e-9 * Math.max(1, s)) break;
  }
  return d;
}

function stripTrailingZeros(s: string): string {
  return s.includes('.') ? s.replace(/\.?0+$/, '') : s;
}

/** Steps at or above this label every tick in exponent form (all ticks are big round numbers). */
const BIG_STEP = 1e5;
/** Steps below this, on values below SMALL_VALUE, use exponent form instead of many zeros. */
const TINY_STEP = 1e-5;
const SMALL_VALUE = 1e-4;
/** Plain decimals would need JavaScript's own exponent notation from here on. */
const HUGE_VALUE = 1e15;

/**
 * Label for a tick value, with precision derived from the tick step. The format depends on the
 * step and on the value only through coarse magnitude thresholds, so every label on an axis uses
 * the same form and the same number of decimals: plain decimals (`toFixed`, so step 0.5 gives
 * "1.0") except for steps ≥ 1e5 ("2×10⁵") and for tiny steps on values below 1e-4 ("4×10⁻⁶").
 * Exponent mantissas keep trailing zeros too ("1.0×10⁶" when the step is 2×10⁵).
 */
export function formatTick(value: number, step: number): string {
  if (!Number.isFinite(value)) return String(value);
  const okStep = step > 0 && Number.isFinite(step);
  const abs = Math.abs(value);
  if (value === 0 || (okStep && abs < step * 1e-6)) return '0';

  const exponential = okStep
    ? step >= BIG_STEP || (step < TINY_STEP && abs < SMALL_VALUE) || abs >= HUGE_VALUE
    : abs >= 1e6 || abs < SMALL_VALUE;
  if (exponential) {
    let e = exponentOf(value);
    let mant = mantissa(value, e, okStep ? step : 0);
    // Rounding can carry into the next decade (9.99… → "10").
    if (/^-?10(\.|$)/.test(mant)) {
      e += 1;
      mant = mantissa(value, e, okStep ? step : 0);
    }
    return `${mant}×10${superscript(e)}`;
  }

  const s = okStep ? value.toFixed(decimalsFor(step)) : stripTrailingZeros(value.toFixed(6));
  return /^-0(\.0*)?$/.test(s) ? s.slice(1) : s;
}

/** value / 10^e with the decimals the step needs at that exponent (6, trimmed, without a step). */
function mantissa(value: number, e: number, step: number): string {
  const m = value / pow10(e);
  return step > 0 ? m.toFixed(decimalsFor(step / pow10(e))) : stripTrailingZeros(m.toFixed(6));
}
