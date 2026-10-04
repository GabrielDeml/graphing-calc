// Numeric implementations of the builtin functions named in builtinNames.ts. Angles are radians.
// Nothing here throws: domain errors give NaN and poles give ±Infinity, like Math.*.

import type { BuiltinFunctionName } from './builtinNames';

export type Unary = (x: number) => number;
export type Binary = (a: number, b: number) => number;
export type Variadic = (args: readonly number[]) => number;

/** Implementations by argument count; which ones exist matches BUILTIN_FUNCTIONS' arities. */
export interface BuiltinImpl {
  readonly unary?: Unary;
  readonly binary?: Binary;
  /** Three or more arguments (min, max). */
  readonly variadic?: Variadic;
}

const HALF_PI = Math.PI / 2;

export function sec(x: number): number {
  return 1 / Math.cos(x);
}

export function csc(x: number): number {
  return 1 / Math.sin(x);
}

export function cot(x: number): number {
  return 1 / Math.tan(x);
}

export function asec(x: number): number {
  return Math.acos(1 / x);
}

export function acsc(x: number): number {
  return Math.asin(1 / x);
}

/** acot(x) = atan(1/x), continuous at 0 from the right: acot(0) = π/2 (also for -0). */
export function acot(x: number): number {
  return x === 0 ? HALF_PI : Math.atan(1 / x);
}

export function sech(x: number): number {
  return 1 / Math.cosh(x);
}

export function csch(x: number): number {
  return 1 / Math.sinh(x);
}

export function coth(x: number): number {
  return 1 / Math.tanh(x);
}

/** Rounds half away from zero, so round(-2.5) = -3 mirrors round(2.5) = 3. */
export function round(x: number): number {
  return x < 0 ? -Math.round(-x) : Math.round(x);
}

/** Floored modulo: the result has the sign of b, so mod(-1, 3) = 2. mod(x, 0) is NaN. */
export function mod(a: number, b: number): number {
  if (b === 0) return Number.NaN;
  return a - b * Math.floor(a / b);
}

/** Greatest common divisor of integers (NaN for non-integers); gcd(0, 0) = 0. */
export function gcd(a: number, b: number): number {
  if (!Number.isInteger(a) || !Number.isInteger(b)) return Number.NaN;
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y !== 0) {
    const t = x % y;
    x = y;
    y = t;
  }
  return x;
}

/** Least common multiple of integers (NaN for non-integers); lcm(0, n) = 0. */
export function lcm(a: number, b: number): number {
  const g = gcd(a, b);
  if (Number.isNaN(g)) return g;
  if (g === 0) return 0;
  return Math.abs((a / g) * b);
}

export function variadicMin(args: readonly number[]): number {
  let m = Number.POSITIVE_INFINITY;
  for (const v of args) {
    if (Number.isNaN(v)) return Number.NaN;
    if (v < m) m = v;
  }
  return m;
}

export function variadicMax(args: readonly number[]): number {
  let m = Number.NEGATIVE_INFINITY;
  for (const v of args) {
    if (Number.isNaN(v)) return Number.NaN;
    if (v > m) m = v;
  }
  return m;
}

// Lanczos approximation, g = 7, n = 9 (about 15 significant digits).
const LANCZOS_G = 7;
const LANCZOS = [
  0.9999999999998099, 676.5203681218851, -1259.1392167224028, 771.3234287776531, -176.6150291621406,
  12.507343278686905, -0.13857109526572012, 9.984369578019572e-6, 1.5056327351493116e-7,
];
const SQRT_2PI = Math.sqrt(2 * Math.PI);

/** Exact-as-doubles n! for n = 0..170 (171! overflows). */
const FACTORIALS = (() => {
  const table = new Float64Array(171);
  table[0] = 1;
  for (let i = 1; i <= 170; i++) table[i] = table[i - 1] * i;
  return table;
})();

/** Γ(x) for real x: NaN at 0 and the negative integers, Infinity once it overflows. */
export function gamma(x: number): number {
  if (Number.isNaN(x) || x === Number.NEGATIVE_INFINITY) return Number.NaN;
  if (Number.isInteger(x)) {
    if (x <= 0) return Number.NaN;
    return x <= 171 ? FACTORIALS[x - 1] : Number.POSITIVE_INFINITY;
  }
  if (x > 171.7) return Number.POSITIVE_INFINITY;
  if (x < 0.5) {
    // Reflection formula: Γ(x)Γ(1 − x) = π / sin(πx).
    return Math.PI / (Math.sin(Math.PI * x) * gamma(1 - x));
  }
  const z = x - 1;
  let sum = LANCZOS[0];
  for (let i = 1; i < LANCZOS_G + 2; i++) sum += LANCZOS[i] / (z + i);
  const t = z + LANCZOS_G + 0.5;
  // t^(z+0.5) alone overflows near x = 171; split the power so the product stays finite.
  const half = t ** ((z + 0.5) / 2);
  return SQRT_2PI * half * (Math.exp(-t) * half) * sum;
}

/** x! = Γ(x + 1): exact for integers 0..170, NaN for negative integers, Infinity above 171. */
export function factorial(x: number): number {
  if (Number.isInteger(x)) {
    if (x < 0) return Number.NaN;
    return x <= 170 ? FACTORIALS[x] : Number.POSITIVE_INFINITY;
  }
  if (x > 171) return Number.POSITIVE_INFINITY;
  return gamma(x + 1);
}

const atan: BuiltinImpl = { unary: Math.atan, binary: Math.atan2 };
const minImpl: BuiltinImpl = { binary: Math.min, variadic: variadicMin };
const maxImpl: BuiltinImpl = { binary: Math.max, variadic: variadicMax };

export const BUILTINS: { readonly [K in BuiltinFunctionName]: BuiltinImpl } = {
  sin: { unary: Math.sin },
  cos: { unary: Math.cos },
  tan: { unary: Math.tan },
  sec: { unary: sec },
  csc: { unary: csc },
  cot: { unary: cot },
  asin: { unary: Math.asin },
  acos: { unary: Math.acos },
  atan,
  asec: { unary: asec },
  acsc: { unary: acsc },
  acot: { unary: acot },
  arcsin: { unary: Math.asin },
  arccos: { unary: Math.acos },
  arctan: atan,
  sinh: { unary: Math.sinh },
  cosh: { unary: Math.cosh },
  tanh: { unary: Math.tanh },
  sech: { unary: sech },
  csch: { unary: csch },
  coth: { unary: coth },
  asinh: { unary: Math.asinh },
  acosh: { unary: Math.acosh },
  atanh: { unary: Math.atanh },
  arcsinh: { unary: Math.asinh },
  arccosh: { unary: Math.acosh },
  arctanh: { unary: Math.atanh },
  sqrt: { unary: Math.sqrt },
  cbrt: { unary: Math.cbrt },
  abs: { unary: Math.abs },
  exp: { unary: Math.exp },
  ln: { unary: Math.log },
  log: { unary: Math.log10 },
  floor: { unary: Math.floor },
  ceil: { unary: Math.ceil },
  round: { unary: round },
  sign: { unary: Math.sign },
  sgn: { unary: Math.sign },
  min: minImpl,
  max: maxImpl,
  mod: { binary: mod },
  gcd: { binary: gcd },
  lcm: { binary: lcm },
};

/** The implementation of a builtin, or undefined when `name` isn't one. */
export function builtinImpl(name: string): BuiltinImpl | undefined {
  return Object.hasOwn(BUILTINS, name) ? BUILTINS[name as BuiltinFunctionName] : undefined;
}

/**
 * Applies a builtin to already-evaluated arguments; NaN for an unknown name or an unsupported
 * argument count. Used for tests and debugging; compiled code calls the implementations directly.
 */
export function callBuiltin(name: string, args: readonly number[]): number {
  const impl = builtinImpl(name);
  if (impl === undefined) return Number.NaN;
  const [a = Number.NaN, b = Number.NaN] = args;
  if (args.length === 1 && impl.unary) return impl.unary(a);
  if (args.length === 2 && impl.binary) return impl.binary(a, b);
  if (args.length > 2 && impl.variadic) return impl.variadic(args);
  return Number.NaN;
}
