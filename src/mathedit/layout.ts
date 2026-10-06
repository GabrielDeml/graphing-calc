// Tolerant parse for the typeset view and editor: any text gives a tree whose nodes carry source
// spans. For text the engine accepts, the tree has exactly the engine's structure (parser.ts,
// method by method: same binding powers, prefix-function arguments, `|` rules and name split),
// plus the parentheses the engine drops; the differential test in layout.test.ts holds it to
// that. For the rest it recovers instead of stopping:
//
//   lexical error            → 'error' atom (tokenizeTolerant), read as an operand
//   missing operand          → 'slot' (an empty place: `2+`, `x^`, `1/`)
//   unclosed `(` or `|`      → the group runs to the end of its block, with no closer
//   `)` that closes nothing  → 'error' atom
//   relation or comma in ( ) → kept inside the group as a separator
//   number after an operand  → implicit product, like a name (`x2`)
//   `a_` or `a_{}`           → the name with an empty subscript (one being typed)
//   absurd nesting          → the rest of the row becomes one 'error' atom

import type { RelOp } from '../engine/ast';
import { isBuiltinFunction, PREFIXABLE_FUNCTIONS } from '../engine/builtinNames';
import { definitionContext, detectDefinition } from '../engine/definition';
import { type NameContext, type NameKind, splitIdentifier } from '../engine/names';
import {
  BP_ADD,
  BP_IMPLICIT_ARG,
  BP_MUL,
  BP_POSTFIX,
  BP_POW,
  BP_POW_RIGHT,
  BP_PREFIX,
} from '../engine/parser';
import { tokenizeTolerant } from '../engine/tokenizer';
import type { TokenKind } from '../engine/tokens';
import type { MathError, Span } from '../engine/types';

/** Same nesting limit as the engine's parser, so it never refuses what the engine reads. */
const MAX_DEPTH = 256;

export interface NumL {
  type: 'num';
  value: number;
  /** As written (`.5`, `2.50`); the digits of a superscript (`²` → '2'). */
  text: string;
  /** Written as superscript characters (`x²`). */
  script?: true;
  span: Span;
}

export interface NameL {
  type: 'name';
  /** The engine's name for it: 'x', 'pi', 'θ' (also for `theta`), 'a_1'. */
  name: string;
  kind: NameKind;
  /** Where the subscript starts (its '_'), for a subscripted name. */
  subStart?: number;
  /** Subscript text without '_' or braces. */
  sub?: string;
  span: Span;
}

export interface UnaryL {
  type: 'unary';
  op: '-' | '+';
  opSpan: Span;
  /** Written as a superscript sign (`x⁻¹`). */
  script?: true;
  arg: LNode;
  span: Span;
}

export interface BinaryL {
  type: 'binary';
  op: '+' | '-' | '*' | '/' | '^';
  /** The operator's text; absent for an implicit product. */
  opSpan?: Span;
  implicit?: true;
  /** A '^' read from a superscript character (`x²`); it shares its span with the exponent. */
  script?: true;
  left: LNode;
  right: LNode;
  span: Span;
}

export interface PostfixL {
  type: 'postfix';
  opSpan: Span;
  arg: LNode;
  span: Span;
}

export interface CallL {
  type: 'call';
  callee: string;
  calleeKind: 'builtinFn' | 'userFn';
  nameSpan: Span;
  /** `sin^2 x`: the caret and the power (the caret is a superscript character in `sin²x`). */
  power?: { caret: Span; script?: true; node: LNode };
  /** `sin(x)`, `max(1, 2)`: the parenthesized arguments, separated by commas. */
  parens?: Group;
  /** `sin x`: the argument without parentheses. */
  arg?: LNode;
  span: Span;
}

/** Shared by parenthesized groups, calls' argument lists and `|…|`. */
export interface Group {
  open: Span;
  /** null while unclosed: the group then runs to the end of its block. */
  close: Span | null;
  body: LBlock;
}

export interface GroupL extends Group {
  type: 'group';
  span: Span;
}

export interface AbsL extends Group {
  type: 'abs';
  span: Span;
}

/** A missing operand. Zero width, right after the token before it. */
export interface SlotL {
  type: 'slot';
  span: Span;
}

/** Text that isn't math: a lexical error, a `)` that closes nothing, or the rest of a too-deep row. */
export interface ErrorL {
  type: 'error';
  text: string;
  span: Span;
  /** The tokenizer's error, for lexical errors. */
  error?: MathError;
}

export type LNode =
  | NumL
  | NameL
  | UnaryL
  | BinaryL
  | PostfixL
  | CallL
  | GroupL
  | AbsL
  | SlotL
  | ErrorL;

export interface LSep {
  kind: 'comma' | 'rel';
  /** ',' or the normalized relation ('<=' for `≤`). */
  text: string;
  span: Span;
}

/**
 * A row, or the inside of a group: expressions separated by commas and relations. `items` has
 * one more entry than `seps`; an empty block is one slot.
 */
export interface LBlock {
  items: LNode[];
  seps: LSep[];
  span: Span;
}

export interface Layout {
  source: string;
  root: LBlock;
}

type LTokKind = TokenKind | 'error';

interface LTok {
  kind: LTokKind;
  text: string;
  start: number;
  end: number;
  value?: number;
  nameKind?: NameKind;
  sub?: string;
  subStart?: number;
  /** Read from a superscript character: `^`, its sign and digits in `x⁻¹`. */
  script?: boolean;
  error?: MathError;
}

function isScriptChar(c: number): boolean {
  return c === 0xb2 || c === 0xb3 || c === 0xb9 || (c >= 0x2070 && c <= 0x207b);
}

/** The row's tokens, lexical errors included, with letter runs split into names as the engine does. */
function tokens(source: string, ctx: NameContext): LTok[] {
  const { tokens: raw, errors } = tokenizeTolerant(source);
  const out: LTok[] = [];
  let e = 0;
  const flushErrors = (before: number) => {
    for (; e < errors.length; e++) {
      const err = errors[e] as MathError;
      const span = err.span as Span;
      if (span.start >= before) break;
      // `a_` or `a_{}` while a subscript is being typed: the name with an empty subscript.
      const prev = out[out.length - 1];
      const text = source.slice(span.start, span.end);
      if (
        err.code === 'bad-subscript' &&
        (text === '_' || text === '_{}') &&
        prev?.kind === 'ident' &&
        prev.end === span.start &&
        prev.sub === undefined
      ) {
        prev.sub = '';
        prev.subStart = span.start;
        prev.end = span.end;
        continue;
      }
      out.push({
        kind: 'error',
        text: source.slice(span.start, span.end),
        start: span.start,
        end: span.end,
        error: err,
      });
    }
  };
  for (const t of raw) {
    flushErrors(t.kind === 'eof' ? Number.POSITIVE_INFINITY : t.start);
    if (t.kind !== 'ident') {
      const tok: LTok = { ...t };
      if (t.end > t.start && isScriptChar(source.charCodeAt(t.start))) tok.script = true;
      out.push(tok);
      continue;
    }
    const units = splitIdentifier(t, ctx);
    units.forEach((u, i) => {
      const tok: LTok = {
        kind: 'ident',
        text: u.name,
        start: u.start,
        end: u.end,
        nameKind: u.kind,
      };
      // The subscript belongs to the last unit (`ka_1` is k·a_1).
      if (t.sub !== undefined && i === units.length - 1) {
        tok.sub = t.sub;
        tok.subStart = t.subStart;
      }
      out.push(tok);
    });
  }
  return out;
}

/**
 * Lays out a row: the engine's reading of it, with source spans and recovery from errors. Never
 * throws. `names` is the document's names table (DocumentEngine.names().ctx); the row's own
 * definition head is applied here, as the engine does.
 */
export function layoutParse(source: string, names: NameContext): Layout {
  const ctx = definitionContext(detectDefinition(source), names);
  const parser = new LayoutParser(tokens(source, ctx));
  return { source, root: parser.parseRoot() };
}

function spanOf(t: Span): Span {
  return { start: t.start, end: t.end };
}

function isFunctionName(t: LTok): boolean {
  // A name with an empty subscript (`ln_`) is a name being typed, not a function.
  return (
    t.kind === 'ident' && t.sub !== '' && (t.nameKind === 'builtinFn' || t.nameKind === 'userFn')
  );
}

/** Tokens after which the engine reads an implicit product (and a tolerant read, an operand). */
function startsOperand(t: LTok, absDepth: number): boolean {
  return (
    t.kind === 'num' ||
    t.kind === 'ident' ||
    t.kind === 'lparen' ||
    t.kind === 'error' ||
    (t.kind === 'pipe' && absDepth === 0)
  );
}

class LayoutParser {
  private readonly toks: LTok[];
  private pos = 0;
  /** Open `|` groups in the current parenthesis level; an infix `|` closes one when > 0. */
  private absDepth = 0;
  private parenDepth = 0;
  private depth = 0;

  constructor(toks: LTok[]) {
    this.toks = toks;
  }

  parseRoot(): LBlock {
    return this.parseBlock(0);
  }

  // ---- token helpers ----

  private peek(): LTok {
    return this.toks[this.pos] as LTok;
  }

  private advance(): LTok {
    const t = this.toks[this.pos] as LTok;
    if (t.kind !== 'eof') this.pos++;
    return t;
  }

  private get lastEnd(): number {
    return this.pos > 0 ? (this.toks[this.pos - 1] as LTok).end : 0;
  }

  private slot(): SlotL {
    const at = this.lastEnd;
    return { type: 'slot', span: { start: at, end: at } };
  }

  private errorNode(t: LTok): ErrorL {
    const node: ErrorL = { type: 'error', text: t.text, span: spanOf(t) };
    if (t.error) node.error = t.error;
    return node;
  }

  // ---- blocks ----

  /**
   * Expressions separated by commas and relations, up to whatever no expression takes: the end,
   * the closer of the group being read (`)`, or `|` inside `|…|`), or the `)` of an outer group.
   */
  private parseBlock(start: number): LBlock {
    const items: LNode[] = [];
    const seps: LSep[] = [];
    for (;;) {
      let item = this.parseExpr(0);
      // A `)` that closes nothing joins the expression as an error atom, which goes on after it.
      while (this.peek().kind === 'rparen' && this.parenDepth === 0) {
        const stray = this.errorNode(this.advance());
        item = this.implicit(item, stray);
        item = this.infix(item, 0, false);
      }
      items.push(item);
      const t = this.peek();
      if (t.kind !== 'comma' && t.kind !== 'rel') break;
      this.advance();
      seps.push({
        kind: t.kind,
        text: t.kind === 'rel' ? (t.text as RelOp) : ',',
        span: spanOf(t),
      });
    }
    const last = items[items.length - 1] as LNode;
    return { items, seps, span: { start, end: Math.max(start, last.span.end) } };
  }

  // ---- expressions ----

  private parseExpr(rbp: number, implicitArg = false): LNode {
    if (++this.depth > MAX_DEPTH) {
      const rest = this.swallowRest();
      this.depth--;
      return rest;
    }
    const node = this.infix(this.parsePrefix(), rbp, implicitArg);
    this.depth--;
    return node;
  }

  /** The rest of the row as one error atom (or a slot at its end). */
  private swallowRest(): LNode {
    const first = this.peek();
    if (first.kind === 'eof') return this.slot();
    while (this.peek().kind !== 'eof') this.advance();
    const end = this.lastEnd;
    return { type: 'error', text: '', span: { start: first.start, end } };
  }

  private infix(left: LNode, rbp: number, implicitArg: boolean): LNode {
    for (;;) {
      const t = this.peek();
      if (t.kind === 'op') {
        const op = t.text as BinaryL['op'];
        const lbp = op === '+' || op === '-' ? BP_ADD : op === '^' ? BP_POW : BP_MUL;
        if (lbp <= rbp) break;
        this.advance();
        const right = this.parseExpr(op === '^' ? BP_POW_RIGHT : lbp);
        const node: BinaryL = {
          type: 'binary',
          op,
          opSpan: spanOf(t),
          left,
          right,
          span: { start: left.span.start, end: Math.max(right.span.end, t.end) },
        };
        if (t.script) node.script = true;
        left = node;
      } else if (t.kind === 'bang') {
        if (BP_POSTFIX <= rbp) break;
        this.advance();
        left = {
          type: 'postfix',
          opSpan: spanOf(t),
          arg: left,
          span: { start: left.span.start, end: t.end },
        };
      } else if (startsOperand(t, this.absDepth)) {
        // Implicit product. Inside `sin 2x` it binds tighter than `*` and `/` so the whole `2x`
        // is the argument, but a function name ends the argument: sin x cos x = (sin x)(cos x).
        const lbp = implicitArg && !isFunctionName(t) ? BP_IMPLICIT_ARG : BP_MUL;
        if (lbp <= rbp) break;
        left = this.implicit(left, this.parseExpr(lbp));
      } else {
        break;
      }
    }
    return left;
  }

  private implicit(left: LNode, right: LNode): BinaryL {
    return {
      type: 'binary',
      op: '*',
      implicit: true,
      left,
      right,
      span: { start: left.span.start, end: Math.max(left.span.end, right.span.end) },
    };
  }

  private parsePrefix(): LNode {
    const t = this.peek();
    switch (t.kind) {
      case 'num':
        this.advance();
        return this.numNode(t);
      case 'ident':
        if (isFunctionName(t)) return this.parseFunction();
        this.advance();
        return this.nameNode(t);
      case 'op':
        if (t.text === '-' || t.text === '+') {
          this.advance();
          const arg = this.parseExpr(BP_PREFIX);
          return this.unaryNode(t, arg);
        }
        break;
      case 'lparen':
        return this.parseParen();
      case 'pipe':
        return this.parseAbs();
      case 'error':
        this.advance();
        return this.errorNode(t);
      case 'rparen':
        if (this.parenDepth === 0) {
          this.advance();
          return this.errorNode(t);
        }
        break;
      default:
        break;
    }
    return this.slot();
  }

  private numNode(t: LTok): NumL {
    const node: NumL = {
      type: 'num',
      value: t.value ?? Number(t.text),
      text: t.text,
      span: spanOf(t),
    };
    if (t.script) node.script = true;
    return node;
  }

  private nameNode(t: LTok): NameL {
    const node: NameL = {
      type: 'name',
      name: t.text,
      kind: t.nameKind ?? 'unknown',
      span: spanOf(t),
    };
    if (t.sub !== undefined && t.subStart !== undefined) {
      node.sub = t.sub;
      node.subStart = t.subStart;
    }
    return node;
  }

  private unaryNode(t: LTok, arg: LNode): UnaryL {
    const node: UnaryL = {
      type: 'unary',
      op: t.text === '-' ? '-' : '+',
      opSpan: spanOf(t),
      arg,
      span: { start: t.start, end: Math.max(t.end, arg.span.end) },
    };
    if (t.script) node.script = true;
    return node;
  }

  /** `(e)` grouping, `(a, b, …)` tuple. */
  private parseParen(): GroupL {
    const group = this.parseGroup();
    return { type: 'group', ...group, span: groupSpan(group) };
  }

  private parseGroup(): Group {
    const open = this.advance();
    const savedAbs = this.absDepth;
    this.absDepth = 0;
    this.parenDepth++;
    const body = this.parseBlock(open.end);
    const close = this.peek().kind === 'rparen' ? spanOf(this.advance()) : null;
    this.parenDepth--;
    this.absDepth = savedAbs;
    return { open: spanOf(open), close, body };
  }

  /** `|e|`. Called with a `|` in prefix position, which always opens a group. */
  private parseAbs(): AbsL {
    const bar = this.advance();
    this.absDepth++;
    const body = this.parseBlock(bar.end);
    const close = this.peek().kind === 'pipe' ? spanOf(this.advance()) : null;
    this.absDepth--;
    const group: Group = { open: spanOf(bar), close, body };
    return { type: 'abs', ...group, span: groupSpan(group) };
  }

  // ---- functions ----

  /** A builtin or user function name in prefix position. */
  private parseFunction(): CallL {
    const nameTok = this.advance();
    const name = nameTok.text;
    const isUser = nameTok.nameKind === 'userFn';
    const call: CallL = {
      type: 'call',
      callee: name,
      calleeKind: isUser ? 'userFn' : 'builtinFn',
      nameSpan: spanOf(nameTok),
      span: spanOf(nameTok),
    };

    const caret = this.peek();
    if (caret.kind === 'op' && caret.text === '^') {
      this.advance();
      call.power = { caret: spanOf(caret), node: this.parseFunctionPower() };
      if (caret.script) call.power.script = true;
    }

    if (this.peek().kind === 'lparen') {
      call.parens = this.parseGroup();
    } else if (!isUser && PREFIXABLE_FUNCTIONS.has(name)) {
      call.arg = this.canStartArgument(this.peek()) ? this.parseExpr(BP_MUL, true) : this.slot();
    }
    // A user function or min/max/… without parentheses is just its name: what follows is read
    // as a product with it, though the engine reports an error.
    const end = call.parens ? groupSpan(call.parens).end : (call.arg?.span.end ?? 0);
    call.span = { start: nameTok.start, end: Math.max(end, this.lastEnd) };
    return call;
  }

  private canStartArgument(t: LTok): boolean {
    return (
      t.kind === 'num' ||
      t.kind === 'ident' ||
      t.kind === 'lparen' ||
      t.kind === 'pipe' ||
      t.kind === 'error' ||
      (t.kind === 'op' && t.text === '-')
    );
  }

  /** The exponent in `sin^2 x`: one number, name or parenthesized expression, maybe negated. */
  private parseFunctionPower(): LNode {
    let t = this.peek();
    let sign: LTok | null = null;
    if (t.kind === 'op' && (t.text === '-' || t.text === '+')) {
      sign = this.advance();
      t = this.peek();
    }
    let base: LNode;
    if (t.kind === 'num') {
      this.advance();
      base = this.numNode(t);
    } else if (t.kind === 'ident' && !isFunctionName(t)) {
      this.advance();
      base = this.nameNode(t);
    } else if (t.kind === 'lparen') {
      base = this.parseParen();
    } else if (t.kind === 'error') {
      this.advance();
      base = this.errorNode(t);
    } else {
      base = this.slot();
    }
    return sign === null ? base : this.unaryNode(sign, base);
  }
}

function groupSpan(g: Group): Span {
  return {
    start: g.open.start,
    end: g.close ? g.close.end : Math.max(g.open.end, g.body.span.end),
  };
}

// ---- reading the tree ----

/** A call's arguments: the items of its parentheses, or its one unparenthesized argument. */
export function callArgs(call: CallL): LNode[] {
  if (call.arg) return [call.arg];
  if (!call.parens) return [];
  const { items } = call.parens.body;
  return items.length === 1 && items[0]?.type === 'slot' ? [] : items;
}

/**
 * Prints a node the way the engine's printNode prints its AST (print.ts): parentheses vanish,
 * `|x|` is `(abs x)`. Slots print as `_` and error atoms as `(error …)`, which the engine never
 * prints.
 */
export function printLayoutNode(node: LNode): string {
  switch (node.type) {
    case 'num':
      return String(node.value);
    case 'name':
      return node.sub === '' ? `${node.name}_` : node.name;
    case 'unary':
      return `(${node.op === '-' ? 'neg' : 'pos'} ${printLayoutNode(node.arg)})`;
    case 'binary':
      return `(${node.op} ${printLayoutNode(node.left)} ${printLayoutNode(node.right)})`;
    case 'postfix':
      return `(! ${printLayoutNode(node.arg)})`;
    case 'call': {
      const head = node.calleeKind === 'userFn' ? `call ${node.callee}` : node.callee;
      const call = `(${head} ${callArgs(node).map(printLayoutNode).join(' ')})`;
      return node.power ? `(^ ${call} ${printLayoutNode(node.power.node)})` : call;
    }
    case 'group': {
      const { items, seps } = node.body;
      if (seps.length === 0 && items[0]) return printLayoutNode(items[0]);
      return `(tuple ${printBlockItems(node.body)})`;
    }
    case 'abs':
      return `(abs ${printBlockItems(node.body)})`;
    case 'slot':
      return '_';
    case 'error':
      return `(error ${JSON.stringify(node.text)})`;
  }
}

function printBlockItems(block: LBlock): string {
  const parts = [printLayoutNode(block.items[0] as LNode)];
  block.seps.forEach((sep, i) => {
    if (sep.kind === 'rel') parts.push(sep.text);
    parts.push(printLayoutNode(block.items[i + 1] as LNode));
  });
  return parts.join(' ');
}

/** Prints a row like the engine's printStatement: `(empty)`, `(= y x)`, `(points …)`. */
export function printLayout(layout: Layout): string {
  const { items, seps } = layout.root;
  const [first] = items;
  if (seps.length === 0 && first) return first.type === 'slot' ? '(empty)' : printLayoutNode(first);
  if (seps.length === 1 && seps[0]?.kind === 'rel') {
    return `(${seps[0].text} ${printLayoutNode(first as LNode)} ${printLayoutNode(items[1] as LNode)})`;
  }
  if (seps.every((s) => s.kind === 'comma'))
    return `(points ${items.map(printLayoutNode).join(' ')})`;
  return `(row ${printBlockItems(layout.root)})`;
}

/** Whether a name reads upright: builtin function names (also as the base of `log_2`). */
export function isUprightName(name: string): boolean {
  const underscore = name.indexOf('_');
  return isBuiltinFunction(underscore < 0 ? name : name.slice(0, underscore));
}
