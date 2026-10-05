import { describe, expect, it } from 'vitest';
import { EMPTY_CONTEXT, type NameContext } from '../engine/names';
import { parse } from '../engine/parser';
import { mulberry32, pick, randomSource } from '../engine/testing/fuzz';
import { caretStops } from './caret';
import {
  caretAt,
  type EditorCommand,
  type EditorOptions,
  type EditorState,
  readSelection,
  runCommand,
} from './commands';
import { layoutParse } from './layout';
import { type Block, forEachLeaf, renderPlan } from './plan';

const OPTS: EditorOptions = { names: EMPTY_CONTEXT };

function ctxOf(vars: string[] = [], fns: Record<string, number> = {}): NameContext {
  return { vars: new Set(vars), fns: new Map(Object.entries(fns)) };
}

/**
 * A state in ‸ notation: the text with ‸ at the caret, then :depth (default: the shallowest stop
 * there). A selection is «…», from its anchor « to its focus ».
 */
function state(s: string, opts = OPTS): EditorState {
  const m = /^(.*?)(?::(\d+))?$/su.exec(s) as RegExpExecArray;
  const body = m[1] as string;
  if (body.includes('«')) {
    const a = body.indexOf('«');
    const text = body.replace('«', '').replace('»', '');
    const f = body.replace('«', '').indexOf('»');
    return { text, anchor: caretAt(text, a, opts), focus: caretAt(text, f, opts) };
  }
  const at = body.indexOf('‸');
  const text = body.replace('‸', '');
  const offset = at < 0 ? text.length : at;
  const caret = m[2] === undefined ? caretAt(text, offset, opts) : { offset, depth: Number(m[2]) };
  return { text, anchor: caret, focus: caret };
}

function show(st: EditorState): string {
  const { text, focus, anchor } = st;
  if (anchor.offset !== focus.offset || anchor.depth !== focus.depth) {
    const sel = readSelection(st, OPTS);
    return `${text.slice(0, sel.start)}«${text.slice(sel.start, sel.end)}»${text.slice(sel.end)}`;
  }
  return `${text.slice(0, focus.offset)}‸${text.slice(focus.offset)}:${focus.depth}`;
}

function run(from: string, cmd: EditorCommand, opts = OPTS): string {
  const r = runCommand(state(from, opts), cmd, opts);
  return r ? show(r.state) : 'null';
}

/** Types `keys` one character at a time. */
function type(from: string, keys: string, opts = OPTS): string {
  let st = state(from, opts);
  for (const ch of keys) {
    st = (runCommand(st, { type: 'type', text: ch }, opts) as { state: EditorState }).state;
  }
  return show(st);
}

describe('typing', () => {
  it.each([
    // The plan's examples.
    ['', 'y=1/2x', 'y=1/(2x‸):1'],
    ['', 'x^2+1', 'x^2+1‸:0'],
    ['', 'e^2x', 'e^(2x‸):1'],
    ['', 'x^2y', 'x^(2y‸):1'],
    ['', 'y = x', 'y = x‸:0'],
    ['', 'y = sin(x)', 'y = sin(x)‸:0'],
    ['', '(x+1)/(x-1)', '(x+1)/(x-1)‸:0'],
    ['', 'f(x)=x^2', 'f(x)=x^2‸:1'],
    ['', 'x**2+1', 'x**2+1‸:0'],
    ['', '2x/3=4', '2x/3=4‸:0'],
    ['', 'y=|x|', 'y=|x|‸:0'],
    // A denominator, an exponent and a radicand keep what is typed in them.
    ['', '1/2+3', '1/(2+3‸):1'],
    ['', '√2x+', '√(2x+‸):1'],
    ['2‸/3:1', '+', '(2+‸)/3:1'],
    ['1/‸2:1', 'x', '1/(x‸2):1'],
    ['x^‸2:1', 'y', 'x^(y‸2):1'],
    // Typed after a structure, a character stays after it.
    ['2/3‸:0', 'x', '2/3x‸:0'],
    ['2/3‸:0', '4', '2/3 4‸:0'],
    ['x^2‸:0', '!', '(x^2)!‸:0'],
    ['‸1/2:0', '3', '3‸(1/2):0'],
    ['x^2‸:0', 'y', 'x^2y‸:0'],
    // Right after a structure with an empty last part, typing goes into it (End, a paste, an
    // IME or a click can leave the caret after the fraction rather than in its denominator).
    ['y=1/‸:0', '2', 'y=1/2‸:1'],
    ['y=x^‸:0', '2', 'y=x^2‸:1'],
    ['x_‸:0', '2', 'x_2‸:1'],
    // Right after a `)` that closed a denominator's or an exponent's group, `^` and `!` are for
    // that group, as the text reads.
    ['1/(x+1)‸:0', '^2', '1/(x+1)^2‸:2'],
    ['1/(x+1)‸:0', '!', '1/(x+1)!‸:1'],
    ['x^(2)‸:0', '!', 'x^(2)!‸:1'],
    // A function's name typed into a denominator or an exponent takes back the parentheses its
    // first letters needed (`1/si` reads as (1/s)i).
    ['', 'y=1/sin(x)', 'y=1/sin(x)‸:1'],
    ['', 'e^sin(x)', 'e^sin(x)‸:1'],
    ['', 'y=log(x)/log(2)', 'y=log(x)/log(2)‸:1'],
    ['1/(2si‸):1', 'n', '1/(2sin‸):1'],
    // A space must not split a part.
    ['x^2‸3:1', ' ', 'x^(2 ‸3):1'],
    ['1/2‸3:1', ' ', '1/(2 ‸3):1'],
    ['a_1‸2:1', ' ', 'a_1‸2:1'],
    // A function's power is one number or name: what follows is its argument.
    ['', 'y=sin^2(x)', 'y=sin^2(x)‸:0'],
    ['', 'y=sin^2x', 'y=sin^2x‸:0'],
    ['', 'y=sin^(2x)', 'y=sin^(2x)‸:0'],
  ])('%j + %j → %j', (from, keys, expected) => {
    expect(type(from, keys)).toBe(expected);
  });

  it('opens sqrt and cbrt, and no other function', () => {
    expect(type('', 'sqrt')).toBe('sqrt(‸):1');
    expect(type('', 'cbrt')).toBe('cbrt(‸):1');
    expect(type('', 'sqrtx')).toBe('sqrt(x‸):1');
    expect(type('', 'xsqrt')).toBe('xsqrt(‸):1');
    expect(type('', 'sin')).toBe('sin‸:0');
    // Before parentheses, the name takes them.
    expect(type('‸(x)', 'sqrt')).toBe('sqrt(‸x):1');
  });

  it.each([
    ['', 'sqrt(x)', 'sqrt(x)‸:0'],
    ['', 'sqrt(x)+1', 'sqrt(x)+1‸:0'],
    ['', 'cbrt(x)', 'cbrt(x)‸:0'],
    ['', 'y=sqrt(x)/2', 'y=sqrt(x)/2‸:1'],
    ['', 'sqrt((x+1)/2)', 'sqrt((x+1)/2)‸:0'],
    ['', '(sqrt(x))', '(sqrt(x))‸:0'],
    ['a‸b', '/(x+1)', 'a/(x+1)‸b:0'],
    ['x‸y', '^(2)', 'x^(2)‸y:0'],
  ])(
    'a ( typed into parentheses the editor just opened is theirs: %j + %j → %j',
    (from, keys, expected) => {
      expect(type(from, keys)).toBe(expected);
    },
  );

  it.each([
    ['', '/', '(‸)/:1'],
    ['y = ‸', '/', 'y = (‸)/:1'],
    ['1‸', '/', '1/‸:1'],
    ['1‸ = 2', '/', '1/‸ = 2:1'],
    // A sign would be read into the denominator.
    ['1‸ + 2', '/', '1/(‸) + 2:1'],
    ['a‸b', '/', 'a/(‸)b:1'],
    ['a‸-b', '/', 'a/(‸)-b:1'],
    ['x‸', '÷', 'x÷‸:1'],
    ['x^2‸:1', '/', 'x^(2/‸):2'],
    ['1/2‸:1', '/', '1/(2/‸):2'],
    ['(x+1)‸', '/', '(x+1)/‸:1'],
    ['2‸/3:1', '/', '2/‸/3:2'],
  ])('/ : %j + %j → %j', (from, keys, expected) => {
    expect(type(from, keys)).toBe(expected);
  });

  it.each([
    ['x‸', '^', 'x^‸:1'],
    ['x‸y', '^', 'x^(‸)y:1'],
    ['a/b‸:0', '^', '(a/b)^‸:1'],
    ['(x+1)‸', '^', '(x+1)^‸:1'],
    ['x^2‸:1', '^', 'x^2^‸:2'],
    ['1/2‸:1', '^', '1/2^‸:2'],
    ['‸', '^', '^‸:1'],
    ['x*‸', '*', 'x**‸:1'],
  ])('^ : %j + %j → %j', (from, keys, expected) => {
    expect(type(from, keys)).toBe(expected);
  });

  it.each([
    ['x‸', '_', 'x_‸:1'],
    ['x‸', '_1', 'x_1‸:1'],
    ['x‸y', '_', 'x_{‸}y:1'],
    ['2‸', '_', '2‸:0'],
    ['sin‸', '_', 'sin‸:0'],
    // A log's base.
    ['y = log‸', '_2(x', 'y = log_2(x‸:1'],
    ['y = log‸', '_{10} x', 'y = log_10 x‸:0'],
    ['a_1‸:1', '_', 'a_1‸:1'],
    ['a_1‸:1', '2', 'a_12‸:1'],
    // Letters and digits stay in a subscript, the rest leave it.
    ['a_1‸:1', 'x', 'a_{1x‸}:1'],
    ['a_1‸:1', '+', 'a_1+‸:0'],
    ['a_1‸:1', '(', 'a_1(‸:1'],
    ['a_1‸:1', ' ', 'a_1‸:0'],
    ['a_‸:1', '+', 'a+‸:0'],
    ['a_‸:1', ' ', 'a‸:0'],
    // Braces are the editor's: `{` is already there, `}` leaves.
    ['x_‸:1', '{', 'x_‸:1'],
    ['x_10‸:1', '}', 'x_10‸:0'],
    ['x_{10‸}:1', '}', 'x_{10}‸:0'],
    ['', 'x_{10}', 'x_10‸:0'],
  ])('_ : %j + %j → %j', (from, keys, expected) => {
    expect(type(from, keys)).toBe(expected);
  });

  it.each([
    ['‸', '(', '(‸:1'],
    ['(x‸:1', ')', '(x)‸:0'],
    ['(x‸):1', ')', '(x)‸:0'],
    ['sqrt((x-1‸):2', ')', 'sqrt((x-1)‸):1'],
    ['|x‸:1', '|', '|x|‸:0'],
    ['|x‸|:1', '|', '|x|‸:0'],
    ['‸', '|', '|‸:1'],
    ['x‸', ')', 'x)‸:0'],
    // `(` in a denominator stays in it: the denominator needs its parentheses then.
    ['1/2‸:1', '(', '1/(2(‸)):2'],
    // In the empty |‸| of the |a| key, what is typed is the bars'.
    ['|‸|:1', 'x', '|x‸|:1'],
    ['y=2|‸|:1', 'x+1', 'y=2|x+1‸|:1'],
    ['1/(2|‸|):2', 'x', '1/(2|x‸|):2'],
    // At the end of a denominator or an exponent in the editor's parentheses, `)` and `|` are
    // for the group around it.
    ['(1/(2x‸):2', ')', '(1/(2x))‸:0'],
    ['((1/(2x‸)):3', ')', '((1/(2x))‸):1'],
    ['(x^(2y‸):2', ')', '(x^(2y))‸:0'],
    ['', '(1/2x)+1', '(1/(2x))+1‸:0'],
    ['', 'y=sin(x/2+1)+3', 'y=sin(x/(2+1))+3‸:0'],
    ['', '|x/2+1|', '|x/(2+1)|‸:0'],
    // With no group around, `|` starts one in the denominator.
    ['1/(2x‸):1', '|', '1/(2x|‸):2'],
  ])('( ) | : %j + %j → %j', (from, keys, expected) => {
    expect(type(from, keys)).toBe(expected);
  });

  it.each([
    ['x^2‸:1', '+', 'x^2+‸:0'],
    ['x^2‸:1', '-', 'x^2-‸:0'],
    ['x^2‸:1', '=', 'x^2=‸:0'],
    ['x^2‸:1', '<', 'x^2<‸:0'],
    ['x^2‸:1', '>', 'x^2>‸:0'],
    ['x^2‸:1', ',', 'x^2,‸:0'],
    ['x^(2y‸):1', '+', 'x^(2y)+‸:0'],
    // `-` in an empty exponent is its sign.
    ['x^‸:1', '-', 'x^-‸:1'],
    ['x^‸:1', '-1', 'x^-1‸:1'],
    // In the middle of an exponent, typing stays in it.
    ['x^‸2:1', '-', 'x^-‸2:1'],
    ['x^2‸3:1', '+', 'x^(2+‸3):1'],
    // After an operator, a sign is the operand's.
    ['x^(2*‸):1', '-', 'x^(2*-‸):1'],
    ['', 'x^2*-1', 'x^(2*-1‸):1'],
  ])('+ - = < > , : %j + %j → %j', (from, keys, expected) => {
    expect(type(from, keys)).toBe(expected);
  });

  it.each([
    ['x^2‸:1', ' ', 'x^2‸:0'],
    ['x^2‸:1', ' y', 'x^2y‸:0'],
    ['x^‸:1', ' ', 'x‸:0'],
    ['y = 2‸', ' ', 'y = 2 ‸:0'],
    ['1/‸:1', ' ', '1/‸:1'],
    ['sqrt(x‸):1', ' ', 'sqrt(x ‸):1'],
  ])('space: %j + %j → %j', (from, keys, expected) => {
    expect(type(from, keys)).toBe(expected);
  });

  it.each([
    ['y=‸', '=', 'y=‸:0'],
    ['y=‸', '<', 'y<=‸:0'],
    ['y=‸', '>', 'y>=‸:0'],
    ['y<‸', '=', 'y<=‸:0'],
    ['y ‸', '—', 'y -‸:0'],
    ['x‸', '–1', 'x-1‸:0'],
  ])('corrections: %j + %j → %j', (from, keys, expected) => {
    expect(type(from, keys)).toBe(expected);
  });

  it.each([
    ['«x+1»', '/', '(x+1)/‸:1'],
    ['«(x+1)»', '/', '(x+1)/‸:1'],
    ['«x»', '^', '(x)^‸:1'],
    ['y = «x+1»', '(', 'y = (x+1)‸:0'],
    ['y = «x»', '|', 'y = |x|‸:0'],
    ['y = «x+1»', '2', 'y = 2‸:0'],
    ['«y = x»', 'a', 'a‸:0'],
  ])('over a selection: %j + %j → %j', (from, keys, expected) => {
    expect(type(from, keys)).toBe(expected);
  });

  it('groups letters with the names in scope', () => {
    const opts = { names: ctxOf(['a']) };
    expect(type('', 'y=asin(x', opts)).toBe('y=asin(x‸:1');
  });

  it('reports insertions, and replacements over a selection, for undo', () => {
    const insert = runCommand(state('1/2‸:1'), { type: 'type', text: 'x' }, OPTS);
    expect(insert?.edit).toBe('insert');
    const replace = runCommand(state('«x»'), { type: 'type', text: '/' }, OPTS);
    expect(replace?.edit).toBe('replace');
    const ignored = runCommand(state('y=‸'), { type: 'type', text: '=' }, OPTS);
    expect(ignored?.edit).toBeNull();
  });
});

describe('pasting and composing', () => {
  it('inserts text as it is', () => {
    expect(run('‸', { type: 'insert', text: 'y = sin(x)/2' })).toBe('y = sin(x)/2‸:0');
    expect(run('y = «x»', { type: 'insert', text: '1/2x' })).toBe('y = 1/2x‸:0');
    // An empty place at the end takes the caret.
    expect(run('‸', { type: 'insert', text: 'y=1/' })).toBe('y=1/‸:1');
  });

  it('reads a caret set from outside into an empty place at its offset', () => {
    expect(caretAt('y=1/', 4, OPTS)).toEqual({ offset: 4, depth: 1 });
    expect(caretAt('y=1/', 4, OPTS, 0)).toEqual({ offset: 4, depth: 0 });
    expect(caretAt('y=1/2', 5, OPTS)).toEqual({ offset: 5, depth: 0 });
  });
});

describe('Backspace', () => {
  it.each([
    // At the start of a part, the fraction comes apart.
    ['1/‸2:1', '1‸2:0'],
    ['‸1/2:1', '‸12:0'],
    ['1/(‸):1', '1‸:0'],
    ['(‸)/2:1', '‸2:0'],
    ['1/(‸x+1):1', '1‸(x+1):0'],
    // An exponent or a subscript loses its `^` or `_` (and its parentheses).
    ['x^‸2:1', 'x‸2:0'],
    ['x^(‸2y):1', 'x‸2y:0'],
    ['x^‸:1', 'x‸:0'],
    ['x**‸:1', 'x‸:0'],
    ['a_‸1:1', 'a‸1:0'],
    ['a_{‸1x}:1', 'a‸1x:0'],
    // A radical loses its name.
    ['sqrt(‸x):1', '‸x:0'],
    ['sqrt(‸):1', '‸:0'],
    ['√‸x:1', '‸x:0'],
    ['sqrt ‸x:1', '‸x:0'],
    ['sqrt(‸x:2', '‸x:0'],
    // A group loses both delimiters, and a function call its name.
    ['(‸x+1):1', '‸x+1:0'],
    ['(‸x+1:1', '‸x+1:0'],
    ['sin(‸x):1', '‸x:0'],
    ['|‸x|:1', '‸x:0'],
    ['y = (‸x):1', 'y = ‸x:0'],
    // Right after a structure, it steps in.
    ['1/2‸:0', '1/2‸:1'],
    ['(x+1)‸:0', '(x+1‸):1'],
    ['x^2‸:0', 'x^2‸:1'],
    ['x^(2y)‸:0', 'x^(2y‸):1'],
    ['sqrt(x)‸:0', 'sqrt(x‸):1'],
    ['a_1‸:0', 'a_1‸:1'],
    // Units.
    ['sin‸', '‸:0'],
    ['xsin‸', 'x‸:0'],
    ['y<=‸', 'y‸:0'],
    ['pi‸', '‸:0'],
    ['x²‸', 'x‸:0'],
    ['x⁻¹‸', 'x‸:0'],
    // Characters.
    ['12‸', '1‸:0'],
    ['1‸2', '‸2:0'],
    ['y = ‸', 'y =‸:0'],
    ['y = x‸', 'y = ‸:0'],
    ['‸', '‸:0'],
    ['‸x', '‸x:0'],
    ['«x+1»', '‸:0'],
    ['y = «1/2»', 'y = ‸:0'],
  ])('%j → %j', (from, expected) => {
    expect(run(from, { type: 'backspace' })).toBe(expected);
  });

  it('empties a row from its end', () => {
    let st = state('y = sqrt(x^2 + 1)/(2|x|) + sin(x)');
    for (let i = 0; i < 100 && st.text !== ''; i++) {
      st = (runCommand(st, { type: 'backspace' }, OPTS) as { state: EditorState }).state;
    }
    expect(st.text).toBe('');
  });
});

describe('Delete', () => {
  it.each([
    ['‸12', '‸2:0'],
    ['‸sin x', '‸ x:0'],
    ['‸1/2:0', '‸1/2:1'],
    ['1‸/2:1', '1‸2:0'],
    ['x^2‸:1', 'x2‸:0'],
    ['x^‸:1', 'x‸:0'],
    ['y‸<= 1', 'y‸ 1:0'],
    ['x‸', 'x‸:0'],
  ])('%j → %j', (from, expected) => {
    expect(run(from, { type: 'delete' })).toBe(expected);
  });
});

describe('moving', () => {
  function walk(from: string, dir: 'left' | 'right'): string[] {
    let st = state(from);
    const out: string[] = [];
    for (let i = 0; i < 20; i++) {
      st = (runCommand(st, { type: dir }, OPTS) as { state: EditorState }).state;
      const s = show(st);
      if (out[out.length - 1] === s) break;
      out.push(s);
    }
    return out;
  }

  it('walks through structures left to right, and back', () => {
    expect(walk('‸1/2+x^2', 'right')).toEqual([
      '‸1/2+x^2:1',
      '1‸/2+x^2:1',
      '1/‸2+x^2:1',
      '1/2‸+x^2:1',
      '1/2‸+x^2:0',
      '1/2+‸x^2:0',
      '1/2+x‸^2:0',
      '1/2+x^‸2:1',
      '1/2+x^2‸:1',
      '1/2+x^2‸:0',
    ]);
    expect(walk('1/2‸:0', 'left')).toEqual(['1/2‸:1', '1/‸2:1', '1‸/2:1', '‸1/2:1', '‸1/2:0']);
    // Typed spaces are places too.
    expect(walk('‸y = x', 'right')).toEqual([
      'y‸ = x:0',
      'y ‸= x:0',
      'y =‸ x:0',
      'y = ‸x:0',
      'y = x‸:0',
    ]);
  });

  it('closes an open group at its end', () => {
    expect(run('(x‸:1', { type: 'right' })).toBe('(x)‸:0');
    expect(run('y = |x‸:1', { type: 'right' })).toBe('y = |x|‸:0');
    expect(run('sqrt(x‸:2', { type: 'right' })).toBe('sqrt(x)‸:0');
    expect(run('((x‸:2', { type: 'right' })).toBe('((x)‸:1');
  });

  it('takes away an empty exponent or subscript it leaves', () => {
    expect(run('x^‸:1', { type: 'left' })).toBe('x‸:0');
    expect(run('x^‸:1', { type: 'right' })).toBe('x‸:0');
    expect(run('x^‸ = 1:1', { type: 'right' })).toBe('x‸ = 1:0');
    expect(run('a_‸:1', { type: 'left' })).toBe('a‸:0');
    expect(run('1/‸:1', { type: 'right' })).toBe('1/‸:0');
  });

  it('collapses a selection to the side it moves to', () => {
    expect(run('y = «x+1»', { type: 'left' })).toBe('y = ‸x+1:0');
    expect(run('y = «x+1»', { type: 'right' })).toBe('y = x+1‸:0');
  });

  it('goes to the start and the end of the row', () => {
    expect(run('1/‸2:1', { type: 'home' })).toBe('‸1/2:0');
    expect(run('1/‸2:1', { type: 'end' })).toBe('1/2‸:0');
    expect(run('y = (x‸+1:1', { type: 'end' })).toBe('y = (x+1‸:1');
    // An empty place at the end is the end.
    expect(run('‸y=1/', { type: 'end' })).toBe('y=1/‸:1');
    expect(run('‸y=x^', { type: 'end' })).toBe('y=x^‸:1');
  });

  it('places the caret, taking away an empty exponent it leaves', () => {
    expect(run('y=x^‸:1', { type: 'place', at: { offset: 0, depth: 0 } })).toBe('‸y=x:0');
    expect(run('y=1/‸2:1', { type: 'place', at: { offset: 1, depth: 0 } })).toBe('y‸=1/2:0');
    expect(run('y=1/2‸:1', { type: 'place', at: { offset: 0, depth: 0 }, extend: true })).toBe(
      '«y=1/2»',
    );
  });

  it.each([
    ['1/‸2:1', 'up', '‸1/2:1'],
    ['1/2‸:1', 'up', '1‸/2:1'],
    ['1‸/2:1', 'down', '1/2‸:1'],
    ['‸1/2:1', 'down', '1/‸2:1'],
    ['‸1/2:0', 'up', '‸1/2:1'],
    ['‸1/2:0', 'down', '1/‸2:1'],
    ['1/2‸:0', 'up', '1‸/2:1'],
    ['1/2‸:0', 'down', '1/2‸:1'],
    ['x^2‸:1', 'down', 'x^2‸:0'],
    ['x‸^2:0', 'up', 'x^‸2:1'],
    ['x^2‸:0', 'up', 'x^2‸:1'],
    ['a_1‸:1', 'up', 'a_1‸:0'],
    ['a_1‸:0', 'down', 'a_1‸:1'],
    ['(1+‸x)/2:2', 'down', '(1+x)/2‸:1'],
    ['x^‸:1', 'down', 'x‸:0'],
    ['y‸ = x', 'up', 'null'],
    ['1/2‸:1', 'down', 'null'],
    ['x^2‸:1', 'up', 'null'],
  ])('%j %s → %j', (from, dir, expected) => {
    expect(run(from, { type: dir as 'up' | 'down' })).toBe(expected);
  });

  it('goes up and down to the nearest place on screen when it knows where places are', () => {
    // Each character 10px wide, the parts centered: "123" over "4", which spans 10 to 20.
    const xOf = (stop: { offset: number; depth: number }) =>
      stop.offset >= 4 ? 10 + (stop.offset - 4) * 10 : stop.offset * 10;
    const up = (from: string) => runCommand(state(from), { type: 'up' }, { ...OPTS, xOf });
    expect(show(up('123/‸4:1')?.state as EditorState)).toBe('1‸23/4:1');
    expect(show(up('123/4‸:1')?.state as EditorState)).toBe('12‸3/4:1');
  });

  it('selects across structures by whole boxes', () => {
    let st = state('‸1/2+x');
    st = (runCommand(st, { type: 'right', extend: true }, OPTS) as { state: EditorState }).state;
    expect(show(st)).toBe('«1/2»+x');
    for (let i = 0; i < 6; i++) {
      st = (runCommand(st, { type: 'right', extend: true }, OPTS) as { state: EditorState }).state;
    }
    expect(show(st)).toBe('«1/2+x»');
    st = (runCommand(st, { type: 'home', extend: true }, OPTS) as { state: EditorState }).state;
    expect(show(st)).toBe('‸1/2+x:0');
    expect(
      show(
        (runCommand(state('x^‸2'), { type: 'selectAll' }, OPTS) as { state: EditorState }).state,
      ),
    ).toBe('«x^2»');
    // From inside an exponent, the selection takes the base with it.
    st = state('y+x^2‸:1');
    st = { ...st, anchor: { offset: 4, depth: 1 } };
    st = (runCommand(st, { type: 'right', extend: true }, OPTS) as { state: EditorState }).state;
    expect(show(st)).toBe('y+«x^2»');
  });
});

describe('keypad', () => {
  it.each([
    ['‸', { type: 'function', name: 'sin' }, 'sin(‸):1'],
    ['‸', { type: 'function', name: 'sqrt' }, 'sqrt(‸):1'],
    ['«x+1»', { type: 'function', name: 'sin' }, 'sin(x+1)‸:0'],
    ['1/2‸:1', { type: 'function', name: 'sin' }, '1/(2sin(‸)):2'],
    ['‸', { type: 'wrap', before: '|', after: '|' }, '|‸|:1'],
    // Kept in the denominator or the exponent the caret is in.
    ['1/2‸:1', { type: 'wrap', before: '|', after: '|' }, '1/(2|‸|):2'],
    ['x^2‸:1', { type: 'wrap', before: '|', after: '|' }, 'x^(2|‸|):2'],
    ['y = «x»', { type: 'wrap', before: '|', after: '|' }, 'y = |x|‸:0'],
    ['x‸', { type: 'power', exponent: '2' }, 'x^2‸:0'],
    ['x‸y', { type: 'power', exponent: '2' }, 'x^(2)‸y:0'],
    ['«x+1»', { type: 'power', exponent: '2' }, '(x+1)^2‸:0'],
    ['y = x‸', { type: 'clear' }, '‸:0'],
  ] as [string, EditorCommand, string][])('%j %j → %j', (from, cmd, expected) => {
    expect(run(from, cmd)).toBe(expected);
  });

  it('types a key with several characters one by one', () => {
    expect(run('x‸', { type: 'type', text: '^2' })).toBe('x^2‸:1');
  });
});

// ---- invariants over generated rows ----

/** Rows the engine accepts, from the shared generator. */
function validRows(seed: number, count: number): string[] {
  const rand = mulberry32(seed);
  const out: string[] = [];
  while (out.length < count) {
    const source = randomSource(rand);
    if (parse(source).ok) out.push(source);
  }
  return out;
}

const COMMANDS: EditorCommand[] = [
  { type: 'type', text: 'x' },
  { type: 'type', text: '2' },
  { type: 'type', text: '/' },
  { type: 'type', text: '^' },
  { type: 'type', text: '_' },
  { type: 'type', text: '(' },
  { type: 'type', text: ')' },
  { type: 'type', text: '|' },
  { type: 'type', text: '+' },
  { type: 'type', text: '-' },
  { type: 'type', text: '=' },
  { type: 'type', text: '<' },
  { type: 'type', text: ',' },
  { type: 'type', text: ' ' },
  { type: 'type', text: '!' },
  { type: 'type', text: '*' },
  { type: 'type', text: '.' },
  { type: 'type', text: 'q' },
  { type: 'insert', text: 'sin(x)/2' },
  { type: 'wrap', before: '|', after: '|' },
  { type: 'function', name: 'sqrt' },
  { type: 'function', name: 'sin' },
  { type: 'power', exponent: '2' },
  { type: 'backspace' },
  { type: 'delete' },
  { type: 'left' },
  { type: 'right' },
  { type: 'left', extend: true },
  { type: 'right', extend: true },
  { type: 'home' },
  { type: 'end', extend: true },
  { type: 'up' },
  { type: 'down' },
  { type: 'selectAll' },
  { type: 'clear' },
];

function isStop(st: EditorState, opts = OPTS): boolean {
  const stops = caretStops(renderPlan(layoutParse(st.text, opts.names)));
  return (
    stops.at(st.focus.offset, st.focus.depth) !== undefined &&
    stops.at(st.anchor.offset, st.anchor.depth) !== undefined
  );
}

/** Names in scope, as a document with sliders a and b and a function f gives them. */
const NAMED: EditorOptions = { names: ctxOf(['a', 'b'], { f: 1 }) };

describe('invariants', () => {
  it.each([
    ['no names', OPTS],
    ['sliders and a function', NAMED],
  ])(
    'every command ends on caret stops of the new text (%s)',
    (_, opts) => {
      const rand = mulberry32(0x5e1ec7);
      const failures: string[] = [];
      for (const text of validRows(0xed17, 1000)) {
        const stops = caretStops(renderPlan(layoutParse(text, opts.names))).list;
        const a = pick(rand, stops);
        const f = rand() < 0.7 ? a : pick(rand, stops);
        const from: EditorState = { text, anchor: a, focus: f };
        for (const cmd of COMMANDS) {
          const r = runCommand(from, cmd, opts);
          if (r && !isStop(r.state, opts)) {
            failures.push(
              `${JSON.stringify(text)} ${show(from)} ${JSON.stringify(cmd)} → ${show(r.state)}`,
            );
          }
        }
      }
      expect(failures.slice(0, 10)).toEqual([]);
    },
    30_000,
  );

  it.each([
    // Common rows, typed key by key as written: the text comes out as typed (so it means what
    // was typed), parentheses and all.
    'y=1/(x+1)^2',
    'y=(x+1)/(x-1)^2',
    'y=(x+1)/(x-1)',
    'y=sqrt(x)+1',
    'y=sqrt(1-x^2)',
    'y=1/sqrt(x)',
    'y=sqrt((x+1)/2)',
    'y=(sqrt(x))^3',
    'y=1/sin(x)',
    'y=sin(x)/x',
    'y=e^(-x)',
    'y=e^(-x^2)',
    'y=e^sin(x)',
    'y=x^sin(x)',
    'y=log(x)/log(2)',
    'y=ln(x)/x',
    'y=1/(1+e^(-x))',
    'y=1/(x(x+1))',
    'y=sin(x)^2',
    'y=sin^2(x)',
    'y=|x-1|+2',
    'y=|sin(x)|',
    'y=x^(1/2)',
    'y=2^-x',
    'y=(x^2)!',
    'y=1/(x+1)!',
    'y=(x-1)(x+2)',
    'x^2+y^2=9',
    'r=1+cos(θ)',
    '(cos(t),sin(t))',
    'f(x)=x^2+1',
  ])('types %j as written', (row) => {
    expect(parse(row).ok).toBe(true);
    let st = state('', NAMED);
    for (const ch of row) {
      st = (runCommand(st, { type: 'type', text: ch }, NAMED) as { state: EditorState }).state;
    }
    expect(st.text).toBe(row);
  });

  it('types text with no structure characters exactly as typed', () => {
    const rand = mulberry32(0x7e47);
    const PIECES = [
      ...'0123456789',
      'x',
      'y',
      'a',
      'b',
      'e',
      't',
      ' ',
      ' ',
      '+',
      '-',
      '*',
      '.',
      '!',
      ',',
      '=',
      '<',
      '>',
      ')',
      'sin',
      'cos ',
      'pi',
      'θ',
      'π',
      '≤',
      '·',
      'x²',
      'ln',
      'max',
    ];
    const failures: string[] = [];
    for (let i = 0; i < 3000; i++) {
      let s = '';
      for (let k = 1 + Math.floor(rand() * 12); k > 0; k--) s += pick(rand, PIECES);
      // Corrections and `**` (an exponent) change what is typed, by design.
      if (/==|=<|=>|\*\*/.test(s)) continue;
      const typed = type('', s);
      if (typed !== `${s}‸:0`) failures.push(`${JSON.stringify(s)} → ${typed}`);
    }
    expect(failures.slice(0, 10)).toEqual([]);
  });

  it('types rows the engine reads, without structure keys, exactly as written', () => {
    // `/ ^ _ **`, a radical's name (it opens its parentheses) and the corrections change what
    // is typed by design; with the rest, any row comes out as typed, so it means what it says.
    const rand = mulberry32(0x1234);
    const failures: string[] = [];
    let rows = 0;
    for (let i = 0; i < 20_000 && rows < 3000; i++) {
      const row = randomSource(rand);
      if (!parse(row).ok || /[/^_*√∛÷]|sqrt|cbrt|==|=<|=>/.test(row)) continue;
      rows++;
      let st = state('');
      for (const ch of row) {
        st = (runCommand(st, { type: 'type', text: ch }, OPTS) as { state: EditorState }).state;
      }
      if (st.text !== row) failures.push(`${JSON.stringify(row)} → ${JSON.stringify(st.text)}`);
    }
    expect(rows).toBe(3000);
    expect(failures.slice(0, 10)).toEqual([]);
  }, 30_000);

  it.each([
    ['no names', OPTS],
    ['sliders and a function', NAMED],
  ])(
    'Backspace from the end empties any row (%s)',
    (_, opts) => {
      const failures: string[] = [];
      const rand = mulberry32(0xbac5);
      for (let i = 0; i < 3000; i++) {
        const text = randomSource(rand);
        let st = state(`${text}‸`, opts);
        let steps = 0;
        const limit = 4 * text.length + 8;
        while (st.text !== '' && steps < limit) {
          st = (runCommand(st, { type: 'backspace' }, opts) as { state: EditorState }).state;
          steps++;
        }
        if (st.text !== '') failures.push(`${JSON.stringify(text)} stuck at ${show(st)}`);
      }
      expect(failures.slice(0, 10)).toEqual([]);
    },
    30_000,
  );

  it('never throws on junk text and carets', () => {
    const rand = mulberry32(0x1a2b);
    const junk = () => {
      const r = rand();
      if (r < 0.1) return Number.NaN;
      if (r < 0.2) return -5;
      if (r < 0.3) return 1e9;
      return Math.floor(rand() * 30);
    };
    for (let i = 0; i < 500; i++) {
      let text = randomSource(rand);
      for (let k = Math.floor(rand() * 3); k > 0; k--) {
        const at = Math.floor(rand() * (text.length + 1));
        text =
          text.slice(0, at) +
          pick(rand, ['(', ')', '|', '_', '{', '}', '^', '/', '😀', '²']) +
          text.slice(at);
      }
      const from: EditorState = {
        text,
        anchor: { offset: junk(), depth: junk() },
        focus: { offset: junk(), depth: junk() },
      };
      for (const cmd of COMMANDS) {
        const r = runCommand(from, cmd, OPTS);
        if (r) expect(isStop(r.state)).toBe(true);
      }
    }
  }, 30_000);

  it('keeps each typed letter and digit in the block the caret was in', () => {
    // Random keystrokes, structure keys included; after each letter or digit the caret must be
    // in the same block as before (by its place in the tree), right after what was typed.
    const rand = mulberry32(0x5c7);
    const KEYS = [...'x2a7', '/', '^', '+', '-', '(', ')', ' ', '|', '_', '.', '!', '=', ','];
    const failures: string[] = [];
    for (let i = 0; i < 2000; i++) {
      let st = state('');
      for (let k = 0; k < 14; k++) {
        const key = pick(rand, KEYS);
        const before = readSelection(st, OPTS);
        const r = runCommand(st, { type: 'type', text: key }, OPTS) as { state: EditorState };
        // Text that isn't math (a `)` that closes nothing) is outside what the rules define.
        let junk = false;
        forEachLeaf(before.doc.plan.root, (leaf) => {
          if (leaf.kind === 'atom' && leaf.role === 'err') junk = true;
        });
        if (/[a-z0-9]/.test(key) && !junk) {
          const after = readSelection(r.state, OPTS);
          // An empty place at the caret's offset takes what is typed there (`1/‸` after the
          // fraction is its denominator).
          const isEmpty = (b: Block) => b.boxes.every((x) => x.kind === 'slot');
          const deeper = before.doc.stops
            .atOffset(before.focus.offset)
            .filter((s) => s.depth > before.focus.depth && isEmpty(s.block));
          const inEmpty =
            isEmpty(before.focus.block) && before.focus.block !== before.doc.plan.root;
          const into = (!inEmpty && deeper[deeper.length - 1]) || before.focus;
          const path = (sel: typeof before, block = sel.focus.block) =>
            sel.doc.info.get(block)?.path;
          if (
            path(after) !== path(before, into.block) ||
            after.doc.text[after.focus.offset - 1] !== key
          ) {
            failures.push(`${show(st)} + ${JSON.stringify(key)} → ${show(r.state)}`);
            break;
          }
        }
        st = r.state;
      }
    }
    expect(failures.slice(0, 10)).toEqual([]);
  }, 30_000);

  it('never puts a structure with an empty part in parentheses', () => {
    // `y=1/` + `2` must not become `y=(1/)2`, whichever stop the caret is at.
    const rand = mulberry32(0xe5c7);
    const KEYS = [...'x2', '/', '^', '_', '+', '(', ')', '!', ' ', '|'];
    const failures: string[] = [];
    for (let i = 0; i < 1500; i++) {
      let st = state('');
      for (let k = 0; k < 10; k++) {
        const stops = caretStops(renderPlan(layoutParse(st.text, EMPTY_CONTEXT))).list;
        const at = pick(rand, stops);
        const from: EditorState = { text: st.text, anchor: at, focus: at };
        const key = pick(rand, KEYS);
        const r = runCommand(from, { type: 'type', text: key }, OPTS) as { state: EditorState };
        // The structure before the caret, wrapped: `(…)` + key.
        const p = at.offset;
        const old = st.text;
        for (let s = 0; s < p; s++) {
          const part = old.slice(s, p);
          const wrapped = `${old.slice(0, s)}(${part})${key}${old.slice(p)}`;
          if (r.state.text === wrapped && /[/÷^]\s*$|[a-z]_\s*$|^\s*[/÷]/.test(part)) {
            failures.push(`${show(from)} + ${JSON.stringify(key)} → ${show(r.state)}`);
          }
        }
        st = r.state;
      }
    }
    expect(failures.slice(0, 10)).toEqual([]);
  }, 30_000);
});
