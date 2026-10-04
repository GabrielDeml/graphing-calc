// S-expression printer for tests and debugging.

import type { Node, Statement } from './ast';

/**
 * Prints a node as an S-expression: `(neg (^ x 2))`, `(* 3 (sin x))`, `(call f (- x 1))`,
 * `(abs x)`, `(! x)`, `(pos x)`, `(tuple 1 2)`. A call with a power prints as `(^ (sin x) 2)`.
 * Implicit and explicit multiplication both print as `*`.
 */
export function printNode(node: Node): string {
  switch (node.type) {
    case 'num':
      return String(node.value);
    case 'name':
      return node.name;
    case 'unary':
      return `(${node.op === '-' ? 'neg' : 'pos'} ${printNode(node.arg)})`;
    case 'binary':
      return `(${node.op} ${printNode(node.left)} ${printNode(node.right)})`;
    case 'postfix':
      return `(! ${printNode(node.arg)})`;
    case 'call': {
      const head = node.calleeKind === 'userFn' ? `call ${node.callee}` : node.callee;
      const call = `(${head} ${node.args.map(printNode).join(' ')})`;
      return node.power ? `(^ ${call} ${printNode(node.power)})` : call;
    }
    case 'tuple':
      return `(tuple ${node.items.map(printNode).join(' ')})`;
  }
}

/**
 * Prints a statement: `(empty)`, a single expression as its node, a comma list as
 * `(points (tuple 1 2) (tuple 3 4))`, and a relation as `(= y (^ x 2))` or `(<= y x)`.
 */
export function printStatement(s: Statement): string {
  switch (s.type) {
    case 'empty':
      return '(empty)';
    case 'exprs': {
      const [only] = s.items;
      if (s.items.length === 1 && only) return printNode(only);
      return `(points ${s.items.map(printNode).join(' ')})`;
    }
    case 'relation':
      return `(${s.op} ${printNode(s.left)} ${printNode(s.right)})`;
  }
}
