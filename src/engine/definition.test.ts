import { describe, expect, it } from 'vitest';
import { detectDefinition } from './definition';

describe('detectDefinition', () => {
  it.each([
    'y = 2',
    'x = 3',
    'r = 2',
    't = 1',
    'θ = 1',
    'theta = 1',
    'ax=1',
    'sin = 2',
    'pi=3',
    'e = 2',
    'f(x+1)=2',
    'f(x, x)=1',
    'f() = 1',
    'f(x) + 1 = 2',
    'f(sin) = 1',
    'f(pi) = 1',
    'f(e) = 1',
    'f(ax) = 1',
    'f(x,) = 1',
    'f(x',
    'f(x)',
    'f(x) < 2',
    '2a = 1',
    'a < 1',
    'a == 1',
    'a =< 1',
    'a_ = 1',
    'a',
    '',
    '= 2',
    'x^2 + y^2 = 1',
    // Letter runs with a builtin after other letters, or with θ, are products, not names.
    'bcos(x) = 1',
    'rcosθ = 1',
    'rcos(θ) = 1',
    'rcostheta = 1',
    'sinθ = 1',
    'ksin x = 1',
    'atheta = 1',
    'spin = 3',
  ])('%j is not a definition', (source) => {
    expect(detectDefinition(source)).toBeNull();
  });

  it.each([
    ['a = 2', 'a'],
    ['a_1=3', 'a_1'],
    ['speed=3', 'speed'],
    ['b = 2a + 1', 'b'],
    ['v_{max} = 10', 'v_max'],
    ['A = 1', 'A'],
    ['α = 0.5', 'α'],
    ['x_1 = 4', 'x_1'],
    ['k =', 'k'],
    // Subscripted names are always definable, even with a builtin base.
    ['e_1 = 2', 'e_1'],
    ['pi_2 = 2', 'pi_2'],
    ['π_2 = 2', 'pi_2'],
    ['tau_0 = 1', 'tau_0'],
    ['log_2 = 1', 'log_2'],
    ['theta_0 = 1', 'θ_0'],
    // Words that merely start with a builtin name.
    ['cost = 5', 'cost'],
    ['second = 2', 'second'],
  ])('%j defines variable %s', (source, name) => {
    expect(detectDefinition(source)).toMatchObject({ kind: 'var', name, params: [] });
  });

  it.each([
    ['f(x)=x^2', 'f', ['x']],
    ['g(u,v)=u+v', 'g', ['u', 'v']],
    ['a(x)=x+1', 'a', ['x']],
    ['h(t) = t', 'h', ['t']],
    ['p(θ) = θ', 'p', ['θ']],
    ['p(theta) = 1', 'p', ['θ']],
    ['q(x, y, r) = x', 'q', ['x', 'y', 'r']],
    ['f_1(a_1) = a_1', 'f_1', ['a_1']],
    ['dist(u, w) = u', 'dist', ['u', 'w']],
    ['f(x) = ', 'f', ['x']],
  ])('%j defines function %s(%j)', (source, name, params) => {
    expect(detectDefinition(source)).toMatchObject({ kind: 'fn', name, params });
  });

  it('reports spans in the original source', () => {
    expect(detectDefinition('  speed = 3')).toEqual({
      kind: 'var',
      name: 'speed',
      nameSpan: { start: 2, end: 7 },
      params: [],
      paramSpans: [],
    });
    expect(detectDefinition('g( u , v_{0} ) = u')).toEqual({
      kind: 'fn',
      name: 'g',
      nameSpan: { start: 0, end: 1 },
      params: ['u', 'v_0'],
      paramSpans: [
        { start: 3, end: 4 },
        { start: 7, end: 12 },
      ],
    });
  });

  it('recognizes the head even when the rest of the row has a lexical error', () => {
    expect(detectDefinition('a = 2$')).toMatchObject({ kind: 'var', name: 'a' });
    expect(detectDefinition('f(x) = [1, 2]')).toMatchObject({ kind: 'fn', name: 'f' });
    expect(detectDefinition('a == 2')).toBeNull();
    expect(detectDefinition('f(x$) = 1')).toBeNull();
  });

  it('never throws', () => {
    for (const source of ['(', ')', '=', '_', 'f(', 'f(x,', 'a_{', '\u0000', '😀=1']) {
      expect(() => detectDefinition(source)).not.toThrow();
    }
  });
});
