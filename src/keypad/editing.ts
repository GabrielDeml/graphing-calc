import {
  BUILTIN_CONSTANTS,
  BUILTIN_FUNCTION_NAMES,
  isBuiltinFunction,
} from '../engine/builtinNames';

/** An input's text and selection, as UTF-16 offsets like `selectionStart`/`selectionEnd`. */
export interface EditState {
  text: string;
  selStart: number;
  selEnd: number;
}

export type EditOp =
  /** Replace the selection. `)` and a closing `|` type over an identical next character. */
  | { type: 'insert'; text: string }
  /** Surround the selection (caret after `after`), or insert both with the caret between. */
  | { type: 'wrap'; before: string; after: string }
  /** `name(sel)` with the caret after `)`, or `name()` with the caret inside. */
  | { type: 'function'; name: string }
  /** `^exponent` (a²), the caret after it: in a typeset row, out of the exponent. */
  | { type: 'power'; exponent: string }
  | { type: 'backspace' }
  | { type: 'deleteForward' }
  | { type: 'left' }
  | { type: 'right' }
  | { type: 'home' }
  | { type: 'end' }
  | { type: 'clear' };

const LPAREN = 40;
const RPAREN = 41;
const COMMA = 44;
const BAR = 124;
const UNDERSCORE = 95;
const PI = 0x3c0;
const TAU = 0x3c4;
const SQRT_SIGN = 0x221a;
const CBRT_SIGN = 0x221b;

const LONGEST_NAME = Math.max(
  'theta'.length,
  ...BUILTIN_FUNCTION_NAMES.map((n) => n.length),
  ...Object.keys(BUILTIN_CONSTANTS).map((n) => n.length),
);

function isLatin(c: number): boolean {
  return (c >= 65 && c <= 90) || (c >= 97 && c <= 122);
}

/**
 * Letters that continue an identifier run, mirroring the tokenizer: Latin and Greek, except π and
 * τ, which are tokens of their own.
 */
export function isRunLetter(c: number): boolean {
  if (isLatin(c)) return true;
  return ((c >= 0x391 && c <= 0x3a9) || (c >= 0x3b1 && c <= 0x3c9)) && c !== PI && c !== TAU;
}

/** Characters of an unbraced subscript, mirroring the tokenizer. */
export function isSubscriptChar(c: number): boolean {
  return (c >= 48 && c <= 57) || isLatin(c);
}

export function isSpace(c: number): boolean {
  return (
    c === 32 ||
    (c >= 9 && c <= 13) ||
    c === 0xa0 ||
    (c >= 0x2000 && c <= 0x200b) ||
    c === 0x202f ||
    c === 0x205f ||
    c === 0x3000 ||
    c === 0xfeff
  );
}

/** Operators, relations, '(' and ',': after one of these an operand starts. */
function isPrefixChar(c: number): boolean {
  switch (c) {
    case 43: // +
    case 45: // -
    case 0x2212: // −
    case 42: // *
    case 0xb7: // ·
    case 0xd7: // ×
    case 0x22c5: // ⋅
    case 47: // /
    case 0xf7: // ÷
    case 94: // ^
    case 61: // =
    case 60: // <
    case 62: // >
    case 0x2264: // ≤
    case 0x2265: // ≥
    case LPAREN:
    case COMMA:
      return true;
    default:
      return false;
  }
}

function isHighSurrogate(c: number): boolean {
  return c >= 0xd800 && c <= 0xdbff;
}

function isLowSurrogate(c: number): boolean {
  return c >= 0xdc00 && c <= 0xdfff;
}

/** Offset of the code point that ends at `p` (p > 0). */
export function prevCodePoint(text: string, p: number): number {
  if (p >= 2 && isLowSurrogate(text.charCodeAt(p - 1)) && isHighSurrogate(text.charCodeAt(p - 2))) {
    return p - 2;
  }
  return p - 1;
}

/** Offset just past the code point that starts at `p` (p < text.length). */
export function nextCodePoint(text: string, p: number): number {
  if (isHighSurrogate(text.charCodeAt(p)) && isLowSurrogate(text.charCodeAt(p + 1))) return p + 2;
  return p + 1;
}

function isKnownName(name: string): boolean {
  // The engine reads 'theta' inside a run as θ, so it is a unit when splitting too.
  return isBuiltinFunction(name) || Object.hasOwn(BUILTIN_CONSTANTS, name) || name === 'theta';
}

/**
 * Where the identifier holding the run letters [s, end) starts, or -1 when `end` lies inside an
 * unbraced subscript. Like the tokenizer, a subscript runs from '_' over ASCII letters and digits,
 * so `v_max` is a single name, while `a_1θsin` ends the subscript at θ. A subscript that starts
 * with a digit stops at the first non-digit, so `a_1sin` is a_1·sin.
 */
function identifierStart(text: string, s: number, end: number): number {
  let k = s;
  while (k > 0 && isSubscriptChar(text.charCodeAt(k - 1))) k--;
  if (k === 0 || text.charCodeAt(k - 1) !== UNDERSCORE) return s;
  const first = text.charCodeAt(k);
  if (k < s && first >= 48 && first <= 57) return s;
  let m = s;
  while (m < end && isSubscriptChar(text.charCodeAt(m))) m++;
  return m < end ? m : -1;
}

/**
 * Start of the builtin function name that ends at `end`, or -1. Mirrors how the engine reads a
 * letter run: split from the left into the longest builtin function or constant names, else
 * single letters, so `xsin` is x·sin and `basin` is b·asin. √ and ∛ are names of their own.
 */
export function builtinNameStart(text: string, end: number): number {
  if (end <= 0) return -1;
  const last = text.charCodeAt(end - 1);
  if (last === SQRT_SIGN || last === CBRT_SIGN) return end - 1;
  let s = end;
  while (s > 0 && isRunLetter(text.charCodeAt(s - 1))) s--;
  if (s === end) return -1;
  s = identifierStart(text, s, end);
  if (s < 0) return -1;
  let i = s;
  for (;;) {
    let len = 1;
    for (let l = Math.min(LONGEST_NAME, end - i); l >= 2; l--) {
      if (isKnownName(text.slice(i, i + l))) {
        len = l;
        break;
      }
    }
    if (i + len >= end) return isBuiltinFunction(text.slice(i, end)) ? i : -1;
    i += len;
  }
}

/**
 * If `t` falls strictly inside a builtin call token `name(` (anywhere from after its first letter
 * up to just before the `(` ends), move it to the token's end (forward) or start (backward).
 */
function snapOutOfName(text: string, t: number, forward: boolean): number {
  let b = t;
  while (b < text.length && isRunLetter(text.charCodeAt(b))) b++;
  if (text.charCodeAt(b) !== LPAREN) return t;
  const a = builtinNameStart(text, b);
  if (a < 0 || a >= t) return t;
  return forward ? b + 1 : a;
}

/** '(' in text[0, end) that no ')' before `end` closes. */
function unclosedOpens(text: string, end: number): number {
  let depth = 0;
  for (let i = 0; i < end; i++) {
    const c = text.charCodeAt(i);
    if (c === LPAREN) depth++;
    else if (c === RPAREN && depth > 0) depth--;
  }
  return depth;
}

/** ')' from `start` on that no '(' from `start` on matches. */
function strayCloses(text: string, start: number): number {
  let depth = 0;
  let stray = 0;
  for (let i = start; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c === LPAREN) depth++;
    else if (c === RPAREN) {
      if (depth > 0) depth--;
      else stray++;
    }
  }
  return stray;
}

/**
 * Whether the `)` at `i` may go with the innermost `(` before it: true unless an outer `(` would
 * then be left unclosed, as in `sqrt((x-1‸)`, where that `)` belongs to `sqrt(`. Decides
 * type-over and whether backspace removes a `)` along with its `(`.
 */
export function isSpareClose(text: string, i: number): boolean {
  return unclosedOpens(text, i) <= strayCloses(text, i + 1) + 1;
}

type BarPrev = 'prefix' | 'open' | 'operand';

interface BarContext {
  /** Absolute values open at this point, within the current parentheses. */
  depth: number;
  /** What the last non-space character before this point was. */
  prev: BarPrev;
}

/**
 * The abs-bar state at `end`, scanning bars the way the parser reads them. A bar in prefix
 * position (at the start, or after an operator, relation, '(', ',', an opening bar or a function
 * name) opens. Any other bar closes the innermost open one, or opens an implicit product
 * (`|a||b|`) when none is open. Parentheses start a fresh level, so `|(|x|)|` nests.
 */
function barContext(text: string, end: number): BarContext {
  const outer: number[] = [];
  let depth = 0;
  let prev: BarPrev | 'word' = 'prefix';
  let wordEnd = 0;
  for (let i = 0; i < end; i++) {
    const c = text.charCodeAt(i);
    if (isSpace(c)) continue;
    if (c === BAR) {
      if (prev === 'word') prev = builtinNameStart(text, wordEnd) >= 0 ? 'prefix' : 'operand';
      if (prev === 'operand' && depth > 0) {
        depth--;
      } else {
        depth++;
        prev = 'open';
      }
    } else if (c === LPAREN) {
      outer.push(depth);
      depth = 0;
      prev = 'prefix';
    } else if (c === RPAREN) {
      depth = outer.pop() ?? depth;
      prev = 'operand';
    } else if (isPrefixChar(c)) {
      prev = 'prefix';
    } else if (isRunLetter(c) || c === SQRT_SIGN || c === CBRT_SIGN) {
      // Resolved only at a bar, since checking for a function name costs a scan of the word.
      prev = 'word';
      wordEnd = i + 1;
    } else {
      prev = 'operand';
    }
  }
  if (prev === 'word') prev = builtinNameStart(text, wordEnd) >= 0 ? 'prefix' : 'operand';
  return { depth, prev };
}

/** Whether the parser reads the `|` at `i` as an opening bar. */
export function barOpens(text: string, i: number): boolean {
  const { depth, prev } = barContext(text, i);
  return depth === 0 || prev !== 'operand';
}

/**
 * Whether typing `|` before the `|` at `i` should move past it: it closes an open absolute
 * value, or is the closing half of an empty `|‸|` template.
 */
export function barTypesOver(text: string, i: number): boolean {
  const { depth, prev } = barContext(text, i);
  return depth > 0 && prev !== 'prefix';
}

function clampOffset(n: number, len: number): number {
  if (Number.isNaN(n)) return len;
  return Math.min(Math.max(Math.trunc(n), 0), len);
}

function normalize(state: EditState): EditState {
  const text = typeof state.text === 'string' ? state.text : '';
  const a = clampOffset(state.selStart, text.length);
  const b = clampOffset(state.selEnd, text.length);
  return a <= b ? { text, selStart: a, selEnd: b } : { text, selStart: b, selEnd: a };
}

function caret(text: string, p: number): EditState {
  return { text, selStart: p, selEnd: p };
}

/** Replace text[start, end) with `insert`; the caret lands `caretAt` chars into `insert`. */
function splice(
  text: string,
  start: number,
  end: number,
  insert: string,
  caretAt = insert.length,
): EditState {
  return caret(text.slice(0, start) + insert + text.slice(end), start + caretAt);
}

function wrap(s: EditState, before: string, after: string): EditState {
  const { text, selStart, selEnd } = s;
  if (selStart === selEnd) return splice(text, selStart, selEnd, before + after, before.length);
  const inner = before + text.slice(selStart, selEnd) + after;
  return splice(text, selStart, selEnd, inner);
}

function insert(s: EditState, ins: string): EditState {
  const { text, selStart, selEnd } = s;
  if (selStart === selEnd && ins.length === 1) {
    const c = ins.charCodeAt(0);
    if (
      text.charCodeAt(selStart) === c &&
      ((c === RPAREN && isSpareClose(text, selStart)) ||
        (c === BAR && barTypesOver(text, selStart)))
    ) {
      return caret(text, selStart + 1);
    }
  }
  return splice(text, selStart, selEnd, ins);
}

function backspace(s: EditState): EditState {
  const { text, selStart: p, selEnd } = s;
  if (p !== selEnd) return splice(text, p, selEnd, '');
  if (p === 0) return s;
  const prev = text.charCodeAt(p - 1);
  const next = text.charCodeAt(p);
  if (prev === LPAREN) {
    const pair = next === RPAREN && isSpareClose(text, p);
    const start = builtinNameStart(text, p - 1);
    if (start >= 0) return splice(text, start, pair ? p + 1 : p, '');
    if (pair) return splice(text, p - 1, p + 1, '');
  } else if (prev === BAR && next === BAR && barOpens(text, p - 1)) {
    return splice(text, p - 1, p + 1, '');
  }
  return splice(text, prevCodePoint(text, p), p, '');
}

function deleteForward(s: EditState): EditState {
  const { text, selStart: p, selEnd } = s;
  if (p !== selEnd) return splice(text, p, selEnd, '');
  if (p === text.length) return s;
  return splice(text, p, nextCodePoint(text, p), '');
}

function left(s: EditState): EditState {
  const { text, selStart, selEnd } = s;
  if (selStart !== selEnd) return caret(text, snapOutOfName(text, selStart, false));
  if (selStart === 0) return s;
  return caret(text, snapOutOfName(text, prevCodePoint(text, selStart), false));
}

function right(s: EditState): EditState {
  const { text, selStart, selEnd } = s;
  if (selStart !== selEnd) return caret(text, snapOutOfName(text, selEnd, true));
  if (selEnd === text.length) return s;
  return caret(text, snapOutOfName(text, nextCodePoint(text, selEnd), true));
}

/**
 * Apply one keypad edit. Pure and total: out-of-range, reversed or NaN selections are clamped
 * first, and an unknown op returns the normalized state unchanged.
 */
export function applyEdit(state: EditState, op: EditOp): EditState {
  const s = normalize(state);
  switch (op.type) {
    case 'insert':
      return insert(s, op.text);
    case 'wrap':
      return wrap(s, op.before, op.after);
    case 'function':
      return wrap(s, `${op.name}(`, ')');
    case 'power':
      return insert(s, `^${op.exponent}`);
    case 'backspace':
      return backspace(s);
    case 'deleteForward':
      return deleteForward(s);
    case 'left':
      return left(s);
    case 'right':
      return right(s);
    case 'home':
      return caret(s.text, 0);
    case 'end':
      return caret(s.text, s.text.length);
    case 'clear':
      return caret('', 0);
    default:
      return s;
  }
}
