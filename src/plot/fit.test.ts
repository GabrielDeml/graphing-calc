import { describe, expect, it } from 'vitest';
import {
  affineSlope,
  basisFit,
  conicFit,
  expFit,
  extremesOver,
  leastSquares,
  periodOf,
  polyFit,
  polyRoots,
  polyTurningPoints,
} from './fit';

function close(actual: readonly number[] | null, expected: readonly number[], digits = 9) {
  expect(actual).not.toBeNull();
  expect(actual?.length).toBe(expected.length);
  expected.forEach((v, i) => {
    expect(actual?.[i]).toBeCloseTo(v, digits);
  });
}

describe('leastSquares', () => {
  it('solves an exact square system', () => {
    close(
      leastSquares(
        [
          [2, 1],
          [1, 3],
        ],
        [5, 10],
      ),
      [1, 3],
    );
  });

  it('fits an overdetermined consistent system exactly', () => {
    const rows = [0, 1, 2, 3, 4].map((x) => [1, x, x * x]);
    close(
      leastSquares(
        rows,
        rows.map(([, x]) => 1 - 2 * x + 0.5 * x * x),
      ),
      [1, -2, 0.5],
    );
  });

  it('refuses dependent columns', () => {
    expect(
      leastSquares(
        [
          [1, 2],
          [2, 4],
          [3, 6],
        ],
        [1, 2, 3],
      ),
    ).toBeNull();
    expect(leastSquares([[0], [0]], [1, 1])).toBeNull();
    expect(leastSquares([], [])).toBeNull();
  });
});

describe('polyFit', () => {
  it.each([
    ['constant', () => 3, [3]],
    ['zero', () => 0, []],
    ['line', (x: number) => 2 * x + 1, [1, 2]],
    ['parabola', (x: number) => x * x - 2, [-2, 0, 1]],
    ['shifted parabola', (x: number) => (x - 1) ** 2 + 3, [4, -2, 1]],
    ['cubic', (x: number) => x ** 3 - x, [0, -1, 0, 1]],
    ['quartic', (x: number) => (x * x - 1) * (x * x - 4), [4, 0, -5, 0, 1]],
    ['tiny leading term', (x: number) => 1e-6 * x * x + x, [0, 1, 1e-6]],
  ])('%s', (_, f, coeffs) => {
    close(polyFit(f), coeffs);
  });

  it.each([
    ['x^5', (x: number) => x ** 5],
    ['sin', Math.sin],
    ['|x|', Math.abs],
    ['sqrt', Math.sqrt],
    ['1/x', (x: number) => 1 / x],
    ['exp', Math.exp],
    ['floor', Math.floor],
    ['a line that bends far out', (x: number) => Math.min(x, 500)],
  ])('%s is no polynomial of degree ≤ 4', (_, f) => {
    expect(polyFit(f)).toBeNull();
  });
});

describe('polyRoots', () => {
  it.each([
    [[], []],
    [[3], []],
    [[1, 2], [-0.5]],
    [
      [-2, 0, 1],
      [-Math.SQRT2, Math.SQRT2],
    ],
    [[2, 0, 1], []],
    [[0, 0, 1], [0]],
    [[1, -2, 1], [1]],
    [
      [0, -1, 0, 1],
      [-1, 0, 1],
    ],
    [[0, 0, 0, 1], [0]],
    [
      [-2, 3, 0, -1],
      [-2, 1],
    ],
    [
      [4, 0, -5, 0, 1],
      [-2, -1, 1, 2],
    ],
    [[1, 0, 0, 0, 1], []],
    [
      [1, 0, -2, 0, 1],
      [-1, 1],
    ],
    [
      [-1e6, 0, 1],
      [-1000, 1000],
    ],
  ])('%j → %j', (c, roots) => {
    close(polyRoots(c), roots, 7);
  });
});

describe('polyTurningPoints', () => {
  it('finds where the slope changes sign, not a flat inflection', () => {
    close(polyTurningPoints([0, -3, 0, 1]), [-1, 1]);
    close(polyTurningPoints([0, 0, 0, 1]), []);
    close(polyTurningPoints([3, -2, 1]), [1]);
    close(polyTurningPoints([4, 0, -5, 0, 1]), [-Math.sqrt(2.5), 0, Math.sqrt(2.5)]);
  });
});

describe('multiple roots of fitted polynomials', () => {
  // Fitted, coefficients carry rounding: near a root of multiplicity m the polynomial is noise
  // over about ε^(1/m), and seems to cross zero there again and again.
  it.each([
    ['(x − 1)²(x + 2)', (x: number) => (x - 1) ** 2 * (x + 2), [-2, 1], [-1, 1]],
    ['x³ − 3x + 2', (x: number) => x ** 3 - 3 * x + 2, [-2, 1], [-1, 1]],
    ['(x − 1)⁴', (x: number) => (x - 1) ** 4, [1], [1]],
    [
      'x⁴ − 4x³ + 6x² − 4x + 1',
      (x: number) => x ** 4 - 4 * x ** 3 + 6 * x * x - 4 * x + 1,
      [1],
      [1],
    ],
    ['(x − 3)⁴', (x: number) => (x - 3) ** 4, [3], [3]],
    ['(x − 0.5)³', (x: number) => (x - 0.5) ** 3, [0.5], []],
    ['(x − 1)³', (x: number) => (x - 1) ** 3, [1], []],
    ['(x − 0.001)³', (x: number) => (x - 0.001) ** 3, [0.001], []],
    ['(x² − 1)²', (x: number) => (x * x - 1) ** 2, [-1, 1], [-1, 0, 1]],
    ['(x − 1)²(x + 1)²', (x: number) => (x - 1) ** 2 * (x + 1) ** 2, [-1, 1], [-1, 0, 1]],
    ['(x − 1)²(x + 2)²', (x: number) => (x - 1) ** 2 * (x + 2) ** 2, [-2, 1], [-2, -0.5, 1]],
    ['(x − 1)³(x + 2)', (x: number) => (x - 1) ** 3 * (x + 2), [-2, 1], [-1.25]],
    ['(x − 100)³', (x: number) => (x - 100) ** 3, [100], []],
    ['(1000x − 1)²(x + 1)', (x: number) => (1000 * x - 1) ** 2 * (x + 1), [-1, 0.001], null],
  ])('%s: each root once', (_, f, roots, turns) => {
    const c = polyFit(f);
    expect(c).not.toBeNull();
    close(polyRoots(c as number[]), roots, 7);
    if (turns) close(polyTurningPoints(c as number[]), turns, 7);
  });

  it('keeps roots apart that are apart', () => {
    close(polyRoots(polyFit((x) => (x - 1) * (x - 1.001)) as number[]), [1, 1.001], 9);
    close(polyRoots(polyFit((x) => (x - 1) ** 2 * (x - 1.001)) as number[]), [1, 1.001], 7);
    close(
      polyRoots(polyFit((x) => (x - 1) * (x - 2) * (x - 3) * (x - 4)) as number[]),
      [1, 2, 3, 4],
    );
  });

  it('never more than the degree, whatever the noise', () => {
    for (let i = 0; i < 300; i++) {
      // Coefficients of (x − r)^m (x − s)^(n − m), each off by a few ulps.
      const r = Math.round(Math.sin(i) * 80) / 8;
      const s = Math.round(Math.cos(i * 1.7) * 80) / 8;
      const m = 1 + (i % 3);
      const n = Math.min(4, m + 1 + (i % 2));
      let c = [1];
      for (let k = 0; k < n; k++) {
        const root = k < m ? r : s;
        c = [...c.map((v) => -root * v), 0].map((v, j) => v + (c[j - 1] ?? 0));
      }
      const noisy = c.map((v, j) => v * (1 + (((i * 7 + j * 13) % 5) - 2) * 2.2e-16));
      const roots = polyRoots(noisy);
      expect(roots.length).toBeLessThanOrEqual(r === s ? 1 : 2);
      expect(roots.length).toBeGreaterThanOrEqual(1);
    }
  });
});

describe('expFit', () => {
  it.each([
    ['2^x', (x: number) => 2 ** x, { a: 1, base: 2, c: 0 }],
    ['e^x', Math.exp, { a: 1, base: Math.E, c: 0 }],
    ['3·0.5^x + 1', (x: number) => 3 * 0.5 ** x + 1, { a: 3, base: 0.5, c: 1 }],
    ['-e^(-x) + 2', (x: number) => -Math.exp(-x) + 2, { a: -1, base: 1 / Math.E, c: 2 }],
    ['e^(2x)', (x: number) => Math.exp(2 * x), { a: 1, base: Math.exp(2), c: 0 }],
  ])('%s', (_, f, fit) => {
    const got = expFit(f);
    expect(got?.a).toBeCloseTo(fit.a, 9);
    expect(got?.base).toBeCloseTo(fit.base, 9);
    expect(got?.c).toBeCloseTo(fit.c, 9);
  });

  it.each([
    ['x^2', (x: number) => x * x],
    ['2x + 1', (x: number) => 2 * x + 1],
    ['e^(-x^2)', (x: number) => Math.exp(-x * x)],
    ['x·2^x', (x: number) => x * 2 ** x],
    ['constant', () => 4],
    ['2^x + x', (x: number) => 2 ** x + x],
  ])('%s is no exponential', (_, f) => {
    expect(expFit(f)).toBeNull();
  });
});

describe('periods', () => {
  it('reads the slope of an affine argument', () => {
    expect(affineSlope((x) => 3 * x + 1)).toBeCloseTo(3, 12);
    expect(affineSlope((x) => x / 2)).toBeCloseTo(0.5, 12);
    expect(affineSlope(() => 2)).toBe(0);
    expect(affineSlope((x) => x * x)).toBeNull();
    expect(affineSlope(Math.sin)).toBeNull();
  });

  it.each([
    ['sin x', Math.sin, [{ slope: 1, halfTurn: false }], 2 * Math.PI],
    ['cos 2x', (x: number) => Math.cos(2 * x), [{ slope: 2, halfTurn: false }], Math.PI],
    ['tan x', Math.tan, [{ slope: 1, halfTurn: true }], Math.PI],
    ['sin² x', (x: number) => Math.sin(x) ** 2, [{ slope: 1, halfTurn: false }], Math.PI],
    [
      'sin x + cos(x/2)',
      (x: number) => Math.sin(x) + Math.cos(x / 2),
      [
        { slope: 1, halfTurn: false },
        { slope: 0.5, halfTurn: false },
      ],
      4 * Math.PI,
    ],
    [
      'sin 2x + sin 3x',
      (x: number) => Math.sin(2 * x) + Math.sin(3 * x),
      [
        { slope: 2, halfTurn: false },
        { slope: 3, halfTurn: false },
      ],
      2 * Math.PI,
    ],
  ])('%s repeats every %s', (_, f, args, period) => {
    expect(periodOf(f, args)).toBeCloseTo(period, 9);
  });

  it.each([
    ['sin x + x', (x: number) => Math.sin(x) + x, [{ slope: 1, halfTurn: false }]],
    [
      'sin x + sin(πx)',
      (x: number) => Math.sin(x) + Math.sin(Math.PI * x),
      [
        { slope: 1, halfTurn: false },
        { slope: Math.PI, halfTurn: false },
      ],
    ],
    ['x sin x', (x: number) => x * Math.sin(x), [{ slope: 1, halfTurn: false }]],
    ['no trig', (x: number) => x, []],
  ])('%s has no period', (_, f, args) => {
    expect(periodOf(f, args)).toBeNull();
  });

  it('finds the extremes over a period', () => {
    const e = extremesOver((x) => 3 * Math.sin(x) + 1, 0, 2 * Math.PI);
    expect(e?.max).toBeCloseTo(4, 7);
    expect(e?.min).toBeCloseTo(-2, 7);
    expect(e?.argMax).toBeCloseTo(Math.PI / 2, 3);
    expect(extremesOver(Math.tan, 0, Math.PI)).toBeNull();
  });
});

describe('conicFit', () => {
  it('recovers an exact quadratic, scaled to a largest coefficient of 1', () => {
    const c = conicFit((x, y) => x * x + y * y - 9);
    expect(c?.A).toBeCloseTo(1 / 9, 12);
    expect(c?.C).toBeCloseTo(1 / 9, 12);
    expect(c?.F).toBeCloseTo(-1, 12);
    expect(c?.B).toBe(0);
    const h = conicFit((x, y) => x * y - 1);
    expect(h?.B).toBeCloseTo(1, 12);
    expect(h?.F).toBeCloseTo(-1, 12);
  });

  it.each([
    ['x^4 + y^4 - 1', (x: number, y: number) => x ** 4 + y ** 4 - 1],
    ['sqrt(x² + y²) - 3', (x: number, y: number) => Math.hypot(x, y) - 3],
    ['sin x - y', (x: number, y: number) => Math.sin(x) - y],
    ['x³ - y', (x: number, y: number) => x ** 3 - y],
  ])('%s is no conic', (_, F) => {
    expect(conicFit(F)).toBeNull();
  });
});

describe('basisFit', () => {
  it('fits a trig series exactly, or not at all', () => {
    const basis = [() => 1, Math.cos, Math.sin];
    close(
      basisFit((t) => 1 + 2 * Math.cos(t), basis, 2 * Math.PI),
      [1, 2, 0],
    );
    expect(basisFit((t) => Math.cos(2 * t), basis, 2 * Math.PI)).toBeNull();
  });
});
