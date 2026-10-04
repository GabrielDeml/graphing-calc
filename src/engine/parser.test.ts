import { describe, expect, it } from 'vitest';
import { literalFraction, type Node, type Statement, walk, walkStatement } from './ast';
import { detectDefinition } from './definition';
import { MathSyntaxError } from './errors';
import { EMPTY_CONTEXT, type NameContext } from './names';
import { parse } from './parser';
import { printNode, printStatement } from './print';
import { mulberry32, randomSource } from './testing/fuzz';
import { tokenize } from './tokenizer';
import type { MathError, Span } from './types';

function ctxOf(
  vars: string[] = [],
  fns: Record<string, number> = {},
  params?: string[],
): NameContext {
  const ctx: NameContext = { vars: new Set(vars), fns: new Map(Object.entries(fns)) };
  if (params) ctx.params = params;
  return ctx;
}

function statement(source: string, ctx: NameContext = EMPTY_CONTEXT): Statement {
  const r = parse(source, ctx);
  if (!r.ok) {
    throw new Error(`${JSON.stringify(source)}: ${r.error.code}: ${r.error.message}`);
  }
  return r.statement;
}

function p(source: string, ctx: NameContext = EMPTY_CONTEXT): string {
  return printStatement(statement(source, ctx));
}

/** The single expression of a statement. */
function expr(source: string, ctx: NameContext = EMPTY_CONTEXT): Node {
  const s = statement(source, ctx);
  if (s.type !== 'exprs' || s.items.length !== 1) throw new Error('expected one expression');
  return s.items[0] as Node;
}

function err(source: string, ctx: NameContext = EMPTY_CONTEXT): MathError {
  const r = parse(source, ctx);
  if (r.ok) {
    throw new Error(`${JSON.stringify(source)} parsed as ${printStatement(r.statement)}`);
  }
  return r.error;
}

const USER = ctxOf(['a', 'b', 'xy', 'speed', 'a_1'], { f: 1, g: 2, h: 3 });

describe('parse: statements', () => {
  it.each([
    ['', '(empty)'],
    ['   ', '(empty)'],
    ['x', 'x'],
    ['y = x^2', '(= y (^ x 2))'],
    ['y < x', '(< y x)'],
    ['y > x', '(> y x)'],
    ['y <= x', '(<= y x)'],
    ['y >= x', '(>= y x)'],
    ['y ≤ x', '(<= y x)'],
    ['y ≥ x', '(>= y x)'],
    ['x^2 + y^2 < 1', '(< (+ (^ x 2) (^ y 2)) 1)'],
    ['x^2 = y', '(= (^ x 2) y)'],
    ['0 < y', '(< 0 y)'],
    ['r = 1 + cos θ', '(= r (+ 1 (cos θ)))'],
    ['r = 1 + cos theta', '(= r (+ 1 (cos θ)))'],
    ['(1, 2)', '(tuple 1 2)'],
    ['(1,2),(3,4)', '(points (tuple 1 2) (tuple 3 4))'],
    ['(1,2), (3,4), (5,6)', '(points (tuple 1 2) (tuple 3 4) (tuple 5 6))'],
    ['1, 2', '(points 1 2)'],
    ['(cos t, sin t)', '(tuple (cos t) (sin t))'],
    ['(t, t^2, 1)', '(tuple t (^ t 2) 1)'],
    ['((1, 2), 3)', '(tuple (tuple 1 2) 3)'],
  ])('%j → %s', (source, expected) => {
    expect(p(source)).toBe(expected);
  });

  it('records the relation operator span', () => {
    const s = statement('y  <= x');
    expect(s).toMatchObject({ type: 'relation', op: '<=', opSpan: { start: 3, end: 5 } });
  });
});

describe('parse: precedence and associativity', () => {
  it.each([
    ['1 + 2 - 3', '(- (+ 1 2) 3)'],
    ['1 - 2 - 3', '(- (- 1 2) 3)'],
    ['2 * 3 / 4', '(/ (* 2 3) 4)'],
    ['2 / 3 / 4', '(/ (/ 2 3) 4)'],
    ['1 + 2 * 3', '(+ 1 (* 2 3))'],
    ['x^2', '(^ x 2)'],
    ['2^3^2', '(^ 2 (^ 3 2))'],
    ['-x^2', '(neg (^ x 2))'],
    ['-x!', '(neg (! x))'],
    ['-2x', '(* (neg 2) x)'],
    ['+x', '(pos x)'],
    ['--x', '(neg (neg x))'],
    ['2*-3', '(* 2 (neg 3))'],
    ['2 - -3', '(- 2 (neg 3))'],
    ['2^-x^2', '(^ 2 (neg (^ x 2)))'],
    ['e^-x^2', '(^ e (neg (^ x 2)))'],
    ['2^-x+1', '(+ (^ 2 (neg x)) 1)'],
    ['x^2y', '(* (^ x 2) y)'],
    ['e^2x', '(* (^ e 2) x)'],
    ['2^3!', '(^ 2 (! 3))'],
    ['x!', '(! x)'],
    ['x!!', '(! (! x))'],
    ['x!^2', '(^ (! x) 2)'],
    ['3!x', '(* (! 3) x)'],
    ['(x+1)^2', '(^ (+ x 1) 2)'],
    ['x**2', '(^ x 2)'],
    ['x·y', '(* x y)'],
    ['6÷2', '(/ 6 2)'],
    ['2−x', '(- 2 x)'],
  ])('%j → %s', (source, expected) => {
    expect(p(source)).toBe(expected);
  });
});

describe('parse: implicit multiplication', () => {
  it.each([
    ['2x', '(* 2 x)'],
    ['2 x', '(* 2 x)'],
    ['2(x+1)', '(* 2 (+ x 1))'],
    ['2(3)', '(* 2 3)'],
    ['(2)(3)', '(* 2 3)'],
    ['2sin x', '(* 2 (sin x))'],
    ['2|x|', '(* 2 (abs x))'],
    ['(x+1)(x-1)', '(* (+ x 1) (- x 1))'],
    ['xy', '(* x y)'],
    ['x y', '(* x y)'],
    ['a b c', '(* (* a b) c)'],
    ['2xy', '(* (* 2 x) y)'],
    ['2x^2', '(* 2 (^ x 2))'],
    ['2x!', '(* 2 (! x))'],
    ['1/2x', '(* (/ 1 2) x)'],
    ['x/2y', '(* (/ x 2) y)'],
    ['2x/3', '(/ (* 2 x) 3)'],
    ['2πr', '(* (* 2 pi) r)'],
    ['πr^2', '(* pi (^ r 2))'],
    ['pix', '(* pi x)'],
    ['ex', '(* e x)'],
    ['2e', '(* 2 e)'],
    ['x sin x', '(* x (sin x))'],
    ['sin(x)(x+1)', '(* (sin x) (+ x 1))'],
    ['x(2)', '(* x 2)'],
    ['a(x+1)', '(* a (+ x 1))'],
    ['g(x)', '(* g x)'],
    ['e(x+1)', '(* e (+ x 1))'],
    ['y = 2e - 3', '(= y (- (* 2 e) 3))'],
  ])('%j → %s', (source, expected) => {
    expect(p(source)).toBe(expected);
  });

  it('marks implicit products', () => {
    const node = expr('2x');
    expect(node).toMatchObject({ type: 'binary', op: '*', implicit: true });
    expect(expr('2*x')).not.toHaveProperty('implicit');
  });
});

describe('parse: builtin functions', () => {
  it.each([
    ['sin(x)', '(sin x)'],
    ['sin (x)', '(sin x)'],
    ['sin x', '(sin x)'],
    ['sinx', '(sin x)'],
    ['3sin x', '(* 3 (sin x))'],
    ['sin 2x', '(sin (* 2 x))'],
    ['sin2x', '(sin (* 2 x))'],
    ['sin x^2', '(sin (^ x 2))'],
    ['sin x cos x', '(* (sin x) (cos x))'],
    ['sinxcosx', '(* (sin x) (cos x))'],
    ['sin x / 2', '(/ (sin x) 2)'],
    ['sin x * 2', '(* (sin x) 2)'],
    ['sin 2x + 1', '(+ (sin (* 2 x)) 1)'],
    ['sin x + cos x', '(+ (sin x) (cos x))'],
    ['ln x y', '(ln (* x y))'],
    ['sin 2xy', '(sin (* (* 2 x) y))'],
    ['sin 2(x+1)', '(sin (* 2 (+ x 1)))'],
    ['sin x^2y', '(sin (* (^ x 2) y))'],
    ['sin -x', '(sin (neg x))'],
    ['sin -2x', '(sin (* (neg 2) x))'],
    ['sin x!', '(sin (! x))'],
    ['sin sin x', '(sin (sin x))'],
    ['sinsinx', '(sin (sin x))'],
    ['ln|x|', '(ln (abs x))'],
    ['sin|x|', '(sin (abs x))'],
    ['sin(x)^2', '(^ (sin x) 2)'],
    ['sin (2)x', '(* (sin 2) x)'],
    ['asinx', '(asin x)'],
    ['a sin x', '(* a (sin x))'],
    ['exp x', '(exp x)'],
    ['sech x', '(sech x)'],
    ['sinhx', '(sinh x)'],
    ['cost', '(cos t)'],
    ['log 2x', '(log (* 2 x))'],
    ['max(1, 2)', '(max 1 2)'],
    ['max(1, 2, 3)', '(max 1 2 3)'],
    ['min(x, -x)', '(min x (neg x))'],
    ['atan(y, x)', '(atan y x)'],
    ['atan(x)', '(atan x)'],
    ['mod(x, 3)', '(mod x 3)'],
    ['√x', '(sqrt x)'],
    ['√(x+1)', '(sqrt (+ x 1))'],
    ['2√x', '(* 2 (sqrt x))'],
    ['√2x', '(sqrt (* 2 x))'],
    ['∛x', '(cbrt x)'],
    ['sin theta', '(sin θ)'],
    ['sinθ', '(sin θ)'],
    ['sin x √x', '(* (sin x) (sqrt x))'],
  ])('%j → %s', (source, expected) => {
    expect(p(source)).toBe(expected);
  });

  it.each([
    ['sin^2 x', '(^ (sin x) 2)'],
    ['sin^2(x)', '(^ (sin x) 2)'],
    ['sin^2x', '(^ (sin x) 2)'],
    ['sin^(2) x', '(^ (sin x) 2)'],
    ['sin^-2 x', '(^ (sin x) (neg 2))'],
    ['sin^a x', '(^ (sin x) a)'],
    ['cos^2 x + sin^2 x', '(+ (^ (cos x) 2) (^ (sin x) 2))'],
    ['sin^2 x cos x', '(* (^ (sin x) 2) (cos x))'],
    ['2sin^2 x', '(* 2 (^ (sin x) 2))'],
  ])('function power %j → %s', (source, expected) => {
    expect(p(source)).toBe(expected);
  });

  it('builds call nodes with the power field', () => {
    const node = expr('sin^2 x');
    expect(node).toMatchObject({ type: 'call', callee: 'sin', calleeKind: 'builtinFn' });
    expect(node.type === 'call' && node.power).toMatchObject({ type: 'num', value: 2 });
    expect(expr('sin x')).not.toHaveProperty('power');
  });
});

describe('parse: absolute value', () => {
  it.each([
    ['|x|', '(abs x)'],
    ['2|x|', '(* 2 (abs x))'],
    ['|x|+|y|', '(+ (abs x) (abs y))'],
    ['|x||y|', '(* (abs x) (abs y))'],
    ['||x|-1|', '(abs (- (abs x) 1))'],
    ['|-x|', '(abs (neg x))'],
    ['|x|^2', '(^ (abs x) 2)'],
    ['|x|y', '(* (abs x) y)'],
    ['x|y|', '(* x (abs y))'],
    ['|x y|', '(abs (* x y))'],
    ['|2x - |x||', '(abs (- (* 2 x) (abs x)))'],
    ['|sin x|', '(abs (sin x))'],
    ['|x|(x+1)', '(* (abs x) (+ x 1))'],
    ['(|x|)', '(abs x)'],
    ['|(x)|', '(abs x)'],
    ['|a(b|c|)|', '(abs (* a (* b (abs c))))'],
    ['abs(x)', '(abs x)'],
    ['abs x', '(abs x)'],
  ])('%j → %s', (source, expected) => {
    expect(p(source)).toBe(expected);
  });
});

describe('parse: user names', () => {
  it.each([
    ['xy', 'xy'],
    ['2xy', '(* 2 xy)'],
    ['a(x+1)', '(* a (+ x 1))'],
    ['f(x+1)', '(call f (+ x 1))'],
    ['f(x)^2', '(^ (call f x) 2)'],
    ['f^2(x)', '(^ (call f x) 2)'],
    ['2f(x)', '(* 2 (call f x))'],
    ['xf(x)', '(* x (call f x))'],
    ['af(x)', '(* a (call f x))'],
    ['g(1, 2)', '(call g 1 2)'],
    ['h(1, 2, 3)', '(call h 1 2 3)'],
    ['f(f(x))', '(call f (call f x))'],
    ['sin x f(x)', '(* (sin x) (call f x))'],
    ['speed t', '(* speed t)'],
    ['speedt', '(* speed t)'],
    ['a_1 x', '(* a_1 x)'],
    ['ka_1', '(* k a_1)'],
    ['y = a sin(b x)', '(= y (* a (sin (* b x))))'],
  ])('%j → %s', (source, expected) => {
    expect(p(source, USER)).toBe(expected);
  });

  it('resolves name kinds', () => {
    const kinds = (source: string, ctx: NameContext) => {
      const out: string[] = [];
      walk(expr(source, ctx), (n) => {
        if (n.type === 'name') out.push(`${n.name}:${n.kind}`);
      });
      return out;
    };
    expect(kinds('a b x pi c', USER)).toEqual([
      'a:userVar',
      'b:userVar',
      'x:plotVar',
      'pi:const',
      'c:unknown',
    ]);
    expect(kinds('a x', ctxOf(['a'], {}, ['a']))).toEqual(['a:param', 'x:plotVar']);
    expect(kinds('u v', ctxOf([], {}, ['u', 'v']))).toEqual(['u:param', 'v:param']);
  });

  it('params shadow user functions', () => {
    expect(p('f(x+1)', ctxOf([], { f: 1 }, ['f']))).toBe('(* f (+ x 1))');
  });

  it('parses function definitions when the row name and params are in context', () => {
    const ctx = ctxOf(['a'], { f: 1, g: 2 }, ['x']);
    expect(p('f(x) = x^2', ctx)).toBe('(= (call f x) (^ x 2))');
    expect(p('g(u, v) = u + v', ctxOf([], { g: 2 }, ['u', 'v']))).toBe('(= (call g u v) (+ u v))');
    expect(p('a = 2', ctx)).toBe('(= a 2)');
  });

  it('marks user calls', () => {
    expect(expr('f(x)', USER)).toMatchObject({ type: 'call', callee: 'f', calleeKind: 'userFn' });
  });
});

describe('parse: review regressions', () => {
  const SLIDERS = ctxOf(['a', 'b', 'c', 'n', 'm_1', 'a_1']);

  it.each([
    // `a` + trig name reads as a·trig once the user defines a.
    ['y = asin(bx) + c', '(= y (+ (* a (sin (* b x))) c))'],
    ['y = acos x', '(= y (* a (cos x)))'],
    ['y = arcsin(x)', '(= y (arcsin x))'],
    // `theta` inside a letter run.
    ['r = atheta', '(= r (* a θ))'],
    ['r = 2costheta', '(= r (* 2 (cos θ)))'],
    ['r = 1 + sintheta', '(= r (+ 1 (sin θ)))'],
    ['r = cos(ntheta)', '(= r (cos (* n θ)))'],
    // A digit subscript ends at the first non-digit.
    ['y = a_1x', '(= y (* a_1 x))'],
    ['y = m_1x + b', '(= y (+ (* m_1 x) b))'],
    // Pasted superscripts.
    ['x² + y² = 1', '(= (+ (^ x 2) (^ y 2)) 1)'],
    ['y = sin²x', '(= y (^ (sin x) 2))'],
    ['y = x⁻¹', '(= y (^ x (neg 1)))'],
    ['y = 2^x²', '(= y (^ 2 (^ x 2)))'],
  ])('%s → %s', (source, expected) => {
    expect(p(source, SLIDERS)).toBe(expected);
  });

  it('asin is still the inverse sine without a user a', () => {
    expect(p('y = asin(bx)', ctxOf(['b']))).toBe('(= y (asin (* b x)))');
  });

  it('suggests arcsin for sin^-1 when a is a user variable', () => {
    expect(err('sin^-1 x', SLIDERS).message).toBe('Use arcsin(x) for the inverse sine');
    expect(err('sin⁻¹x', SLIDERS).message).toBe('Use arcsin(x) for the inverse sine');
    expect(err('sec^-1 x', SLIDERS).message).toBe("sec^-1 isn't supported");
  });

  it('1e-3 is a bad number, not 1·e − 3', () => {
    expect(err('y = 1e-3x')).toMatchObject({ code: 'bad-number', span: { start: 4, end: 8 } });
    expect(p('y = 1e - 3x')).toBe('(= y (- (* 1 e) (* 3 x)))');
  });

  it('a leading superscript has a sensible error', () => {
    expect(err('²')).toMatchObject({ code: 'expected-expr', span: { start: 0, end: 1 } });
  });
});

describe('parse: spans', () => {
  it('covers the full source extent of every node', () => {
    const node = expr('2(x+1)');
    expect(node.span).toEqual({ start: 0, end: 6 });
    if (node.type !== 'binary') throw new Error('expected binary');
    expect(node.right.span).toEqual({ start: 2, end: 5 });
    expect(expr('(x+1)^2').span).toEqual({ start: 0, end: 7 });
    expect(expr(' -x ').span).toEqual({ start: 1, end: 3 });
    expect(expr('sin x').span).toEqual({ start: 0, end: 5 });
    expect(expr('sin^2 x').span).toEqual({ start: 0, end: 7 });
    expect(expr('max(1, 2)').span).toEqual({ start: 0, end: 9 });
    expect(expr('|x|').span).toEqual({ start: 0, end: 3 });
    expect(expr('x!').span).toEqual({ start: 0, end: 2 });
    expect(expr('(1, 2)').span).toEqual({ start: 0, end: 6 });
    expect(expr('2πr').span).toEqual({ start: 0, end: 3 });
  });

  it('keeps original offsets for normalized names', () => {
    const node = expr('2 theta');
    if (node.type !== 'binary') throw new Error('expected binary');
    expect(node.right).toEqual({
      type: 'name',
      name: 'θ',
      kind: 'plotVar',
      span: { start: 2, end: 7 },
    });
  });

  it('split names get their own spans', () => {
    const node = expr('sinx');
    expect(node).toMatchObject({ type: 'call', span: { start: 0, end: 4 } });
    if (node.type !== 'call') throw new Error('expected call');
    expect(node.args[0]?.span).toEqual({ start: 3, end: 4 });
  });

  it('num nodes carry their value and literal span', () => {
    const s = statement('a = 2.50', USER);
    if (s.type !== 'relation') throw new Error('expected relation');
    expect(s.right).toEqual({ type: 'num', value: 2.5, span: { start: 4, end: 8 } });
  });
});

describe('parse: errors', () => {
  it.each([
    ['2+', 'expected-expr', 1, 2],
    ['2 + ', 'expected-expr', 2, 3],
    ['2^', 'expected-expr', 1, 2],
    ['2+*3', 'expected-expr', 2, 3],
    ['*3', 'expected-expr', 0, 1],
    ['=2', 'expected-expr', 0, 1],
    ['y = = 2', 'expected-expr', 4, 5],
    ['y =', 'expected-expr', 2, 3],
    ['(1, )', 'expected-expr', 4, 5],
    ['(1,2),', 'expected-expr', 5, 6],
    ['sin(', 'missing-rparen', 3, 4],
    ['(', 'missing-rparen', 0, 1],
    ['(x+1', 'missing-rparen', 0, 1],
    ['((x)', 'missing-rparen', 0, 1],
    ['f(x', 'missing-rparen', 1, 2],
    [')', 'unexpected-rparen', 0, 1],
    ['x)', 'unexpected-rparen', 1, 2],
    ['2+)', 'unexpected-rparen', 2, 3],
    ['sin(x))', 'unexpected-rparen', 6, 7],
    ['(x = 2)', 'unexpected-token', 3, 4],
    ['x2', 'missing-operator', 1, 2],
    ['2 3', 'missing-operator', 2, 3],
    ['(x+1)2', 'missing-operator', 5, 6],
    ['x^2 3', 'missing-operator', 4, 5],
    ['|x|2', 'missing-operator', 3, 4],
    ['x!2', 'missing-operator', 2, 3],
    ['sin x 2', 'missing-operator', 6, 7],
    ['2e3', 'missing-operator', 2, 3],
    ['max x', 'fn-needs-call', 0, 3],
    ['mod 5', 'fn-needs-call', 0, 3],
    ['f x', 'fn-needs-call', 0, 1],
    ['f', 'fn-needs-call', 0, 1],
    ['2f', 'fn-needs-call', 1, 2],
    ['f^2 x', 'fn-needs-call', 0, 1],
    ['sin', 'fn-needs-call', 0, 3],
    ['sin + 1', 'fn-needs-call', 0, 3],
    ['sin^2', 'fn-needs-call', 0, 5],
    ['sin(x, y)', 'arity', 0, 9],
    ['sin()', 'arity', 0, 5],
    ['min(1)', 'arity', 0, 6],
    ['arctan(1, 2, 3)', 'arity', 0, 15],
    ['f(1, 2)', 'arity', 0, 7],
    ['g(1)', 'arity', 0, 4],
    ['sin^-1 x', 'use-inverse', 0, 6],
    ['cos^(-1)(x)', 'use-inverse', 0, 8],
    ['ln^-1 x', 'use-inverse', 0, 5],
    ['sin^', 'expected-expr', 3, 4],
    ['sin^ x', 'fn-needs-call', 0, 6],
    ['sin^sin x', 'expected-expr', 4, 7],
    ['|x', 'missing-pipe', 0, 1],
    ['|', 'missing-pipe', 0, 1],
    ['x|', 'missing-pipe', 1, 2],
    ['(|x)', 'missing-pipe', 1, 2],
    ['|1, 2|', 'missing-pipe', 0, 1],
    ['0<y<1', 'chained-relation', 3, 4],
    ['a = b = c', 'chained-relation', 6, 7],
    ['y = 1, 2', 'list-relation', 5, 6],
    ['1, 2 = y', 'list-relation', 5, 6],
    ['()', 'empty-parens', 0, 2],
    ['2( )', 'empty-parens', 1, 4],
    ['y==2', 'double-equals', 1, 3],
    ['1.2.3', 'bad-number', 0, 5],
    ['[1, 2]', 'unsupported', 0, 1],
    ['x ≠ 2', 'unsupported', 2, 3],
    ['y = $', 'unexpected-char', 4, 5],
  ])('%j → %s [%i, %i)', (source, code, start, end) => {
    const error = err(source, USER);
    expect(error.code).toBe(code);
    expect(error.span).toEqual({ start, end });
    expect(error.message.length).toBeGreaterThan(0);
  });

  it('has friendly messages and hints', () => {
    expect(err('2+').message).toBe("Expected an expression after '+'");
    expect(err('sin(').message).toBe("Missing ')'");
    expect(err('x2').hint).toBe('Did you mean x^2 or 2x?');
    expect(err('(x+1)2').hint).toBe('Did you mean (x+1)^2 or 2(x+1)?');
    expect(err('2e3').hint).toBe("Scientific notation isn't supported; write 2*10^3");
    expect(err('1.5e10').hint).toContain('1.5*10^10');
    expect(err('f x', USER).message).toBe("'f' is a function, so call it like f(x)");
    expect(err('g', USER).message).toBe("'g' is a function, so call it like g(a, b)");
    expect(err('max x').message).toBe("'max' is a function, so call it like max(a, b)");
    expect(err('sin(x, y)').message).toBe('sin takes 1 argument, got 2');
    expect(err('min(1)').message).toBe('min takes 2 or more arguments, got 1');
    expect(err('atan(1, 2, 3)').message).toBe('atan takes 1 or 2 arguments, got 3');
    expect(err('f(1, 2)', USER).message).toBe('f takes 1 argument, got 2');
    expect(err('sin^-1 x').message).toBe('Use asin(x) for the inverse sine');
    expect(err('tanh^-1 x').message).toBe('Use atanh(x) for the inverse hyperbolic tangent');
    expect(err('0<y<1').message).toBe("Chained inequalities aren't supported yet");
    expect(err('()').message).toBe('Empty parentheses');
  });

  it('turns internal failures into an internal error instead of throwing', () => {
    const broken: NameContext = {
      vars: {
        has() {
          throw new Error('boom');
        },
      } as unknown as ReadonlySet<string>,
      fns: new Map(),
    };
    const r = parse('a + 1', broken);
    expect(r).toMatchObject({ ok: false, error: { code: 'internal' } });
  });

  it('rejects absurd nesting without overflowing the stack', () => {
    const deep = `${'('.repeat(5000)}x${')'.repeat(5000)}`;
    expect(err(deep).code).toBe('too-deep');
    expect(err(`${'-'.repeat(5000)}x`).code).toBe('too-deep');
    expect(err(`${'2^'.repeat(5000)}2`).code).toBe('too-deep');
    expect(p(`${'('.repeat(100)}x${')'.repeat(100)}`)).toBe('x');
  });

  it('handles long flat inputs', () => {
    const sum = Array.from({ length: 5000 }, (_, i) => `x^${i % 7}`).join(' + ');
    expect(parse(sum).ok).toBe(true);
    expect(parse('xy'.repeat(3000)).ok).toBe(true);
  });
});

describe('ast helpers', () => {
  it('walk visits every node in pre-order', () => {
    const seen: string[] = [];
    walk(expr('sin^2(x) + |y|'), (n) => {
      seen.push(n.type === 'name' ? n.name : n.type === 'num' ? String(n.value) : n.type);
    });
    expect(seen).toEqual(['binary', 'call', 'x', '2', 'call', 'y']);
  });

  it('walkStatement covers both sides of a relation and every list item', () => {
    const names: string[] = [];
    const collect = (n: Node) => {
      if (n.type === 'name') names.push(n.name);
    };
    walkStatement(statement('y = a x'), collect);
    walkStatement(statement('(a, b), (c, d)'), collect);
    walkStatement(statement(''), collect);
    expect(names).toEqual(['y', 'a', 'x', 'a', 'b', 'c', 'd']);
  });

  it.each([
    ['1/3', { p: 1, q: 3 }],
    ['(2/5)', { p: 2, q: 5 }],
    ['-1/3', { p: -1, q: 3 }],
    ['-(1/3)', { p: -1, q: 3 }],
    ['1/-3', { p: -1, q: 3 }],
    ['1/3.5', null],
    ['1.5/3', null],
    ['x/3', null],
    ['1/0', null],
    ['3', null],
  ])('literalFraction(%s)', (source, expected) => {
    expect(literalFraction(expr(source))).toEqual(expected);
  });

  it('literalFraction sees through exponent parentheses', () => {
    const node = expr('(-8)^(1/3)');
    if (node.type !== 'binary') throw new Error('expected binary');
    expect(literalFraction(node.right)).toEqual({ p: 1, q: 3 });
  });

  it('printNode prints single nodes', () => {
    expect(printNode(expr('-(x^2)'))).toBe('(neg (^ x 2))');
    expect(printNode(expr('f(x-1)', USER))).toBe('(call f (- x 1))');
  });
});

// ---- fuzz ----

const KNOWN_CODES = new Set([
  'unexpected-char',
  'bad-number',
  'bad-subscript',
  'unsupported',
  'double-equals',
  'bad-relation',
  'missing-rparen',
  'unexpected-rparen',
  'expected-expr',
  'unexpected-token',
  'missing-operator',
  'arity',
  'fn-needs-call',
  'use-inverse',
  'missing-pipe',
  'chained-relation',
  'list-relation',
  'empty-parens',
  'too-deep',
]);

function spanProblem(span: Span | undefined, length: number, parent?: Span): string | null {
  if (span === undefined) return 'missing span';
  if (!(span.start >= 0 && span.start <= span.end && span.end <= length)) return 'out of range';
  if (parent && (span.start < parent.start || span.end > parent.end)) return 'outside parent';
  return null;
}

function nodeProblem(node: Node, length: number, parent?: Span): string | null {
  const own = spanProblem(node.span, length, parent);
  if (own) return `${node.type}: ${own}`;
  const children: Node[] = [];
  switch (node.type) {
    case 'unary':
    case 'postfix':
      children.push(node.arg);
      break;
    case 'binary':
      children.push(node.left, node.right);
      break;
    case 'call':
      children.push(...node.args);
      if (node.power) children.push(node.power);
      break;
    case 'tuple':
      children.push(...node.items);
      break;
    default:
      break;
  }
  for (const child of children) {
    const problem = nodeProblem(child, length, node.span);
    if (problem) return problem;
  }
  return null;
}

describe('fuzz', () => {
  it('parse() never throws, terminates quickly and reports valid spans', () => {
    const rand = mulberry32(0x5eed);
    const contexts = [EMPTY_CONTEXT, USER, ctxOf(['a'], { f: 1 }, ['x', 'a'])];
    const failures: string[] = [];
    let ok = 0;
    const started = Date.now();

    for (let i = 0; i < 10_000; i++) {
      const source = randomSource(rand);
      const ctx = contexts[i % contexts.length] as NameContext;

      let result: ReturnType<typeof parse>;
      try {
        result = parse(source, ctx);
      } catch (e) {
        failures.push(`${JSON.stringify(source)} threw ${String(e)}`);
        continue;
      }
      if (result.ok) {
        ok++;
        const s = result.statement;
        const roots = s.type === 'exprs' ? s.items : s.type === 'relation' ? [s.left, s.right] : [];
        for (const root of roots) {
          const problem = nodeProblem(root, source.length);
          if (problem) failures.push(`${JSON.stringify(source)}: ${problem}`);
        }
        printStatement(s);
      } else {
        const { error } = result;
        if (!KNOWN_CODES.has(error.code) || error.message.length === 0) {
          failures.push(`${JSON.stringify(source)}: ${error.code} ${error.message}`);
        }
        const problem = spanProblem(error.span, source.length);
        if (problem) failures.push(`${JSON.stringify(source)}: error span ${problem}`);
      }

      try {
        detectDefinition(source);
      } catch (e) {
        failures.push(`${JSON.stringify(source)}: detectDefinition threw ${String(e)}`);
      }
      try {
        tokenize(source);
      } catch (e) {
        if (!(e instanceof MathSyntaxError)) failures.push(`tokenize threw ${String(e)}`);
      }
    }

    expect(failures.slice(0, 20)).toEqual([]);
    // The generator must exercise successful parses too, not only errors.
    expect(ok).toBeGreaterThan(3000);
    expect(Date.now() - started).toBeLessThan(5000);
  });
});
