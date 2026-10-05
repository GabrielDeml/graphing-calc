// Editing a row in its typeset form. The text stays the model: every command reads the layout of
// the row (the render plan and its caret stops) and splices the text, then lays the new text out
// again and checks that what was typed landed where the caret was. When it didn't, a few
// fixups add the parentheses the engine needs (`1/2x` typed key by key is `1/(2x)`, `x^2y` is
// `x^(2y)`); when none works the plain insertion stays, so the display still matches the engine.
// Nothing is ever serialized from the tree: the text is what was typed, plus structural
// parentheses only where they are needed.
//
// Pure TS, like the engine. The row editor (components/MathField.tsx) maps keys, input events
// and the keypad onto these commands.

import type { NameContext } from '../engine/names';
import {
  barOpens,
  barTypesOver,
  builtinNameStart,
  isRunLetter,
  isSpace,
  isSpareClose,
  isSubscriptChar,
  nextCodePoint,
  prevCodePoint,
} from '../keypad/editing';
import { type Caret, type CaretStop, type CaretStops, caretStops, resolveCaret } from './caret';
import { layoutParse } from './layout';
import type { AtomBox, Block, Box, FenceBox, FracBox, Plan, RadicalBox, SupBox } from './plan';
import { renderPlan } from './plan';

/** A row being edited: its text and selection. */
export interface EditorState {
  text: string;
  /** The end of the selection that stays put; equal to `focus` without a selection. */
  anchor: Caret;
  /** The caret: the end of the selection that moves. */
  focus: Caret;
  /**
   * Where the caret is right after parentheses the editor just opened by itself (`sqrt` typed:
   * `sqrt(‸)`): a `(` typed next is that one, not another. Any other command clears it.
   */
  opened?: number;
}

export type EditorCommand =
  /** Keystrokes: each character by the typing rules. */
  | { type: 'type'; text: string }
  /** Pasted or composed text, inserted as it is. */
  | { type: 'insert'; text: string }
  /** Surround the selection, or insert both with the caret between. */
  | { type: 'wrap'; before: string; after: string }
  /** `name(sel)`, or `name()` with the caret inside. */
  | { type: 'function'; name: string }
  /** An exponent typed whole (a²): the caret ends after it. */
  | { type: 'power'; exponent: string }
  | { type: 'backspace' }
  | { type: 'delete' }
  | { type: 'left'; extend?: boolean }
  | { type: 'right'; extend?: boolean }
  | { type: 'home'; extend?: boolean }
  | { type: 'end'; extend?: boolean }
  | { type: 'up' }
  | { type: 'down' }
  /** The caret to a place (a click), or the selection's focus there (a drag, Shift+click). */
  | { type: 'place'; at: Caret; extend?: boolean }
  | { type: 'selectAll' }
  | { type: 'clear' };

/** How a command changed the text, for undo grouping. */
export type EditKind = 'insert' | 'delete' | 'replace';

export interface EditorResult {
  state: EditorState;
  /** How the text changed, or null when it didn't (the caret moved, or a key was ignored). */
  edit: EditKind | null;
}

export interface EditorOptions {
  /** The document's names (DocumentEngine.names().ctx). */
  names: NameContext;
  /** Plans a text: a cached typesetter, so the stops are those of the plan on screen. */
  plan?: (text: string) => Plan;
  /** Where a stop of the current text is drawn (client x), for Up and Down. */
  xOf?: (stop: CaretStop) => number;
}

// ---- the layout, as the editor reads it ----

/** Which part of its structure a block is. */
export type Part = 'root' | 'num' | 'den' | 'sup' | 'sub' | 'radicand' | 'group';

export interface BlockInfo {
  part: Part;
  /** The structure holding the block (null for the root). */
  box: Box | null;
  /** The block holding that structure, and the structure's index in it. */
  parent: Block | null;
  index: number;
  /**
   * The block's place in the tree: its parts and their structures' starts, from the root. Text
   * typed in a block doesn't move the structures around it, so the path of a block survives an
   * edit inside it, which is how an edit is checked.
   */
  path: string;
}

export interface EditDoc {
  text: string;
  plan: Plan;
  stops: CaretStops;
  info: Map<Block, BlockInfo>;
  /** Each block's own stops, in order. */
  blockStops: Map<Block, CaretStop[]>;
  /** Each stop's index in stops.list. */
  order: Map<CaretStop, number>;
}

/** Plans already read (a plan is reused while its text and names stay the same). */
const analyzed = new WeakMap<Plan, EditDoc>();

/** A plan read for editing: its stops, and where each block sits in the tree. */
export function analyze(plan: Plan): EditDoc {
  let doc = analyzed.get(plan);
  if (!doc) {
    doc = analyzeOnce(plan);
    analyzed.set(plan, doc);
  }
  return doc;
}

function analyzeOnce(plan: Plan): EditDoc {
  const info = new Map<Block, BlockInfo>();
  const visit = (block: Block, own: BlockInfo) => {
    info.set(block, own);
    block.boxes.forEach((box, index) => {
      const child = (b: Block, part: Part, tag: string) =>
        visit(b, { part, box, parent: block, index, path: `${own.path}/${tag}${box.span.start}` });
      switch (box.kind) {
        case 'frac':
          child(box.num, 'num', 'n');
          child(box.den, 'den', 'd');
          break;
        case 'sup':
          if (!box.atomic) child(box.body, 'sup', 's');
          break;
        case 'radical':
          child(box.body, 'radicand', 'r');
          break;
        case 'fence':
          child(box.body, 'group', 'g');
          break;
        case 'atom':
          if (box.sub) child(box.sub, 'sub', 'u');
          break;
        case 'slot':
          break;
      }
    });
  };
  visit(plan.root, { part: 'root', box: null, parent: null, index: 0, path: '' });
  const stops = caretStops(plan);
  const blockStops = new Map<Block, CaretStop[]>();
  const order = new Map<CaretStop, number>();
  stops.list.forEach((st, i) => {
    order.set(st, i);
    const own = blockStops.get(st.block);
    if (own) own.push(st);
    else blockStops.set(st.block, [st]);
  });
  return { text: plan.source, plan, stops, info, blockStops, order };
}

/** Where a block's content ends: past spaces after its last box. */
function blockEnd(block: Block): number {
  const last = block.boxes[block.boxes.length - 1];
  return last ? Math.max(block.end, last.span.end) : block.end;
}

/** A block with nothing in it but an empty place. */
function isEmpty(block: Block): boolean {
  return block.boxes.every((b) => b.kind === 'slot');
}

/** A block that ends with an empty place: an operand is still to come (`2*‸`, or nothing yet). */
function awaitsOperand(block: Block): boolean {
  const last = block.boxes[block.boxes.length - 1];
  return last === undefined || last.kind === 'slot';
}

/**
 * A finished structure the caret can be next to: one with an empty part (`1/‸`) or still open
 * (`|‸|` reads as a bar opening another) doesn't count, nothing is wrapped around it.
 */
function isStructure(box: Box | undefined): boolean {
  if (box === undefined || box.unclosed) return false;
  switch (box.kind) {
    case 'frac':
      return !isEmpty(box.num) && !isEmpty(box.den);
    case 'sup':
      return !box.atomic && !isEmpty(box.body);
    case 'radical':
    case 'fence':
      return !isEmpty(box.body);
    default:
      return false;
  }
}

/**
 * The stop to type at for a caret at `stop`: an empty place at the same offset when there is one
 * (`y=1/‸` after the fraction is the empty denominator: what is typed there lands in it).
 */
function preferEmpty(doc: EditDoc, stop: CaretStop): CaretStop {
  if (isEmpty(stop.block) && doc.info.get(stop.block)?.part !== 'root') return stop;
  const same = doc.stops.atOffset(stop.offset);
  for (let i = same.length - 1; i >= 0; i--) {
    const st = same[i] as CaretStop;
    if (st.depth > stop.depth && isEmpty(st.block)) return st;
  }
  return stop;
}

/** Where the boxes a structure is drawn from start: an exponent's include its base. */
function structureStart(block: Block, index: number): number {
  const box = block.boxes[index] as Box;
  const base = block.boxes[index - 1];
  return box.kind === 'sup' && base ? base.span.start : box.span.start;
}

// ---- text helpers ----

function splice(text: string, from: number, to: number, insert: string): string {
  return text.slice(0, from) + insert + text.slice(to);
}

/** Removes spans (any order, not overlapping); `map` takes an old offset to the new text. */
function removeSpans(text: string, spans: { start: number; end: number }[]) {
  const sorted = spans.filter((s) => s.end > s.start).sort((a, b) => a.start - b.start);
  let out = '';
  let at = 0;
  for (const s of sorted) {
    out += text.slice(at, s.start);
    at = Math.max(at, s.end);
  }
  out += text.slice(at);
  const map = (offset: number) => {
    let shift = 0;
    for (const s of sorted) {
      if (offset >= s.end) shift += s.end - s.start;
      else if (offset > s.start) return s.start - shift;
    }
    return offset - shift;
  };
  return { text: out, map };
}

/** Characters after which no operand stands: the start of an operand comes next. */
const OPENING = new Set([
  '+',
  '-',
  '−',
  '*',
  '·',
  '×',
  '⋅',
  '/',
  '÷',
  '^',
  '=',
  '<',
  '>',
  '≤',
  '≥',
  ',',
  '(',
]);

/** Characters that leave an exponent or a subscript when typed at its end. */
const LEAVES_SCRIPT = new Set(['+', '-', '−', '=', '<', '>', '≤', '≥', ',']);

/** Whether an operand ends at `p` (spaces aside) within a block starting at `start`. */
function hasLeftOperand(text: string, p: number, start: number): boolean {
  let k = p;
  while (k > start && isSpace(text.charCodeAt(k - 1))) k--;
  if (k <= start) return false;
  const c = text[k - 1] as string;
  if (c === '|') return !barOpens(text, k - 1);
  return !OPENING.has(c);
}

/**
 * Whether what follows `p` (spaces aside, before `end`) would be read into a denominator or an
 * exponent typed at `p`: an operand, or a sign before one.
 */
function absorbsRight(text: string, p: number, end: number): boolean {
  let k = p;
  while (k < end && isSpace(text.charCodeAt(k))) k++;
  if (k >= end) return false;
  const c = text.charCodeAt(k);
  if (c === 124) return barOpens(text, k); // |
  return (
    isRunLetter(c) ||
    (c >= 48 && c <= 57) ||
    c === 46 || // .
    c === 40 || // (
    c === 0x3c0 || // π
    c === 0x3c4 || // τ
    c === 0x221a || // √
    c === 0x221b || // ∛
    c === 43 || // +
    c === 45 || // -
    c === 0x2212 // −
  );
}

function isAlnum(ch: string): boolean {
  return ch.length === 1 && isSubscriptChar(ch.charCodeAt(0));
}

function isLetter(ch: string): boolean {
  return ch.length === 1 && isRunLetter(ch.charCodeAt(0));
}

/** Whether `s` is one parenthesized group, `(…)` with nothing outside it. */
function isWholeGroup(s: string): boolean {
  if (!s.startsWith('(')) return false;
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '(') depth++;
    else if (s[i] === ')' && --depth === 0) return i === s.length - 1;
  }
  return false;
}

/**
 * Whether the character at `offset` is part of something drawn as one symbol: a name (`sin`,
 * `pi`, a radical's `sqrt`) or `<=`.
 */
function inUnit(doc: EditDoc, offset: number): boolean {
  const inside = (s: { start: number; end: number }) =>
    s.end - s.start > 1 && s.start <= offset && offset < s.end;
  const visit = (block: Block): boolean =>
    block.boxes.some((box) => {
      switch (box.kind) {
        case 'atom':
          if (!box.chars && inside({ start: box.span.start, end: box.subStart ?? box.span.end })) {
            return true;
          }
          return box.sub ? visit(box.sub) : false;
        case 'radical':
          return inside(box.name) || visit(box.body);
        case 'frac':
          return visit(box.num) || visit(box.den);
        case 'sup':
          return !box.atomic && visit(box.body);
        case 'fence':
          return visit(box.body);
        default:
          return false;
      }
    });
  return visit(doc.plan.root);
}

// ---- the editor ----

/** A state read against its layout. */
interface Sel {
  doc: EditDoc;
  anchor: CaretStop;
  focus: CaretStop;
  /** The selection as text offsets, widened to whole boxes of `block`. */
  start: number;
  end: number;
  /** The innermost block holding both ends. */
  block: Block;
  collapsed: boolean;
  /** EditorState.opened, while the caret is there. */
  opened: boolean;
}

/** A candidate edit: its text, where the caret goes, and whether it landed as intended. */
interface Try {
  text: string;
  offset: number;
  depth: number;
  ok: (doc: EditDoc, stop: CaretStop) => boolean;
}

class Editor {
  private readonly docs = new Map<string, EditDoc>();

  constructor(private readonly opts: EditorOptions) {}

  doc(text: string): EditDoc {
    let doc = this.docs.get(text);
    if (!doc) {
      const plan = this.opts.plan
        ? this.opts.plan(text)
        : renderPlan(layoutParse(text, this.opts.names));
      doc = analyze(plan);
      this.docs.set(text, doc);
    }
    return doc;
  }

  // ---- reading states ----

  read(state: EditorState): Sel {
    const text = typeof state.text === 'string' ? state.text : '';
    const doc = this.doc(text);
    const clamp = (n: number) =>
      Number.isFinite(n) ? Math.min(Math.max(Math.trunc(n), 0), text.length) : text.length;
    const stopOf = (c: Caret | undefined) =>
      resolveCaret(
        doc.stops,
        clamp(c?.offset ?? text.length),
        Number.isFinite(c?.depth) ? (c?.depth as number) : 0,
      );
    const focus = stopOf(state.focus);
    const anchor = state.anchor ? stopOf(state.anchor) : focus;
    const sel = this.select(doc, anchor, focus);
    if (sel.collapsed && state.opened === focus.offset) sel.opened = true;
    return sel;
  }

  private select(doc: EditDoc, anchor: CaretStop, focus: CaretStop): Sel {
    if (anchor === focus) {
      const { offset } = focus;
      return {
        doc,
        anchor,
        focus,
        start: offset,
        end: offset,
        block: focus.block,
        collapsed: true,
        opened: false,
      };
    }
    const chain = (b: Block) => {
      const out: Block[] = [];
      for (let x: Block | null = b; x; x = doc.info.get(x)?.parent ?? null) out.push(x);
      return out;
    };
    const ofAnchor = new Set(chain(anchor.block));
    const block = chain(focus.block).find((b) => ofAnchor.has(b)) ?? doc.plan.root;
    const forward = (doc.order.get(anchor) ?? 0) <= (doc.order.get(focus) ?? 0);
    const [first, last] = forward ? [anchor, focus] : [focus, anchor];
    const start = this.edgeIn(doc, block, first, true);
    const end = this.edgeIn(doc, block, last, false);
    const collapsed = start >= end;
    return {
      doc,
      anchor,
      focus,
      start: Math.min(start, end),
      end: Math.max(start, end),
      block,
      collapsed,
      opened: false,
    };
  }

  /** Where a stop is in an outer block: its offset, or the edge of the structure holding it. */
  private edgeIn(doc: EditDoc, block: Block, stop: CaretStop, start: boolean): number {
    if (stop.block === block) return stop.offset;
    let b = stop.block;
    let own = doc.info.get(b);
    while (own?.parent && own.parent !== block) {
      b = own.parent;
      own = doc.info.get(b);
    }
    if (!own?.box || !own.parent) return stop.offset;
    return start ? structureStart(own.parent, own.index) : own.box.span.end;
  }

  // ---- results ----

  private state(anchor: Caret, focus: Caret, text: string): EditorState {
    return {
      text,
      anchor: { offset: anchor.offset, depth: anchor.depth },
      focus: { offset: focus.offset, depth: focus.depth },
    };
  }

  /** The caret at a stop. */
  private to(doc: EditDoc, stop: CaretStop, edit: EditKind | null): EditorResult {
    return { state: this.state(stop, stop, doc.text), edit };
  }

  /** New text, with the caret at the stop nearest {offset, depth}. */
  private at(text: string, offset: number, depth: number, edit: EditKind | null): EditorResult {
    const doc = this.doc(text);
    return this.to(doc, resolveCaret(doc.stops, offset, depth), edit);
  }

  /** Nothing changes (the state, read against its layout). */
  private same(sel: Sel): EditorResult {
    return { state: this.state(sel.anchor, sel.focus, sel.doc.text), edit: null };
  }

  /** A result whose caret is right after parentheses just opened: see EditorState.opened. */
  private opening(result: EditorResult): EditorResult {
    const { text, focus } = result.state;
    if (text[focus.offset - 1] !== '(' || text[focus.offset] !== ')') return result;
    return { ...result, state: { ...result.state, opened: focus.offset } };
  }

  /** The first candidate that lands as intended, else the last resort, placed by resolveCaret. */
  private first(tries: Try[], fallback: Omit<Try, 'ok'>, edit: EditKind): EditorResult {
    for (const t of tries) {
      const doc = this.doc(t.text);
      const stop = doc.stops.at(t.offset, t.depth);
      if (stop && t.ok(doc, stop)) return this.to(doc, stop, edit);
    }
    return this.at(fallback.text, fallback.offset, fallback.depth, edit);
  }

  // ---- commands ----

  run(state: EditorState, cmd: EditorCommand): EditorResult | null {
    const sel = this.read(state);
    switch (cmd.type) {
      case 'type':
        return this.typeText(sel, cmd.text);
      case 'insert':
        return this.insertText(sel, cmd.text);
      case 'wrap':
        return this.wrap(sel, cmd.before, cmd.after);
      case 'function':
        return this.callKey(sel, cmd.name);
      case 'power':
        return this.power(sel, cmd.exponent);
      case 'backspace':
        return this.backspace(sel);
      case 'delete':
        return this.deleteForward(sel);
      case 'left':
      case 'right':
        return this.horizontal(sel, cmd.type === 'left' ? -1 : 1, cmd.extend === true);
      case 'home':
      case 'end': {
        const { list } = sel.doc.stops;
        const last = list[list.length - 1] as CaretStop;
        // The end of `y=1/` is in its empty denominator: typing goes there.
        const target = cmd.type === 'home' ? (list[0] as CaretStop) : preferEmpty(sel.doc, last);
        if (cmd.extend) return { state: this.state(sel.anchor, target, sel.doc.text), edit: null };
        return this.moveTo(sel, target);
      }
      case 'up':
      case 'down':
        return this.vertical(sel, cmd.type === 'up' ? -1 : 1);
      case 'place': {
        const { doc } = sel;
        const offset = Number.isFinite(cmd.at?.offset) ? cmd.at.offset : doc.text.length;
        const depth = Number.isFinite(cmd.at?.depth) ? cmd.at.depth : 0;
        const target = resolveCaret(
          doc.stops,
          Math.min(Math.max(offset, 0), doc.text.length),
          depth,
        );
        if (cmd.extend) return { state: this.state(sel.anchor, target, doc.text), edit: null };
        return this.moveTo(sel, target);
      }
      case 'selectAll': {
        const { list } = sel.doc.stops;
        const last = list[list.length - 1] as CaretStop;
        return { state: this.state(list[0] as CaretStop, last, sel.doc.text), edit: null };
      }
      case 'clear':
        return this.at('', 0, 0, sel.doc.text === '' ? null : 'delete');
      default:
        return this.same(sel);
    }
  }

  private typeText(sel: Sel, text: string): EditorResult {
    let result: EditorResult = this.same(sel);
    let edit: EditKind | null = null;
    let current = sel;
    for (const ch of text) {
      result = this.typeChar(current, ch);
      edit = edit === 'replace' ? edit : (result.edit ?? edit);
      current = this.read(result.state);
    }
    return { state: result.state, edit };
  }

  private insertText(sel: Sel, insert: string): EditorResult {
    const { doc, start, end, block } = sel;
    if (insert === '' && sel.collapsed) return this.same(sel);
    const next = this.doc(splice(doc.text, start, end, insert));
    // Pasted `y=1/` leaves the caret in its empty denominator.
    const stop = preferEmpty(next, resolveCaret(next.stops, start + insert.length, block.depth));
    return this.to(next, stop, sel.collapsed ? 'insert' : 'replace');
  }

  // ---- typing ----

  private typeChar(sel: Sel, raw: string): EditorResult {
    const ch = raw === '—' || raw === '–' ? '-' : raw;
    if (!sel.collapsed) return this.typeOver(sel, ch);
    const { doc } = sel;
    const { text } = doc;
    // Right after a structure with an empty last part, the key goes into that part (its text
    // would land there anyway): `y=1/` + `2` is `y=1/2`, wherever the caret came from.
    let stop = preferEmpty(doc, sel.focus);
    const p = stop.offset;
    const prev = text[p - 1];

    // Corrections: `==` is `=`, `=<` and `=>` are `<=` and `>=`.
    if (ch === '=' && prev === '=') return this.same(sel);
    if ((ch === '<' || ch === '>') && prev === '=') {
      return this.at(splice(text, p - 1, p, `${ch}=`), p + 1, stop.depth, 'insert');
    }

    // At the end of an exponent or a subscript, some keys leave it first.
    const own = doc.info.get(stop.block);
    if ((own?.part === 'sup' || own?.part === 'sub') && this.atBlockEnd(doc, stop)) {
      const empty = isEmpty(stop.block);
      // A subscript's braces are the editor's to add: `{` is already there, `}` leaves.
      if (own.part === 'sub' && ch === '{') return this.to(doc, stop, null);
      // After an operator (`x^(2*‸)`), a sign or a space is the operand's.
      const awaits = awaitsOperand(stop.block) && !empty;
      // A function's power (`sin^2‸`) is one number, name or group: what follows it is the
      // function's argument.
      const base = own.parent?.boxes[own.index - 1];
      const power =
        base?.kind === 'atom' && base.role === 'fn' && !stop.block.parens && !/^[0-9.]$/.test(ch);
      const leaves =
        own.part === 'sub'
          ? !isAlnum(ch)
          : ch === ' '
            ? !awaits
            : (LEAVES_SCRIPT.has(ch) || power) && !empty && !awaits;
      if (leaves) {
        if (empty) {
          const removed = this.removeScript(doc, stop.block);
          if (ch === ' ' || ch === '}') return removed;
          return this.typeChar(this.read(removed.state), ch);
        }
        if (ch === ' ' || ch === '}') return this.to(doc, this.after(doc, stop.block), null);
        stop = this.after(doc, stop.block);
      }
    }

    switch (ch) {
      case '/':
      case '÷':
        return this.fraction(doc, stop, ch);
      case '^':
        return this.exponent(doc, stop, '^');
      case '*':
        if (text[stop.offset - 1] === '*') return this.exponent(doc, stop, '*');
        break;
      case '_':
        return this.subscript(sel, stop);
      case '√':
      case '∛':
        return this.structural(doc, stop, ch, 1, 'radicand');
      case '(':
        // The parentheses the editor just opened (`sqrt(‸)`, `a/(‸)b`): this is their `(`.
        if (sel.opened && stop === sel.focus) return this.to(doc, stop, null);
        return this.open(doc, stop);
      case ')':
      case '|':
        return this.closer(doc, stop, ch);
      case ' ': {
        const part = doc.info.get(stop.block)?.part;
        // A space in an empty place would leave it behind, empty (a group's stays in it), and
        // one in a subscript would split its name.
        if ((isEmpty(stop.block) && part !== 'root' && part !== 'group') || part === 'sub') {
          return this.to(doc, stop, null);
        }
        // Inside a part of a structure it must not split it (`x^2 3`): checked like any key.
        if (part === 'root' || part === 'group' || this.atBlockEnd(doc, stop)) {
          const q = stop.offset;
          return this.at(splice(text, q, q, ' '), q + 1, stop.depth, 'insert');
        }
        break;
      }
      default:
        break;
    }
    const result = this.verified(doc, stop, ch);
    return isLetter(ch) ? this.rootSlot(result) : result;
  }

  /**
   * `)` and `|`: over the closer the caret is before when that closes its group, else inserted.
   * At the end of a denominator or an exponent in the editor's own (unseen) parentheses, the key
   * is for a group around the structure: `(1/(2x‸)` + `)` is `(1/(2x))`, out of both.
   */
  private closer(doc: EditDoc, stop: CaretStop, ch: ')' | '|'): EditorResult {
    const { text } = doc;
    const q = stop.offset;
    if (text[q] === ch && (ch === ')' ? isSpareClose(text, q) : barTypesOver(text, q))) {
      return this.to(doc, resolveCaret(doc.stops, q + 1, stop.depth), null);
    }
    const part = doc.info.get(stop.block)?.part;
    if (stop.block.parens && (part === 'den' || part === 'sup') && this.atBlockEnd(doc, stop)) {
      const out = this.after(doc, stop.block);
      const o = out.offset;
      // A `)` that isn't spare here closes a group outside; a `|` closes one if open there.
      const outside =
        ch === ')' ||
        (text[o] === '|' && barTypesOver(text, o)) ||
        !barOpens(splice(text, o, o, '|'), o);
      if (outside && out !== stop) return this.closer(doc, out, ch);
    }
    const next = splice(text, q, q, ch);
    const depth = ch === '|' && barOpens(next, q) ? stop.depth + 1 : stop.depth;
    return this.at(next, q + 1, depth, 'insert');
  }

  /** Typing with a selection: `/`, `^`, `(` and `|` wrap it; anything else replaces it. */
  private typeOver(sel: Sel, ch: string): EditorResult {
    const { doc, start, end, block } = sel;
    const selected = doc.text.slice(start, end);
    const replace = (r: EditorResult): EditorResult => ({ state: r.state, edit: 'replace' });
    if (ch === '/' || ch === '÷' || ch === '^') {
      const wrapped = isWholeGroup(selected) ? selected : `(${selected})`;
      const text = splice(doc.text, start, end, wrapped);
      const next = this.doc(text);
      const stop = resolveCaret(next.stops, start + wrapped.length, block.depth);
      return replace(ch === '^' ? this.exponent(next, stop, '^') : this.fraction(next, stop, ch));
    }
    if (ch === '(' || ch === '|') {
      const close = ch === '(' ? ')' : '|';
      const text = splice(doc.text, start, end, `${ch}${selected}${close}`);
      return this.at(text, end + 2, block.depth, 'replace');
    }
    const cleared = this.at(splice(doc.text, start, end, ''), start, block.depth, 'delete');
    return replace(this.typeChar(this.read(cleared.state), ch));
  }

  /**
   * A character typed into a block, checked: it must land in that block, which must keep all it
   * held. When it doesn't, it tries (1) parentheses around the block (`1/(2x)`, `x^(2y)`,
   * braces for a subscript), (2) a space before it, (3) parentheses around the structure before
   * the caret (`(x^2)!`) or (4) after it (`x(1/2)`).
   */
  private verified(doc: EditDoc, stop: CaretStop, ch: string): EditorResult {
    const { text } = doc;
    const block = stop.block;
    const own = doc.info.get(block) as BlockInfo;
    const p = stop.offset;
    const n = ch.length;
    const depth = block.depth;
    const bs = block.start;
    const be = blockEnd(block);
    /**
     * Whether the character landed in the block: right before the caret, in the block of the
     * same place in the tree, which now holds all it held (from `bs + startShift` to its end
     * plus the character and `extra` more characters inserted in it).
     */
    const lands = (startShift: number, extra: number) => (d: EditDoc, st: CaretStop) => {
      const info = d.info.get(st.block);
      if (!info || info.path !== own.path) return false;
      // The character itself is in the block, not in a structure that ends where it does.
      const before = d.stops.at(st.offset - n, depth);
      if (before?.block !== st.block || d.order.get(before) !== (d.order.get(st) ?? 0) - 1) {
        return false;
      }
      if (info.part === 'root') return true;
      return st.block.start === bs + startShift && blockEnd(st.block) === be + n + extra;
    };
    const plain = { text: splice(text, p, p, ch), offset: p + n, depth };
    // A character that completes something drawn as one symbol (`sqr` + t, `p` + i, `<` + =)
    // is what it is.
    if (inUnit(this.doc(plain.text), p)) {
      return (
        this.unwrapName(doc, block, plain) ?? this.at(plain.text, plain.offset, depth, 'insert')
      );
    }
    const tries: Try[] = [{ ...plain, ok: lands(0, 0) }];
    // Right after a `)` that closed a structure's last part, the key may be for that part, as
    // the text reads (`1/(x+1)` + `!`: the denominator's factorial).
    const closed = this.closedPart(stop);
    if (closed) {
      const path = doc.info.get(closed)?.path;
      tries.push({
        ...plain,
        depth: closed.depth,
        ok: (d, st) => {
          const before = d.stops.at(st.offset - n, st.depth);
          return (
            d.info.get(st.block)?.path === path &&
            before?.block === st.block &&
            d.order.get(before) === (d.order.get(st) ?? 0) - 1
          );
        },
      });
    }
    const wrapper = this.wrapper(doc, block);
    if (wrapper) {
      const [open, close] = wrapper;
      tries.push({
        text: `${text.slice(0, bs)}${open}${text.slice(bs, p)}${ch}${text.slice(p, be)}${close}${text.slice(be)}`,
        offset: p + 1 + n,
        depth,
        ok: lands(1, 1),
      });
    }
    tries.push({ text: splice(text, p, p, ` ${ch}`), offset: p + 1 + n, depth, ok: lands(0, 1) });
    const before = stop.inside || stop.index === 0 ? undefined : block.boxes[stop.index - 1];
    if (isStructure(before) && before?.span.end === p) {
      const s = structureStart(block, stop.index - 1);
      tries.push({
        text: `${text.slice(0, s)}(${text.slice(s, p)})${ch}${text.slice(p)}`,
        offset: p + 2 + n,
        depth,
        ok: lands(0, 2),
      });
    }
    const after = stop.inside ? undefined : block.boxes[stop.index];
    if (isStructure(after) && after?.span.start === p) {
      const e = after.span.end;
      tries.push({
        text: `${text.slice(0, p)}${ch}(${text.slice(p, e)})${text.slice(e)}`,
        offset: p + n,
        depth,
        ok: lands(0, 2),
      });
    }
    return this.first(tries, plain, 'insert');
  }

  /**
   * The last part of the structure right before the caret, when it is in parentheses that close
   * right there (drawn as structure, so the caret can't be inside them after the `)`).
   */
  private closedPart(stop: CaretStop): Block | null {
    if (stop.inside || stop.index === 0) return null;
    const before = stop.block.boxes[stop.index - 1];
    if (!before || before.span.end !== stop.offset) return null;
    let part: Block | undefined;
    if (before.kind === 'frac') part = before.den;
    else if (before.kind === 'sup' && !before.atomic) part = before.body;
    else if (before.kind === 'radical') part = before.body;
    return part?.parens?.close.end === stop.offset ? part : null;
  }

  /**
   * A builtin function's name typed in a part the editor put in parentheses one letter earlier
   * (`1/(si‸)` + n: `si` read as s·i then): the parentheses go again when the part holds the
   * same without them (`1/sin‸`).
   */
  private unwrapName(
    doc: EditDoc,
    block: Block,
    plain: { text: string; offset: number; depth: number },
  ): EditorResult | null {
    const part = doc.info.get(block)?.part;
    const { parens } = block;
    if (!parens || (part !== 'num' && part !== 'den' && part !== 'sup')) return null;
    if (builtinNameStart(plain.text, plain.offset) < 0) return null;
    const n = plain.text.length - doc.text.length;
    const { text, map } = removeSpans(plain.text, [
      parens.open,
      { start: parens.close.start + n, end: parens.close.end + n },
    ]);
    const next = this.doc(text);
    const st = next.stops.at(map(plain.offset), block.depth);
    const info = st ? next.info.get(st.block) : undefined;
    // The same place in the tree, holding the same text.
    if (
      !st ||
      info?.path !== doc.info.get(block)?.path ||
      st.block.start !== parens.open.start ||
      blockEnd(st.block) !== blockEnd(block) - 1 + n
    ) {
      return null;
    }
    return this.to(next, st, 'insert');
  }

  /**
   * The characters that can wrap a block whose text escaped it: parentheses (a fraction's part,
   * an exponent, a radicand), braces (a subscript); null for blocks that already are in
   * parentheses, or can't be.
   */
  private wrapper(doc: EditDoc, block: Block): [string, string] | null {
    const part = doc.info.get(block)?.part;
    if (part === 'sub') return doc.text[block.start - 1] === '{' ? null : ['{', '}'];
    if (part === 'num' || part === 'den' || part === 'sup' || part === 'radicand') {
      return block.parens ? null : ['(', ')'];
    }
    return null;
  }

  /** `/`: a fraction whose numerator is whatever the engine takes, the caret in the empty part. */
  private fraction(doc: EditDoc, stop: CaretStop, ch: string): EditorResult {
    const { text } = doc;
    const block = stop.block;
    const p = stop.offset;
    const left = hasLeftOperand(text, p, block.start);
    const absorbs = absorbsRight(text, p, blockEnd(block));
    // With nothing to its left, the fraction starts with an empty numerator; text to its right
    // stays out of the denominator.
    const insert = left ? `${ch}${absorbs ? '()' : ''}` : `()${ch}${absorbs ? '()' : ''}`;
    const into = left ? (absorbs ? 2 : 1) : 1;
    return this.structural(doc, stop, insert, into, left ? 'den' : 'num');
  }

  /** `^` (or the second `*` of `**`): an empty exponent, the caret in it. */
  private exponent(doc: EditDoc, stop: CaretStop, op: '^' | '*'): EditorResult {
    const { text } = doc;
    const block = stop.block;
    const p = stop.offset;
    const base = op === '*' ? p - 1 : p;
    if (!hasLeftOperand(text, base, block.start)) {
      return this.at(splice(text, p, p, op), p + 1, block.depth + 1, 'insert');
    }
    const absorbs = absorbsRight(text, p, blockEnd(block));
    return this.structural(doc, stop, absorbs ? `${op}()` : op, absorbs ? 2 : 1, 'sup', op === '^');
  }

  /**
   * Inserts the operator of a fraction or an exponent and puts the caret `into` characters into
   * it, in the new `part`. Checked like a character: the new structure must be in the caret's
   * block; else the block is put in parentheses, or (for `^` after a structure) the structure.
   */
  private structural(
    doc: EditDoc,
    stop: CaretStop,
    insert: string,
    into: number,
    part: Part,
    wrapBefore = false,
  ): EditorResult {
    const { text } = doc;
    const block = stop.block;
    const own = doc.info.get(block) as BlockInfo;
    const p = stop.offset;
    const depth = block.depth + 1;
    const okIn = (path: string | undefined) => (d: EditDoc, st: CaretStop) => {
      const info = d.info.get(st.block);
      const parent = info?.parent ? d.info.get(info.parent) : undefined;
      return info?.part === part && parent?.path === path;
    };
    const ok = okIn(own.path);
    const plain = { text: splice(text, p, p, insert), offset: p + into, depth };
    const tries: Try[] = [{ ...plain, ok }];
    // `1/(x+1)` + `^`: the exponent of the denominator's group, as the text reads.
    const closed = this.closedPart(stop);
    if (closed) {
      tries.push({ ...plain, depth: closed.depth + 1, ok: okIn(doc.info.get(closed)?.path) });
    }
    const wrapper = this.wrapper(doc, block);
    if (wrapper) {
      const bs = block.start;
      const be = blockEnd(block);
      const [open, close] = wrapper;
      tries.push({
        text: `${text.slice(0, bs)}${open}${text.slice(bs, p)}${insert}${text.slice(p, be)}${close}${text.slice(be)}`,
        offset: p + 1 + into,
        depth,
        ok,
      });
    }
    const before = stop.inside || stop.index === 0 ? undefined : block.boxes[stop.index - 1];
    if (wrapBefore && isStructure(before) && before?.span.end === p) {
      const s = structureStart(block, stop.index - 1);
      tries.push({
        text: `${text.slice(0, s)}(${text.slice(s, p)})${insert}${text.slice(p)}`,
        offset: p + 2 + into,
        depth,
        ok,
      });
    }
    return this.opening(this.first(tries, plain, 'insert'));
  }

  /** `_` right after a letter: an empty subscript (in braces if letters or digits follow). */
  private subscript(sel: Sel, stop: CaretStop): EditorResult {
    const { doc } = sel;
    const { text } = doc;
    const p = stop.offset;
    const own = doc.info.get(stop.block);
    const name = stop.inside ?? (stop.index > 0 ? stop.block.boxes[stop.index - 1] : undefined);
    if (
      own?.part === 'sub' ||
      !isRunLetter(text.charCodeAt(p - 1)) ||
      name?.kind !== 'atom' ||
      name.sub ||
      name.role === 'fn' ||
      (!stop.inside && name.span.end !== p)
    ) {
      return this.same(sel);
    }
    const braced = isSubscriptChar(text.charCodeAt(p));
    const insert = braced ? '_{}' : '_';
    return this.at(
      splice(text, p, p, insert),
      p + (braced ? 2 : 1),
      stop.block.depth + 1,
      'insert',
    );
  }

  /**
   * `(`: only the opener (the view draws a ghost closer). In a block it can't stay in (a
   * denominator: `1/2(`), the block goes in parentheses and the group gets its closer.
   */
  private open(doc: EditDoc, stop: CaretStop): EditorResult {
    const { text } = doc;
    const block = stop.block;
    const own = doc.info.get(block) as BlockInfo;
    const p = stop.offset;
    const depth = block.depth + 1;
    const ok = (d: EditDoc, st: CaretStop) => {
      const info = d.info.get(st.block);
      if (info?.part !== 'group' || !info.parent) return false;
      // In the caret's block, or in a radicand that is (`sqrt(`).
      const parent = d.info.get(info.parent);
      if (parent?.path === own.path) return true;
      return parent?.part === 'radicand' && d.info.get(parent.parent as Block)?.path === own.path;
    };
    const plain = { text: splice(text, p, p, '('), offset: p + 1, depth };
    const tries: Try[] = [{ ...plain, ok }];
    const wrapper = this.wrapper(doc, block);
    if (wrapper?.[0] === '(' && !isEmpty(block)) {
      const bs = block.start;
      const be = blockEnd(block);
      tries.push({
        text: `${text.slice(0, bs)}(${text.slice(bs, p)}()${text.slice(p, be)})${text.slice(be)}`,
        offset: p + 2,
        depth,
        ok,
      });
    }
    return this.first(tries, plain, 'insert');
  }

  /** A letter run just completed `sqrt` or `cbrt`: its parentheses, with the caret inside. */
  private rootSlot(result: EditorResult): EditorResult {
    const { text, focus } = result.state;
    const q = focus.offset;
    if (text[q] === '(') return result;
    const s = builtinNameStart(text, q);
    if (s < 0) return result;
    const name = text.slice(s, q);
    if (name !== 'sqrt' && name !== 'cbrt') return result;
    return this.opening(this.at(splice(text, q, q, '()'), q + 1, focus.depth + 1, 'insert'));
  }

  // ---- keypad ----

  /** `|a|` and the like: around the selection, or both with the caret between. */
  private wrap(sel: Sel, before: string, after: string): EditorResult {
    const { doc, start, end, block } = sel;
    if (!sel.collapsed) {
      const text = splice(doc.text, start, end, before + doc.text.slice(start, end) + after);
      return this.at(text, end + before.length + after.length, block.depth, 'replace');
    }
    return this.template(sel, before + after, before.length);
  }

  /** A function key: `name()` with the caret inside, kept in the caret's block. */
  private callKey(sel: Sel, name: string): EditorResult {
    const { doc, start, end, block } = sel;
    if (!sel.collapsed) {
      const text = splice(doc.text, start, end, `${name}(${doc.text.slice(start, end)})`);
      return this.at(text, end + name.length + 2, block.depth, 'replace');
    }
    return this.opening(this.template(sel, `${name}()`, name.length + 1));
  }

  /**
   * A key's template (`sin()`, `||`) at the caret, the caret `into` characters into it. It must
   * stay in the caret's block (not, say, go after a denominator it was typed at the end of);
   * else the block goes in parentheses.
   */
  private template(sel: Sel, insert: string, into: number): EditorResult {
    const { doc } = sel;
    const stop = preferEmpty(doc, sel.focus);
    const own = doc.info.get(stop.block) as BlockInfo;
    const p = stop.offset;
    const bs = stop.block.start;
    const be = blockEnd(stop.block);
    const lands = (startShift: number, endShift: number) => (d: EditDoc, st: CaretStop) => {
      for (let b: Block | null = st.block; b; b = d.info.get(b)?.parent ?? null) {
        const info = d.info.get(b);
        if (info?.path !== own.path) continue;
        return (
          info.part === 'root' || (b.start === bs + startShift && blockEnd(b) === be + endShift)
        );
      }
      return false;
    };
    const plain = { text: splice(doc.text, p, p, insert), offset: p + into };
    const depth = stop.block.depth + 1;
    const tries: Try[] = [];
    // The parentheses' block (or a radicand's) is one deeper: try both.
    for (const d of [depth, depth + 1])
      tries.push({ ...plain, depth: d, ok: lands(0, insert.length) });
    const wrapper = this.wrapper(doc, stop.block);
    if (wrapper) {
      const [open, close] = wrapper;
      const text = `${doc.text.slice(0, bs)}${open}${doc.text.slice(bs, p)}${insert}${doc.text.slice(p, be)}${close}${doc.text.slice(be)}`;
      for (const d of [depth, depth + 1]) {
        tries.push({ text, offset: plain.offset + 1, depth: d, ok: lands(1, insert.length + 1) });
      }
    }
    return this.first(tries, { ...plain, depth }, 'insert');
  }

  /** a²: the exponent typed whole, then out of it. */
  private power(sel: Sel, exponent: string): EditorResult {
    const typed = this.typeText(sel, `^${exponent}`);
    const doc = this.doc(typed.state.text);
    const stop = resolveCaret(doc.stops, typed.state.focus.offset, typed.state.focus.depth);
    const part = doc.info.get(stop.block)?.part;
    const out = part === 'sup' && this.atBlockEnd(doc, stop) ? this.after(doc, stop.block) : stop;
    return { state: this.state(out, out, doc.text), edit: typed.edit };
  }

  // ---- deleting ----

  private deleteRange(sel: Sel): EditorResult {
    const { doc, start, end, block } = sel;
    return this.at(splice(doc.text, start, end, ''), start, block.depth, 'delete');
  }

  private deleteChars(doc: EditDoc, from: number, to: number, depth: number): EditorResult {
    return this.at(splice(doc.text, from, to, ''), from, depth, 'delete');
  }

  /**
   * Backspace: at the start of a block, takes its structure apart (a fraction's bar, an
   * exponent's `^`, a radical's name, a group's delimiters); right after a structure, steps into
   * it; builtin names, `<=`, `**` and `x²` go as a unit; anything else is one character.
   */
  private backspace(sel: Sel): EditorResult {
    if (!sel.collapsed) return this.deleteRange(sel);
    const { doc } = sel;
    const { text } = doc;
    const stop = sel.focus;
    const block = stop.block;
    const p = stop.offset;
    const depth = block.depth;
    if (stop.inside) return this.deleteChars(doc, prevCodePoint(text, p), p, depth);
    const before = stop.index > 0 ? block.boxes[stop.index - 1] : undefined;
    const gapStart = before ? before.span.end : block.start;
    if (p > gapStart) return this.deleteChars(doc, prevCodePoint(text, p), p, depth);
    if (!before) return this.unwrap(sel, block, 'start');
    switch (before.kind) {
      case 'frac':
        return this.stepInto(doc, before.den, 'end');
      case 'radical':
      case 'fence':
        return this.stepInto(doc, before.body, 'end');
      case 'sup':
        if (before.atomic) return this.deleteChars(doc, before.span.start, before.span.end, depth);
        return this.stepInto(doc, before.body, 'end');
      case 'atom':
        if (before.sub) return this.stepInto(doc, before.sub, 'end');
        if (!before.chars && before.span.end - before.span.start > 1) {
          return this.deleteChars(doc, before.span.start, before.span.end, depth);
        }
        return this.deleteChars(doc, prevCodePoint(text, p), p, depth);
      case 'slot':
        return this.deleteChars(doc, prevCodePoint(text, p), p, depth);
    }
  }

  /** Delete: the mirror of Backspace, forwards. */
  private deleteForward(sel: Sel): EditorResult {
    if (!sel.collapsed) return this.deleteRange(sel);
    const { doc } = sel;
    const { text } = doc;
    const stop = sel.focus;
    const block = stop.block;
    const p = stop.offset;
    const depth = block.depth;
    if (stop.inside) return this.deleteChars(doc, p, nextCodePoint(text, p), depth);
    const after = block.boxes[stop.index];
    const gapEnd = after && after.kind !== 'slot' ? after.span.start : blockEnd(block);
    if (p < gapEnd) return this.deleteChars(doc, p, nextCodePoint(text, p), depth);
    if (!after || after.kind === 'slot') {
      if (doc.info.get(block)?.part === 'root') return this.same(sel);
      return this.unwrap(sel, block, 'end');
    }
    switch (after.kind) {
      case 'frac':
        return this.stepInto(doc, after.num, 'start');
      case 'radical':
      case 'fence':
        return this.stepInto(doc, after.body, 'start');
      case 'sup':
        if (after.atomic) return this.deleteChars(doc, after.span.start, after.span.end, depth);
        return this.stepInto(doc, after.body, 'start');
      case 'atom': {
        const end = after.subStart ?? after.span.end;
        if (!after.chars && end - after.span.start > 1) {
          return this.deleteChars(doc, after.span.start, end, depth);
        }
        return this.deleteChars(doc, p, nextCodePoint(text, p), depth);
      }
    }
  }

  /**
   * Into a block: at its start, or at the last place in it, which is in a group it ends with
   * when that group is still open (`(|x)`: after the x).
   */
  private stepInto(doc: EditDoc, block: Block, side: 'start' | 'end'): EditorResult {
    const own = doc.blockStops.get(block) ?? [];
    let stop = side === 'start' ? own[0] : own[own.length - 1];
    if (stop && side === 'end') {
      const { list } = doc.stops;
      for (let i = (doc.order.get(stop) ?? 0) + 1; i < list.length; i++) {
        const next = list[i] as CaretStop;
        if (!this.within(doc, next.block, block)) break;
        stop = next;
      }
    }
    return this.to(doc, stop ?? (doc.stops.list[0] as CaretStop), null);
  }

  /** Whether a block is `outer` or inside it. */
  private within(doc: EditDoc, block: Block, outer: Block): boolean {
    for (let b: Block | null = block; b; b = doc.info.get(b)?.parent ?? null) {
      if (b === outer) return true;
    }
    return false;
  }

  /**
   * Takes apart the structure a block belongs to, keeping what it holds: a fraction loses its
   * bar, an exponent its `^`, a subscript its `_`, a radical its name, a group its delimiters (a
   * function's name too). Empty parentheses that only held a place go with them. The caret stays
   * where it was in the text (`side`: at the start or the end of the block).
   */
  private unwrap(sel: Sel, block: Block, side: 'start' | 'end'): EditorResult {
    const { doc } = sel;
    const own = doc.info.get(block);
    if (!own?.box || !own.parent) return this.same(sel);
    const spans = this.structureSpans(doc, block);
    if (spans.length === 0) return this.same(sel);
    const { text, map } = removeSpans(doc.text, spans);
    const offset = side === 'start' ? this.junction(doc, block, spans) : blockEnd(block);
    return this.at(text, map(offset), own.parent.depth, 'delete');
  }

  /** Where the caret goes when the structure of a block is taken apart at its start. */
  private junction(doc: EditDoc, block: Block, spans: { start: number }[]): number {
    const own = doc.info.get(block) as BlockInfo;
    const box = own.box as Box;
    switch (own.part) {
      case 'num':
        return box.span.start;
      case 'den':
        return (box as FracBox).bar?.start ?? block.start;
      default:
        return Math.min(block.start, ...spans.map((s) => s.start));
    }
  }

  /**
   * The text that makes a block's structure (what unwrap removes). An empty structure goes
   * whole, spaces and all; so does the rest of a fraction from an empty denominator on: nothing
   * is left that the caret can't reach.
   */
  private structureSpans(doc: EditDoc, block: Block): { start: number; end: number }[] {
    const own = doc.info.get(block) as BlockInfo;
    const box = own.box as Box;
    const spans: { start: number; end: number }[] = [];
    if (isEmpty(block)) {
      const name =
        own.part === 'group' ? builtinNameStart(doc.text, (box as FenceBox).open.span.start) : -1;
      switch (own.part) {
        case 'num':
        case 'den': {
          const frac = box as FracBox;
          const other = own.part === 'num' ? frac.den : frac.num;
          if (isEmpty(other)) return [frac.span];
          if (own.part === 'den' && frac.bar)
            return [{ start: frac.bar.start, end: frac.span.end }];
          if (frac.bar) return [{ start: frac.span.start, end: frac.bar.end }];
          break;
        }
        case 'sub':
          return [{ start: (box as AtomBox).subStart ?? box.span.end, end: box.span.end }];
        case 'group':
          return [{ start: name >= 0 ? name : box.span.start, end: box.span.end }];
        case 'sup':
        case 'radicand':
          return [box.span];
        case 'root':
          break;
      }
    }
    const parens = (b: Block, always: boolean) => {
      if (b.parens && (always || isEmpty(b))) spans.push(b.parens.open, b.parens.close);
    };
    switch (own.part) {
      case 'num':
      case 'den': {
        const frac = box as FracBox;
        if (frac.bar) spans.push(frac.bar);
        parens(frac.num, false);
        parens(frac.den, false);
        break;
      }
      case 'sup': {
        const sup = box as SupBox;
        if (sup.op) spans.push(sup.op);
        parens(block, true);
        break;
      }
      case 'sub':
        spans.push(...(box.hidden ?? []));
        break;
      case 'radicand': {
        const radical = box as RadicalBox;
        if (block.parens) {
          spans.push({ start: radical.name.start, end: block.parens.open.end }, block.parens.close);
        } else {
          spans.push({ start: radical.name.start, end: block.start });
        }
        break;
      }
      case 'group': {
        const fence = box as FenceBox;
        const name = builtinNameStart(doc.text, fence.open.span.start);
        spans.push({ start: name >= 0 ? name : fence.open.span.start, end: fence.open.span.end });
        if (fence.close) spans.push(fence.close.span);
        // `||` reads as a bar opening another (`|‸|x` is |(|x)|): the pair goes, like an empty
        // pair of parentheses.
        const next = fence.open.span.end;
        if (fence.bars && !fence.close && doc.text[next] === '|') {
          spans.push({ start: next, end: next + 1 });
        }
        break;
      }
      case 'root':
        break;
    }
    return spans;
  }

  /** Removes an empty exponent or subscript (its `^` or `_`), the caret at its base. */
  private removeScript(doc: EditDoc, block: Block): EditorResult {
    const own = doc.info.get(block) as BlockInfo;
    const { text, map } = removeSpans(doc.text, this.structureSpans(doc, block));
    const at = (own.box as Box).kind === 'sup' ? (own.box as Box).span.start : block.start;
    return this.at(text, map(at), (own.parent as Block).depth, 'delete');
  }

  // ---- moving ----

  /** The stop right after the structure a block belongs to. */
  private after(doc: EditDoc, block: Block): CaretStop {
    const own = doc.info.get(block) as BlockInfo;
    const box = own.box as Box;
    return resolveCaret(doc.stops, box.span.end, (own.parent as Block).depth);
  }

  /** Whether a stop is the last one of its block. */
  private atBlockEnd(doc: EditDoc, stop: CaretStop): boolean {
    const own = doc.blockStops.get(stop.block);
    return own !== undefined && own[own.length - 1] === stop;
  }

  /**
   * Moves the caret to a stop. Leaving an empty exponent or subscript takes it away (an empty
   * place there would catch what is typed next).
   */
  private moveTo(sel: Sel, target: CaretStop): EditorResult {
    const { doc } = sel;
    const from = sel.focus.block;
    const part = doc.info.get(from)?.part;
    if ((part === 'sup' || part === 'sub') && isEmpty(from) && target.block !== from) {
      const { text, map } = removeSpans(doc.text, this.structureSpans(doc, from));
      return this.at(text, map(target.offset), target.depth, 'delete');
    }
    return this.to(doc, target, null);
  }

  private horizontal(sel: Sel, dir: -1 | 1, extend: boolean): EditorResult {
    const { doc } = sel;
    if (!sel.collapsed && !extend) {
      const edge = dir < 0 ? sel.start : sel.end;
      return this.to(doc, resolveCaret(doc.stops, edge, sel.block.depth), null);
    }
    const { focus } = sel;
    if (dir > 0 && !extend) {
      // At the end of a group still open, → closes it.
      const own = doc.info.get(focus.block);
      const fence = own?.part === 'group' ? (own.box as FenceBox) : null;
      if (fence && !fence.close && this.atBlockEnd(doc, focus)) {
        const p = focus.offset;
        const text = splice(doc.text, p, p, fence.bars ? '|' : ')');
        return this.at(text, p + 1, focus.depth - 1, 'insert');
      }
    }
    const next = doc.stops.list[(doc.order.get(focus) ?? 0) + dir];
    if (!next) return extend ? this.same(sel) : this.to(doc, focus, null);
    if (extend) return { state: this.state(sel.anchor, next, doc.text), edit: null };
    return this.moveTo(sel, next);
  }

  /**
   * Up and Down: into the numerator or the denominator of a fraction next to the caret, into an
   * exponent next to it (Up), between the parts of a fraction the caret is in, and out of an
   * exponent (Down) or a subscript (Up). Null when there is no such move: the row's neighbour
   * then takes the caret.
   */
  private vertical(sel: Sel, dir: -1 | 1): EditorResult | null {
    const target = this.verticalTarget(sel.doc, sel.focus, dir);
    return target ? this.moveTo(sel, target) : null;
  }

  private verticalTarget(doc: EditDoc, stop: CaretStop, dir: -1 | 1): CaretStop | null {
    const block = stop.block;
    if (!stop.inside) {
      const before = stop.index > 0 ? block.boxes[stop.index - 1] : undefined;
      const after = block.boxes[stop.index];
      if (dir < 0) {
        if (before?.kind === 'sup' && !before.atomic)
          return this.pick(doc, stop, before.body, 'end');
        if (after?.kind === 'sup' && !after.atomic)
          return this.pick(doc, stop, after.body, 'start');
        if (before?.kind === 'frac') return this.pick(doc, stop, before.num, 'end');
        if (after?.kind === 'frac') return this.pick(doc, stop, after.num, 'start');
      } else {
        if (before?.kind === 'frac') return this.pick(doc, stop, before.den, 'end');
        if (after?.kind === 'frac') return this.pick(doc, stop, after.den, 'start');
        if (before?.kind === 'atom' && before.sub) return this.pick(doc, stop, before.sub, 'end');
      }
    }
    for (let b: Block | null = block; b; ) {
      const own = doc.info.get(b);
      if (!own?.box || !own.parent) return null;
      if (dir < 0 && own.part === 'den')
        return this.pick(doc, stop, (own.box as FracBox).num, null);
      if (dir > 0 && own.part === 'num')
        return this.pick(doc, stop, (own.box as FracBox).den, null);
      if ((dir > 0 && own.part === 'sup') || (dir < 0 && own.part === 'sub')) {
        return this.after(doc, b);
      }
      b = own.parent;
    }
    return null;
  }

  /**
   * A stop in `target` for a caret coming from `from`: the nearest on screen when positions are
   * known, else its start or end (`side`, or the side `from` is at in its own block).
   */
  private pick(
    doc: EditDoc,
    from: CaretStop,
    target: Block,
    side: 'start' | 'end' | null,
  ): CaretStop | null {
    const own = doc.blockStops.get(target);
    if (!own || own.length === 0) return null;
    const { xOf } = this.opts;
    if (xOf && side === null) {
      const x = xOf(from);
      let best = own[0] as CaretStop;
      for (const st of own) if (Math.abs(xOf(st) - x) < Math.abs(xOf(best) - x)) best = st;
      return best;
    }
    const start =
      side === 'start' || (side === null && doc.blockStops.get(from.block)?.[0] === from);
    return (start ? own[0] : own[own.length - 1]) as CaretStop;
  }
}

/**
 * Runs an editing command. Total: any text and any carets (out of range, or not stops) are read
 * as the nearest stops first, and the carets returned are always stops of the new text. Null
 * only for Up and Down with nowhere to go in the row.
 */
export function runCommand(
  state: EditorState,
  cmd: EditorCommand,
  opts: EditorOptions,
): EditorResult | null {
  return new Editor(opts).run(state, cmd);
}

/** A state's selection: the stops of its ends, and the text offsets it covers (whole boxes). */
export interface Selection {
  doc: EditDoc;
  anchor: CaretStop;
  focus: CaretStop;
  start: number;
  end: number;
  /** The innermost block holding both ends. */
  block: Block;
  collapsed: boolean;
}

export function readSelection(state: EditorState, opts: EditorOptions): Selection {
  return new Editor(opts).read(state);
}

/**
 * The caret for a text offset set from outside (a focus, a test, a paste the editor didn't see):
 * the stop at `depth` (or the deepest above it); with no depth, the shallowest, unless an empty
 * place is there (`y=1/‸` is in its denominator).
 */
export function caretAt(text: string, offset: number, opts: EditorOptions, depth?: number): Caret {
  const doc = new Editor(opts).doc(text);
  const at = resolveCaret(doc.stops, offset, depth ?? 0);
  const stop = depth === undefined ? preferEmpty(doc, at) : at;
  return { offset: stop.offset, depth: stop.depth };
}
