import { describe, expect, it } from 'vitest';
import {
  EMPTY_CONTEXT,
  isDefinableName,
  type NameContext,
  type NameKind,
  resolveName,
  splitIdentifier,
} from './names';
import { tokenize } from './tokenizer';
import type { Token } from './tokens';

function ctxOf(
  vars: string[] = [],
  fns: Record<string, number> = {},
  params?: string[],
): NameContext {
  const ctx: NameContext = { vars: new Set(vars), fns: new Map(Object.entries(fns)) };
  if (params) ctx.params = params;
  return ctx;
}

/** Splits the first identifier token of `source`. */
function split(source: string, ctx: NameContext = EMPTY_CONTEXT) {
  const token = tokenize(source).find((t) => t.kind === 'ident') as Token;
  return splitIdentifier(token, ctx);
}

function names(source: string, ctx: NameContext = EMPTY_CONTEXT): string[] {
  return split(source, ctx).map((u) => u.name);
}

function kinds(source: string, ctx: NameContext = EMPTY_CONTEXT): NameKind[] {
  return split(source, ctx).map((u) => u.kind);
}

describe('splitIdentifier: greedy splitting', () => {
  it.each([
    ['sinx', ['sin', 'x']],
    ['pix', ['pi', 'x']],
    ['xy', ['x', 'y']],
    ['asinx', ['asin', 'x']],
    ['exp', ['exp']],
    ['ex', ['e', 'x']],
    ['sech', ['sech']],
    ['sinhx', ['sinh', 'x']],
    ['thetax', ['θ', 'x']],
    ['cost', ['cos', 't']],
    ['cott', ['cot', 't']],
    ['cosh', ['cosh']],
    ['tanhx', ['tanh', 'x']],
    ['arcsinx', ['arcsin', 'x']],
    ['xsinx', ['x', 'sin', 'x']],
    ['sinxcosx', ['sin', 'x', 'cos', 'x']],
    ['sinsin', ['sin', 'sin']],
    ['taux', ['tau', 'x']],
    ['maxx', ['max', 'x']],
    ['abc', ['a', 'b', 'c']],
    ['rθ', ['r', 'θ']],
    ['αβ', ['α', 'β']],
  ])('%s → %j', (source, expected) => {
    expect(names(source)).toEqual(expected);
  });

  it('assigns kinds', () => {
    expect(kinds('sinx')).toEqual(['builtinFn', 'plotVar']);
    expect(kinds('pix')).toEqual(['const', 'plotVar']);
    expect(kinds('ex')).toEqual(['const', 'plotVar']);
    expect(kinds('xytrθ')).toEqual(['plotVar', 'plotVar', 'plotVar', 'plotVar', 'plotVar']);
    expect(kinds('ab')).toEqual(['unknown', 'unknown']);
  });

  it('gives units spans in the original source', () => {
    expect(split('2 sinx')).toEqual([
      { name: 'sin', kind: 'builtinFn', start: 2, end: 5 },
      { name: 'x', kind: 'plotVar', start: 5, end: 6 },
    ]);
  });

  it('keeps normalized aliases whole with their original span', () => {
    expect(split('theta')).toEqual([{ name: 'θ', kind: 'plotVar', start: 0, end: 5 }]);
    expect(split('π')).toEqual([{ name: 'pi', kind: 'const', start: 0, end: 1 }]);
    expect(split('√')).toEqual([{ name: 'sqrt', kind: 'builtinFn', start: 0, end: 1 }]);
    expect(split('theta_1')).toEqual([{ name: 'θ_1', kind: 'unknown', start: 0, end: 7 }]);
  });
});

describe('splitIdentifier: user names and priorities', () => {
  it('a whole known run stays one name', () => {
    expect(names('xy', ctxOf(['xy']))).toEqual(['xy']);
    expect(kinds('xy', ctxOf(['xy']))).toEqual(['userVar']);
    expect(names('speed', ctxOf(['speed']))).toEqual(['speed']);
  });

  it('user names take part in greedy splitting', () => {
    expect(names('speedt', ctxOf(['speed']))).toEqual(['speed', 't']);
    expect(kinds('speedt', ctxOf(['speed']))).toEqual(['userVar', 'plotVar']);
    expect(names('kab', ctxOf(['ab']))).toEqual(['k', 'ab']);
    expect(names('fx', ctxOf([], { f: 1 }))).toEqual(['f', 'x']);
    expect(kinds('fx', ctxOf([], { f: 1 }))).toEqual(['userFn', 'plotVar']);
  });

  it('the longest known name wins', () => {
    expect(names('abc', ctxOf(['ab', 'abc']))).toEqual(['abc']);
    expect(names('abcd', ctxOf(['ab', 'abc']))).toEqual(['abc', 'd']);
    expect(names('asinx', ctxOf(['as']))).toEqual(['asin', 'x']);
    expect(names('verylongnamex', ctxOf(['verylongname']))).toEqual(['verylongname', 'x']);
  });

  it('priority: param > userFn > userVar > builtin', () => {
    expect(kinds('g', ctxOf(['g'], { g: 1 }))).toEqual(['userFn']);
    expect(kinds('a', ctxOf(['a'], {}, ['a']))).toEqual(['param']);
    expect(kinds('f', ctxOf([], { f: 2 }, ['f']))).toEqual(['param']);
    expect(kinds('x', ctxOf([], {}, ['x']))).toEqual(['param']);
    expect(kinds('t', ctxOf([], {}, ['u']))).toEqual(['plotVar']);
  });

  it('multi-letter params split like other names', () => {
    expect(names('uvw', ctxOf([], {}, ['uv']))).toEqual(['uv', 'w']);
    expect(kinds('uvw', ctxOf([], {}, ['uv']))).toEqual(['param', 'unknown']);
  });
});

describe('splitIdentifier: subscripts', () => {
  it('a subscript attaches to the last unit', () => {
    expect(split('ka_1')).toEqual([
      { name: 'k', kind: 'unknown', start: 0, end: 1 },
      { name: 'a_1', kind: 'unknown', start: 1, end: 4 },
    ]);
    expect(names('xa_{12}')).toEqual(['x', 'a_12']);
    expect(split('xa_{12}')[1]).toMatchObject({ start: 1, end: 7 });
  });

  it('resolves the subscripted unit as a whole name', () => {
    expect(kinds('ka_1', ctxOf(['a_1']))).toEqual(['unknown', 'userVar']);
    expect(kinds('a_1', ctxOf(['a_1']))).toEqual(['userVar']);
    expect(names('v_{max}', ctxOf(['v_max']))).toEqual(['v_max']);
    expect(kinds('x_1')).toEqual(['unknown']);
    expect(names('sin_1')).toEqual(['sin_1']);
    expect(kinds('sin_1')).toEqual(['unknown']);
  });

  it('a whole subscripted user name wins over splitting', () => {
    expect(names('ab_1', ctxOf(['ab_1']))).toEqual(['ab_1']);
    expect(names('ab_1', ctxOf(['b_1']))).toEqual(['a', 'b_1']);
  });
});

describe('splitIdentifier: theta inside a letter run', () => {
  it.each([
    ['atheta', ['a', 'θ']],
    ['costheta', ['cos', 'θ']],
    ['sintheta', ['sin', 'θ']],
    ['ntheta', ['n', 'θ']],
    ['thetatheta', ['θ', 'θ']],
    ['rtheta', ['r', 'θ']],
  ])('%s → %j', (source, expected) => {
    expect(names(source)).toEqual(expected);
  });

  it('gives θ its five source characters and resolves its kind', () => {
    expect(split('2costheta')).toEqual([
      { name: 'cos', kind: 'builtinFn', start: 1, end: 4 },
      { name: 'θ', kind: 'plotVar', start: 4, end: 9 },
    ]);
    expect(kinds('atheta', ctxOf([], {}, ['θ']))).toEqual(['unknown', 'param']);
  });

  it('a subscript after an embedded theta attaches to θ', () => {
    expect(split('atheta_1')).toEqual([
      { name: 'a', kind: 'unknown', start: 0, end: 1 },
      { name: 'θ_1', kind: 'unknown', start: 1, end: 8 },
    ]);
  });
});

describe('splitIdentifier: a + trig name with a user variable a', () => {
  const withA = ctxOf(['a', 'b']);

  it.each([
    ['asin', ['a', 'sin']],
    ['acos', ['a', 'cos']],
    ['atan', ['a', 'tan']],
    ['asinh', ['a', 'sinh']],
    ['asec', ['a', 'sec']],
    ['asinx', ['a', 'sin', 'x']],
    ['basin', ['b', 'a', 'sin']],
    ['arcsin', ['arcsin']],
    ['abs', ['abs']],
  ])('%s → %j', (source, expected) => {
    expect(names(source, withA)).toEqual(expected);
  });

  it('reads asin as the inverse when a is not a user variable', () => {
    expect(names('asin')).toEqual(['asin']);
    expect(names('asin', ctxOf([], { a: 1 }))).toEqual(['asin']);
  });

  it('the row defining a keeps asin whole, since a·sin there could only be a cycle', () => {
    expect(names('asin', { ...withA, self: 'a' })).toEqual(['asin']);
    expect(names('asin', { ...withA, self: 'b' })).toEqual(['a', 'sin']);
  });

  it('a parameter named a counts too', () => {
    expect(kinds('asin', ctxOf([], {}, ['a']))).toEqual(['param', 'builtinFn']);
  });
});

describe('resolveName', () => {
  it('resolves whole names without splitting', () => {
    expect(resolveName('sin', EMPTY_CONTEXT)).toBe('builtinFn');
    expect(resolveName('e', EMPTY_CONTEXT)).toBe('const');
    expect(resolveName('θ', EMPTY_CONTEXT)).toBe('plotVar');
    expect(resolveName('sinx', EMPTY_CONTEXT)).toBe('unknown');
    expect(resolveName('a', ctxOf(['a']))).toBe('userVar');
  });
});

describe('isDefinableName', () => {
  it.each([
    ['a', true],
    ['b', true],
    ['A', true],
    ['k', true],
    ['α', true],
    ['speed', true],
    ['rate', true],
    ['cost', true],
    ['a_1', true],
    ['x_1', true],
    ['y_0', true],
    ['v_x', true],
    ['v_max', true],
    ['t_1', true],
    ['θ_1', true],
    ['ax_1', true],
    ['x', false],
    ['y', false],
    ['t', false],
    ['r', false],
    ['θ', false],
    ['e', false],
    ['theta', false],
    ['pi', false],
    ['tau', false],
    ['sin', false],
    ['exp', false],
    ['max', false],
    ['ax', false],
    ['xa', false],
    ['by', false],
    ['xy', false],
    ['sin_1', true],
    ['e_1', true],
    ['pi_2', true],
    ['tau_0', true],
    ['ln_2', true],
    ['log_b', true],
    ['bcos', false],
    ['rcos', false],
    ['rcosθ', false],
    ['ksin', false],
    ['spin', false],
    ['atheta', false],
    ['thetab', false],
    ['aθ', false],
    ['second', true],
    ['signal', true],
    ['π', false],
    ['', false],
    ['a1', false],
    ['a_', false],
    ['a_{1}', false],
    ['1a', false],
    ['a b', false],
  ])('%j → %s', (name, expected) => {
    expect(isDefinableName(name)).toBe(expected);
  });
});
