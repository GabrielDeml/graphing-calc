// Render plan: what the typeset view draws for a layout. Boxes in visual order, each with its
// source span: atoms (prettified text: π θ ≤ ≥ − ·), fractions, superscripts, radicals and
// fences, with TeX's spacing between them. The DOM renderer (components/MathView.tsx) only
// turns boxes into elements; error marks and caret stops are worked out here.

import type { Span } from '../engine/types';
import {
  type Group,
  isUprightName,
  type Layout,
  type LBlock,
  type LNode,
  type NameL,
} from './layout';

/**
 * How deep boxes nest. The layout bounds its own recursion, not its left chains: `1/x/x/x…` nests
 * a fraction in each numerator. Deeper boxes are drawn as their text, so nothing that walks a plan
 * (or its elements) goes deeper; browsers stall on a few hundred nested fraction elements, and
 * nothing this deep is readable anyway.
 */
export const MAX_PLAN_DEPTH = 64;

/** Space before a box: none, thin, medium or thick (TeX's 3, 4 and 5 mu). */
export type Space = 0 | 1 | 2 | 3;

export type AtomRole =
  /** Italic letters: variables, constants, user functions. */
  | 'var'
  /** Upright digits. */
  | 'num'
  /** Upright builtin function names. */
  | 'fn'
  /** Operators and `!`. */
  | 'op'
  | 'rel'
  | 'punct'
  /** Parentheses and absolute value bars. */
  | 'paren'
  /** Text that isn't math, or math nested too deep to typeset. */
  | 'err';

interface BoxBase {
  /** Everything of the source the box draws. */
  span: Span;
  space: Space;
  /** Source text drawn as structure, not as characters: `/`, `^`, `_`, invisible parentheses. */
  hidden?: Span[];
  /** It ends inside an unclosed group, so nothing typed can go after it. */
  unclosed?: true;
}

export interface AtomBox extends BoxBase {
  kind: 'atom';
  text: string;
  role: AtomRole;
  /** The text is the source's, character for character, so a caret can stop inside it. */
  chars?: true;
  /** A name's subscript (`a_1`, `v_{max}`), from `subStart`, the `_`. */
  sub?: Block;
  subStart?: number;
}

/** An empty place: a missing operand. */
export interface SlotBox extends BoxBase {
  kind: 'slot';
}

export interface FracBox extends BoxBase {
  kind: 'frac';
  num: Block;
  den: Block;
}

/** An exponent; it follows its base in the same block. */
export interface SupBox extends BoxBase {
  kind: 'sup';
  body: Block;
  /** Written with superscript characters (`x²`): one unit, no caret inside. */
  atomic?: true;
}

export interface RadicalBox extends BoxBase {
  kind: 'radical';
  /** '3' for a cube root. */
  index: string | null;
  body: Block;
}

/** Parentheses or absolute value bars around a block. */
export interface FenceBox extends BoxBase {
  kind: 'fence';
  bars: boolean;
  open: AtomBox;
  /** null while unclosed (the focused row draws a ghost closer). */
  close: AtomBox | null;
  body: Block;
  /** Holds something taller than a line (a fraction): drawn delimiters stretch to fit. */
  tall: boolean;
}

export type Box = AtomBox | SlotBox | FracBox | SupBox | RadicalBox | FenceBox;

export interface Block {
  boxes: Box[];
  /** Where a caret at its start and at its end sits in the source. */
  start: number;
  end: number;
  depth: number;
  /** Script style (exponents, subscripts): smaller, and no medium or thick spaces. */
  script: boolean;
}

export interface Plan {
  source: string;
  root: Block;
}

// ---- spacing ----

type SpaceClass = 'ord' | 'op' | 'bin' | 'rel' | 'open' | 'close' | 'punct' | 'inner';

/**
 * TeX's spacing table (The TeXbook, chapter 18): rows are the left box's class, columns the
 * right one's. Negative entries apply only outside scripts.
 */
const SPACING: Record<SpaceClass, Record<SpaceClass, number>> = {
  ord: { ord: 0, op: 1, bin: -2, rel: -3, open: 0, close: 0, punct: 0, inner: -1 },
  op: { ord: 1, op: 1, bin: 0, rel: -3, open: 0, close: 0, punct: 0, inner: -1 },
  bin: { ord: -2, op: -2, bin: 0, rel: 0, open: -2, close: 0, punct: 0, inner: -2 },
  rel: { ord: -3, op: -3, bin: 0, rel: 0, open: -3, close: 0, punct: 0, inner: -3 },
  open: { ord: 0, op: 0, bin: 0, rel: 0, open: 0, close: 0, punct: 0, inner: 0 },
  close: { ord: 0, op: 1, bin: -2, rel: -3, open: 0, close: 0, punct: 0, inner: -1 },
  punct: { ord: -1, op: -1, bin: 0, rel: -1, open: -1, close: -1, punct: -1, inner: -1 },
  inner: { ord: -1, op: 1, bin: -2, rel: -3, open: -1, close: 0, punct: -1, inner: -1 },
};

/** Each box's class on its left and right side, for spacing (kept off the public boxes). */
const classes = new WeakMap<Box, readonly [SpaceClass, SpaceClass]>();

function classOf(box: Box, side: 0 | 1): SpaceClass {
  return classes.get(box)?.[side] ?? 'ord';
}

function isSpaceChar(c: number): boolean {
  return c === 32 || (c >= 9 && c <= 13) || c === 0xa0 || (c >= 0x2000 && c <= 0x200b);
}

// ---- prettified text ----

const RELATIONS: Readonly<Record<string, string>> = { '<=': '≤', '>=': '≥' };

/** `*` shows as a centered dot; a typed × stays. */
function timesText(source: string, span: Span): string {
  return source.slice(span.start, span.end) === '×' ? '×' : '·';
}

function nameText(name: string): string {
  const underscore = name.indexOf('_');
  const base = underscore < 0 ? name : name.slice(0, underscore);
  if (base === 'pi') return 'π';
  if (base === 'tau') return 'τ';
  if (base === 'theta') return 'θ';
  return base;
}

// ---- building ----

class Builder {
  constructor(private readonly source: string) {}

  atom(
    text: string,
    role: AtomRole,
    span: Span,
    cls: SpaceClass | readonly [SpaceClass, SpaceClass],
  ): AtomBox {
    const box: AtomBox = { kind: 'atom', text, role, span: { ...span }, space: 0 };
    classes.set(box, typeof cls === 'string' ? [cls, cls] : cls);
    return box;
  }

  /**
   * A block of one node; a parenthesized group that fills it draws no parentheses. While the
   * group is unclosed it keeps its `(`, so the row doesn't look finished (and "Missing ')'" marks
   * a symbol that is there).
   */
  nodeBlock(node: LNode, depth: number, script: boolean): { block: Block; hidden: Span[] } {
    if (node.type === 'group' && node.body.seps.length === 0 && node.close) {
      const block = this.groupBlock(node, depth, script);
      return { block, hidden: [node.open, node.close] };
    }
    const boxes: Box[] = [];
    this.emit(node, boxes, depth, script);
    return { block: this.finish(boxes, node.span.start, node.span.end, depth, script), hidden: [] };
  }

  /** The inside of a group as a block, from after its opener to its closer. */
  groupBlock(g: Group, depth: number, script: boolean): Block {
    const boxes: Box[] = [];
    this.emitBlock(g.body, boxes, depth, script);
    const end = g.close ? g.close.start : Math.max(g.open.end, g.body.span.end);
    return this.finish(boxes, g.open.end, end, depth, script);
  }

  /** Sets the spaces between a block's boxes and wraps them up. */
  finish(boxes: Box[], start: number, end: number, depth: number, script: boolean): Block {
    let prevRight: SpaceClass | null = null;
    let prev: Box | null = null;
    boxes.forEach((box, i) => {
      // A superscript hugs its base; the base's class goes on to the right.
      if (box.kind === 'sup') return;
      if (prevRight !== null && prev !== null) {
        let space = SPACING[prevRight][classOf(box, 0)] ?? 0;
        if (space < 0) space = script ? 0 : -space;
        // Text that isn't math keeps the gaps it was typed with (`y == 2` reads like a relation),
        // and two numbers side by side (a missing operator) don't read as one (`2 3` isn't 23).
        if (
          (isError(prev) && this.spaceAfter(prev)) ||
          (isError(box) && this.spaceBefore(box)) ||
          (isNumber(prev) && isNumber(box) && boxes[i - 1] === prev)
        ) {
          space = 3;
        }
        box.space = space as Space;
      }
      prevRight = classOf(box, 1);
      prev = box;
    });
    return { boxes, start, end, depth, script };
  }

  private spaceBefore(box: Box): boolean {
    return box.span.start > 0 && isSpaceChar(this.source.charCodeAt(box.span.start - 1));
  }

  private spaceAfter(box: Box): boolean {
    return isSpaceChar(this.source.charCodeAt(box.span.end));
  }

  /** Items and separators of a row or group, in order. */
  emitBlock(block: LBlock, out: Box[], depth: number, script: boolean): void {
    block.items.forEach((item, i) => {
      if (i > 0) {
        const sep = block.seps[i - 1];
        if (sep) {
          out.push(
            sep.kind === 'comma'
              ? this.atom(',', 'punct', sep.span, 'punct')
              : this.atom(RELATIONS[sep.text] ?? sep.text, 'rel', sep.span, 'rel'),
          );
        }
      }
      this.emit(item, out, depth, script);
    });
  }

  emit(node: LNode, out: Box[], depth: number, script: boolean): void {
    if (depth > MAX_PLAN_DEPTH) {
      const { start, end } = node.span;
      const box = this.atom(this.source.slice(start, end), 'err', node.span, 'ord');
      if (end - start > 1) box.chars = true;
      out.push(box);
      return;
    }
    // Sums and products chain to the left; walk the chain instead of recursing down it.
    const chain: LNode[] = [];
    let n = node;
    while (n.type === 'binary' && n.op !== '/' && n.op !== '^') {
      chain.push(n);
      n = n.left;
    }
    this.emitOne(n, out, depth, script);
    for (let i = chain.length - 1; i >= 0; i--) {
      const b = chain[i];
      if (b?.type !== 'binary') continue;
      if (b.opSpan && !b.implicit) {
        const text = b.op === '*' ? timesText(this.source, b.opSpan) : b.op === '-' ? '−' : '+';
        out.push(this.atom(text, 'op', b.opSpan, 'bin'));
      }
      this.emit(b.right, out, depth, script);
    }
  }

  private emitOne(node: LNode, out: Box[], depth: number, script: boolean): void {
    switch (node.type) {
      case 'num': {
        const box = this.atom(node.text, 'num', node.span, 'ord');
        if (!node.script && node.text.length > 1) box.chars = true;
        out.push(box);
        return;
      }
      case 'name':
        out.push(this.name(node, depth));
        return;
      case 'unary':
        out.push(this.atom(node.op === '-' ? '−' : '+', 'op', node.opSpan, 'ord'));
        this.emit(node.arg, out, depth, script);
        return;
      case 'binary':
        if (node.op === '^') {
          this.emit(node.left, out, depth, script);
          out.push(this.sup(node.right, node.opSpan, node.script === true, depth));
        } else {
          out.push(this.frac(node.left, node.right, node.opSpan, node.span, depth, script));
        }
        return;
      case 'postfix': {
        // `x!!!` chains to the left too.
        const bangs: Span[] = [];
        let arg: LNode = node;
        while (arg.type === 'postfix') {
          bangs.push(arg.opSpan);
          arg = arg.arg;
        }
        this.emit(arg, out, depth, script);
        for (let i = bangs.length - 1; i >= 0; i--) {
          out.push(this.atom('!', 'op', bangs[i] as Span, 'close'));
        }
        return;
      }
      case 'call':
        this.call(node, out, depth, script);
        return;
      case 'group':
      case 'abs':
        out.push(this.fence(node, node.type === 'abs', node.span, depth, script));
        return;
      case 'slot': {
        const box: SlotBox = { kind: 'slot', span: { ...node.span }, space: 0 };
        out.push(box);
        return;
      }
      case 'error': {
        const written = this.source.slice(node.span.start, node.span.end);
        const box = this.atom(node.text || written, 'err', node.span, 'ord');
        if (box.text.length > 1 && box.text === written) box.chars = true;
        out.push(box);
        return;
      }
    }
  }

  private name(node: NameL, depth: number): AtomBox {
    const baseEnd = node.subStart ?? node.span.end;
    const written = this.source.slice(node.span.start, baseEnd);
    const text = nameText(node.name);
    const upright = isUprightName(node.name);
    const box = this.atom(text, upright ? 'fn' : 'var', node.span, 'ord');
    if (text.length > 1 && text === written) box.chars = true;
    if (node.sub !== undefined && node.subStart !== undefined) {
      const braced = this.source.charCodeAt(node.subStart + 1) === 123;
      const start = node.subStart + (braced ? 2 : 1);
      const end = start + node.sub.length;
      const hidden: Span[] = [{ start: node.subStart, end: start }];
      if (braced) hidden.push({ start: end, end: end + 1 });
      const digits = /^\d+$/.test(node.sub);
      const atom = this.atom(node.sub, digits ? 'num' : 'var', { start, end }, 'ord');
      if (node.sub.length > 1) atom.chars = true;
      box.sub = this.finish([atom], start, end, depth + 1, true);
      box.subStart = node.subStart;
      box.hidden = hidden;
    }
    return box;
  }

  private sup(exp: LNode, caret: Span | undefined, atomic: boolean, depth: number): SupBox {
    const { block, hidden } = this.nodeBlock(exp, depth + 1, true);
    const start = atomic ? exp.span.start : (caret?.start ?? exp.span.start);
    const box: SupBox = {
      kind: 'sup',
      body: block,
      span: { start, end: Math.max(exp.span.end, caret?.end ?? 0) },
      space: 0,
    };
    if (atomic) box.atomic = true;
    else if (caret) hidden.unshift(caret);
    if (hidden.length > 0) box.hidden = hidden;
    if (endsOpen(exp, block)) box.unclosed = true;
    return box;
  }

  private frac(
    left: LNode,
    right: LNode,
    bar: Span | undefined,
    span: Span,
    depth: number,
    script: boolean,
  ): FracBox {
    const num = this.nodeBlock(left, depth + 1, script);
    const den = this.nodeBlock(right, depth + 1, script);
    const hidden = [...num.hidden, ...(bar ? [bar] : []), ...den.hidden];
    const box: FracBox = {
      kind: 'frac',
      num: num.block,
      den: den.block,
      span: { ...span },
      space: 0,
      hidden,
    };
    classes.set(box, ['inner', 'inner']);
    if (endsOpen(right, den.block)) box.unclosed = true;
    return box;
  }

  private fence(g: Group, bars: boolean, span: Span, depth: number, script: boolean): FenceBox {
    const delim = bars ? '|' : null;
    const open = this.atom(delim ?? '(', 'paren', g.open, 'open');
    const close = g.close ? this.atom(delim ?? ')', 'paren', g.close, 'close') : null;
    const body = this.groupBlock(g, depth + 1, script);
    const box: FenceBox = {
      kind: 'fence',
      bars,
      open,
      close,
      body,
      tall: isTall(body),
      span: { ...span },
      space: 0,
    };
    classes.set(box, ['open', 'close']);
    if (!close) box.unclosed = true;
    return box;
  }

  private call(
    node: Extract<LNode, { type: 'call' }>,
    out: Box[],
    depth: number,
    script: boolean,
  ): void {
    const root =
      node.calleeKind === 'builtinFn' && (node.callee === 'sqrt' || node.callee === 'cbrt');
    if (root && !node.power && (node.arg || node.parens?.body.seps.length === 0)) {
      const index = node.callee === 'cbrt' ? '3' : null;
      let body: Block;
      const hidden = [node.nameSpan];
      if (node.parens?.close) {
        body = this.groupBlock(node.parens, depth + 1, script);
        hidden.push(node.parens.open, node.parens.close);
      } else if (node.parens) {
        // Unclosed: its `(` shows, as in nodeBlock.
        const { parens } = node;
        const fence = this.fence(parens, false, groupExtent(parens), depth + 1, script);
        body = this.finish([fence], parens.open.start, fence.span.end, depth + 1, script);
      } else {
        const arg = node.arg as LNode;
        body = this.nodeBlock(arg, depth + 1, script).block;
      }
      const box: RadicalBox = {
        kind: 'radical',
        index,
        body,
        span: { ...node.span },
        space: 0,
        hidden,
      };
      const unclosed = node.parens ? !node.parens.close : endsOpen(node.arg as LNode, body);
      if (unclosed) box.unclosed = true;
      out.push(box);
      return;
    }

    const name = this.source.slice(node.nameSpan.start, node.nameSpan.end);
    const builtin = node.calleeKind === 'builtinFn';
    out.push(this.atom(name, builtin ? 'fn' : 'var', node.nameSpan, builtin ? 'op' : 'ord'));
    if (node.power) {
      out.push(this.sup(node.power.node, node.power.caret, node.power.script === true, depth));
    }
    if (node.parens) {
      out.push(this.fence(node.parens, false, groupExtent(node.parens), depth, script));
    } else if (node.arg) {
      this.emit(node.arg, out, depth, script);
    }
  }
}

function isError(box: Box): boolean {
  return box.kind === 'atom' && box.role === 'err';
}

function isNumber(box: Box): boolean {
  return box.kind === 'atom' && box.role === 'num';
}

function groupExtent(g: Group): Span {
  return {
    start: g.open.start,
    end: g.close ? g.close.end : Math.max(g.open.end, g.body.span.end),
  };
}

/** Whether a node's text ends inside an unclosed group (judged from the block drawn for it). */
function endsOpen(node: LNode, block: Block): boolean {
  if (node.type === 'group' && node.body.seps.length === 0) {
    if (!node.close) return true;
  }
  const last = block.boxes[block.boxes.length - 1];
  return last?.unclosed === true;
}

/** Holds a fraction or a radical: a line's parentheses would be too short. */
function isTall(block: Block): boolean {
  return block.boxes.some((b) => {
    switch (b.kind) {
      case 'frac':
      case 'radical':
        return true;
      case 'fence':
        return b.tall;
      case 'sup':
        return isTall(b.body);
      default:
        return false;
    }
  });
}

/** A plan that draws the whole source as plain text. */
export function flatPlan(source: string): Plan {
  const boxes: Box[] = [];
  if (source.trim() !== '') {
    const span = { start: 0, end: source.length };
    boxes.push({ kind: 'atom', text: source, role: 'err', span, space: 0, chars: true });
  }
  return { source, root: { boxes, start: 0, end: source.length, depth: 0, script: false } };
}

/** The render plan of a layout. Never throws. */
export function renderPlan(layout: Layout): Plan {
  const { source } = layout;
  const builder = new Builder(source);
  const boxes: Box[] = [];
  const { items, seps } = layout.root;
  // An empty row draws nothing (the view shows its placeholder).
  if (!(seps.length === 0 && items[0]?.type === 'slot')) {
    builder.emitBlock(layout.root, boxes, 0, false);
  }
  return { source, root: builder.finish(boxes, 0, source.length, 0, false) };
}

// ---- reading a plan ----

/** A box drawn as characters: what error marks go on and what a click lands on. */
export type Leaf = AtomBox | SlotBox;

/** Calls `visit` on every leaf in visual order (fence delimiters around their body). */
export function forEachLeaf(block: Block, visit: (leaf: Leaf) => void): void {
  for (const box of block.boxes) {
    switch (box.kind) {
      case 'atom':
        visit(box);
        if (box.sub) forEachLeaf(box.sub, visit);
        break;
      case 'slot':
        visit(box);
        break;
      case 'frac':
        forEachLeaf(box.num, visit);
        forEachLeaf(box.den, visit);
        break;
      case 'sup':
      case 'radical':
        forEachLeaf(box.body, visit);
        break;
      case 'fence':
        visit(box.open);
        forEachLeaf(box.body, visit);
        if (box.close) visit(box.close);
        break;
    }
  }
}

/** Where a leaf's own characters are (a subscripted name's, without its subscript). */
export function leafSpan(leaf: Leaf): Span {
  return leaf.kind === 'atom' && leaf.subStart !== undefined
    ? { start: leaf.span.start, end: leaf.subStart }
    : leaf.span;
}

/**
 * The leaves an error span marks: those it overlaps. A span on structure only (the `^` of `x^`,
 * an invisible parenthesis) or on nothing (`y =` ends at its `=`) marks the first leaf after
 * it, or the last one.
 */
export function errorLeaves(plan: Plan, span: Span): Leaf[] {
  const leaves: Leaf[] = [];
  forEachLeaf(plan.root, (leaf) => leaves.push(leaf));
  const hit = leaves.filter((leaf) => {
    const s = leafSpan(leaf);
    return span.end > span.start
      ? s.start < span.end && s.end > span.start
      : s.start <= span.start && span.start < s.end;
  });
  if (hit.length > 0) return hit;
  const after = leaves.find((leaf) => leafSpan(leaf).start >= span.start);
  const last = leaves[leaves.length - 1];
  return after ? [after] : last ? [last] : [];
}

/**
 * Everything about a plan except its texts and spans. Two plans with the same shape draw the
 * same elements, so a renderer can patch texts in place (a playing slider's value).
 */
export function planShape(plan: Plan): string {
  return blockShape(plan.root);
}

function blockShape(block: Block): string {
  let s = '';
  for (const b of block.boxes) {
    s += b.space;
    switch (b.kind) {
      case 'atom':
        s += `a${b.role}${b.sub ? `[${blockShape(b.sub)}]` : ''}`;
        break;
      case 'slot':
        s += 's';
        break;
      case 'frac':
        s += `f(${blockShape(b.num)}/${blockShape(b.den)})`;
        break;
      case 'sup':
        s += `^${b.atomic ? '!' : ''}(${blockShape(b.body)})`;
        break;
      case 'radical':
        s += `r${b.index ?? ''}(${blockShape(b.body)})`;
        break;
      case 'fence':
        s += `${b.bars ? '|' : 'p'}${b.tall ? 't' : ''}${b.close ? '' : 'o'}(${blockShape(b.body)})`;
        break;
    }
  }
  return s;
}
