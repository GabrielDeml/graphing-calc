// Pratt parser: source text → Statement. See ast.ts for the tree and print.ts for its S-expression
// form.
//
// Binding powers, low to high:
//   + -                          10, left-assoc
//   * / and implicit products    20, left-assoc (`1/2x` = (1/2)·x)
//   prefix - +                   operand parsed at 25, so -x^2 = -(x^2)
//   ^                            30, right-assoc; the exponent may start with a prefix minus
//   postfix !                    40
// A number never starts an implicit product (`x2`, `2 3`, `(x+1)2` are errors), but may end one
// on the left (`2x`, `2(x+1)`, `2sin x`, `2|x|`).

import type { CallNode, NameNode, NameNodeKind, Node, NumNode, RelOp, Statement } from './ast';
import { BUILTIN_FUNCTIONS, isBuiltinFunction, PREFIXABLE_FUNCTIONS } from './builtinNames';
import { MathSyntaxError, mathError, replaceFix, syntaxError } from './errors';
import {
  EMPTY_CONTEXT,
  type NameContext,
  type NameKind,
  readsAsProductWithA,
  splitIdentifier,
} from './names';
import { tokenize } from './tokenizer';
import type { Token } from './tokens';
import type { MathError, QuickFix, Span } from './types';

export type ParseResult = { ok: true; statement: Statement } | { ok: false; error: MathError };

// Exported so the typeset editor can mirror the parser's extents exactly.
export const BP_ADD = 10;
export const BP_MUL = 20;
/** Implicit products inside an unparenthesized builtin argument bind tighter: sin 2x = sin(2x). */
export const BP_IMPLICIT_ARG = 21;
export const BP_PREFIX = 25;
export const BP_POW = 30;
export const BP_POW_RIGHT = 29;
export const BP_POSTFIX = 40;
/** Nesting limit, so pathological input gets an error instead of a stack overflow. */
const MAX_DEPTH = 256;

const INVERSE_NAMES: Readonly<Record<string, string>> = {
  sin: 'sine',
  cos: 'cosine',
  tan: 'tangent',
  sec: 'secant',
  csc: 'cosecant',
  cot: 'cotangent',
  sinh: 'hyperbolic sine',
  cosh: 'hyperbolic cosine',
  tanh: 'hyperbolic tangent',
  sech: 'hyperbolic secant',
  csch: 'hyperbolic cosecant',
  coth: 'hyperbolic cotangent',
};

/** A token after identifier splitting: each name unit is its own 'ident' with its kind. */
interface PTok extends Token {
  nameKind?: NameKind;
}

/**
 * Parses one row. Never throws: lexical and syntax errors (and unexpected internal failures, as
 * code 'internal') come back as `{ ok: false, error }`. Parsing stops at the first error.
 *
 * Unknown names are not errors here; they become 'name' nodes of kind 'unknown'. For a
 * function-definition row, pass its parameters in `ctx.params` and make sure `ctx.fns` maps the
 * row's own name to its parameter count, so the left side parses as a call.
 */
export function parse(source: string, ctx: NameContext = EMPTY_CONTEXT): ParseResult {
  try {
    const toks = splitNames(tokenize(source), ctx);
    return { ok: true, statement: new Parser(toks, source, ctx).parseStatement() };
  } catch (e) {
    if (e instanceof MathSyntaxError) return { ok: false, error: e.error };
    const detail = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      error: mathError('internal', 'Something went wrong reading this expression', undefined, {
        hint: detail,
      }),
    };
  }
}

function splitNames(tokens: Token[], ctx: NameContext): PTok[] {
  const out: PTok[] = [];
  for (const t of tokens) {
    if (t.kind !== 'ident') {
      out.push(t);
      continue;
    }
    for (const u of splitIdentifier(t, ctx)) {
      out.push({ kind: 'ident', text: u.name, start: u.start, end: u.end, nameKind: u.kind });
    }
  }
  return out;
}

function spanOf(t: Span): Span {
  return { start: t.start, end: t.end };
}

function nameNode(t: PTok): NameNode {
  const k = t.nameKind;
  const kind: NameNodeKind = k === undefined || k === 'builtinFn' || k === 'userFn' ? 'unknown' : k;
  return { type: 'name', name: t.text, kind, span: spanOf(t) };
}

function isFunctionName(t: PTok): boolean {
  return t.kind === 'ident' && (t.nameKind === 'builtinFn' || t.nameKind === 'userFn');
}

function isMinusOne(node: Node): boolean {
  return (
    node.type === 'unary' && node.op === '-' && node.arg.type === 'num' && node.arg.value === 1
  );
}

function argumentPlaceholder(arity: number): string {
  if (arity <= 1) return 'x';
  return 'abcdefgh'.slice(0, Math.min(arity, 8)).split('').join(', ');
}

function describeArity(arities: readonly number[]): string {
  const [first = 1, second] = arities;
  if (second === Number.POSITIVE_INFINITY) return `${first} or more arguments`;
  if (second !== undefined) return `${first} or ${second} arguments`;
  return first === 1 ? '1 argument' : `${first} arguments`;
}

function acceptsArity(arities: readonly number[], n: number): boolean {
  const [first = 1, second] = arities;
  if (second === Number.POSITIVE_INFINITY) return n >= first;
  return arities.includes(n);
}

class Parser {
  private readonly toks: PTok[];
  private readonly source: string;
  private readonly ctx: NameContext;
  private pos = 0;
  /** Open `|` groups in the current parenthesis level; an infix `|` closes one when > 0. */
  private absDepth = 0;
  private parenDepth = 0;
  private depth = 0;

  constructor(toks: PTok[], source: string, ctx: NameContext) {
    this.toks = toks;
    this.source = source;
    this.ctx = ctx;
  }

  parseStatement(): Statement {
    if (this.peek().kind === 'eof') return { type: 'empty' };
    const first = this.parseExpr(0);
    const t = this.peek();

    if (t.kind === 'comma') {
      const items = [first];
      while (this.peek().kind === 'comma') {
        this.advance();
        items.push(this.parseExpr(0));
      }
      const after = this.peek();
      if (after.kind === 'rel') this.listRelation(after);
      this.expectEnd();
      return { type: 'exprs', items };
    }

    if (t.kind === 'rel') {
      this.advance();
      const right = this.parseExpr(0);
      const after = this.peek();
      if (after.kind === 'rel') {
        const inequalities = t.text !== '=' && after.text !== '=';
        syntaxError(
          'chained-relation',
          inequalities
            ? "Chained inequalities aren't supported yet"
            : "A row can have only one '=', '<' or '>'",
          spanOf(after),
        );
      }
      if (after.kind === 'comma') this.listRelation(after);
      this.expectEnd();
      return { type: 'relation', op: t.text as RelOp, left: first, right, opSpan: spanOf(t) };
    }

    this.expectEnd();
    return { type: 'exprs', items: [first] };
  }

  // ---- token helpers ----

  private peek(): PTok {
    return this.toks[this.pos] as PTok;
  }

  /** Consumes and returns the current token; never moves past 'eof'. */
  private advance(): PTok {
    const t = this.toks[this.pos] as PTok;
    if (t.kind !== 'eof') this.pos++;
    return t;
  }

  private get lastEnd(): number {
    return this.pos > 0 ? (this.toks[this.pos - 1] as PTok).end : 0;
  }

  private sourceText(t: Span): string {
    return this.source.slice(t.start, t.end);
  }

  private expectEnd(): void {
    const t = this.peek();
    if (t.kind === 'eof') return;
    if (t.kind === 'rparen') {
      syntaxError('unexpected-rparen', "Unmatched ')'", spanOf(t), "There's no '(' to close");
    }
    syntaxError('unexpected-token', `Unexpected '${this.sourceText(t)}'`, spanOf(t));
  }

  private listRelation(t: PTok): never {
    syntaxError(
      'list-relation',
      "A list of points can't be part of an equation or inequality",
      spanOf(t),
    );
  }

  // ---- expressions ----

  private parseExpr(rbp: number, implicitArg = false): Node {
    if (++this.depth > MAX_DEPTH) {
      syntaxError('too-deep', 'This expression is nested too deeply', spanOf(this.peek()));
    }
    // Extent start of `left`: covers parentheses around it, unlike left.span.
    const start = this.peek().start;
    let left = this.parsePrefix();

    for (;;) {
      const t = this.peek();
      if (t.kind === 'op') {
        const op = t.text as '+' | '-' | '*' | '/' | '^';
        const lbp = op === '+' || op === '-' ? BP_ADD : op === '^' ? BP_POW : BP_MUL;
        if (lbp <= rbp) break;
        this.advance();
        const right = this.parseExpr(op === '^' ? BP_POW_RIGHT : lbp);
        left = { type: 'binary', op, left, right, span: { start, end: this.lastEnd } };
      } else if (t.kind === 'bang') {
        if (BP_POSTFIX <= rbp) break;
        this.advance();
        left = { type: 'postfix', op: '!', arg: left, span: { start, end: t.end } };
      } else if (t.kind === 'num') {
        this.missingOperator(t, start);
      } else if (
        t.kind === 'ident' ||
        t.kind === 'lparen' ||
        (t.kind === 'pipe' && this.absDepth === 0)
      ) {
        // Implicit product. Inside `sin 2x` it binds tighter than `*` and `/` so the whole `2x`
        // is the argument, but a function name ends the argument: sin x cos x = (sin x)(cos x).
        const lbp = implicitArg && !isFunctionName(t) ? BP_IMPLICIT_ARG : BP_MUL;
        if (lbp <= rbp) break;
        const right = this.parseExpr(lbp);
        left = {
          type: 'binary',
          op: '*',
          left,
          right,
          implicit: true,
          span: { start, end: this.lastEnd },
        };
      } else {
        break;
      }
    }

    this.depth--;
    return left;
  }

  private parsePrefix(): Node {
    const t = this.peek();
    switch (t.kind) {
      case 'num':
        this.advance();
        return this.numNode(t);
      case 'ident':
        if (t.nameKind === 'builtinFn' || t.nameKind === 'userFn') return this.parseFunction();
        this.advance();
        return nameNode(t);
      case 'op':
        if (t.text === '-' || t.text === '+') {
          this.advance();
          const arg = this.parseExpr(BP_PREFIX);
          return { type: 'unary', op: t.text, arg, span: { start: t.start, end: this.lastEnd } };
        }
        break;
      case 'lparen':
        return this.parseParen();
      case 'pipe':
        return this.parseAbs();
      case 'rparen':
        if (this.parenDepth === 0) {
          syntaxError('unexpected-rparen', "Unmatched ')'", spanOf(t), "There's no '(' to close");
        }
        break;
      default:
        break;
    }
    return this.expectedExpression(t);
  }

  private numNode(t: PTok): NumNode {
    return { type: 'num', value: t.value ?? Number(t.text), span: spanOf(t) };
  }

  private expectedExpression(t: PTok): never {
    const prev = this.pos > 0 ? (this.toks[this.pos - 1] as PTok) : null;
    if (t.kind === 'eof') {
      if (prev === null) syntaxError('expected-expr', 'Expected an expression', spanOf(t));
      if (prev.kind === 'lparen') syntaxError('missing-rparen', "Missing ')'", spanOf(prev));
      syntaxError(
        'expected-expr',
        `Expected an expression after '${this.sourceText(prev)}'`,
        spanOf(prev),
      );
    }
    syntaxError(
      'expected-expr',
      prev
        ? `Expected an expression after '${this.sourceText(prev)}'`
        : `Expected an expression before '${this.sourceText(t)}'`,
      spanOf(t),
    );
  }

  private missingOperator(num: PTok, leftStart: number): never {
    const numText = this.sourceText(num);
    const prev = this.toks[this.pos - 1] as PTok;
    const beforePrev = this.pos >= 2 ? (this.toks[this.pos - 2] as PTok) : null;
    let hint: string;
    // The rewrites the hint names, as fixes.
    const fixes: QuickFix[] = [];
    if (
      prev.kind === 'ident' &&
      (prev.text === 'e' || prev.text === 'E') &&
      prev.end === num.start &&
      beforePrev?.kind === 'num' &&
      beforePrev.end === prev.start
    ) {
      const power = `${this.sourceText(beforePrev)}*10^${numText}`;
      hint = `Scientific notation isn't supported; write ${power}`;
      fixes.push(replaceFix({ start: beforePrev.start, end: num.end }, power));
    } else if (prev.kind === 'num') {
      hint = 'Use * to multiply numbers';
      const product = `${this.sourceText(prev)}*${numText}`;
      fixes.push(replaceFix({ start: prev.start, end: num.end }, product));
    } else {
      const left = this.source.slice(leftStart, prev.end);
      if (left.length <= 16) {
        hint = `Did you mean ${left}^${numText} or ${numText}${left}?`;
        const span = { start: leftStart, end: num.end };
        fixes.push(replaceFix(span, `${left}^${numText}`));
        // The number first, unless it would run into what comes before (`3x2` is not `32x`).
        const before = this.source.slice(0, leftStart).trimEnd().at(-1);
        if (before === undefined || '+-−*·×/÷=<>≤≥(,'.includes(before)) {
          fixes.push(replaceFix(span, `${numText}${left}`));
        }
      } else {
        hint = `Write the number first, or put * before ${numText}`;
      }
    }
    syntaxError('missing-operator', `Missing operator before ${numText}`, spanOf(num), hint, fixes);
  }

  /** `(e)` grouping, `(a, b, …)` tuple. */
  private parseParen(): Node {
    const open = this.advance();
    const first = this.peek();
    if (first.kind === 'rparen') {
      this.advance();
      syntaxError('empty-parens', 'Empty parentheses', { start: open.start, end: first.end });
    }
    if (first.kind === 'eof') syntaxError('missing-rparen', "Missing ')'", spanOf(open));

    const savedAbs = this.absDepth;
    this.absDepth = 0;
    this.parenDepth++;
    const items = [this.parseExpr(0)];
    while (this.peek().kind === 'comma') {
      this.advance();
      items.push(this.parseExpr(0));
    }
    const close = this.expectClose(open);
    this.parenDepth--;
    this.absDepth = savedAbs;

    const [only] = items;
    if (items.length === 1 && only) return only;
    return { type: 'tuple', items, span: { start: open.start, end: close.end } };
  }

  private expectClose(open: PTok): PTok {
    const t = this.peek();
    if (t.kind === 'rparen') return this.advance();
    if (t.kind === 'eof') {
      // Closed at the end, every group still open (the editor draws them there already).
      const close = replaceFix({ start: t.start, end: t.start }, ')'.repeat(this.parenDepth));
      syntaxError('missing-rparen', "Missing ')'", spanOf(open), undefined, [close]);
    }
    syntaxError(
      'unexpected-token',
      `Unexpected '${this.sourceText(t)}' inside parentheses`,
      spanOf(t),
    );
  }

  /** `|e|`. Called with a `|` in prefix position, which always opens a group. */
  private parseAbs(): Node {
    const bar = this.advance();
    const next = this.peek();
    if (
      next.kind === 'eof' ||
      next.kind === 'rparen' ||
      next.kind === 'comma' ||
      next.kind === 'rel'
    ) {
      syntaxError('missing-pipe', "Missing closing '|'", spanOf(bar));
    }
    this.absDepth++;
    const inner = this.parseExpr(0);
    const close = this.peek();
    if (close.kind !== 'pipe') syntaxError('missing-pipe', "Missing closing '|'", spanOf(bar));
    this.advance();
    this.absDepth--;
    return {
      type: 'call',
      callee: 'abs',
      calleeKind: 'builtinFn',
      args: [inner],
      span: { start: bar.start, end: close.end },
    };
  }

  // ---- functions ----

  /** A builtin or user function name in prefix position. */
  private parseFunction(): Node {
    const nameTok = this.advance();
    const name = nameTok.text;
    const isUser = nameTok.nameKind === 'userFn';

    let power: Node | undefined;
    const caret = this.peek();
    if (caret.kind === 'op' && caret.text === '^') {
      this.advance();
      power = this.parseFunctionPower(caret);
      if (isMinusOne(power)) this.useInverse(nameTok, isUser);
    }

    if (this.peek().kind === 'lparen') return this.parseCall(nameTok, power);

    if (isUser || !PREFIXABLE_FUNCTIONS.has(name)) {
      const arity = isUser
        ? (this.ctx.fns.get(name) ?? 1)
        : ((BUILTIN_FUNCTIONS as Record<string, readonly number[]>)[name]?.[0] ?? 1);
      syntaxError(
        'fn-needs-call',
        `'${name}' is a function, so call it like ${name}(${argumentPlaceholder(arity)})`,
        spanOf(nameTok),
      );
    }
    if (!this.canStartArgument(this.peek())) {
      syntaxError('fn-needs-call', `'${name}' needs an argument, like ${name}(x)`, {
        start: nameTok.start,
        end: this.lastEnd,
      });
    }
    const arg = this.parseExpr(BP_MUL, true);
    return this.callNode(name, 'builtinFn', [arg], power, {
      start: nameTok.start,
      end: this.lastEnd,
    });
  }

  private canStartArgument(t: PTok): boolean {
    return (
      t.kind === 'num' ||
      t.kind === 'ident' ||
      t.kind === 'lparen' ||
      t.kind === 'pipe' ||
      (t.kind === 'op' && t.text === '-')
    );
  }

  /** The exponent in `sin^2 x`: one number, name or parenthesized expression, maybe negated. */
  private parseFunctionPower(caret: PTok): Node {
    let t = this.peek();
    let sign: PTok | null = null;
    if (t.kind === 'op' && (t.text === '-' || t.text === '+')) {
      sign = this.advance();
      t = this.peek();
    }
    let base: Node;
    if (t.kind === 'num') {
      this.advance();
      base = this.numNode(t);
    } else if (t.kind === 'ident' && !isFunctionName(t)) {
      this.advance();
      base = nameNode(t);
    } else if (t.kind === 'lparen') {
      base = this.parseParen();
    } else {
      syntaxError(
        'expected-expr',
        "Expected an exponent after '^'",
        spanOf(t.kind === 'eof' ? (sign ?? caret) : t),
      );
    }
    if (sign === null) return base;
    return {
      type: 'unary',
      op: sign.text === '-' ? '-' : '+',
      arg: base,
      span: { start: sign.start, end: this.lastEnd },
    };
  }

  private useInverse(nameTok: PTok, isUser: boolean): never {
    const name = nameTok.text;
    // With a user variable `a`, `asin` reads as a·sin, so suggest the `arc…` spelling.
    const inverse = readsAsProductWithA(`a${name}`, this.ctx) ? `arc${name}` : `a${name}`;
    const span = { start: nameTok.start, end: this.lastEnd };
    const reciprocal = `For the reciprocal, write 1/${name}(x)`;
    if (!isUser && isBuiltinFunction(inverse)) {
      const what = INVERSE_NAMES[name] ?? `of ${name}`;
      syntaxError('use-inverse', `Use ${inverse}(x) for the inverse ${what}`, span, reciprocal, [
        replaceFix(span, inverse),
      ]);
    }
    syntaxError('use-inverse', `${name}^-1 isn't supported`, span, reciprocal);
  }

  private parseCall(nameTok: PTok, power: Node | undefined): Node {
    const open = this.advance();
    const savedAbs = this.absDepth;
    this.absDepth = 0;
    this.parenDepth++;
    const args: Node[] = [];
    let close: PTok;
    const first = this.peek();
    if (first.kind === 'rparen') {
      close = this.advance();
    } else {
      if (first.kind === 'eof') syntaxError('missing-rparen', "Missing ')'", spanOf(open));
      args.push(this.parseExpr(0));
      while (this.peek().kind === 'comma') {
        this.advance();
        args.push(this.parseExpr(0));
      }
      close = this.expectClose(open);
    }
    this.parenDepth--;
    this.absDepth = savedAbs;

    const span = { start: nameTok.start, end: close.end };
    const isUser = nameTok.nameKind === 'userFn';
    this.checkArity(nameTok.text, isUser, args.length, span);
    return this.callNode(nameTok.text, isUser ? 'userFn' : 'builtinFn', args, power, span);
  }

  private checkArity(name: string, isUser: boolean, n: number, span: Span): void {
    let arities: readonly number[];
    if (isUser) {
      const arity = this.ctx.fns.get(name);
      if (arity === undefined) return;
      arities = [arity];
    } else {
      const known = (BUILTIN_FUNCTIONS as Record<string, readonly number[]>)[name];
      if (known === undefined) return;
      arities = known;
    }
    if (acceptsArity(arities, n)) return;
    syntaxError('arity', `${name} takes ${describeArity(arities)}, got ${n}`, span);
  }

  private callNode(
    callee: string,
    calleeKind: 'builtinFn' | 'userFn',
    args: Node[],
    power: Node | undefined,
    span: Span,
  ): CallNode {
    const node: CallNode = { type: 'call', callee, calleeKind, args, span };
    if (power) node.power = power;
    return node;
  }
}
