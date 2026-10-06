import { describe, expect, it } from 'vitest';
import { formatCoordinate, formatPlain, formatSliderValue, formatValue } from './format';

describe('formatValue', () => {
  it.each([
    [0, '0'],
    [-0, '0'],
    [1, '1'],
    [-1, '-1'],
    [0.1 + 0.2, '0.3'],
    [1 / 3, '0.3333333333'],
    [2 / 3, '0.6666666667'],
    [-2 / 3, '-0.6666666667'],
    [Math.PI, '3.141592654'],
    [100, '100'],
    [123456.789, '123456.789'],
    [1234567890.5, '1234567891'],
    [9999999999, '9999999999'],
    [0.000001, '0.000001'],
    [0.0000012345, '0.0000012345'],
    [2.5, '2.5'],
    [1e10, '1×10¹⁰'],
    [2e12, '2×10¹²'],
    [-2e12, '-2×10¹²'],
    [1.5e-7, '1.5×10⁻⁷'],
    [-1.5e-7, '-1.5×10⁻⁷'],
    [6.02214076e23, '6.02214076×10²³'],
    [1 / 3e20, '3.333333333×10⁻²¹'],
    [9.99999999999e9, '1×10¹⁰'],
    [Number.MAX_VALUE, '1.797693135×10³⁰⁸'],
    [5e-324, '4.940656458×10⁻³²⁴'],
    [Number.NaN, 'undefined'],
    [Number.POSITIVE_INFINITY, '∞'],
    [Number.NEGATIVE_INFINITY, '-∞'],
  ])('%d → %s', (v, expected) => {
    expect(formatValue(v)).toBe(expected);
  });
});

describe('formatSliderValue', () => {
  it.each([
    // [value, step, min, max, expected]
    [-2.35, 0.01, -10, 10, '-2.35'],
    [2.5, 0.1, 0, 10, '2.5'],
    [0.30000000000000004, 0.1, 0, 1, '0.3'],
    [3, 0.1, 0, 10, '3'],
    [2.25, 0.25, 0, 10, '2.25'],
    [7, 1, 0, 10, '7'],
    [7.4, 1, 0, 10, '7'],
    [-0.0001, 0.01, -1, 1, '0'],
    [-0, 1, -10, 10, '0'],
    [1 / 3, 0, 0, 1, '0.333'],
    [1 / 3, 0, -10, 10, '0.33'],
    [123.456, 0, 0, 1000, '123'],
    [0.123456789012345, 1e-12, 0, 1, '0.123456789'],
    [1 / 3, 1 / 3, 0, 1, '0.3333333333'],
    [1e21, 1, 0, 1e22, '1000000000000000000000'],
    [1e-7, 0.01, 0, 1, '0'],
    [5.5, 0, Number.NaN, Number.NaN, '5.5'],
    [Number.NaN, 0.1, 0, 1, '0'],
  ])('(%d, step %d, %d..%d) → %s', (v, step, min, max, expected) => {
    expect(formatSliderValue(v, step, min, max)).toBe(expected);
  });

  it('never uses exponent form or non-ASCII characters', () => {
    for (const v of [1e-9, 1e25, -3e22, 12345.6789, 1e-20]) {
      const s = formatSliderValue(v, 0, 0, 0);
      expect(s).toMatch(/^-?\d+(\.\d+)?$/);
    }
  });

  it('round-trips through Number for typical slider values', () => {
    for (let k = -100; k <= 100; k++) {
      const v = -10 + k * 0.1;
      expect(Number(formatSliderValue(v, 0.1, -10, 10))).toBeCloseTo(v, 10);
    }
  });
});

describe('formatCoordinate', () => {
  it.each([
    // [value, ppu, expected]
    [1, 50, '1'],
    [1.23456, 50, '1.235'],
    [-1.23456, 50, '-1.235'],
    [1.5, 50, '1.5'],
    [-0.0001, 50, '0'],
    [-0, 50, '0'],
    [1234.5678, 1, '1234.6'],
    [1234.5678, 0.01, '1235'],
    [Math.PI, 1e6, '3.1415927'],
    [Math.PI, 1e20, '3.14159265359'],
    [Math.PI, 0, '3'],
    [Number.NaN, 50, 'undefined'],
    [Number.POSITIVE_INFINITY, 50, '∞'],
  ])('(%d at %d px/unit) → %s', (v, ppu, expected) => {
    expect(formatCoordinate(v, ppu)).toBe(expected);
  });
});

describe('formatPlain', () => {
  it.each([
    [0, 4, '0'],
    [-0, 4, '0'],
    [Math.SQRT2, 4, '1.414'],
    [-Math.SQRT2, 4, '-1.414'],
    [2.5, 4, '2.5'],
    [12345.6, 4, '12346'],
    [0.000123456, 4, '0.0001235'],
    [0.99996, 4, '1'],
    [-0.00001, 2, '-0.00001'],
    [1.23e-15, 4, '0'],
    [1e21, 4, '1000000000000000000000'],
    [Number.NaN, 4, 'undefined'],
    [Number.POSITIVE_INFINITY, 4, '∞'],
    [Math.PI, 6, '3.14159'],
  ])('%d to %d digits is %s', (v, digits, text) => {
    expect(formatPlain(v, digits)).toBe(text);
  });
});
