import { describe, expect, it } from 'vitest';
import { DocumentEngine } from '../engine/document';
import { formatSlope, isStraight, pointRow, slopeAt, tangentRow } from './tangent';

describe('slopeAt', () => {
  it.each([
    [(x: number) => x * x, 3, 6],
    [(x: number) => x * x, 0, 0],
    [Math.sin, 0, 1],
    [Math.exp, 1, Math.E],
    [(x: number) => 5 - x, 100, -1],
    [(x: number) => x ** 3, 1e4, 3e8],
    // Smooth, however sharply they bend: extrema a pin lands on.
    [(x: number) => 1000 * x * x, 0, 0],
    [(x: number) => 1000 * x * x, 0.0001, 0.2],
    [(x: number) => 10 * (x - 100) ** 2, 100, 0],
    [(x: number) => Math.sin(100 * x), Math.PI / 200, 0],
    [(x: number) => Math.sin(50 * x), Math.PI / 100, 0],
    [Math.sin, (3183 + 0.5) * Math.PI, 0],
    [() => 3, 7, 0],
  ])('%s at %d is %d', (f, x, m) => {
    expect(slopeAt(f, x)).toBeCloseTo(m, 4 - Math.max(0, Math.round(Math.log10(Math.abs(m) || 1))));
  });

  it('has none at a corner, a pole or off the domain', () => {
    expect(slopeAt(Math.abs, 0)).toBeNull();
    expect(slopeAt((x) => 1 / x, 0)).toBeNull();
    expect(slopeAt(Math.sqrt, -1)).toBeNull();
    expect(slopeAt(Math.sqrt, 0)).toBeNull();
    expect(slopeAt(Math.floor, 1)).toBeNull();
    // However small the corner.
    expect(slopeAt((x) => 0.001 * Math.abs(x), 0)).toBeNull();
    expect(slopeAt((x) => Math.abs(x - 100), 100)).toBeNull();
    expect(slopeAt((x) => Math.cbrt(x) ** 2, 0)).toBeNull();
  });
});

describe('isStraight', () => {
  it('tells a line from a curve', () => {
    expect(isStraight((x) => x / 3, 8.6, 1 / 3)).toBe(true);
    expect(isStraight((x) => 5 - 2 * x, 0, -2)).toBe(true);
    expect(isStraight(() => 4, -3, 0)).toBe(true);
    expect(isStraight((x) => x * x, 1, 2)).toBe(false);
    expect(isStraight((x) => x + 1e-3 * x ** 3, 0, 1)).toBe(false);
    // Lines only where it is defined: not known to be one.
    expect(isStraight((x) => (x > 0 ? x : Number.NaN), 1, 1)).toBe(false);
  });
});

describe('formatSlope', () => {
  it.each([
    // The same at any zoom, finer for gentle slopes, coarser for steep ones.
    [0.04, 1000, '0.04'],
    [1 / 3, 1000, '0.333'],
    [2 * Math.SQRT2, 1000, '2.828'],
    [-1.26, 1000, '-1.26'],
    [3e8 + 0.4, 1000, '300000000'],
    [1e-9, 1000, '0'],
    [1 / 3, 100, '0.33'],
  ])('%d across %d px is %s', (m, span, text) => {
    expect(formatSlope(m, span)).toBe(text);
  });
});

describe('tangentRow', () => {
  it.each([
    // y = x² at 1: slope 2.
    ['x', 1, 1, 2, 50, 'y = 2(x - 1) + 1'],
    ['x', -1.5, 2.25, -3, 50, 'y = -3(x + 1.5) + 2.25'],
    ['x', 0, 0, 1, 50, 'y = x'],
    ['x', 0, 2, -1, 50, 'y = -x + 2'],
    ['x', 2, -4, 0.5, 50, 'y = 0.5(x - 2) - 4'],
    // A maximum: a level line.
    ['x', 1.5, 3.25, 1e-9, 50, 'y = 3.25'],
    // The point rounded to what the trace shows at this zoom, the slope to what the view needs.
    ['x', Math.SQRT2, 0, 2 * Math.SQRT2, 50, 'y = 2.828(x - 1.414)'],
    ['x', Math.SQRT2, 0, 2 * Math.SQRT2, 5, 'y = 2.828(x - 1.41)'],
    // Zoomed far out, a gentle slope is still a slope.
    ['x', 20, 0.4, 0.04, 0.5, 'y = 0.04(x - 20) + 0.4'],
    ['x', 3000, 1000, 1 / 3, 0.05, 'y = 0.333(x - 3000) + 1000'],
    // x = f(y): the roles swap.
    ['y', 1, 1, 2, 50, 'x = 2(y - 1) + 1'],
  ] as const)('%s at (%d, %d), slope %d: %s', (variable, u, v, m, ppu, text) => {
    expect(tangentRow(variable, u, v, m, { ppu, span: 1000 })).toBe(text);
  });

  it('writes rows the engine reads as the tangent line', () => {
    const f = (x: number) => x ** 3 - 2 * x;
    for (const x0 of [-1.7, -0.3, 0, 0.8, 2.25]) {
      const m = slopeAt(f, x0) as number;
      const text = tangentRow('x', x0, f(x0), m, { ppu: 1000, span: 1000 });
      const a = new DocumentEngine().update([{ id: 'r0', source: text }]);
      const plot = a.byId.get('r0')?.plot;
      if (plot?.kind !== 'explicitY') throw new Error(`${text}: not a curve`);
      // Through the point, with its slope: within half a pixel of it across the view.
      expect(plot.f(x0)).toBeCloseTo(f(x0), 2);
      const slope = plot.f(x0 + 1) - plot.f(x0);
      expect(Math.abs(Math.atan(slope) - Math.atan(m)) * 1000).toBeLessThan(0.5);
    }
  });
});

describe('pointRow', () => {
  it('writes the point as the trace shows it', () => {
    expect(pointRow(Math.SQRT2, 0, 50)).toBe('(1.414, 0)');
    expect(pointRow(-2.5, 2.5, 50)).toBe('(-2.5, 2.5)');
    const a = new DocumentEngine().update([{ id: 'r0', source: pointRow(-2.5, 1 / 3, 50) }]);
    expect(a.byId.get('r0')?.kind).toBe('point');
  });
});
