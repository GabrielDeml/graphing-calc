// AST produced by parser.ts.
//
// Parentheses do not create nodes: `(x+1)` is the binary node for x+1, whose own span excludes the
// parentheses, but any node built around it (`2(x+1)`, `(x+1)^2`) has a span covering the
// parentheses too. Every span lies inside its parent's span.

import type { NameKind } from './names';
import type { Span } from './types';

export type BinaryOp = '+' | '-' | '*' | '/' | '^';
export type RelOp = '=' | '<' | '>' | '<=' | '>=';
/** Kinds a 'name' node can have; function names always become 'call' nodes. */
export type NameNodeKind = Exclude<NameKind, 'builtinFn' | 'userFn'>;

export interface NumNode {
  type: 'num';
  value: number;
  span: Span;
}

export interface NameNode {
  type: 'name';
  /** Normalized name, e.g. 'x', 'θ', 'pi', 'a_1'. */
  name: string;
  kind: NameNodeKind;
  span: Span;
}

export interface UnaryNode {
  type: 'unary';
  op: '-' | '+';
  arg: Node;
  span: Span;
}

export interface BinaryNode {
  type: 'binary';
  op: BinaryOp;
  left: Node;
  right: Node;
  /** Set for juxtaposition (`2x`, `x y`, `sin x cos x`); always with op '*'. */
  implicit?: true;
  span: Span;
}

export interface PostfixNode {
  type: 'postfix';
  op: '!';
  arg: Node;
  span: Span;
}

export interface CallNode {
  type: 'call';
  /** Function name; `|x|` becomes a call to the builtin 'abs'. */
  callee: string;
  calleeKind: 'builtinFn' | 'userFn';
  args: Node[];
  /** `sin^2 x` is a call with power 2, meaning (sin x)^2. */
  power?: Node;
  span: Span;
}

export interface TupleNode {
  type: 'tuple';
  /** Two or more items: `(a, b)` points and parametric curves. */
  items: Node[];
  span: Span;
}

export type Node = NumNode | NameNode | UnaryNode | BinaryNode | PostfixNode | CallNode | TupleNode;

export interface EmptyStatement {
  type: 'empty';
}

/** One expression, or a top-level comma list (more than one item: a list of points). */
export interface ExprsStatement {
  type: 'exprs';
  items: Node[];
}

export interface RelationStatement {
  type: 'relation';
  op: RelOp;
  left: Node;
  right: Node;
  opSpan: Span;
}

export type Statement = EmptyStatement | ExprsStatement | RelationStatement;

/** Visits `node` and all its descendants in pre-order (call power after the arguments). */
export function walk(node: Node, visit: (n: Node) => void): void {
  visit(node);
  switch (node.type) {
    case 'unary':
    case 'postfix':
      walk(node.arg, visit);
      break;
    case 'binary':
      walk(node.left, visit);
      walk(node.right, visit);
      break;
    case 'call':
      for (const arg of node.args) walk(arg, visit);
      if (node.power) walk(node.power, visit);
      break;
    case 'tuple':
      for (const item of node.items) walk(item, visit);
      break;
    default:
      break;
  }
}

/** Visits every node of a statement in source order. */
export function walkStatement(statement: Statement, visit: (n: Node) => void): void {
  if (statement.type === 'exprs') {
    for (const item of statement.items) walk(item, visit);
  } else if (statement.type === 'relation') {
    walk(statement.left, visit);
    walk(statement.right, visit);
  }
}

function integerLiteral(node: Node): number | null {
  if (node.type === 'num') return Number.isInteger(node.value) ? node.value : null;
  if (node.type === 'unary' && node.op === '-' && node.arg.type === 'num') {
    return Number.isInteger(node.arg.value) ? -node.arg.value : null;
  }
  return null;
}

/**
 * If `node` is a literal integer fraction such as `1/3`, `-1/3`, `(2/5)` or `-(1/3)`, returns it
 * with q > 0; otherwise null. The compiler uses this so `(-8)^(1/3)` takes the real odd root.
 */
export function literalFraction(node: Node): { p: number; q: number } | null {
  if (node.type === 'unary' && node.op === '-') {
    const inner = literalFraction(node.arg);
    return inner && { p: -inner.p, q: inner.q };
  }
  if (node.type !== 'binary' || node.op !== '/') return null;
  const p = integerLiteral(node.left);
  const q = integerLiteral(node.right);
  if (p === null || q === null || q === 0) return null;
  return q < 0 ? { p: -p, q: -q } : { p, q };
}
