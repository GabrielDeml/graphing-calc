import { describe, expect, it } from 'vitest';
import { DocumentEngine } from '../engine/document';
import {
  type AutoTrigger,
  autoSliderNames,
  caretTouchesName,
  isBuiltinPrefix,
  nameRunAt,
  offeredNames,
  smartRange,
} from './autoSlider';

/** The sliders a row would get, its caret at ‸ (idle) or at the end (commit). */
function names(marked: string, trigger: AutoTrigger, skip: string[] = []): string[] {
  const caret = marked.indexOf('‸');
  const source = marked.replace('‸', '');
  const engine = new DocumentEngine();
  engine.update([{ id: 'r0', source }]);
  const at = caret < 0 ? source.length : caret;
  return autoSliderNames(source, engine.unknownUses('r0'), trigger, {
    selection: { start: at, end: at },
    skip: new Set(skip),
  });
}

describe('autoSliderNames', () => {
  it.each([
    ['y = m x + b', ['m', 'b']],
    ['y = a sin(b x) + c', ['a', 'b', 'c']],
    ['y = k x + k^2', ['k']],
    ['f(x) = a x^2', ['a']],
    ['c = 2d', ['d']],
    ['y = v_{max} x', ['v_max']],
    // A name called like a function is one to define, not a slider.
    ['y = f(x) + k', ['k']],
    ['y = g (x)', []],
    ['y = f_1(x + 1) + k', ['k']],
    ['y = F(x) + c', ['c']],
    ['y = p(x, x)', []],
    // A coefficient times a group is a product: vertex form.
    ['y = a(x - h)^2 + k', ['a', 'h', 'k']],
    ['y = m(x - x_0) + 1', ['m', 'x_0']],
    ['y = k (x + 1)', ['k']],
    ['y = log_2(x) + c', ['c']],
    ['y = x^2', []],
    ['y = (x', []],
  ])('%s, once the edit ends: %j', (source, expected) => {
    expect(names(source, 'commit')).toEqual(expected);
  });

  it.each([
    ['y = k x + 1‸', ['k']],
    ['y = k x + 1 ‸', ['k']],
    ['y = k‸ x + 1', []],
    ['y = ‸k x + 1', []],
    ['y = k x + q‸', []],
    ['y = k x + q_1‸', []],
    ['y = k x^2‸', ['k']],
    // Letters the caret has left are done, even those a builtin starts with.
    ['y = a x + 1‸', ['a']],
    ['y = s + 1‸', ['s']],
    ['y = m x + b + 1‸', ['m', 'b']],
    ['y = a(x - h)^2 + k ‸', ['a', 'h', 'k']],
    ['y = sq + k‸ ', []],
    // Just before the caret, a space away, they may still be on the way to one: none yet, so
    // the row's sliders come together.
    ['y = k x + m ‸', []],
    ['y = a x^2 + b x + c ‸', []],
    ['y = h x + n ‸', ['h', 'n']],
  ])('%s, when typing pauses: %j', (source, expected) => {
    expect(names(source, 'idle')).toEqual(expected);
  });

  it('a pause with text selected makes none', () => {
    const engine = new DocumentEngine();
    const source = 'y = k x + 1';
    engine.update([{ id: 'r0', source }]);
    const uses = engine.unknownUses('r0');
    expect(autoSliderNames(source, uses, 'idle', { selection: { start: 9, end: 11 } })).toEqual([]);
    expect(autoSliderNames(source, uses, 'idle')).toEqual([]);
    expect(autoSliderNames(source, uses, 'commit')).toEqual(['k']);
  });

  it('never makes a name again that was made once', () => {
    expect(names('y = m x + b', 'commit', ['m'])).toEqual(['b']);
    expect(names('y = m x + b', 'commit', ['m', 'b'])).toEqual([]);
  });
});

describe('caretTouchesName', () => {
  it.each([
    ['y = a‸', true],
    ['y = ‸a', true],
    ['y = 2x‸', true],
    ['y = a_1‸', true],
    ['y = v_{max}‸', true],
    ['y = a_‸', true],
    ['y = a ‸', false],
    ['y = 2‸', false],
    ['y = x^2‸', false],
    ['y = (a)‸', false],
    ['‸', false],
    ['y = θ‸', true],
  ])('%s: %s', (marked, expected) => {
    const caret = marked.indexOf('‸');
    expect(caretTouchesName(marked.replace('‸', ''), caret)).toBe(expected);
  });
});

describe('nameRunAt', () => {
  it.each([
    ['y = 2co‸', 'co'],
    ['y = c‸o + 1', 'co'],
    ['y = a_1‸ + b', 'a_1'],
    ['y = k x‸', 'x'],
    ['y = k ‸x', 'x'],
    ['y = 2‸', null],
    ['y = k ‸', null],
  ])('%s: %s', (marked, expected) => {
    const caret = marked.indexOf('‸');
    const text = marked.replace('‸', '');
    const run = nameRunAt(text, caret);
    expect(run ? text.slice(run.start, run.end) : null).toBe(expected);
  });
});

describe('offeredNames', () => {
  /** The names offered for a row, its caret at ‸ (none: the row has no focus). */
  function offered(marked: string): string[] {
    const caret = marked.indexOf('‸');
    const source = marked.replace('‸', '');
    const engine = new DocumentEngine();
    engine.update([{ id: 'r0', source }]);
    const uses = engine.unknownUses('r0');
    const all = [...new Set(uses.map((u) => u.name))];
    return offeredNames(source, uses, all, caret < 0 ? null : caret);
  }

  it.each([
    ['y = k x + 2co‸', ['k']],
    ['y = k x + 2co', ['k', 'c', 'o']],
    ['y = k x + q ‸', ['k', 'q']],
    ['y = k‸', []],
    // Used elsewhere too: offered.
    ['y = k x + k‸', ['k']],
  ])('%s: %j', (marked, expected) => {
    expect(offered(marked)).toEqual(expected);
  });
});

describe('isBuiltinPrefix', () => {
  it.each([
    ['s', true],
    ['sq', true],
    ['sqr', true],
    ['sqrt', false],
    ['p', true],
    ['ta', true],
    ['k', false],
    ['b', false],
    ['speed', false],
  ])('%s: %s', (name, expected) => {
    expect(isBuiltinPrefix(name)).toBe(expected);
  });
});

describe('smartRange', () => {
  it.each([
    [50, '0', '100'],
    [1, '0', '2'],
    [7, '0', '20'],
    [10, '0', '20'],
    [10.5, '0', '50'],
    [250, '0', '500'],
    [0.3, '0', '1'],
    [0.01, '0', '0.02'],
    [0.004, '0', '0.01'],
    [-3, '-10', '0'],
    [-50, '-100', '0'],
    [-0.2, '-0.5', '0'],
    [0, '-10', '10'],
    [1234567, '0', '5000000'],
  ])('%d → %s…%s', (value, min, max) => {
    expect(smartRange(value)).toEqual({ min, max });
  });

  it('keeps the value inside, near the middle', () => {
    for (const v of [0.0007, 0.03, 0.9, 3, 42, 999, 12345, -0.05, -8, -777]) {
      const range = smartRange(v);
      if (!range) throw new Error(`no range for ${v}`);
      const [lo, hi] = [Number(range.min), Number(range.max)];
      expect(v).toBeGreaterThan(lo);
      expect(v).toBeLessThan(hi);
      // The value takes at least a fifth of the range, at most a half.
      const share = Math.abs(v) / (hi - lo);
      expect(share).toBeGreaterThanOrEqual(0.2);
      expect(share).toBeLessThanOrEqual(0.5);
    }
  });

  it('has none for values plain bounds cannot hold', () => {
    expect(smartRange(Number.NaN)).toBeNull();
    expect(smartRange(Number.POSITIVE_INFINITY)).toBeNull();
    expect(smartRange(1e-12)).toBeNull();
    expect(smartRange(1e20)).toBeNull();
  });
});
