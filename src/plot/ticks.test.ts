import { describe, expect, it } from 'vitest';
import { computeTicks, formatTick } from './ticks';
import { homeViewport, viewBounds } from './viewport';

describe('computeTicks', () => {
  it('picks the 1-2-5 step nearest to 100px (in log space)', () => {
    expect(computeTicks(-10, 10, 40).step).toBe(2); // raw 2.5 → 2 (80px)
    expect(computeTicks(-10, 10, 50).step).toBe(2); // raw 2 → 2
    expect(computeTicks(-10, 10, 100).step).toBe(1); // raw 1 → 1
    expect(computeTicks(-10, 10, 99).step).toBe(1); // raw 1.0101 → 1
    expect(computeTicks(-10, 10, 70).step).toBe(2); // raw 1.43 → 2
    expect(computeTicks(-1, 1, 1000).step).toBe(0.1);
    expect(computeTicks(-1, 1, 400).step).toBe(0.2); // raw 0.25 → 0.2
    expect(computeTicks(-1e9, 1e9, 1e-6).step).toBe(1e8);
    expect(computeTicks(0, 1, 30, 100).step).toBe(5); // raw 3.33 → 5
    expect(computeTicks(0, 1, 15, 100).step).toBe(5); // raw 6.67 → 5
    expect(computeTicks(0, 1, 14, 100).step).toBe(10); // raw 7.14 → 10
    expect(computeTicks(0, 1, 1e9).step).toBe(1e-7);
  });

  it('keeps major spacing within about 63–158px at any scale', () => {
    for (let k = 0; k < 2000; k++) {
      const ppu = 10 ** (-5 + (17 * k) / 2000);
      const t = computeTicks(-1, 1, ppu);
      const px = t.step * ppu;
      expect(px).toBeGreaterThanOrEqual(63);
      expect(px).toBeLessThanOrEqual(159);
    }
  });

  it('labels the phone and desktop home views at a readable density', () => {
    for (const [w, h, step] of [
      [390, 400, 5],
      [390, 350, 5],
      [1600, 900, 2],
      [1280, 700, 2],
      [1024, 500, 5],
      [800, 600, 5],
    ] as const) {
      const v = homeViewport(w, h);
      const b = viewBounds(v);
      const t = computeTicks(b.xmin, b.xmax, v.ppuX);
      expect(t.step).toBe(step);
      expect(t.major.length).toBeGreaterThanOrEqual(5);
    }
  });

  it('uses minor steps of a fifth (a quarter for 2s)', () => {
    expect(computeTicks(-10, 10, 40).minorStep).toBe(0.5);
    expect(computeTicks(-10, 10, 30).minorStep).toBe(1);
    expect(computeTicks(-10, 10, 50).minorStep).toBe(0.5);
    expect(computeTicks(-10, 10, 100).minorStep).toBe(0.2);
    expect(computeTicks(-1, 1, 1000).minorStep).toBe(0.02);
  });

  it('lists majors from integer multiples and minors between them', () => {
    const t = computeTicks(-10, 10, 30);
    expect(t.major).toEqual([-10, -5, 0, 5, 10]);
    expect(t.minor).toEqual([-9, -8, -7, -6, -4, -3, -2, -1, 1, 2, 3, 4, 6, 7, 8, 9]);
    const q = computeTicks(-1.1, 1.1, 50);
    expect(q.major).toEqual([0]);
    expect(q.minor).toEqual([-1, -0.5, 0.5, 1]);
  });

  it('produces exact decimal tick values (no float noise)', () => {
    const t = computeTicks(0, 1, 1000);
    expect(t.major).toEqual([0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1]);
    expect(t.minor).toContain(0.14);
    expect(t.minor).not.toContain(0.2);
    const tiny = computeTicks(0, 3e-6, 1e8);
    expect(tiny.step).toBe(1e-6);
    expect(tiny.major).toEqual([0, 1e-6, 2e-6, 3e-6]);
  });

  it('never returns -0', () => {
    const t = computeTicks(-0.5, 0.5, 100);
    expect(Object.is(t.major[0], -0)).toBe(false);
    expect(t.major).toEqual([0]);
  });

  it('returns empty lists for unusable input or too many ticks', () => {
    expect(computeTicks(0, 1e9, 40).major).toEqual([]);
    expect(computeTicks(Number.NaN, 1, 40).major).toEqual([]);
    expect(computeTicks(1, 0, 40).major).toEqual([]);
    const bad = computeTicks(0, 1, 0);
    expect(bad).toEqual({ step: 0, minorStep: 0, major: [], minor: [] });
    expect(computeTicks(0, 1, Number.NaN).major).toEqual([]);
  });

  it('returns promptly far from the origin at extreme zoom (indices beyond 2^53)', () => {
    for (const [c, ppu] of [
      [1e6, 1e12],
      [1e6, 2e11],
      [1e9, 1e9],
      [1e12, 1e6],
      [1e12, 1e7],
      [-1e12, 1e12],
    ]) {
      const half = 400 / ppu;
      const t0 = performance.now();
      const t = computeTicks(c - half, c + half, ppu);
      expect(performance.now() - t0).toBeLessThan(50);
      expect(t.major.length).toBeLessThanOrEqual(1000);
      expect(t.minor.length).toBeLessThanOrEqual(5000);
      for (let i = 1; i < t.major.length; i++) expect(t.major[i]).toBeGreaterThan(t.major[i - 1]);
    }
  });

  it('still ticks large but exact indices (cx 1e6 at ppu 1e8)', () => {
    const t = computeTicks(1e6 - 4e-6, 1e6 + 4e-6, 1e8);
    expect(t.step).toBe(1e-6);
    expect(t.major).toHaveLength(9);
    expect(t.major[4]).toBe(1e6);
  });
});

describe('formatTick', () => {
  it('prints decimals implied by the step', () => {
    expect(formatTick(0.30000000000000004, 0.1)).toBe('0.3');
    expect(formatTick(0.4, 0.2)).toBe('0.4');
    expect(formatTick(0.15, 0.05)).toBe('0.15');
    expect(formatTick(1, 0.5)).toBe('1.0');
    expect(formatTick(1.5, 0.5)).toBe('1.5');
    expect(formatTick(-2, 1)).toBe('-2');
    expect(formatTick(250, 50)).toBe('250');
    expect(formatTick(0.00002, 0.00001)).toBe('0.00002');
    expect(formatTick(0.7000000000000001, 0.1)).toBe('0.7');
  });

  it('always prints zero as "0"', () => {
    expect(formatTick(0, 0.1)).toBe('0');
    expect(formatTick(-0, 1e-7)).toBe('0');
    expect(formatTick(-1e-17, 0.1)).toBe('0');
    expect(formatTick(0, 1e8)).toBe('0');
  });

  it('uses exponent form for large steps', () => {
    expect(formatTick(5e7, 1e7)).toBe('5×10⁷');
    expect(formatTick(1e6, 2e5)).toBe('1.0×10⁶');
    expect(formatTick(8e5, 2e5)).toBe('8×10⁵');
    expect(formatTick(1.5e7, 5e6)).toBe('1.5×10⁷');
    expect(formatTick(-2e8, 1e8)).toBe('-2×10⁸');
    expect(formatTick(999999, 1)).toBe('999999');
    expect(formatTick(1000000001, 1)).toBe('1000000001');
    expect(formatTick(1.2e21, 2e20)).toBe('1.2×10²¹');
  });

  it('uses exponent form for tiny steps on values near zero', () => {
    expect(formatTick(2e-6, 1e-6)).toBe('2×10⁻⁶');
    expect(formatTick(3e-6, 1e-6)).toBe('3×10⁻⁶');
    expect(formatTick(-4e-7, 2e-7)).toBe('-4×10⁻⁷');
    expect(formatTick(1.2e-5, 2e-6)).toBe('1.2×10⁻⁵');
    expect(formatTick(1e-5, 2e-6)).toBe('1.0×10⁻⁵');
  });

  it('keeps plain decimals for tiny steps away from zero', () => {
    expect(formatTick(0.500002, 2e-6)).toBe('0.500002');
    expect(formatTick(0.5, 2e-6)).toBe('0.500000');
    expect(formatTick(1.000002, 2e-6)).toBe('1.000002');
    expect(formatTick(-12.000001, 1e-6)).toBe('-12.000001');
  });

  it('formats every label on an axis the same way', () => {
    // The reported mixed axes: deep zoom around 1, 0.5 and sqrt(2) - 1, and a wide axis at 1e6.
    for (const [cx, ppu, pattern] of [
      [1, 1e8, /^\d\.\d{6}$/],
      [0.5, 5e7, /^0\.\d{6}$/],
      [0.5, 2.5e7, /^0\.\d{6}$/],
      [0.5, 1.5e7, /^0\.\d{6}$/],
      [0.5, 7e6, /^0\.\d{5}$/],
      [0.41421356, 4e7, /^0\.\d{6}$/],
      [5e5, 2e-4, /^(0|-?\d(\.\d)?×10[⁵⁶])$/],
      [0, 1e8, /^(0|-?\d(\.\d)?×10⁻[⁵⁶])$/],
    ] as const) {
      const half = 400 / ppu;
      const t = computeTicks(cx - half, cx + half, ppu);
      expect(t.major.length).toBeGreaterThan(3);
      for (const v of t.major) expect(formatTick(v, t.step)).toMatch(pattern);
    }
  });

  it('labels every tick of a range without noise', () => {
    for (const ppu of [0.001, 0.37, 1, 40, 123, 1e4, 3e7]) {
      const t = computeTicks(-400 / ppu, 400 / ppu, ppu);
      for (const v of t.major) {
        const s = formatTick(v, t.step);
        expect(s).not.toMatch(/0000000|9999999|^-0$/);
      }
    }
  });
});
