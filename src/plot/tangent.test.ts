import { describe, expect, it } from 'vitest';
import { DocumentEngine } from '../engine/document';
import { pointRow, slopeAt, tangentRow } from './tangent';

describe('slopeAt', () => {
  it.each([
    [(x: number) => x * x, 3, 6],
    [(x: number) => x * x, 0, 0],
    [Math.sin, 0, 1],
    [Math.exp, 1, Math.E],
    [(x: number) => 5 - x, 100, -1],
    [(x: number) => x ** 3, 1e4, 3e8],
  ])('%s at %d is %d', (f, x, m) => {
    expect(slopeAt(f, x)).toBeCloseTo(m, 4 - Math.max(0, Math.round(Math.log10(Math.abs(m) || 1))));
  });

  it('has none at a corner, a pole or off the domain', () => {
    expect(slopeAt(Math.abs, 0)).toBeNull();
    expect(slopeAt((x) => 1 / x, 0)).toBeNull();
    expect(slopeAt(Math.sqrt, -1)).toBeNull();
    expect(slopeAt(Math.sqrt, 0)).toBeNull();
    expect(slopeAt(Math.floor, 1)).toBeNull();
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
    // Rounded to what the trace shows at this zoom.
    ['x', Math.SQRT2, 0, 2 * Math.SQRT2, 50, 'y = 2.828(x - 1.414)'],
    ['x', Math.SQRT2, 0, 2 * Math.SQRT2, 5, 'y = 2.83(x - 1.41)'],
    // x = f(y): the roles swap.
    ['y', 1, 1, 2, 50, 'x = 2(y - 1) + 1'],
  ] as const)('%s at (%d, %d), slope %d: %s', (variable, u, v, m, ppu, text) => {
    expect(tangentRow(variable, u, v, m, ppu)).toBe(text);
  });

  it('writes rows the engine reads as the tangent line', () => {
    const f = (x: number) => x ** 3 - 2 * x;
    for (const x0 of [-1.7, -0.3, 0, 0.8, 2.25]) {
      const m = slopeAt(f, x0) as number;
      const text = tangentRow('x', x0, f(x0), m, 1000);
      const a = new DocumentEngine().update([{ id: 'r0', source: text }]);
      const plot = a.byId.get('r0')?.plot;
      if (plot?.kind !== 'explicitY') throw new Error(`${text}: not a curve`);
      // Through the point, with its slope.
      expect(plot.f(x0)).toBeCloseTo(f(x0), 2);
      expect(plot.f(x0 + 1) - plot.f(x0)).toBeCloseTo(m, 2);
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
