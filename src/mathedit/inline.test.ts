import { describe, expect, it } from 'vitest';
import { type InlinePiece, inlineMath } from './inline';

/** Pieces in short: `x` italic, `[sin]` upright, ` + ` spaced, `^2` raised, `_0` lowered. */
function show(pieces: InlinePiece[]): string {
  return pieces
    .map((p) => {
      const text =
        p.role === 'var'
          ? p.text
          : p.role === 'op' || p.role === 'rel'
            ? ` ${p.text} `
            : p.role === 'sep'
              ? `${p.text} `
              : p.role === 'fn'
                ? `[${p.text}]`
                : p.text;
      return p.script === 'sup' ? `^${text}` : p.script === 'sub' ? `_${text}` : text;
    })
    .join('');
}

describe('inlineMath', () => {
  it.each([
    ['x^2', 'x^2'],
    ['2x', '2x'],
    ['(x+1)^2', '(x + 1)^2'],
    ['3x^2', '3x^2'],
    ['1*10^-3x', '1 · 10^−^3x'],
    ['1e - 3x', '1e − 3x'],
    ['2*10^(x+1)', '2 · 10^x^ + ^1'],
    ['log(x)/log(2)', '[log](x)/[log](2)'],
    ['(log(x)/log(2))^2', '([log](x)/[log](2))^2'],
    ['asin', '[asin]'],
    ['a(x) = …', 'a(x) = …'],
    ['<=', ' ≤ '],
    ['y >= -x', 'y ≥ −x'],
    ['=', ' = '],
    ['m, b', 'm, b'],
    ['x_0', 'x_0'],
    ['v_{max}', 'v_max'],
    ['2pi theta', '2πθ'],
    ['x**2', 'x^2'],
    ['e^(x', 'e^x'],
  ])('%s', (text, expected) => {
    expect(show(inlineMath(text))).toBe(expected);
  });

  it('reads a row as the engine does, given the document names', () => {
    const names = { vars: new Set(['a']), fns: new Map<string, number>() };
    const none = { vars: new Set<string>(), fns: new Map<string, number>() };
    expect(show(inlineMath('y = asin(x)', names))).toBe('y = a[sin](x)');
    expect(show(inlineMath('y = asin(x)', none))).toBe('y = [asin](x)');
    // The row that defines a keeps asin whole, as the engine does.
    expect(show(inlineMath('a = asin(0.5)', names))).toBe('a = [asin](0.5)');
    expect(show(inlineMath('y = pix', none))).toBe('y = πx');
    expect(show(inlineMath('y = sin(tau x)', none))).toBe('y = [sin](τx)');
    expect(show(inlineMath('y = ka_1', none))).toBe('y = ka_1');
    // Without names, a run of letters is one name.
    expect(show(inlineMath('y = pix'))).toBe('y = pix');
    expect(show(inlineMath('tau'))).toBe('τ');
  });

  it('keeps every character it was given, prettified', () => {
    const text = inlineMath('y = sin(x) - 2*x^2 <= 1')
      .map((p) => p.text)
      .join('');
    expect(text).toBe('y=sin(x)−2·x2≤1');
  });
});
