// Statement (+ the row's definition head) → what the row means: a definition, a curve of some
// kind, a point list, a constant. Pure AST inspection; compiling happens later in document.ts.
//
// free(E) is the set of plot variables (x y t θ r) appearing in E. Calls to user functions are
// looked through only at their arguments: function bodies are separate rows.

import type { BinaryNode, NameNode, Node, RelOp, Statement } from './ast';
import type { DefinitionHead } from './definition';
import { mathError, replaceFix } from './errors';
import type { ExplicitInequality, MathError, QuickFix, Span } from './types';

export interface PointNodes {
  readonly x: Node;
  readonly y: Node;
}

export type Classified =
  | { readonly kind: 'empty' }
  | { readonly kind: 'constant'; readonly expr: Node }
  /** y = expr(x); also a bare expression in x. isConstant: expr doesn't use x. */
  | { readonly kind: 'explicitY'; readonly expr: Node; readonly isConstant: boolean }
  /** x = expr(y). */
  | { readonly kind: 'explicitX'; readonly expr: Node; readonly isConstant: boolean }
  /** r = expr(θ). */
  | { readonly kind: 'polar'; readonly expr: Node }
  | { readonly kind: 'parametric'; readonly x: Node; readonly y: Node }
  | { readonly kind: 'point'; readonly points: readonly PointNodes[] }
  | { readonly kind: 'points'; readonly points: readonly PointNodes[] }
  | { readonly kind: 'varDef'; readonly name: string; readonly expr: Node }
  /** `a = 2`: valueSpan covers the literal including its sign. */
  | {
      readonly kind: 'slider';
      readonly name: string;
      readonly value: number;
      readonly valueSpan: Span;
    }
  | {
      readonly kind: 'funcDef';
      readonly name: string;
      readonly params: readonly string[];
      readonly body: Node;
    }
  /** expr(x, y) = 0. */
  | { readonly kind: 'implicit'; readonly expr: Node }
  | {
      readonly kind: 'ineqY';
      readonly expr: Node;
      readonly isConstant: boolean;
      readonly ineq: ExplicitInequality;
    }
  | {
      readonly kind: 'ineqX';
      readonly expr: Node;
      readonly isConstant: boolean;
      readonly ineq: ExplicitInequality;
    }
  /** The region expr(x, y) > 0 (strict) or >= 0. */
  | { readonly kind: 'ineqImplicit'; readonly expr: Node; readonly strict: boolean };

export type ClassifyResult =
  | { readonly ok: true; readonly row: Classified }
  | { readonly ok: false; readonly error: MathError };

/**
 * The first node under `root` (pre-order, left to right, `root` included) matching `pred`.
 * Iterative: a long flat chain like `x+x+…+x` is a tree thousands of levels deep.
 */
export function findNode(root: Node, pred: (n: Node) => boolean): Node | null {
  const stack: Node[] = [root];
  for (let n = stack.pop(); n !== undefined; n = stack.pop()) {
    if (pred(n)) return n;
    switch (n.type) {
      case 'unary':
      case 'postfix':
        stack.push(n.arg);
        break;
      case 'binary':
        stack.push(n.right, n.left);
        break;
      case 'call':
        if (n.power) stack.push(n.power);
        for (let i = n.args.length - 1; i >= 0; i--) stack.push(n.args[i]);
        break;
      case 'tuple':
        for (let i = n.items.length - 1; i >= 0; i--) stack.push(n.items[i]);
        break;
      default:
        break;
    }
  }
  return null;
}

/** Visits every node under `root` in pre-order, left to right (iteratively, see findNode). */
export function forEachNode(root: Node, visit: (n: Node) => void): void {
  findNode(root, (n) => {
    visit(n);
    return false;
  });
}

/** Plot variables used in `node`, each mapped to the span of its first occurrence. */
export function freePlotVars(node: Node, into = new Map<string, Span>()): Map<string, Span> {
  forEachNode(node, (n) => {
    if (n.type === 'name' && n.kind === 'plotVar' && !into.has(n.name)) into.set(n.name, n.span);
  });
  return into;
}

/** The first tuple anywhere inside `node` (including node itself). */
export function findTuple(node: Node): Node | null {
  return findNode(node, (n) => n.type === 'tuple');
}

function fail(
  code: string,
  message: string,
  span?: Span,
  hint?: string,
  quickFix?: QuickFix,
): ClassifyResult {
  return { ok: false, error: mathError(code, message, span, { hint, quickFix }) };
}

function ok(row: Classified): ClassifyResult {
  return { ok: true, row };
}

function tupleError(nodes: readonly Node[]): ClassifyResult | null {
  for (const n of nodes) {
    const t = findTuple(n);
    if (t) return fail('bad-tuple', "A point can't be used inside an expression", t.span);
  }
  return null;
}

function isPlotName(node: Node, name: string): node is NameNode {
  return node.type === 'name' && node.kind === 'plotVar' && node.name === name;
}

/** Function notation on a plot variable, and the variable it's written in: y(x), x(y), r(θ). */
const PLOT_CALLS: readonly (readonly [string, string])[] = [
  ['y', 'x'],
  ['x', 'y'],
  ['r', 'θ'],
];

/**
 * `y(x)`: the parser reads it as the product y·x, but it is function notation. Only a lone,
 * parenthesized variable counts (the product's extent then ends at the ')' after it), so `yx`,
 * `y x` and `y(x + 1)` stay products.
 */
function isPlotCall(node: Node, name: string, arg: string): boolean {
  return (
    node.type === 'binary' &&
    node.implicit === true &&
    isPlotName(node.left, name) &&
    isPlotName(node.right, arg) &&
    node.right.span.end < node.span.end
  );
}

/** `y` or `y(x)` (and likewise x / x(y), r / r(θ)) as one side of an equation or inequality. */
function isPlotSide(node: Node, name: string): boolean {
  if (isPlotName(node, name)) return true;
  const call = PLOT_CALLS.find(([n]) => n === name);
  return call !== undefined && isPlotCall(node, name, call[1]);
}

/** Error for `y(x)` notation that couldn't be read as `y = …`, e.g. `y(x) = x + y`. */
function plotCallError(...sides: Node[]): ClassifyResult | null {
  for (const side of sides) {
    for (const [name, arg] of PLOT_CALLS) {
      if (!isPlotCall(side, name, arg)) continue;
      return fail(
        'plot-var-call',
        `${name} is a graph variable, not a function`,
        side.span,
        `Write ${name} = … to graph, or name a function: f(${arg}) = …`,
      );
    }
  }
  return null;
}

/** Whether every variable in `free` is one of `allowed`. */
function within(free: ReadonlyMap<string, Span>, ...allowed: string[]): boolean {
  for (const v of free.keys()) if (!allowed.includes(v)) return false;
  return true;
}

/** The first (variable, span) entry of a free-variable map. */
function first(free: ReadonlyMap<string, Span>): [string, Span] | [undefined, undefined] {
  for (const entry of free) return entry;
  return [undefined, undefined];
}

function joinSpan(a: Node, b: Node): Span {
  return { start: Math.min(a.span.start, b.span.start), end: Math.max(a.span.end, b.span.end) };
}

/** Synthesized `left − right`, for F = L − R and inequality regions. */
function difference(left: Node, right: Node): BinaryNode {
  return { type: 'binary', op: '-', left, right, span: joinSpan(left, right) };
}

/** `2`, `-2`, `+2.5`: a numeric literal with an optional sign. */
function signedLiteral(node: Node): { value: number; span: Span } | null {
  if (node.type === 'num') return { value: node.value, span: node.span };
  if (node.type === 'unary' && node.arg.type === 'num') {
    const v = node.arg.value;
    return { value: node.op === '-' ? -v : v, span: node.span };
  }
  return null;
}

function flip(op: RelOp): RelOp {
  switch (op) {
    case '<':
      return '>';
    case '>':
      return '<';
    case '<=':
      return '>=';
    case '>=':
      return '<=';
    default:
      return op;
  }
}

function explicitIneq(op: RelOp): ExplicitInequality {
  return { side: op === '>' || op === '>=' ? 'greater' : 'less', strict: op === '<' || op === '>' };
}

function exprsRow(items: readonly Node[]): ClassifyResult {
  const [only] = items;
  if (items.length > 1 || only === undefined) return pointList(items);
  if (only.type === 'tuple') return tupleRow(only.items, only.span);
  const bad = tupleError([only]);
  if (bad) return bad;

  const free = freePlotVars(only);
  if (free.size === 0) return ok({ kind: 'constant', expr: only });
  if (within(free, 'x')) return ok({ kind: 'explicitY', expr: only, isConstant: false });
  const y = free.get('y');
  if (y) {
    return fail(
      'needs-equation',
      "An expression in y can't be graphed on its own",
      y,
      'Write x = … or an equation like x^2 + y^2 = 1',
    );
  }
  const theta = free.get('θ');
  if (theta) {
    return fail(
      'needs-equation',
      "An expression in θ can't be graphed on its own",
      theta,
      'Write r = …',
    );
  }
  const t = free.get('t');
  if (t) {
    return fail(
      'needs-equation',
      "An expression in t can't be graphed on its own",
      t,
      'Parametric curves look like (cos t, sin t)',
    );
  }
  const r = free.get('r');
  return fail(
    'needs-equation',
    "An expression in r can't be graphed on its own",
    r,
    'Polar curves look like r = 1 + cos θ',
  );
}

function pointList(items: readonly Node[]): ClassifyResult {
  const points: PointNodes[] = [];
  for (const item of items) {
    if (item.type !== 'tuple' || item.items.length !== 2) {
      return fail('bad-point', 'Each point needs the form (x, y)', item.span);
    }
    const [x, y] = item.items as [Node, Node];
    const bad = tupleError([x, y]);
    if (bad) return bad;
    const [v, span] = first(freePlotVars(item));
    if (v !== undefined) {
      const message = v === 'x' || v === 'y' ? "Points can't use x or y" : `Points can't use ${v}`;
      return fail('point-uses-plot-var', message, span);
    }
    points.push({ x, y });
  }
  return ok({ kind: 'points', points });
}

function tupleRow(items: readonly Node[], span: Span): ClassifyResult {
  if (items.length !== 2) {
    return fail('bad-point', 'Points need exactly 2 coordinates', span);
  }
  const [x, y] = items as [Node, Node];
  const bad = tupleError([x, y]);
  if (bad) return bad;
  const free = freePlotVars(y, freePlotVars(x));
  if (free.size === 0) return ok({ kind: 'point', points: [{ x, y }] });
  if (within(free, 't')) return ok({ kind: 'parametric', x, y });
  const where = free.get('x') ?? free.get('y') ?? free.get('θ') ?? free.get('r');
  return fail('parametric-uses-plot-var', 'Parametric curves use t: (cos t, sin t)', where);
}

function definitionRow(left: Node, right: Node, head: DefinitionHead): ClassifyResult | null {
  if (head.kind === 'var') {
    if (left.type !== 'name' || left.name !== head.name) return null;
    const bad = tupleError([right]);
    if (bad) return bad;
    const [v, span] = first(freePlotVars(right));
    if (v !== undefined) {
      // A function of it, as the message suggests: `a = x^2` → `a(x) = x^2`.
      const fn = `${head.name}(${v})`;
      return fail(
        'var-uses-plot-var',
        `${head.name} can't depend on ${v}. Did you mean ${fn} = …?`,
        span,
        undefined,
        replaceFix(head.nameSpan, fn, `${fn} = …`),
      );
    }
    const literal = signedLiteral(right);
    if (literal) {
      return ok({
        kind: 'slider',
        name: head.name,
        value: literal.value,
        valueSpan: { start: literal.span.start, end: literal.span.end },
      });
    }
    return ok({ kind: 'varDef', name: head.name, expr: right });
  }

  if (left.type !== 'call' || left.calleeKind !== 'userFn' || left.callee !== head.name) {
    return null;
  }
  const bad = tupleError([right]);
  if (bad) return bad;
  // Parameters parse as 'param' names, so any plot variable left over isn't a parameter.
  const [v, span] = first(freePlotVars(right));
  if (v !== undefined) {
    return fail(
      'fn-uses-plot-var',
      `${head.name} uses ${v}, which isn't one of its parameters`,
      span,
    );
  }
  return ok({ kind: 'funcDef', name: head.name, params: head.params, body: right });
}

function plotVarMisuse(free: ReadonlyMap<string, Span>, inequality: boolean): ClassifyResult {
  const t = free.get('t');
  const theta = free.get('θ');
  const r = free.get('r');
  const span = t ?? theta ?? r;
  if (inequality) {
    return fail(
      'unsupported-inequality',
      "Polar/parametric inequalities aren't supported yet",
      span,
    );
  }
  if (t) {
    return fail(
      'misplaced-plot-var',
      't is only for parametric curves',
      t,
      'Parametric curves look like (cos t, sin t)',
    );
  }
  return fail(
    'misplaced-plot-var',
    'Polar curves must be written r = …',
    span,
    'For example r = 1 + cos θ',
  );
}

function equationRow(left: Node, right: Node): ClassifyResult {
  const fl = freePlotVars(left);
  const fr = freePlotVars(right);

  if (isPlotSide(left, 'y') && within(fr, 'x')) {
    return ok({ kind: 'explicitY', expr: right, isConstant: fr.size === 0 });
  }
  if (isPlotSide(left, 'x') && within(fr, 'y')) {
    return ok({ kind: 'explicitX', expr: right, isConstant: fr.size === 0 });
  }
  if (isPlotSide(left, 'r') && within(fr, 'θ')) return ok({ kind: 'polar', expr: right });
  if (isPlotSide(right, 'y') && within(fl, 'x')) {
    return ok({ kind: 'explicitY', expr: left, isConstant: fl.size === 0 });
  }
  if (isPlotSide(right, 'x') && within(fl, 'y')) {
    return ok({ kind: 'explicitX', expr: left, isConstant: fl.size === 0 });
  }
  if (isPlotSide(right, 'r') && within(fl, 'θ')) return ok({ kind: 'polar', expr: left });
  const free = new Map([...fl, ...fr]);
  if (free.size === 0) {
    return fail(
      'no-variables',
      'This equation has no variables',
      undefined,
      'Try y = … to graph it',
    );
  }
  if (!within(free, 'x', 'y')) return plotVarMisuse(free, false);
  const call = plotCallError(left, right);
  if (call) return call;
  return ok({ kind: 'implicit', expr: difference(left, right) });
}

function inequalityRow(op: RelOp, left: Node, right: Node): ClassifyResult {
  const fl = freePlotVars(left);
  const fr = freePlotVars(right);

  if (isPlotSide(left, 'y') && within(fr, 'x')) {
    return ok({ kind: 'ineqY', expr: right, isConstant: fr.size === 0, ineq: explicitIneq(op) });
  }
  if (isPlotSide(right, 'y') && within(fl, 'x')) {
    return ok({
      kind: 'ineqY',
      expr: left,
      isConstant: fl.size === 0,
      ineq: explicitIneq(flip(op)),
    });
  }
  if (isPlotSide(left, 'x') && within(fr, 'y')) {
    return ok({ kind: 'ineqX', expr: right, isConstant: fr.size === 0, ineq: explicitIneq(op) });
  }
  if (isPlotSide(right, 'x') && within(fl, 'y')) {
    return ok({
      kind: 'ineqX',
      expr: left,
      isConstant: fl.size === 0,
      ineq: explicitIneq(flip(op)),
    });
  }
  const free = new Map([...fl, ...fr]);
  if (free.size === 0) {
    return fail(
      'no-variables',
      'This inequality has no variables',
      undefined,
      'Try y > … to shade a region',
    );
  }
  if (!within(free, 'x', 'y')) return plotVarMisuse(free, true);
  const call = plotCallError(left, right);
  if (call) return call;
  const greater = op === '>' || op === '>=';
  return ok({
    kind: 'ineqImplicit',
    expr: greater ? difference(left, right) : difference(right, left),
    strict: op === '<' || op === '>',
  });
}

/**
 * Classifies a parsed row. `head` is the row's definition head from detectDefinition (null when
 * the row isn't a definition); the statement must have been parsed with a NameContext that knows
 * that definition (and, for functions, its parameters).
 */
export function classify(statement: Statement, head: DefinitionHead | null): ClassifyResult {
  switch (statement.type) {
    case 'empty':
      return ok({ kind: 'empty' });
    case 'exprs':
      return exprsRow(statement.items);
    case 'relation': {
      const { op, left, right } = statement;
      const bad = tupleError([left, right]);
      if (head !== null && op === '=') {
        const def = definitionRow(left, right, head);
        if (def) return def;
      }
      if (bad) return bad;
      return op === '=' ? equationRow(left, right) : inequalityRow(op, left, right);
    }
  }
}
