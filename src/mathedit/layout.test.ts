import { describe, expect, it } from 'vitest';
import { definitionContext, detectDefinition } from '../engine/definition';
import { EMPTY_CONTEXT, type NameContext } from '../engine/names';
import { parse } from '../engine/parser';
import { printStatement } from '../engine/print';
import { mulberry32, randomSource } from '../engine/testing/fuzz';
import type { Span } from '../engine/types';
import { type LBlock, type LNode, layoutParse, printLayout } from './layout';

function ctxOf(vars: string[] = [], fns: Record<string, number> = {}): NameContext {
  return { vars: new Set(vars), fns: new Map(Object.entries(fns)) };
}

const USER = ctxOf(['a', 'b', 'xy', 'speed', 'a_1'], { f: 1, g: 2, h: 3 });
const SLIDERS = ctxOf(['a', 'b', 'c', 'n', 'm_1', 'a_1']);

function lp(source: string, ctx: NameContext = EMPTY_CONTEXT): string {
  return printLayout(layoutParse(source, ctx));
}

/** The engine's reading of a row, with its definition head applied as DocumentEngine does. */
function engine(source: string, ctx: NameContext): string | null {
  const r = parse(source, definitionContext(detectDefinition(source), ctx));
  return r.ok ? printStatement(r.statement) : null;
}

/** Children of a node in source order, with the span each must lie in. */
function children(node: LNode): { spans: Span[]; nodes: LNode[]; blocks: LBlock[] } {
  const spans: Span[] = [];
  const nodes: LNode[] = [];
  const blocks: LBlock[] = [];
  switch (node.type) {
    case 'unary':
      spans.push(node.opSpan);
      nodes.push(node.arg);
      break;
    case 'binary':
      if (node.opSpan) spans.push(node.opSpan);
      nodes.push(node.left, node.right);
      break;
    case 'postfix':
      spans.push(node.opSpan);
      nodes.push(node.arg);
      break;
    case 'call':
      spans.push(node.nameSpan);
      if (node.power) {
        spans.push(node.power.caret);
        nodes.push(node.power.node);
      }
      if (node.parens) {
        spans.push(node.parens.open);
        if (node.parens.close) spans.push(node.parens.close);
        blocks.push(node.parens.body);
      }
      if (node.arg) nodes.push(node.arg);
      break;
    case 'group':
    case 'abs':
      spans.push(node.open);
      if (node.close) spans.push(node.close);
      blocks.push(node.body);
      break;
    default:
      break;
  }
  return { spans, nodes, blocks };
}

function within(inner: Span, outer: Span): boolean {
  return inner.start >= outer.start && inner.end <= outer.end && inner.start <= inner.end;
}

/** Nested spans: every child (node, block, token) lies inside its parent. */
function nestingProblem(node: LNode, length: number): string | null {
  if (!within(node.span, { start: 0, end: length })) return `${node.type} out of range`;
  const { spans, nodes, blocks } = children(node);
  for (const s of spans) if (!within(s, node.span)) return `${node.type}: token outside`;
  for (const n of nodes) {
    if (!within(n.span, node.span)) return `${node.type}: ${n.type} outside`;
    const p = nestingProblem(n, length);
    if (p) return p;
  }
  for (const b of blocks) {
    if (!within(b.span, node.span)) return `${node.type}: block outside`;
    const p = blockProblem(b, length);
    if (p) return p;
  }
  return null;
}

function blockProblem(block: LBlock, length: number): string | null {
  if (block.items.length !== block.seps.length + 1) return 'items and seps out of step';
  for (const item of block.items) {
    if (!within(item.span, block.span)) return `${item.type} outside its block`;
    const p = nestingProblem(item, length);
    if (p) return p;
  }
  for (const sep of block.seps) if (!within(sep.span, block.span)) return 'separator outside';
  return null;
}

describe('layoutParse mirrors the engine', () => {
  it.each([
    ['', '(empty)'],
    ['y = x^2', '(= y (^ x 2))'],
    ['y <= x', '(<= y x)'],
    ['(1,2),(3,4)', '(points (tuple 1 2) (tuple 3 4))'],
    ['(cos t, sin t)', '(tuple (cos t) (sin t))'],
    ['r = 1 + cos theta', '(= r (+ 1 (cos θ)))'],
    ['-x^2', '(neg (^ x 2))'],
    ['2^-x+1', '(+ (^ 2 (neg x)) 1)'],
    ['e^2x', '(* (^ e 2) x)'],
    ['2^3!', '(^ 2 (! 3))'],
    ['x!^2', '(^ (! x) 2)'],
    ['1/2x', '(* (/ 1 2) x)'],
    ['2x/3', '(/ (* 2 x) 3)'],
    ['sin x/2', '(/ (sin x) 2)'],
    ['√2x', '(sqrt (* 2 x))'],
    ['sin 2x + 1', '(+ (sin (* 2 x)) 1)'],
    ['sin x cos x', '(* (sin x) (cos x))'],
    ['sin^2 x cos x', '(* (^ (sin x) 2) (cos x))'],
    ['ln|x|', '(ln (abs x))'],
    ['||x|-1|', '(abs (- (abs x) 1))'],
    ['|a(b|c|)|', '(abs (* a (* b (abs c))))'],
    ['x² + y² = 1', '(= (+ (^ x 2) (^ y 2)) 1)'],
    ['y = x⁻¹', '(= y (^ x (neg 1)))'],
    ['pix', '(* pi x)'],
    ['2πr', '(* (* 2 pi) r)'],
    ['max(1, 2, 3)', '(max 1 2 3)'],
  ])('%j → %s', (source, expected) => {
    expect(lp(source)).toBe(expected);
    expect(engine(source, EMPTY_CONTEXT)).toBe(expected);
  });

  it.each([
    ['f(x+1)', '(call f (+ x 1))'],
    ['af(x)', '(* a (call f x))'],
    ['speedt', '(* speed t)'],
    ['ka_1', '(* k a_1)'],
    ['f(x) = x^2', '(= (call f x) (^ x 2))'],
  ])('with user names: %j → %s', (source, expected) => {
    expect(lp(source, USER)).toBe(expected);
  });

  it('groups letters with the names in scope', () => {
    expect(lp('y = asin(bx) + c', SLIDERS)).toBe('(= y (+ (* a (sin (* b x))) c))');
    expect(lp('y = asin(bx) + c')).toBe('(= y (+ (asin (* b x)) c))');
    // A definition of a keeps its own asin whole (a·sin would be a cycle).
    expect(lp('a = asin(0.5)', SLIDERS)).toBe('(= a (asin 0.5))');
    expect(lp('g(a) = asin(a)', ctxOf([], { g: 1 }))).toBe('(= (call g a) (* a (sin a)))');
  });
});

describe('layoutParse recovers', () => {
  it.each([
    ['2+', '(+ 2 _)'],
    ['x^', '(^ x _)'],
    ['1/', '(/ 1 _)'],
    ['y =', '(= y _)'],
    ['=2', '(= _ 2)'],
    ['(x+1', '(+ x 1)'],
    ['|x', '(abs x)'],
    ['sin', '(sin _)'],
    ['sin(', '(sin )'],
    ['()', '_'],
    ['x)', '(* x (error ")"))'],
    ['x) + 1', '(+ (* x (error ")")) 1)'],
    ['y == 2', '(* (* y (error "==")) 2)'],
    ['a_ + 1', '(+ (* a (error "_")) 1)'],
    ['x2', '(* x 2)'],
    ['(x = 2)', '(tuple x = 2)'],
    ['0<y<1', '(row 0 < y < 1)'],
    ['f x', '(* (call f ) x)'],
  ])('%j → %s', (source, expected) => {
    expect(lp(source, ctxOf([], { f: 1 }))).toBe(expected);
  });

  it('keeps unclosed groups open to the end of their block', () => {
    const root = layoutParse('(x, (y', EMPTY_CONTEXT).root;
    const outer = root.items[0];
    expect(outer).toMatchObject({ type: 'group', close: null, span: { start: 0, end: 6 } });
    if (outer?.type !== 'group') throw new Error('expected a group');
    expect(outer.body.items[1]).toMatchObject({
      type: 'group',
      close: null,
      span: { start: 4, end: 6 },
    });
    // An unclosed `|` inside parentheses stops at their `)`.
    const abs = layoutParse('(|x)', EMPTY_CONTEXT).root.items[0];
    expect(abs).toMatchObject({ type: 'group', close: { start: 3, end: 4 } });
  });

  it('turns absurd nesting into one error atom instead of overflowing', () => {
    const deep = `${'('.repeat(5000)}x${')'.repeat(5000)}`;
    expect(() => layoutParse(deep, EMPTY_CONTEXT)).not.toThrow();
    expect(lp(`${'('.repeat(100)}x${')'.repeat(100)}`)).toBe('x');
    expect(() => layoutParse(`${'2^'.repeat(5000)}2`, EMPTY_CONTEXT)).not.toThrow();
    expect(() => layoutParse(`${'-'.repeat(5000)}x`, EMPTY_CONTEXT)).not.toThrow();
  });
});

describe('differential fuzz', () => {
  const contexts = [EMPTY_CONTEXT, USER, SLIDERS, ctxOf(['a'], { f: 1 })];

  it('reads every row the engine accepts exactly as the engine does', () => {
    const rand = mulberry32(0xd1ff);
    const failures: string[] = [];
    let accepted = 0;
    for (let i = 0; i < 20_000; i++) {
      const source = randomSource(rand);
      const ctx = contexts[i % contexts.length] as NameContext;
      const expected = engine(source, ctx);
      if (expected === null) continue;
      accepted++;
      const got = lp(source, ctx);
      if (got !== expected) failures.push(`${JSON.stringify(source)}: ${got} ≠ ${expected}`);
    }
    expect(failures.slice(0, 20)).toEqual([]);
    expect(accepted).toBeGreaterThan(6000);
  });

  it('never throws, and nests every span inside its parent', () => {
    const rand = mulberry32(0xbad5);
    const junk = ['(', ')', '|', '$', '_', '{', '==', '😀', 'é', '^', '/', ',', '=', 'sqrt', '²'];
    const failures: string[] = [];
    for (let i = 0; i < 20_000; i++) {
      let source = randomSource(rand);
      // Garbage, unicode and unbalanced delimiters on top of the generator's own junk.
      for (let k = Math.floor(rand() * 3); k > 0; k--) {
        const at = Math.floor(rand() * (source.length + 1));
        source = source.slice(0, at) + junk[Math.floor(rand() * junk.length)] + source.slice(at);
      }
      const ctx = contexts[i % contexts.length] as NameContext;
      try {
        const { root } = layoutParse(source, ctx);
        const p = blockProblem(root, source.length);
        if (p) failures.push(`${JSON.stringify(source)}: ${p}`);
      } catch (e) {
        failures.push(`${JSON.stringify(source)} threw ${String(e)}`);
      }
    }
    expect(failures.slice(0, 20)).toEqual([]);
  });
});
