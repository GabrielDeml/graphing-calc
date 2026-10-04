import { describe, expect, it } from 'vitest';
import { BUILTIN_FUNCTION_NAMES, BUILTIN_FUNCTIONS } from './builtinNames';
import {
  acot,
  BUILTINS,
  builtinImpl,
  callBuiltin,
  factorial,
  gamma,
  gcd,
  lcm,
  mod,
  round,
} from './builtins';

const XS = [-2.5, -1, -0.3, 0.2, 0.7, 1, 3.4];

describe('BUILTINS table', () => {
  it('implements every builtin name with every arity it accepts', () => {
    for (const name of BUILTIN_FUNCTION_NAMES) {
      const impl = BUILTINS[name];
      const arities: readonly number[] = BUILTIN_FUNCTIONS[name];
      if (arities.includes(1)) expect(impl.unary, name).toBeTypeOf('function');
      if (arities.includes(2)) expect(impl.binary, name).toBeTypeOf('function');
      if (arities.includes(Number.POSITIVE_INFINITY)) {
        expect(impl.variadic, name).toBeTypeOf('function');
      }
    }
  });

  it('looks names up without touching the prototype', () => {
    expect(builtinImpl('sin')).toBe(BUILTINS.sin);
    expect(builtinImpl('constructor')).toBeUndefined();
    expect(builtinImpl('toString')).toBeUndefined();
  });

  it.each([
    ['sin', Math.sin],
    ['cos', Math.cos],
    ['tan', Math.tan],
    ['asin', Math.asin],
    ['acos', Math.acos],
    ['atan', Math.atan],
    ['arcsin', Math.asin],
    ['arccos', Math.acos],
    ['arctan', Math.atan],
    ['sinh', Math.sinh],
    ['cosh', Math.cosh],
    ['tanh', Math.tanh],
    ['asinh', Math.asinh],
    ['acosh', Math.acosh],
    ['atanh', Math.atanh],
    ['arcsinh', Math.asinh],
    ['arccosh', Math.acosh],
    ['arctanh', Math.atanh],
    ['sqrt', Math.sqrt],
    ['cbrt', Math.cbrt],
    ['abs', Math.abs],
    ['exp', Math.exp],
    ['ln', Math.log],
    ['log', Math.log10],
    ['floor', Math.floor],
    ['ceil', Math.ceil],
    ['sign', Math.sign],
    ['sgn', Math.sign],
    ['sec', (x: number) => 1 / Math.cos(x)],
    ['csc', (x: number) => 1 / Math.sin(x)],
    ['cot', (x: number) => 1 / Math.tan(x)],
    ['sech', (x: number) => 1 / Math.cosh(x)],
    ['csch', (x: number) => 1 / Math.sinh(x)],
    ['coth', (x: number) => 1 / Math.tanh(x)],
    ['asec', (x: number) => Math.acos(1 / x)],
    ['acsc', (x: number) => Math.asin(1 / x)],
  ] as const)('%s matches its Math definition', (name, ref) => {
    for (const x of XS) expect(callBuiltin(name, [x])).toBe(ref(x));
  });

  it('atan with two arguments is atan2(y, x)', () => {
    expect(callBuiltin('atan', [1, -1])).toBe(Math.atan2(1, -1));
    expect(callBuiltin('arctan', [-1, -1])).toBe(Math.atan2(-1, -1));
  });

  it('min and max take two or more arguments', () => {
    expect(callBuiltin('min', [3, 1])).toBe(1);
    expect(callBuiltin('max', [3, 1])).toBe(3);
    expect(callBuiltin('min', [3, 1, -2, 5])).toBe(-2);
    expect(callBuiltin('max', [3, 1, -2, 5])).toBe(5);
    expect(callBuiltin('max', [1, Number.NaN, 5])).toBeNaN();
    expect(callBuiltin('min', [1, Number.NaN, 5])).toBeNaN();
  });

  it('gives NaN for an unknown name or arity', () => {
    expect(callBuiltin('nope', [1])).toBeNaN();
    expect(callBuiltin('sin', [1, 2])).toBeNaN();
    expect(callBuiltin('mod', [1])).toBeNaN();
  });

  it('domain errors are NaN, poles are infinite', () => {
    expect(callBuiltin('sqrt', [-1])).toBeNaN();
    expect(callBuiltin('ln', [-1])).toBeNaN();
    expect(callBuiltin('ln', [0])).toBe(Number.NEGATIVE_INFINITY);
    expect(callBuiltin('asin', [2])).toBeNaN();
    expect(callBuiltin('csc', [0])).toBe(Number.POSITIVE_INFINITY);
    expect(callBuiltin('coth', [0])).toBe(Number.POSITIVE_INFINITY);
  });
});

describe('acot', () => {
  it('is atan(1/x) and π/2 at zero', () => {
    expect(acot(1)).toBeCloseTo(Math.PI / 4, 15);
    expect(acot(-1)).toBeCloseTo(-Math.PI / 4, 15);
    expect(acot(0)).toBe(Math.PI / 2);
    expect(acot(-0)).toBe(Math.PI / 2);
    expect(acot(Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe('round', () => {
  it.each([
    [2.5, 3],
    [-2.5, -3],
    [2.4, 2],
    [-2.4, -2],
    [0.5, 1],
    [-0.5, -1],
    [3, 3],
    [-3, -3],
  ])('round(%d) = %d', (x, expected) => {
    expect(round(x)).toBe(expected);
  });

  it('is symmetric: round(-x) = -round(x)', () => {
    // + 0 turns -0 into 0, which display code treats the same.
    for (let x = -10; x <= 10; x += 0.25) expect(round(-x) + 0).toBe(-round(x) + 0);
  });

  it('passes NaN and infinities through', () => {
    expect(round(Number.NaN)).toBeNaN();
    expect(round(Number.POSITIVE_INFINITY)).toBe(Number.POSITIVE_INFINITY);
    expect(round(Number.NEGATIVE_INFINITY)).toBe(Number.NEGATIVE_INFINITY);
  });
});

describe('mod', () => {
  it.each([
    [7, 3, 1],
    [-1, 3, 2],
    [-7, 3, 2],
    [7, -3, -2],
    [-7, -3, -1],
    [5.5, 2, 1.5],
    [6, 3, 0],
  ])('mod(%d, %d) = %d', (a, b, expected) => {
    expect(mod(a, b)).toBe(expected);
  });

  it('mod(x, 0) is NaN', () => {
    expect(mod(5, 0)).toBeNaN();
    expect(mod(0, 0)).toBeNaN();
  });
});

describe('gcd and lcm', () => {
  it.each([
    [12, 18, 6],
    [-12, 18, 6],
    [12, -18, 6],
    [7, 13, 1],
    [0, 5, 5],
    [5, 0, 5],
    [0, 0, 0],
  ])('gcd(%d, %d) = %d', (a, b, expected) => {
    expect(gcd(a, b)).toBe(expected);
  });

  it.each([
    [4, 6, 12],
    [-4, 6, 12],
    [7, 13, 91],
    [0, 5, 0],
    [0, 0, 0],
  ])('lcm(%d, %d) = %d', (a, b, expected) => {
    expect(lcm(a, b)).toBe(expected);
  });

  it('non-integers give NaN', () => {
    expect(gcd(1.5, 3)).toBeNaN();
    expect(gcd(3, Number.NaN)).toBeNaN();
    expect(gcd(Number.POSITIVE_INFINITY, 3)).toBeNaN();
    expect(lcm(2, 0.5)).toBeNaN();
  });
});

describe('gamma and factorial', () => {
  it('factorial is exact for small integers', () => {
    const expected = [1, 1, 2, 6, 24, 120, 720, 5040, 40320, 362880, 3628800];
    expected.forEach((f, n) => {
      expect(factorial(n)).toBe(f);
    });
    expect(factorial(20)).toBe(2432902008176640000);
  });

  it('factorial(170) is finite and factorial above 170 integers overflows', () => {
    expect(Number.isFinite(factorial(170))).toBe(true);
    expect(factorial(170)).toBeCloseTo(7.257415615307994e306, -292);
    expect(factorial(171)).toBe(Number.POSITIVE_INFINITY);
    expect(factorial(1000)).toBe(Number.POSITIVE_INFINITY);
    expect(factorial(171.5)).toBe(Number.POSITIVE_INFINITY);
  });

  it('negative integers give NaN', () => {
    expect(factorial(-1)).toBeNaN();
    expect(factorial(-5)).toBeNaN();
    expect(gamma(0)).toBeNaN();
    expect(gamma(-3)).toBeNaN();
  });

  it('half-integers match closed forms', () => {
    expect(factorial(0.5)).toBeCloseTo(Math.sqrt(Math.PI) / 2, 13);
    expect(factorial(-0.5)).toBeCloseTo(Math.sqrt(Math.PI), 13);
    expect(factorial(1.5)).toBeCloseTo((3 * Math.sqrt(Math.PI)) / 4, 13);
    expect(gamma(-0.5)).toBeCloseTo(-2 * Math.sqrt(Math.PI), 12);
    expect(gamma(0.5)).toBeCloseTo(Math.sqrt(Math.PI), 13);
  });

  it('agrees with the integer table between integers (Γ(x+1) = xΓ(x))', () => {
    for (const x of [1.3, 2.7, 5.25, 10.1, 30.5]) {
      expect(gamma(x + 1) / (x * gamma(x))).toBeCloseTo(1, 12);
    }
    expect(factorial(4.0000001)).toBeCloseTo(24, 4);
  });

  it('stays finite just below the overflow point', () => {
    expect(Number.isFinite(gamma(171.5))).toBe(true);
    expect(gamma(171.5)).toBeGreaterThan(1e307);
    expect(gamma(172.5)).toBe(Number.POSITIVE_INFINITY);
  });

  it('handles NaN and infinities', () => {
    expect(factorial(Number.NaN)).toBeNaN();
    expect(factorial(Number.POSITIVE_INFINITY)).toBe(Number.POSITIVE_INFINITY);
    expect(factorial(Number.NEGATIVE_INFINITY)).toBeNaN();
  });
});
