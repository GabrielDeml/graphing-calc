// Single source of truth for builtin names, shared by the engine (identifier splitting) and the
// keypad (atomic backspace over function names, f(x) page). Implementations live in builtins.ts.

/** Builtin functions with their accepted argument counts. */
export const BUILTIN_FUNCTIONS = {
  sin: [1],
  cos: [1],
  tan: [1],
  sec: [1],
  csc: [1],
  cot: [1],
  asin: [1],
  acos: [1],
  atan: [1, 2], // atan(y, x) is atan2
  asec: [1],
  acsc: [1],
  acot: [1],
  arcsin: [1],
  arccos: [1],
  arctan: [1, 2],
  sinh: [1],
  cosh: [1],
  tanh: [1],
  sech: [1],
  csch: [1],
  coth: [1],
  asinh: [1],
  acosh: [1],
  atanh: [1],
  arcsinh: [1],
  arccosh: [1],
  arctanh: [1],
  sqrt: [1],
  cbrt: [1],
  abs: [1],
  exp: [1],
  ln: [1],
  log: [1],
  floor: [1],
  ceil: [1],
  round: [1],
  sign: [1],
  sgn: [1],
  min: [2, Number.POSITIVE_INFINITY],
  max: [2, Number.POSITIVE_INFINITY],
  mod: [2],
  gcd: [2],
  lcm: [2],
} as const satisfies Record<string, readonly number[]>;

export type BuiltinFunctionName = keyof typeof BUILTIN_FUNCTIONS;

export const BUILTIN_FUNCTION_NAMES: readonly BuiltinFunctionName[] = Object.keys(
  BUILTIN_FUNCTIONS,
) as BuiltinFunctionName[];

/**
 * Unary builtins that may be applied without parentheses: `sin x`, `ln 2x`.
 * Multi-argument functions (min, max, mod, gcd, lcm) always need parentheses.
 */
export const PREFIXABLE_FUNCTIONS: ReadonlySet<string> = new Set(
  BUILTIN_FUNCTION_NAMES.filter((n) => {
    const arities: readonly number[] = BUILTIN_FUNCTIONS[n];
    return arities.includes(1);
  }),
);

export const BUILTIN_CONSTANTS = {
  pi: Math.PI,
  tau: 2 * Math.PI,
  e: Math.E,
} as const;

/** Plot variables. Inputs may write `theta`; the tokenizer normalizes it to `θ`. */
export const PLOT_VARIABLES = ['x', 'y', 't', 'θ', 'r'] as const;

export function isBuiltinFunction(name: string): name is BuiltinFunctionName {
  return Object.hasOwn(BUILTIN_FUNCTIONS, name);
}
