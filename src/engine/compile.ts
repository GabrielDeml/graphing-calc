// AST → closure tree. No `new Function`/eval, so the app runs under a CSP without 'unsafe-eval'.
//
// Each compiled evaluator owns a Float64Array register file. Its inputs (x, y, t, θ, or a
// function's parameters) live in registers 0..n-1, and every inlined user-function call site gets
// fresh registers for its parameters. User variables are read at call time from one shared
// `globals` array owned by the document, so moving a slider never requires recompiling.
//
// Subtrees without registers or globals are folded to constants at compile time, by building the
// same closure that would run and calling it once, so folded and unfolded code agree exactly.

import {
  type BinaryNode,
  type CallNode,
  literalFraction,
  type NameNodeKind,
  type Node,
} from './ast';
import { BUILTIN_CONSTANTS } from './builtinNames';
import { builtinImpl, factorial } from './builtins';
import { mathError } from './errors';
import type { Fn0, Fn1, Fn2, MathError } from './types';

/** A user function, inlined at every call site. Cycles must be rejected before compiling. */
export interface UserFunction {
  readonly params: readonly string[];
  readonly body: Node;
}

export interface CompileEnv {
  /** Shared variable values; compiled closures capture the array and read it at call time. */
  readonly globals: Float64Array;
  /** Slot in `globals` of every user variable an expression may reference. */
  readonly globalSlots: ReadonlyMap<string, number>;
  readonly functions: ReadonlyMap<string, UserFunction>;
  /** Maximum compiled nodes, counting every inlined function body (default 50 000). */
  readonly budget?: number;
}

export const DEFAULT_NODE_BUDGET = 50_000;

/** Thrown by the compile functions; carries the MathError to show on the row. */
export class CompileError extends Error {
  readonly error: MathError;

  constructor(error: MathError) {
    super(error.message);
    this.name = 'CompileError';
    this.error = error;
  }
}

export type Evaluate = (regs: Float64Array) => number;

export interface CompiledExpr {
  /** Evaluates with the inputs already stored in registers 0..inputs-1. */
  readonly evaluate: Evaluate;
  /** Size of the register file `evaluate` needs (inputs plus inlined parameters). */
  readonly registerCount: number;
  /** True when the whole expression folded to a constant at compile time. */
  readonly isConstant: boolean;
  /** The folded value when isConstant, otherwise NaN. */
  readonly constantValue: number;
  /** Compiled nodes, counting inlined function bodies. */
  readonly nodeCount: number;
}

/** A compiled subtree: its closure, and its value when it folded to a constant. */
interface C {
  readonly ev: Evaluate;
  readonly k: boolean;
  readonly v: number;
}

/** Where a plot variable or parameter lives: a register, or a value known at compile time. */
interface Binding {
  readonly reg: number;
  readonly value: number;
}

type Scope = ReadonlyMap<string, Binding>;

const NO_REGS = new Float64Array(0);
/** Longest + / * run compiled as nested closures; longer runs evaluate in a loop. */
const CHAIN_NEST_LIMIT = 32;

type ArithmeticOp = '+' | '-' | '*' | '/';

function konst(v: number): C {
  return { ev: () => v, k: true, v };
}

function dyn(ev: Evaluate): C {
  return { ev, k: false, v: Number.NaN };
}

/** `ev` built from `children`: folded to a constant when every child is one. */
function combine(ev: Evaluate, a: C, b?: C): C {
  return a.k && (b === undefined || b.k) ? konst(ev(NO_REGS)) : dyn(ev);
}

function internal(message: string): CompileError {
  return new CompileError(mathError('internal', message));
}

function gcdInt(a: number, b: number): number {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y !== 0) {
    const t = x % y;
    x = y;
    y = t;
  }
  return x;
}

class Compiler {
  registerCount: number;
  nodes = 0;
  private readonly env: CompileEnv;
  private readonly budget: number;

  constructor(env: CompileEnv, inputs: number) {
    this.env = env;
    this.budget = env.budget ?? DEFAULT_NODE_BUDGET;
    this.registerCount = inputs;
  }

  private count(): void {
    if (++this.nodes > this.budget) {
      throw new CompileError(
        mathError('too-complex', 'Expression too complex', undefined, {
          hint: 'Nested function calls expand to too many operations',
        }),
      );
    }
  }

  compile(node: Node, scope: Scope): C {
    this.count();
    switch (node.type) {
      case 'num':
        return konst(node.value);
      case 'name':
        return this.name(node.name, node.kind, scope);
      case 'unary': {
        const a = this.compile(node.arg, scope);
        if (node.op === '+') return a;
        const fa = a.ev;
        return combine((r) => -fa(r), a);
      }
      case 'postfix': {
        const a = this.compile(node.arg, scope);
        const fa = a.ev;
        return combine((r) => factorial(fa(r)), a);
      }
      case 'binary': {
        if (node.op !== '^') return this.chain(node, scope);
        return power(this.compile(node.left, scope), this.compile(node.right, scope), node.right);
      }
      case 'call': {
        const result =
          node.calleeKind === 'userFn' ? this.userCall(node, scope) : this.builtinCall(node, scope);
        if (node.power === undefined) return result;
        return power(result, this.compile(node.power, scope), node.power);
      }
      case 'tuple':
        throw new CompileError(
          mathError('bad-tuple', "A point can't be used inside an expression", node.span),
        );
    }
  }

  /**
   * A left-associative run of + and − (or of * and /), like `x + x + … + x`. Such runs come out
   * of the parser as trees as deep as they are long, so they are compiled iteratively, and long
   * ones run as one loop instead of thousands of nested closures. Evaluation order and rounding
   * are the same as for the nested binary operations.
   */
  private chain(root: BinaryNode, scope: Scope): C {
    const additive = root.op === '+' || root.op === '-';
    const ops: ArithmeticOp[] = [];
    const operands: Node[] = [];
    let left: Node = root;
    while (
      left.type === 'binary' &&
      left.op !== '^' &&
      (left.op === '+' || left.op === '-') === additive
    ) {
      if (left !== root) this.count();
      ops.push(left.op);
      operands.push(left.right);
      left = left.left;
    }
    ops.reverse();
    operands.reverse();

    let acc = this.compile(left, scope);
    let i = 0;
    // Short tails nest ordinary binary closures, which keeps their constant specializations.
    for (; i < ops.length && (acc.k || ops.length - i <= CHAIN_NEST_LIMIT); i++) {
      acc = arithmetic(ops[i], acc, this.compile(operands[i], scope));
    }
    if (i === ops.length) return acc;

    const n = ops.length - i;
    const evs: Evaluate[] = [];
    /** 1 where the operator is − (or /), 0 for + (or *). */
    const inverse = new Uint8Array(n);
    for (let j = 0; j < n; j++) {
      evs.push(this.compile(operands[i + j], scope).ev);
      inverse[j] = ops[i + j] === '-' || ops[i + j] === '/' ? 1 : 0;
    }
    const first = acc.ev;
    if (additive) {
      return dyn((r) => {
        let v = first(r);
        for (let j = 0; j < n; j++) v = inverse[j] ? v - evs[j](r) : v + evs[j](r);
        return v;
      });
    }
    return dyn((r) => {
      let v = first(r);
      for (let j = 0; j < n; j++) v = inverse[j] ? v / evs[j](r) : v * evs[j](r);
      return v;
    });
  }

  private name(name: string, kind: NameNodeKind, scope: Scope): C {
    switch (kind) {
      case 'const':
        return konst(BUILTIN_CONSTANTS[name as keyof typeof BUILTIN_CONSTANTS] ?? Number.NaN);
      case 'plotVar':
      case 'param': {
        const b = scope.get(name);
        if (b === undefined) throw internal(`Can't use ${name} here`);
        if (b.reg < 0) return konst(b.value);
        const i = b.reg;
        return dyn((r) => r[i]);
      }
      case 'userVar': {
        const slot = this.env.globalSlots.get(name);
        if (slot === undefined) throw internal(`'${name}' has no value`);
        const g = this.env.globals;
        return dyn(() => g[slot]);
      }
      default:
        throw new CompileError(mathError('unknown-name', `'${name}' is not defined`));
    }
  }

  private builtinCall(node: CallNode, scope: Scope): C {
    const impl = builtinImpl(node.callee);
    if (impl === undefined) throw internal(`Unknown function ${node.callee}`);
    const args = node.args.map((a) => this.compile(a, scope));
    const [a, b] = args;
    if (args.length === 1 && a && impl.unary) {
      const f = impl.unary;
      const fa = a.ev;
      return combine((r) => f(fa(r)), a);
    }
    if (args.length === 2 && a && b && impl.binary) {
      const f = impl.binary;
      const fa = a.ev;
      const fb = b.ev;
      return combine((r) => f(fa(r), fb(r)), a, b);
    }
    if (args.length > 2 && impl.variadic) {
      const f = impl.variadic;
      const evs = args.map((c) => c.ev);
      const values = new Array<number>(evs.length).fill(0);
      const ev: Evaluate = (r) => {
        for (let i = 0; i < evs.length; i++) values[i] = evs[i](r);
        return f(values);
      };
      return args.every((c) => c.k) ? konst(ev(NO_REGS)) : dyn(ev);
    }
    throw internal(`${node.callee} can't take ${args.length} arguments`);
  }

  /**
   * Inlines a user function: the call site evaluates its arguments into fresh registers, then
   * runs the body compiled with the parameters bound to those registers. Constant arguments are
   * bound as constants instead, so `f(2)` folds when f's body only uses its parameters.
   */
  private userCall(node: CallNode, scope: Scope): C {
    const fn = this.env.functions.get(node.callee);
    if (fn === undefined) throw internal(`'${node.callee}' has no definition`);
    if (fn.params.length !== node.args.length) {
      throw internal(`${node.callee} takes ${fn.params.length} arguments`);
    }
    const bodyScope = new Map<string, Binding>();
    const regs: number[] = [];
    const argEvs: Evaluate[] = [];
    node.args.forEach((argNode, i) => {
      const arg = this.compile(argNode, scope);
      const param = fn.params[i];
      if (arg.k) {
        bodyScope.set(param, { reg: -1, value: arg.v });
      } else {
        const reg = this.registerCount++;
        bodyScope.set(param, { reg, value: Number.NaN });
        regs.push(reg);
        argEvs.push(arg.ev);
      }
    });
    const body = this.compile(fn.body, bodyScope);
    // A constant body ignores its arguments, which have no side effects.
    if (body.k || regs.length === 0) return body;
    const fb = body.ev;
    if (regs.length === 1) {
      const r0 = regs[0];
      const a0 = argEvs[0];
      return dyn((r) => {
        r[r0] = a0(r);
        return fb(r);
      });
    }
    if (regs.length === 2) {
      const r0 = regs[0];
      const r1 = regs[1];
      const a0 = argEvs[0];
      const a1 = argEvs[1];
      return dyn((r) => {
        r[r0] = a0(r);
        r[r1] = a1(r);
        return fb(r);
      });
    }
    const n = regs.length;
    return dyn((r) => {
      for (let i = 0; i < n; i++) r[regs[i]] = argEvs[i](r);
      return fb(r);
    });
  }
}

function arithmetic(op: ArithmeticOp, a: C, b: C): C {
  const fa = a.ev;
  const fb = b.ev;
  if (a.k && b.k) {
    switch (op) {
      case '+':
        return konst(a.v + b.v);
      case '-':
        return konst(a.v - b.v);
      case '*':
        return konst(a.v * b.v);
      case '/':
        return konst(a.v / b.v);
    }
  }
  if (b.k) {
    const c = b.v;
    switch (op) {
      case '+':
        return dyn((r) => fa(r) + c);
      case '-':
        return dyn((r) => fa(r) - c);
      case '*':
        return dyn((r) => fa(r) * c);
      case '/':
        return dyn((r) => fa(r) / c);
    }
  }
  if (a.k) {
    const c = a.v;
    switch (op) {
      case '+':
        return dyn((r) => c + fb(r));
      case '-':
        return dyn((r) => c - fb(r));
      case '*':
        return dyn((r) => c * fb(r));
      case '/':
        return dyn((r) => c / fb(r));
    }
  }
  switch (op) {
    case '+':
      return dyn((r) => fa(r) + fb(r));
    case '-':
      return dyn((r) => fa(r) - fb(r));
    case '*':
      return dyn((r) => fa(r) * fb(r));
    case '/':
      return dyn((r) => fa(r) / fb(r));
  }
}

/**
 * base^exp. A literal exponent p/q with q odd (after reducing) takes the real odd root of a
 * negative base: (-8)^(1/3) = -2, (-8)^(2/3) = 4. Other non-integer powers of a negative base
 * are NaN, as Math.pow gives.
 */
function power(base: C, exp: C, expNode: Node): C {
  const fb = base.ev;
  const frac = literalFraction(expNode);
  if (frac !== null && frac.p !== 0) {
    const g = gcdInt(frac.p, frac.q);
    const p = frac.p / g;
    const q = frac.q / g;
    if (q > 1 && q % 2 === 1) return combine(oddRoot(fb, p, q), base);
  }
  if (exp.k) {
    const e = exp.v;
    if (e === 0) return konst(1);
    if (e === 1) return base;
    let ev: Evaluate;
    if (e === 2) {
      ev = (r) => {
        const v = fb(r);
        return v * v;
      };
    } else if (e === 3) {
      ev = (r) => {
        const v = fb(r);
        return v * v * v;
      };
    } else if (e === 4) {
      ev = (r) => {
        const v = fb(r);
        const s = v * v;
        return s * s;
      };
    } else if (e === -1) {
      ev = (r) => 1 / fb(r);
    } else if (e === -2) {
      ev = (r) => {
        const v = fb(r);
        return 1 / (v * v);
      };
    } else if (e === 0.5) {
      ev = (r) => Math.sqrt(fb(r));
    } else {
      ev = (r) => fb(r) ** e;
    }
    return combine(ev, base);
  }
  const fe = exp.ev;
  if (base.k) {
    const c = base.v;
    if (c === Math.E) return dyn((r) => Math.exp(fe(r)));
    return dyn((r) => c ** fe(r));
  }
  return dyn((r) => fb(r) ** fe(r));
}

function oddRoot(fb: Evaluate, p: number, q: number): Evaluate {
  if (q === 3) {
    // Via cbrt, so perfect cubes come out exact: (-8)^(2/3) = (cbrt -8)^2 = 4.
    if (p === 1) return (r) => Math.cbrt(fb(r));
    if (p === -1) return (r) => 1 / Math.cbrt(fb(r));
    if (p === 2) {
      return (r) => {
        const c = Math.cbrt(fb(r));
        return c * c;
      };
    }
    return (r) => Math.cbrt(fb(r)) ** p;
  }
  const e = p / q;
  const odd = p % 2 !== 0;
  return (r) => {
    const v = fb(r);
    if (v >= 0) return v ** e;
    const m = (-v) ** e;
    return odd ? -m : m;
  };
}

/**
 * Compiles `node` with the input variables `vars` bound to registers 0..vars.length-1.
 * Throws CompileError ('too-complex', 'unknown-name', 'bad-tuple', 'internal').
 */
export function compileExpr(node: Node, vars: readonly string[], env: CompileEnv): CompiledExpr {
  const scope = new Map<string, Binding>();
  vars.forEach((v, i) => {
    scope.set(v, { reg: i, value: Number.NaN });
  });
  const compiler = new Compiler(env, vars.length);
  let c: C;
  try {
    c = compiler.compile(node, scope);
  } catch (e) {
    if (e instanceof RangeError) {
      // Call-stack overflow on a pathologically deep tree.
      throw new CompileError(mathError('too-complex', 'Expression too complex'));
    }
    throw e;
  }
  return {
    evaluate: c.ev,
    registerCount: compiler.registerCount,
    isConstant: c.k,
    constantValue: c.v,
    nodeCount: compiler.nodes,
  };
}

/** Compiles a constant expression (no plot variables) to a zero-argument function. */
export function compile0(node: Node, env: CompileEnv): Fn0 {
  const c = compileExpr(node, [], env);
  if (c.isConstant) {
    const v = c.constantValue;
    return () => v;
  }
  const regs = new Float64Array(c.registerCount);
  const ev = c.evaluate;
  return () => ev(regs);
}

/** Compiles an expression in one variable (x, y, t or θ). */
export function compile1(node: Node, v: string, env: CompileEnv): Fn1 {
  const c = compileExpr(node, [v], env);
  if (c.isConstant) {
    const k = c.constantValue;
    return () => k;
  }
  const regs = new Float64Array(c.registerCount);
  const ev = c.evaluate;
  return (a) => {
    regs[0] = a;
    return ev(regs);
  };
}

/** Compiles an expression in two variables, e.g. F(x, y) for implicit curves. */
export function compile2(node: Node, a: string, b: string, env: CompileEnv): Fn2 {
  const c = compileExpr(node, [a, b], env);
  if (c.isConstant) {
    const k = c.constantValue;
    return () => k;
  }
  const regs = new Float64Array(c.registerCount);
  const ev = c.evaluate;
  return (x, y) => {
    regs[0] = x;
    regs[1] = y;
    return ev(regs);
  };
}
