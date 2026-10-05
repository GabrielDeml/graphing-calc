import type { EditOp } from './editing';

export type PageId = '123' | 'fx' | 'abc';

export type KeyAction =
  | { type: 'edit'; op: EditOp }
  | { type: 'enter' }
  | { type: 'page'; page: PageId }
  | { type: 'shift' }
  | { type: 'hide' }
  /** Switch the field to the device keyboard; must run inside the tap's click handler (iOS). */
  | { type: 'native' };

/** Icons drawn instead of a key's label (the components map them to SVGs). */
export type KeyIcon = 'keyboard' | 'backspace' | 'arrow-left' | 'arrow-right' | 'enter' | 'shift';

export interface KeyDef {
  /** Unique within a page and stable across shift states; rendered as `data-testid="key-<id>"`. */
  id: string;
  /** Text on the key; with an `icon`, the text the icon stands for. */
  label: string;
  /** Drawn in place of the label, for glyphs fonts render unevenly (⌫ ⌨ ↵ ⇧). */
  icon?: KeyIcon;
  ariaLabel: string;
  action: KeyAction;
  variant: 'char' | 'op' | 'fn' | 'action' | 'primary';
  /** Grid columns this key spans, out of the page's `columns` (default 1). */
  span?: number;
  /** Auto-repeat while held. */
  repeat?: boolean;
}

export interface KeypadPage {
  id: PageId;
  label: string;
  columns: number;
  rows: KeyDef[][];
}

/** Tab order. */
export const PAGE_ORDER: readonly PageId[] = ['123', 'fx', 'abc'];

type Variant = KeyDef['variant'];

/**
 * Every page is this many grid columns wide, so the action column has the same width and the
 * same place on every page. Ten standard keys fill a row; pages with fewer keys widen some.
 */
const GRID_UNITS = 30;
/** A standard key: a tenth of the row, like each ABC letter and the action column. */
const KEY = 3;
/** A wider key, for digits and function names. */
const WIDE = 4;

function key(
  id: string,
  label: string,
  ariaLabel: string,
  op: EditOp,
  variant: Variant,
  span = KEY,
): KeyDef {
  return { id, label, ariaLabel, action: { type: 'edit', op }, variant, span };
}

function ins(id: string, label: string, ariaLabel: string, variant: Variant, text = label) {
  return key(id, label, ariaLabel, { type: 'insert', text }, variant);
}

function fn(id: string, label: string, ariaLabel: string, name = id) {
  return key(id, label, ariaLabel, { type: 'function', name }, 'fn');
}

function digit(d: string): KeyDef {
  return key(d, d, d, { type: 'insert', text: d }, 'char', WIDE);
}

/** The same key at another width (a separate object, since spans differ between pages). */
function sized(def: KeyDef, span: number): KeyDef {
  return { ...def, span };
}

function repeating(def: KeyDef): KeyDef {
  def.repeat = true;
  return def;
}

// Shared objects: the same right-hand column on every page, so its keys keep their place (and
// their DOM nodes) when switching pages.
function withIcon(def: KeyDef, icon: KeyIcon): KeyDef {
  def.icon = icon;
  return def;
}

const BACKSPACE = withIcon(
  repeating(key('backspace', '⌫', 'backspace', { type: 'backspace' }, 'action')),
  'backspace',
);
const LEFT = withIcon(
  repeating(key('left', '←', 'move left', { type: 'left' }, 'action')),
  'arrow-left',
);
const RIGHT = withIcon(
  repeating(key('right', '→', 'move right', { type: 'right' }, 'action')),
  'arrow-right',
);
const ENTER: KeyDef = {
  id: 'enter',
  label: '↵',
  icon: 'enter',
  ariaLabel: 'enter',
  action: { type: 'enter' },
  variant: 'primary',
  span: KEY,
};

/** The action column, top to bottom. */
export const ACTION_COLUMN: readonly KeyDef[] = [BACKSPACE, LEFT, RIGHT, ENTER];

const ABS = key('abs', '|a|', 'absolute value', { type: 'wrap', before: '|', after: '|' }, 'fn');
const SQRT = fn('sqrt', '√', 'square root');
const PI_KEY = ins('pi', 'π', 'pi', 'char');
const X_KEY = ins('x', 'x', 'x', 'char');
const THETA = ins('theta', 'θ', 'theta', 'char');
const LPAREN = ins('lparen', '(', 'left parenthesis', 'char');
const RPAREN = ins('rparen', ')', 'right parenthesis', 'char');

function page(id: PageId, label: string, body: KeyDef[][]): KeypadPage {
  const rows = body.map((row, i) => [...row, ACTION_COLUMN[i]]);
  return { id, label, columns: GRID_UNITS, rows };
}

// Widths in grid units: 4 for digits, 3 for every other key.
//  x   y   a²  aᵇ │ 7  8  9 │ ÷ │ ⌫
//  (   )   <   >  │ 4  5  6 │ × │ ←
//  |a| ,   ≤   ≥  │ 1  2  3 │ − │ →
//  √   π   =   =  │ 0  0  . │ + │ ↵
// The plan puts ← → in this bottom row; they live in the shared action column instead, so they
// keep their place on every page, and = and 0 widen to fill the row.
const PAGE_123 = page('123', '123', [
  [
    X_KEY,
    ins('y', 'y', 'y', 'char'),
    ins('sq', 'a²', 'squared', 'op', '^2'),
    ins('pow', 'aᵇ', 'power', 'op', '^'),
    digit('7'),
    digit('8'),
    digit('9'),
    ins('div', '÷', 'divide', 'op', '/'),
  ],
  [
    LPAREN,
    RPAREN,
    ins('lt', '<', 'less than', 'op'),
    ins('gt', '>', 'greater than', 'op'),
    digit('4'),
    digit('5'),
    digit('6'),
    ins('mul', '×', 'times', 'op', '*'),
  ],
  [
    ABS,
    ins('comma', ',', 'comma', 'char'),
    ins('le', '≤', 'less than or equal to', 'op'),
    ins('ge', '≥', 'greater than or equal to', 'op'),
    digit('1'),
    digit('2'),
    digit('3'),
    ins('sub', '−', 'minus', 'op', '-'),
  ],
  [
    SQRT,
    PI_KEY,
    key('eq', '=', 'equals', { type: 'insert', text: '=' }, 'op', 2 * KEY),
    key('0', '0', '0', { type: 'insert', text: '0' }, 'char', 2 * WIDE),
    key('dot', '.', 'decimal point', { type: 'insert', text: '.' }, 'char', WIDE),
    ins('add', '+', 'plus', 'op'),
  ],
]);

// Function names get wide keys (4 units) so labels like "round" fit; the last column is standard.
//  sin   cos   tan  │ ln    log   exp   │ e │ ⌫
//  sin⁻¹ cos⁻¹ tan⁻¹│ √     ∛     |a|   │ ! │ ←
//  sinh  cosh  tanh │ floor ceil  round │ π │ →
//  min   max   mod  │ θ     t     r     │ x │ ↵
// π and x are repeated from 123 so `sin(πx)` needs no tab switch.
const PAGE_FX = page('fx', 'f(x)', [
  [
    sized(fn('sin', 'sin', 'sine'), WIDE),
    sized(fn('cos', 'cos', 'cosine'), WIDE),
    sized(fn('tan', 'tan', 'tangent'), WIDE),
    sized(fn('ln', 'ln', 'natural log'), WIDE),
    sized(fn('log', 'log', 'log base 10'), WIDE),
    sized(fn('exp', 'exp', 'exponential'), WIDE),
    ins('e', 'e', "Euler's number", 'char'),
  ],
  [
    // arc… spellings: the engine reads `asin` as a·sin when a slider `a` exists.
    sized(fn('asin', 'sin⁻¹', 'arcsine', 'arcsin'), WIDE),
    sized(fn('acos', 'cos⁻¹', 'arccosine', 'arccos'), WIDE),
    sized(fn('atan', 'tan⁻¹', 'arctangent', 'arctan'), WIDE),
    sized(SQRT, WIDE),
    sized(fn('cbrt', '∛', 'cube root'), WIDE),
    sized(ABS, WIDE),
    ins('fact', '!', 'factorial', 'op'),
  ],
  [
    sized(fn('sinh', 'sinh', 'hyperbolic sine'), WIDE),
    sized(fn('cosh', 'cosh', 'hyperbolic cosine'), WIDE),
    sized(fn('tanh', 'tanh', 'hyperbolic tangent'), WIDE),
    sized(fn('floor', 'floor', 'floor'), WIDE),
    sized(fn('ceil', 'ceil', 'ceiling'), WIDE),
    sized(fn('round', 'round', 'round'), WIDE),
    PI_KEY,
  ],
  [
    sized(fn('min', 'min', 'minimum'), WIDE),
    sized(fn('max', 'max', 'maximum'), WIDE),
    sized(fn('mod', 'mod', 'modulo'), WIDE),
    sized(THETA, WIDE),
    sized(ins('t', 't', 't', 'char'), WIDE),
    sized(ins('r', 'r', 'r', 'char'), WIDE),
    X_KEY,
  ],
]);

// Nine letters plus the action column fill a row, so `p` moves to the end of the third row;
// shift sits at that row's start as on phone keyboards. Every key is standard width except space.
//  q w e r t y u i o │ ⌫
//  a s d f g h j k l │ ←
//  ⇧ z x c v b n m p │ →
//  ⌨ θ _ ␣ ␣ ␣ ( ) , │ ↵   (one space key three keys wide)
const LETTER_ROWS = ['qwertyuio', 'asdfghjkl', 'zxcvbnmp'];

function letter(ch: string, upper: boolean): KeyDef {
  return upper
    ? ins(ch, ch.toUpperCase(), `capital ${ch.toUpperCase()}`, 'char')
    : ins(ch, ch, ch, 'char');
}

const SHIFT_OFF: KeyDef = {
  id: 'shift',
  label: '⇧',
  icon: 'shift',
  ariaLabel: 'shift',
  action: { type: 'shift' },
  variant: 'action',
  span: KEY,
};
const SHIFT_ON: KeyDef = { ...SHIFT_OFF, ariaLabel: 'shift on', variant: 'primary' };

const ABC_BOTTOM: KeyDef[] = [
  {
    id: 'native',
    label: '⌨',
    icon: 'keyboard',
    ariaLabel: 'Use device keyboard',
    action: { type: 'native' },
    variant: 'action',
    span: KEY,
  },
  THETA,
  ins('underscore', '_', 'subscript', 'char'),
  key('space', 'space', 'space', { type: 'insert', text: ' ' }, 'char', 3 * KEY),
  LPAREN,
  RPAREN,
  ins('comma', ',', 'comma', 'char'),
];

function abcPage(upper: boolean): KeypadPage {
  const [top, middle, bottom] = LETTER_ROWS.map((row) => [...row].map((ch) => letter(ch, upper)));
  return page('abc', 'ABC', [top, middle, [upper ? SHIFT_ON : SHIFT_OFF, ...bottom], ABC_BOTTOM]);
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value)) deepFreeze(v);
  }
  return value;
}

// Built once: getPage runs on every render and must hand back the same KeyDef objects so the
// component's keyed list reuses its buttons.
const PAGES: Record<PageId, readonly [KeypadPage, KeypadPage]> = deepFreeze({
  '123': [PAGE_123, PAGE_123],
  fx: [PAGE_FX, PAGE_FX],
  abc: [abcPage(false), abcPage(true)],
});

/** The key grid for a page. `shift` only changes the ABC page (capital letters). */
export function getPage(id: PageId, shift: boolean): KeypadPage {
  const pair = PAGES[id] ?? PAGES['123'];
  return pair[shift ? 1 : 0];
}
