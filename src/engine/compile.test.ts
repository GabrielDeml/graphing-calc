import { describe, expect, it } from 'vitest';
import type { Node } from './ast';
import { factorial } from './builtins';
import {
  type CompileEnv,
  CompileError,
  compile0,
  compile1,
  compile2,
  compileExpr,
  type UserFunction,
} from './compile';
import { EMPTY_CONTEXT, type NameContext } from './names';
import { parse } from './parser';

function ctxOf(vars: string[] = [], fns: Record<string, number> = {}, params?: string[]) {
  const ctx: NameContext = { vars: new Set(vars), fns: new Map(Object.entries(fns)) };
  if (params) ctx.params = params;
  return ctx;
}

/** The single expression of `source`. */
function expr(source: string, ctx: NameContext = EMPTY_CONTEXT): Node {
  const r = parse(source, ctx);
  if (!r.ok) throw new Error(`${source}: ${r.error.message}`);
  const s = r.statement;
  if (s.type !== 'exprs' || s.items.length !== 1) throw new Error(`${source}: not one expression`);
  return s.items[0];
}

interface EnvSpec {
  vars?: Record<string, number>;
  /** name → [params, body source] */
  fns?: Record<string, [string[], string]>;
  budget?: number;
}

function makeEnv(spec: EnvSpec = {}): { env: CompileEnv; ctx: NameContext } {
  const varNames = Object.keys(spec.vars ?? {});
  const fnArity: Record<string, number> = {};
  for (const [name, [params]] of Object.entries(spec.fns ?? {})) fnArity[name] = params.length;
  const ctx = ctxOf(varNames, fnArity);
  const globals = new Float64Array(Math.max(1, varNames.length));
  const globalSlots = new Map<string, number>();
  varNames.forEach((name, i) => {
    globals[i] = spec.vars?.[name] ?? 0;
    globalSlots.set(name, i);
  });
  const functions = new Map<string, UserFunction>();
  for (const [name, [params, body]] of Object.entries(spec.fns ?? {})) {
    functions.set(name, { params, body: expr(body, ctxOf(varNames, fnArity, params)) });
  }
  const env: CompileEnv = { globals, globalSlots, functions };
  return { env: spec.budget === undefined ? env : { ...env, budget: spec.budget }, ctx };
}

function expectSame(actual: number, expected: number, label: string): void {
  if (Number.isNaN(expected) || !Number.isFinite(expected) || expected === 0) {
    expect(actual + 0, label).toBe(expected + 0);
  } else {
    expect(Math.abs(actual - expected) / Math.abs(expected), label).toBeLessThan(1e-13);
  }
}

const XS = [-8, -2.5, -1, -0.5, 0, 0.3, 1, 2, 7.25];

describe('compile1: matches hand-written JS', () => {
  const table: [string, (x: number) => number][] = [
    ['x', (x) => x],
    ['x^2 + 3x - 1', (x) => x * x + 3 * x - 1],
    ['2 - x', (x) => 2 - x],
    ['x - 2 - 3', (x) => x - 2 - 3],
    ['10 / x', (x) => 10 / x],
    ['x / 4', (x) => x / 4],
    ['3/x/2', (x) => 3 / x / 2],
    ['2 * x * 5', (x) => 2 * x * 5],
    ['x * x - x / x', (x) => x * x - x / x],
    ['-x^2', (x) => -(x * x)],
    ['+x', (x) => x],
    ['(x + 1)(x - 1)', (x) => (x + 1) * (x - 1)],
    ['sin(x)', Math.sin],
    ['sin x cos x', (x) => Math.sin(x) * Math.cos(x)],
    ['sin^2 x', (x) => Math.sin(x) ** 2],
    ['tan(2x)', (x) => Math.tan(2 * x)],
    ['2^x', (x) => 2 ** x],
    ['e^x', Math.exp],
    ['e^-x^2', (x) => Math.exp(-(x * x))],
    ['x^x', (x) => x ** x],
    ['(x+1)^(x-1)', (x) => (x + 1) ** (x - 1)],
    ['x^3', (x) => x * x * x],
    ['x^4', (x) => x * x * x * x],
    ['x^-2', (x) => 1 / (x * x)],
    ['x^(-1)', (x) => 1 / x],
    ['x^0.5', Math.sqrt],
    ['x^1.5', (x) => x ** 1.5],
    ['x^1', (x) => x],
    ['sqrt(x)', Math.sqrt],
    ['√(x + 9)', (x) => Math.sqrt(x + 9)],
    ['cbrt(x)', Math.cbrt],
    ['|x - 1|', (x) => Math.abs(x - 1)],
    ['ln(x)', Math.log],
    ['log(x)', Math.log10],
    ['exp(x/2)', (x) => Math.exp(x / 2)],
    ['floor(x) + ceil(x)', (x) => Math.floor(x) + Math.ceil(x)],
    ['round(x)', (x) => (x < 0 ? -Math.round(-x) : Math.round(x))],
    ['mod(x, 3)', (x) => x - 3 * Math.floor(x / 3)],
    ['max(x, 0, -x)', (x) => Math.max(x, 0, -x)],
    ['min(x, 1)', (x) => Math.min(x, 1)],
    ['atan(x, 2)', (x) => Math.atan2(x, 2)],
    ['x!', factorial],
    ['2pi x', (x) => 2 * Math.PI * x],
    ['tau + e x', (x) => 2 * Math.PI + Math.E * x],
    ['sec x + csc x', (x) => 1 / Math.cos(x) + 1 / Math.sin(x)],
    ['1/x', (x) => 1 / x],
  ];

  it.each(table)('%s', (source, ref) => {
    const { env } = makeEnv();
    const f = compile1(expr(source), 'x', env);
    for (const x of XS) expectSame(f(x), ref(x), `${source} at x=${x}`);
  });

  it('sin²x + cos²x is 1', () => {
    const f = compile1(expr('sin^2 x + cos^2 x'), 'x', makeEnv().env);
    for (const x of XS) expect(f(x)).toBeCloseTo(1, 14);
  });

  it('never throws at evaluation time', () => {
    const { env } = makeEnv();
    expect(compile1(expr('1/x'), 'x', env)(0)).toBe(Number.POSITIVE_INFINITY);
    expect(compile1(expr('-1/x'), 'x', env)(0)).toBe(Number.NEGATIVE_INFINITY);
    expect(compile1(expr('ln(x)'), 'x', env)(-1)).toBeNaN();
    expect(compile1(expr('sqrt(x)'), 'x', env)(-4)).toBeNaN();
    expect(compile1(expr('x!'), 'x', env)(-2)).toBeNaN();
    expect(compile1(expr('0/x'), 'x', env)(0)).toBeNaN();
  });
});

describe('compile2 and compile0', () => {
  it('evaluates two-variable expressions', () => {
    const F = compile2(expr('x^2 + y^2 - 1'), 'x', 'y', makeEnv().env);
    expect(F(1, 0)).toBe(0);
    expect(F(0, 0)).toBe(-1);
    expect(F(2, 3)).toBe(12);
    const G = compile2(expr('x - y'), 'x', 'y', makeEnv().env);
    expect(G(5, 2)).toBe(3);
    expect(G(2, 5)).toBe(-3);
  });

  it('evaluates constant expressions', () => {
    const { env } = makeEnv();
    expect(compile0(expr('1 + 2 * 3'), env)()).toBe(7);
    expect(compile0(expr('2pi'), env)()).toBe(2 * Math.PI);
    expect(compile0(expr('5!'), env)()).toBe(120);
  });

  it('binds variables by name, not position in the source', () => {
    const F = compile2(expr('y - 2x'), 'x', 'y', makeEnv().env);
    expect(F(1, 10)).toBe(8);
  });
});

describe('odd roots', () => {
  const { env } = makeEnv();
  it.each([
    ['(-8)^(1/3)', -2],
    ['(-8)^(2/3)', 4],
    ['(-8)^(-1/3)', -0.5],
    ['(-27)^(1/3)', -3],
    ['(-8)^(2/6)', -2],
    ['8^(1/3)', 2],
    ['(-32)^(1/5)', -2],
    ['(-32)^(3/5)', -8],
    ['(-8)^(4/3)', 16],
  ])('%s = %d', (source, expected) => {
    expect(compile0(expr(source), env)()).toBeCloseTo(expected, 12);
  });

  it('(-8)^(1/3) is exactly -2 and (-8)^(2/3) exactly 4', () => {
    expect(compile0(expr('(-8)^(1/3)'), env)()).toBe(-2);
    expect(compile0(expr('(-8)^(2/3)'), env)()).toBe(4);
  });

  it('applies to variables: x^(1/3) is a real cube root', () => {
    const f = compile1(expr('x^(1/3)'), 'x', env);
    expect(f(-8)).toBe(-2);
    expect(f(27)).toBe(3);
    expect(f(0)).toBe(0);
    const g = compile1(expr('x^(2/3)'), 'x', env);
    expect(g(-8)).toBe(4);
    const h = compile1(expr('x^(1/5)'), 'x', env);
    expect(h(-32)).toBeCloseTo(-2, 14);
  });

  it('even roots and non-literal exponents of negatives are NaN', () => {
    expect(compile0(expr('(-4)^(1/2)'), env)()).toBeNaN();
    expect(compile0(expr('(-8)^0.3'), env)()).toBeNaN();
    expect(compile1(expr('x^(1/4)'), 'x', env)(-16)).toBeNaN();
    // 1/3 computed from a variable is not a literal fraction.
    const v = makeEnv({ vars: { k: 3 } });
    expect(compile0(expr('(-8)^(1/k)', v.ctx), v.env)()).toBeNaN();
  });

  it('integer powers of negatives stay exact', () => {
    expect(compile1(expr('x^3'), 'x', env)(-2)).toBe(-8);
    expect(compile1(expr('x^(3/1)'), 'x', env)(-2)).toBe(-8);
    expect(compile1(expr('x^5'), 'x', env)(-2)).toBe(-32);
  });
});

describe('power specializations', () => {
  const { env } = makeEnv();
  it('x^2 is exactly x*x', () => {
    const f = compile1(expr('x^2'), 'x', env);
    for (const x of [0.1, 1 / 3, Math.PI, -7.3, 1e154, 123456.789]) expect(f(x)).toBe(x * x);
  });

  it('x^0 is 1 everywhere, even for NaN', () => {
    const f = compile1(expr('x^0'), 'x', env);
    expect(f(5)).toBe(1);
    expect(f(0)).toBe(1);
    expect(f(Number.NaN)).toBe(1);
  });

  it('x^0.5 is sqrt and x^(-1) is 1/x', () => {
    expect(compile1(expr('x^0.5'), 'x', env)(2)).toBe(Math.SQRT2);
    expect(compile1(expr('x^(-1)'), 'x', env)(4)).toBe(0.25);
    expect(compile1(expr('x^-1'), 'x', env)(-0)).toBe(Number.NEGATIVE_INFINITY);
  });

  it('a call with a power applies it to the result: sin^2 x = (sin x)^2', () => {
    const f = compile1(expr('sin^2 x'), 'x', env);
    expect(f(1)).toBe(Math.sin(1) * Math.sin(1));
    const g = compile1(expr('ln^(3) x'), 'x', env);
    expect(g(Math.E ** 2)).toBeCloseTo(8, 13);
  });
});

describe('constant folding', () => {
  it('folds constant expressions at compile time', () => {
    const { env } = makeEnv();
    const c = compileExpr(expr('sin(pi/2) + 2^3'), [], env);
    expect(c.isConstant).toBe(true);
    expect(c.constantValue).toBe(9);
    expect(c.registerCount).toBe(0);
    expect(c.evaluate(new Float64Array(0))).toBe(9);
  });

  it('a folded Fn1 ignores its input', () => {
    const f = compile1(expr('2^10 - 1'), 'x', makeEnv().env);
    expect(f(0)).toBe(1023);
    expect(f(Number.NaN)).toBe(1023);
  });

  it('does not fold anything that reads a variable or a global', () => {
    const { env, ctx } = makeEnv({ vars: { a: 2 } });
    expect(compileExpr(expr('x + 2*3'), ['x'], env).isConstant).toBe(false);
    expect(compileExpr(expr('a + 2*3', ctx), [], env).isConstant).toBe(false);
  });

  it('folds user-function calls with constant arguments, using no registers', () => {
    const { env, ctx } = makeEnv({ fns: { f: [['x'], 'x^2 + 1'], g: [['u', 'v'], 'u * v'] } });
    const c = compileExpr(expr('f(3) + g(2, f(1))', ctx), [], env);
    expect(c.isConstant).toBe(true);
    expect(c.constantValue).toBe(14);
    expect(c.registerCount).toBe(0);
  });

  it('allocates a register per non-constant argument of an inlined call', () => {
    const { env, ctx } = makeEnv({ fns: { g: [['u', 'v'], 'u * v'] } });
    const c = compileExpr(expr('g(x, 3)', ctx), ['x'], env);
    expect(c.isConstant).toBe(false);
    expect(c.registerCount).toBe(2);
    expect(compile1(expr('g(x, 3)', ctx), 'x', env)(5)).toBe(15);
  });

  it('a function whose body ignores its parameter folds even for variable arguments', () => {
    const { env, ctx } = makeEnv({ fns: { k: [['x'], '7'] } });
    const c = compileExpr(expr('k(x)', ctx), ['x'], env);
    expect(c.isConstant).toBe(true);
    expect(c.constantValue).toBe(7);
  });
});

describe('globals', () => {
  it('reads globals at call time, so changing a value needs no recompile', () => {
    const { env, ctx } = makeEnv({ vars: { a: 2, b: 1 } });
    const f = compile1(expr('a x^2 + b', ctx), 'x', env);
    expect(f(3)).toBe(19);
    env.globals[0] = 3;
    expect(f(3)).toBe(28);
    env.globals[1] = -1;
    expect(f(3)).toBe(26);
  });

  it('reads globals inside inlined function bodies too', () => {
    const { env, ctx } = makeEnv({ vars: { a: 2 }, fns: { f: [['x'], 'a x'] } });
    const g = compile0(expr('f(5)', ctx), env);
    expect(g()).toBe(10);
    env.globals[0] = 4;
    expect(g()).toBe(20);
  });
});

describe('user function inlining', () => {
  const spec: EnvSpec = {
    vars: { a: 100 },
    fns: {
      f: [['x'], 'x^2'],
      g: [['u', 'v'], 'u - v'],
      h: [['t'], 'f(t) + g(t, 1)'],
      s: [['a'], 'a + 1'],
      p: [['x', 'y', 'z'], 'x + 10y + 100z'],
    },
  };
  const { env, ctx } = makeEnv(spec);
  const f = (x: number) => x * x;
  const g = (u: number, v: number) => u - v;
  const h = (t: number) => f(t) + g(t, 1);

  it.each([
    ['f(x)', (x: number) => f(x)],
    ['f(x) + f(x + 1)', (x: number) => f(x) + f(x + 1)],
    ['f(f(x))', (x: number) => f(f(x))],
    ['g(x, 2)', (x: number) => g(x, 2)],
    ['g(2, x)', (x: number) => g(2, x)],
    ['g(f(x), x)', (x: number) => g(f(x), x)],
    ['h(f(x)) + g(x, f(2))', (x: number) => h(f(x)) + g(x, f(2))],
    ['h(h(x))', (x: number) => h(h(x))],
    ['p(x, 2x, x + 1)', (x: number) => x + 20 * x + 100 * (x + 1)],
    ['p(p(x, 1, 0), x, f(x))', (x: number) => x + 10 + 10 * x + 100 * x * x],
  ])('%s', (source, ref) => {
    const fn = compile1(expr(source, ctx), 'x', env);
    for (const x of XS) expectSame(fn(x), ref(x), `${source} at ${x}`);
  });

  it('parameters shadow globals of the same name', () => {
    expect(compile0(expr('s(2)', ctx), env)()).toBe(3);
    expect(compile1(expr('s(x) + a', ctx), 'x', env)(1)).toBe(102);
  });

  it('works in two-variable evaluators', () => {
    const F = compile2(expr('g(x, y) + f(y)', ctx), 'x', 'y', env);
    expect(F(5, 2)).toBe(7);
  });

  it('enforces the node budget across inlined bodies', () => {
    const fns: Record<string, [string[], string]> = { f_0: [['x'], 'x + 1'] };
    for (let k = 1; k <= 20; k++) fns[`f_${k}`] = [['x'], `f_${k - 1}(x) + f_${k - 1}(x)`];
    const big = makeEnv({ fns });
    expect(compile1(expr('f_5(x)', big.ctx), 'x', big.env)(1)).toBe(64);
    let error: unknown;
    try {
      compile1(expr('f_20(x)', big.ctx), 'x', big.env);
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(CompileError);
    expect((error as CompileError).error.code).toBe('too-complex');
    expect((error as CompileError).error.message).toBe('Expression too complex');
  });

  it('honours a custom budget', () => {
    const small = makeEnv({ budget: 10 });
    expect(() => compile1(expr('x+x+x+x+x+x'), 'x', small.env)).toThrow(CompileError);
    expect(compile1(expr('x+x+x'), 'x', small.env)(2)).toBe(6);
  });
});

describe('long chains', () => {
  /** A left-to-right chain `x op c1 op c2 …` and the same computation done sequentially in JS. */
  function chain(n: number, ops: string): [string, (x: number) => number] {
    const parts = ['x'];
    const steps: [string, number][] = [];
    for (let i = 0; i < n; i++) {
      const op = ops[i % ops.length];
      const c = (i % 7) + 1;
      parts.push(op, i % 5 === 0 ? 'x' : String(c));
      steps.push([op, i % 5 === 0 ? Number.NaN : c]);
    }
    const ref = (x: number) => {
      let v = x;
      for (const [op, c] of steps) {
        const operand = Number.isNaN(c) ? x : c;
        if (op === '+') v += operand;
        else if (op === '-') v -= operand;
        else if (op === '*') v *= operand;
        else v /= operand;
      }
      return v;
    };
    return [parts.join(' '), ref];
  }

  it.each([
    [10, '+-'],
    [40, '+-'],
    [5000, '+--'],
    [15000, '+-'],
    [10, '*/'],
    [40, '*/'],
    [5000, '**/'],
  ])('%d-term %s chains match left-to-right evaluation exactly', (n, ops) => {
    const [source, ref] = chain(n, ops);
    const f = compile1(expr(source), 'x', makeEnv().env);
    for (const x of [1, -2.5, 0.3]) expect(f(x)).toBe(ref(x));
  });

  it('folds an all-constant chain', () => {
    const c = compileExpr(expr(Array(10000).fill('1').join('+')), [], makeEnv().env);
    expect(c.isConstant).toBe(true);
    expect(c.constantValue).toBe(10000);
  });

  it('counts every node of a chain against the budget', () => {
    const { env } = makeEnv({ budget: 100 });
    expect(() => compile1(expr(Array(51).fill('x').join('+')), 'x', env)).toThrow(CompileError);
    expect(compile1(expr(Array(50).fill('x').join('+')), 'x', env)(1)).toBe(50);
  });

  it('mixes chains with other operators', () => {
    const f = compile1(expr(`${Array(100).fill('x^2').join(' - ')} + 2x/x*3`), 'x', makeEnv().env);
    expect(f(2)).toBe(4 - 99 * 4 + 6);
  });
});

describe('compile errors', () => {
  function codeOf(fn: () => unknown): string {
    try {
      fn();
    } catch (e) {
      if (e instanceof CompileError) return e.error.code;
      throw e;
    }
    return 'none';
  }

  it('rejects unknown names, tuples, and unbound plot variables', () => {
    const { env } = makeEnv();
    expect(codeOf(() => compile1(expr('k x'), 'x', env))).toBe('unknown-name');
    expect(codeOf(() => compile1(expr('sin((1, 2))'), 'x', env))).toBe('bad-tuple');
    expect(codeOf(() => compile1(expr('y'), 'x', env))).toBe('internal');
  });

  it('rejects calls to functions missing from the environment', () => {
    const { env } = makeEnv();
    const ctx = ctxOf([], { q: 1 });
    expect(codeOf(() => compile1(expr('q(x)', ctx), 'x', env))).toBe('internal');
  });
});
