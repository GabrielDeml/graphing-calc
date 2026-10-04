// Number formatting for the "= value" display, slider literals and trace labels.

const SUPERSCRIPT_DIGITS = '⁰¹²³⁴⁵⁶⁷⁸⁹';
const SUPERSCRIPT_MINUS = '⁻';

function superscript(n: number): string {
  let out = n < 0 ? SUPERSCRIPT_MINUS : '';
  for (const ch of String(Math.abs(n))) out += SUPERSCRIPT_DIGITS[ch.charCodeAt(0) - 48] ?? ch;
  return out;
}

/** "2.500" → "2.5", "3.000" → "3", "-0.00" → "0"; strings without '.' are returned as is. */
function trimFixed(s: string): string {
  let out = s;
  if (out.includes('.')) {
    out = out.replace(/0+$/, '');
    if (out.endsWith('.')) out = out.slice(0, -1);
  }
  return out === '-0' ? '0' : out;
}

/** Plain decimal digits for any finite v, rounded to `decimals` places (never exponent form). */
function toPlainFixed(v: number, decimals: number): string {
  // toFixed switches to exponent form at 1e21; such values have no fractional part anyway.
  if (Math.abs(v) >= 1e21) return BigInt(Math.round(v)).toString();
  return v.toFixed(decimals);
}

function nonFinite(v: number): string {
  if (Number.isNaN(v)) return 'undefined';
  return v > 0 ? '∞' : '-∞';
}

/**
 * Value display: up to 10 significant digits without floating-point noise (0.1 + 0.2 → "0.3"),
 * exponent form like "1.5×10⁻⁷" or "2×10¹²" for |v| >= 1e10 or 0 < |v| < 1e-6. NaN reads
 * "undefined", infinities "∞" / "-∞", and -0 "0".
 */
export function formatValue(v: number): string {
  if (!Number.isFinite(v)) return nonFinite(v);
  if (v === 0) return '0';
  const rounded = Number(v.toPrecision(10));
  const abs = Math.abs(rounded);
  if (abs >= 1e10 || abs < 1e-6) {
    const [mantissa = '0', exponent = '0'] = v.toExponential(9).split('e');
    return `${trimFixed(mantissa)}×10${superscript(Number(exponent))}`;
  }
  // String() of a 10-significant-digit double in [1e-6, 1e10) is plain decimal.
  return String(rounded);
}

/** Decimal places needed to write `step` exactly (up to 10): 0.25 → 2, 0.1 → 1, 5 → 0. */
function decimalsOf(step: number): number {
  const s = trimFixed(step.toFixed(10));
  const dot = s.indexOf('.');
  return dot < 0 ? 0 : s.length - dot - 1;
}

/**
 * A slider value as it is written back into the source (e.g. "-2.35"): plain ASCII, never
 * exponent form, never "-0", trailing zeros trimmed. Decimal places follow the step, or
 * (max − min) / 1000 when the step is 0, capped at 10.
 */
export function formatSliderValue(v: number, step: number, min: number, max: number): string {
  // Source text must stay parseable, and there is no literal for NaN or ∞.
  if (!Number.isFinite(v)) return '0';
  const scale = step > 0 ? step : (max - min) / 1000;
  let decimals: number;
  if (Number.isFinite(scale) && scale > 0) {
    // The epsilon keeps exact powers of ten (log10 0.1 = -1) from rounding up a place.
    decimals = Math.max(0, Math.ceil(-Math.log10(scale) - 1e-9));
    if (step > 0) decimals = Math.max(decimals, decimalsOf(step));
  } else {
    decimals = Math.max(0, 9 - Math.floor(Math.log10(Math.abs(v) || 1)));
  }
  return trimFixed(toPlainFixed(v, Math.min(decimals, 10)));
}

/**
 * Trace label coordinate at `ppu` pixels per unit: enough decimals to resolve about a tenth of
 * a pixel (clamp(ceil(log10 ppu) + 1, 0, 12)), trailing zeros trimmed, -0 as "0".
 */
export function formatCoordinate(v: number, ppu: number): string {
  if (!Number.isFinite(v)) return nonFinite(v);
  const raw = Math.ceil(Math.log10(ppu)) + 1;
  const decimals = Number.isFinite(raw) ? Math.min(12, Math.max(0, raw)) : 0;
  return trimFixed(toPlainFixed(v, decimals));
}
