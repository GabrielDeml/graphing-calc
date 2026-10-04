import { describe, expect, it } from 'vitest';
import {
  type Classified,
  type ClassifyResult,
  classify,
  findTuple,
  freePlotVars,
} from './classify';
import { detectDefinition } from './definition';
import type { NameContext } from './names';
import { parse } from './parser';
import { printNode } from './print';
import type { MathError } from './types';

/** Classifies `source` with `vars`/`fns` defined elsewhere, plus the row's own definition. */
function run(
  source: string,
  vars: string[] = [],
  fns: Record<string, number> = {},
): ClassifyResult {
  const head = detectDefinition(source);
  const ctx: NameContext = { vars: new Set(vars), fns: new Map(Object.entries(fns)) };
  if (head?.kind === 'var') (ctx.vars as Set<string>).add(head.name);
  if (head?.kind === 'fn') {
    (ctx.fns as Map<string, number>).set(head.name, head.params.length);
    ctx.params = head.params;
  }
  const parsed = parse(source, ctx);
  if (!parsed.ok) throw new Error(`${source}: ${parsed.error.message}`);
  return classify(parsed.statement, head);
}

function summary(row: Classified): string {
  switch (row.kind) {
    case 'empty':
      return 'empty';
    case 'constant':
    case 'polar':
    case 'implicit':
      return `${row.kind} ${printNode(row.expr)}`;
    case 'explicitY':
    case 'explicitX':
      return `${row.kind}${row.isConstant ? ' const' : ''} ${printNode(row.expr)}`;
    case 'ineqY':
    case 'ineqX':
      return `${row.kind} ${row.ineq.side}${row.ineq.strict ? ' strict' : ''}${row.isConstant ? ' const' : ''} ${printNode(row.expr)}`;
    case 'ineqImplicit':
      return `ineqImplicit${row.strict ? ' strict' : ''} ${printNode(row.expr)}`;
    case 'parametric':
      return `parametric ${printNode(row.x)} ${printNode(row.y)}`;
    case 'point':
    case 'points':
      return `${row.kind} ${row.points.map((p) => `${printNode(p.x)},${printNode(p.y)}`).join(' ')}`;
    case 'varDef':
      return `varDef ${row.name} ${printNode(row.expr)}`;
    case 'slider':
      return `slider ${row.name} ${row.value} @${row.valueSpan.start}-${row.valueSpan.end}`;
    case 'funcDef':
      return `funcDef ${row.name}(${row.params.join(',')}) ${printNode(row.body)}`;
  }
}

function kind(source: string, vars?: string[], fns?: Record<string, number>): string {
  const r = run(source, vars, fns);
  if (!r.ok) throw new Error(`${source}: ${r.error.code}: ${r.error.message}`);
  return summary(r.row);
}

function error(source: string, vars?: string[], fns?: Record<string, number>): MathError {
  const r = run(source, vars, fns);
  if (r.ok) throw new Error(`${source} classified as ${summary(r.row)}`);
  return r.error;
}

describe('classify: every row kind', () => {
  it.each([
    ['', 'empty'],
    ['   ', 'empty'],
    // constant
    ['1 + 2', 'constant (+ 1 2)'],
    ['sin(pi)', 'constant (sin pi)'],
    // explicitY, including bare expressions in x
    ['y = x^2', 'explicitY (^ x 2)'],
    ['sin(x)', 'explicitY (sin x)'],
    ['x', 'explicitY x'],
    ['y = 3', 'explicitY const 3'],
    ['x^2 = y', 'explicitY (^ x 2)'],
    ['3 = y', 'explicitY const 3'],
    ['y = x', 'explicitY x'],
    // explicitX
    ['x = y^2', 'explicitX (^ y 2)'],
    ['x = 3', 'explicitX const 3'],
    ['sin(y) = x', 'explicitX (sin y)'],
    ['x = y', 'explicitX y'],
    // polar
    ['r = 1 + cos θ', 'polar (+ 1 (cos θ))'],
    ['r = 2', 'polar 2'],
    ['θ = r', 'polar θ'],
    ['r = theta', 'polar θ'],
    // parametric
    ['(cos t, sin t)', 'parametric (cos t) (sin t)'],
    ['(t, 2)', 'parametric t 2'],
    // points
    ['(1, 2)', 'point 1,2'],
    ['(1, 2), (3, 4)', 'points 1,2 3,4'],
    ['(1,2),(3,4),(5,-6)', 'points 1,2 3,4 5,(neg 6)'],
    // definitions
    ['a = 2', 'slider a 2 @4-5'],
    ['a = -2.5', 'slider a -2.5 @4-8'],
    ['a = +3', 'slider a 3 @4-6'],
    ['a = - 3', 'slider a -3 @4-7'],
    ['a=7', 'slider a 7 @2-3'],
    ['a = 2b', 'varDef a (* 2 b)'],
    ['a = 1/2', 'varDef a (/ 1 2)'],
    ['a = pi', 'varDef a pi'],
    ['a = --2', 'varDef a (neg (neg 2))'],
    ['f(x) = x^2', 'funcDef f(x) (^ x 2)'],
    ['g(u, v) = u v + a', 'funcDef g(u,v) (+ (* u v) a)'],
    ['f(t) = 3', 'funcDef f(t) 3'],
    ['f(x) = f(x - 1)', 'funcDef f(x) (call f (- x 1))'],
    // implicit
    ['x^2 + y^2 = 1', 'implicit (- (+ (^ x 2) (^ y 2)) 1)'],
    ['x y = 1', 'implicit (- (* x y) 1)'],
    ['x^2 = 4', 'implicit (- (^ x 2) 4)'],
    ['y = y', 'implicit (- y y)'],
    ['y^2 = x', 'explicitX (^ y 2)'],
    ['ax = 1', 'implicit (- (* a x) 1)'],
  ])('%j → %s', (source, expected) => {
    expect(kind(source, ['b'])).toBe(expected);
  });

  it('sees user functions through their arguments only', () => {
    expect(kind('y = f(x)', [], { f: 1 })).toBe('explicitY (call f x)');
    expect(kind('f(2)', [], { f: 1 })).toBe('constant (call f 2)');
    expect(kind('y = f(2)', [], { f: 1 })).toBe('explicitY const (call f 2)');
    expect(kind('f(x, y) = 1', [], { g: 2 })).toBe('funcDef f(x,y) 1');
    // `g(x, y) = 1` would be a (re)definition of g; anything else around the call is not.
    expect(kind('g(x, y) + 1 = 2', [], { g: 2 })).toBe('implicit (- (+ (call g x y) 1) 2)');
    expect(kind('(f(t), t)', [], { f: 1 })).toBe('parametric (call f t) t');
  });

  it('uses user variables freely', () => {
    expect(kind('y = a x + b', ['a', 'b'])).toBe('explicitY (+ (* a x) b)');
    expect(kind('a + b', ['a', 'b'])).toBe('constant (+ a b)');
    expect(kind('(a, b)', ['a', 'b'])).toBe('point a,b');
  });
});

describe('classify: inequalities', () => {
  it.each([
    ['y > x^2', 'ineqY greater strict (^ x 2)'],
    ['y >= x', 'ineqY greater x'],
    ['y < 2', 'ineqY less strict const 2'],
    ['y <= sin x', 'ineqY less (sin x)'],
    ['0 < y', 'ineqY greater strict const 0'],
    ['x^2 >= y', 'ineqY less (^ x 2)'],
    ['x < y', 'ineqY greater strict x'],
    ['x > y^2', 'ineqX greater strict (^ y 2)'],
    ['x <= 3', 'ineqX less const 3'],
    ['y^2 < x', 'ineqX greater strict (^ y 2)'],
    ['1 >= x', 'ineqX less const 1'],
    ['x^2 + y^2 < 1', 'ineqImplicit strict (- 1 (+ (^ x 2) (^ y 2)))'],
    ['x^2 + y^2 > 1', 'ineqImplicit strict (- (+ (^ x 2) (^ y 2)) 1)'],
    ['x y >= 1', 'ineqImplicit (- (* x y) 1)'],
    ['1 <= x y', 'ineqImplicit (- (* x y) 1)'],
    ['x^2 <= 4', 'ineqImplicit (- 4 (^ x 2))'],
  ])('%j → %s', (source, expected) => {
    expect(kind(source)).toBe(expected);
  });

  it('an inequality is never a definition', () => {
    expect(error('a < 2', ['a']).code).toBe('no-variables');
  });
});

describe('classify: errors', () => {
  it.each([
    // point lists
    ['1, 2', 'bad-point', 'Each point needs the form (x, y)'],
    ['(1, 2), 3', 'bad-point', 'Each point needs the form (x, y)'],
    ['(1, 2), (3, 4, 5)', 'bad-point', 'Each point needs the form (x, y)'],
    ['(1, 2), (x, 4)', 'point-uses-plot-var', "Points can't use x or y"],
    ['(1, y), (3, 4)', 'point-uses-plot-var', "Points can't use x or y"],
    ['(1, t), (3, 4)', 'point-uses-plot-var', "Points can't use t"],
    // single tuples
    ['(1, 2, 3)', 'bad-point', 'Points need exactly 2 coordinates'],
    ['(x, x^2)', 'parametric-uses-plot-var', 'Parametric curves use t: (cos t, sin t)'],
    ['(t, y)', 'parametric-uses-plot-var', 'Parametric curves use t: (cos t, sin t)'],
    ['(θ, 1)', 'parametric-uses-plot-var', 'Parametric curves use t: (cos t, sin t)'],
    ['(r, t)', 'parametric-uses-plot-var', 'Parametric curves use t: (cos t, sin t)'],
    ['((1, 2), 3)', 'bad-tuple', "A point can't be used inside an expression"],
    // bare expressions
    ['y^2', 'needs-equation', "An expression in y can't be graphed on its own"],
    ['x + y', 'needs-equation', "An expression in y can't be graphed on its own"],
    ['cos θ', 'needs-equation', "An expression in θ can't be graphed on its own"],
    ['t^2', 'needs-equation', "An expression in t can't be graphed on its own"],
    ['r + 1', 'needs-equation', "An expression in r can't be graphed on its own"],
    ['1 + (2, 3)', 'bad-tuple', "A point can't be used inside an expression"],
    // definitions
    ['a = x', 'var-uses-plot-var', "a can't depend on x. Did you mean a(x) = …?"],
    ['a = 2t + 1', 'var-uses-plot-var', "a can't depend on t. Did you mean a(t) = …?"],
    ['a = (1, 2)', 'bad-tuple', "A point can't be used inside an expression"],
    ['f(x) = x + y', 'fn-uses-plot-var', "f uses y, which isn't one of its parameters"],
    ['f(u) = u + x', 'fn-uses-plot-var', "f uses x, which isn't one of its parameters"],
    ['f(x) = (x, 1)', 'bad-tuple', "A point can't be used inside an expression"],
    // equations
    ['2 = 3', 'no-variables', 'This equation has no variables'],
    ['1 + 1 = 2', 'no-variables', 'This equation has no variables'],
    ['x = t', 'misplaced-plot-var', 't is only for parametric curves'],
    ['y = θ', 'misplaced-plot-var', 'Polar curves must be written r = …'],
    ['r = x', 'misplaced-plot-var', 'Polar curves must be written r = …'],
    ['r = r', 'misplaced-plot-var', 'Polar curves must be written r = …'],
    ['(1, 2) = y', 'bad-tuple', "A point can't be used inside an expression"],
    // inequalities
    ['r < 2', 'unsupported-inequality', "Polar/parametric inequalities aren't supported yet"],
    ['y > t', 'unsupported-inequality', "Polar/parametric inequalities aren't supported yet"],
    ['θ >= 1', 'unsupported-inequality', "Polar/parametric inequalities aren't supported yet"],
    ['2 < 3', 'no-variables', 'This inequality has no variables'],
  ])('%j → %s', (source, code, message) => {
    const e = error(source);
    expect(e.code).toBe(code);
    expect(e.message).toBe(message);
  });

  it('gives hints for bare expressions', () => {
    expect(error('y^2').hint).toBe('Write x = … or an equation like x^2 + y^2 = 1');
    expect(error('cos θ').hint).toBe('Write r = …');
    expect(error('t^2').hint).toBe('Parametric curves look like (cos t, sin t)');
  });

  it('points spans at the offending part', () => {
    expect(error('a = 2 + x').span).toEqual({ start: 8, end: 9 });
    expect(error('f(x) = x + y').span).toEqual({ start: 11, end: 12 });
    expect(error('(1, 2), 3').span).toEqual({ start: 8, end: 9 });
    expect(error('(1, 2), (x, 4)').span).toEqual({ start: 9, end: 10 });
    expect(error('1 + (2, 3)').span).toEqual({ start: 4, end: 10 });
    expect(error('x + y').span).toEqual({ start: 4, end: 5 });
    expect(error('2 = 3').span).toBeUndefined();
  });
});

describe('classify: function notation on plot variables', () => {
  it.each([
    ['y(x) = x^2', 'explicitY (^ x 2)'],
    ['y(x) = 2x + 1', 'explicitY (+ (* 2 x) 1)'],
    ['y (x) = 3', 'explicitY const 3'],
    ['x^2 = y(x)', 'explicitY (^ x 2)'],
    ['x(y) = y^2', 'explicitX (^ y 2)'],
    ['r(θ) = 1 + cos θ', 'polar (+ 1 (cos θ))'],
    ['r(theta) = 2', 'polar 2'],
    ['y(x) > x^2', 'ineqY greater strict (^ x 2)'],
    ['x(y) <= 1', 'ineqX less const 1'],
    // Products that only look similar stay products.
    ['yx = 1', 'implicit (- (* y x) 1)'],
    ['y x = 1', 'implicit (- (* y x) 1)'],
    ['y(x + 1) = 2', 'implicit (- (* y (+ x 1)) 2)'],
    ['y(2x) = 1', 'implicit (- (* y (* 2 x)) 1)'],
  ])('%j → %s', (source, expected) => {
    expect(kind(source)).toBe(expected);
  });

  it.each([
    ['y(x) = x + y', 0, 4],
    ['x^2 + y = x(y)', 10, 14],
    ['y(x) < y', 0, 4],
  ])('%j → plot-var-call error instead of a silent product', (source, start, end) => {
    expect(error(source)).toMatchObject({ code: 'plot-var-call', span: { start, end } });
  });

  it('explains what to write', () => {
    expect(error('y(x) = x + y')).toMatchObject({
      message: 'y is a graph variable, not a function',
      hint: 'Write y = … to graph, or name a function: f(x) = …',
    });
  });

  it('r(θ) in an inequality is still an unsupported polar inequality', () => {
    expect(error('r(θ) < 1').code).toBe('unsupported-inequality');
  });
});

describe('helpers', () => {
  function node(source: string) {
    const r = parse(source);
    if (!r.ok || r.statement.type !== 'exprs') throw new Error(source);
    return r.statement.items[0];
  }

  it('freePlotVars lists plot variables in first-use order with their spans', () => {
    const free = freePlotVars(node('t + x y + x'));
    expect([...free.keys()]).toEqual(['t', 'x', 'y']);
    expect(free.get('x')).toEqual({ start: 4, end: 5 });
    expect(freePlotVars(node('sin(pi) + e')).size).toBe(0);
  });

  it('freePlotVars looks into call arguments and powers', () => {
    expect([...freePlotVars(node('sin^x(y)')).keys()].sort()).toEqual(['x', 'y']);
  });

  it('findTuple finds nested tuples', () => {
    expect(findTuple(node('1 + 2'))).toBeNull();
    expect(findTuple(node('sin(1 + (2, 3))'))?.span).toEqual({ start: 8, end: 14 });
  });
});
