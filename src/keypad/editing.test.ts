import { describe, expect, it } from 'vitest';
import { parse as parseMath, printStatement } from '../engine';
import { applyEdit, type EditOp, type EditState } from './editing';
import { getPage, PAGE_ORDER } from './layouts';

// Test notation: ‸ marks a collapsed caret, «…» a selection. Neither appears in real input.
function parse(s: string): EditState {
  const caret = s.indexOf('‸');
  if (caret >= 0) return { text: s.replace('‸', ''), selStart: caret, selEnd: caret };
  const start = s.indexOf('«');
  const end = s.indexOf('»') - 1;
  if (start < 0 || end < start) throw new Error(`bad test case: ${s}`);
  return { text: s.replace('«', '').replace('»', ''), selStart: start, selEnd: end };
}

function show({ text, selStart, selEnd }: EditState): string {
  if (selStart === selEnd) return `${text.slice(0, selStart)}‸${text.slice(selStart)}`;
  return `${text.slice(0, selStart)}«${text.slice(selStart, selEnd)}»${text.slice(selEnd)}`;
}

function run(before: string, op: EditOp): string {
  return show(applyEdit(parse(before), op));
}

type Case = [before: string, after: string];

function table(op: EditOp, cases: Case[]) {
  it.each(cases)('%s → %s', (before, after) => {
    expect(run(before, op)).toBe(after);
  });
}

describe('insert', () => {
  describe('plain text', () => {
    table({ type: 'insert', text: 'x' }, [
      ['‸', 'x‸'],
      ['a‸b', 'ax‸b'],
      ['«abc»', 'x‸'],
      ['a«bc»d', 'ax‸d'],
    ]);
  });

  describe('multi-character text', () => {
    table({ type: 'insert', text: '^2' }, [
      ['x‸', 'x^2‸'],
      ['«x»+1', '^2‸+1'],
    ]);
  });

  describe("type-over ')'", () => {
    table({ type: 'insert', text: ')' }, [
      ['sin(x‸)', 'sin(x)‸'],
      ['(‸)', '()‸'],
      ['x‸', 'x)‸'],
      ['‸x)', ')‸x)'],
      ['a«b»)', 'a)‸)'],
      ['((a‸))', '((a)‸)'],
      ['sqrt((x-1)^2+1‸)', 'sqrt((x-1)^2+1)‸'],
      // An unmatched '(' an inserted ')' could close: '(a' after the caret doesn't count.
      ['(a‸) + (b', '(a)‸ + (b'],
      // Already one ')' too many: moving past it adds no second one.
      ['x‸)', 'x)‸'],
    ]);
  });

  describe("')' closes a hand-typed '(' inside a template instead of typing over", () => {
    table({ type: 'insert', text: ')' }, [
      ['sqrt((x-1‸)', 'sqrt((x-1)‸)'],
      ['sin((x+1‸)', 'sin((x+1)‸)'],
      ['exp(-(x-1‸)', 'exp(-(x-1)‸)'],
      ['sin(sin(x‸)', 'sin(sin(x)‸)'],
      ['(((a‸))', '(((a)‸))'],
    ]);
  });

  describe("type-over '|'", () => {
    table({ type: 'insert', text: '|' }, [
      ['|x‸|', '|x|‸'],
      ['|‸|', '||‸'],
      ['x‸', 'x|‸'],
      // A bar that opens an absolute value is not typed over.
      ['‸|x|', '|‸|x|'],
      ['|a|‸|b|', '|a||‸|b|'],
      ['|x-‸|', '|x-|‸|'],
      ['|sin‸|', '|sin|‸|'],
      ['||x|‸|', '||x||‸'],
      ['|(x‸|', '|(x|‸|'],
      ['|(x)‸|', '|(x)|‸'],
    ]);
  });

  it('only types over single-character ) or |', () => {
    expect(run('‸)', { type: 'insert', text: '))' })).toBe('))‸)');
    expect(run('‸(', { type: 'insert', text: '(' })).toBe('(‸(');
    expect(run('‸x', { type: 'insert', text: 'x' })).toBe('x‸x');
  });

  it('with empty text deletes the selection', () => {
    expect(run('a«bc»d', { type: 'insert', text: '' })).toBe('a‸d');
  });
});

describe('wrap', () => {
  describe('|a|', () => {
    table({ type: 'wrap', before: '|', after: '|' }, [
      ['‸', '|‸|'],
      ['2‸x', '2|‸|x'],
      ['x+«1»', 'x+|1|‸'],
      ['«x-1»+2', '|x-1|‸+2'],
    ]);
  });

  describe('parentheses', () => {
    table({ type: 'wrap', before: '(', after: ')' }, [
      ['2‸x', '2(‸)x'],
      ['«a+b»^2', '(a+b)‸^2'],
    ]);
  });
});

describe('function', () => {
  describe('sqrt', () => {
    table({ type: 'function', name: 'sqrt' }, [
      ['‸', 'sqrt(‸)'],
      ['2‸', '2sqrt(‸)'],
      ['«x+1»', 'sqrt(x+1)‸'],
      ['y=«x»^2', 'y=sqrt(x)‸^2'],
    ]);
  });

  describe('min', () => {
    table({ type: 'function', name: 'min' }, [
      ['‸', 'min(‸)'],
      ['«a,b»', 'min(a,b)‸'],
    ]);
  });
});

describe('backspace', () => {
  describe('rule 1: deletes a selection', () => {
    table({ type: 'backspace' }, [
      ['«abc»', '‸'],
      ['a«bc»d', 'a‸d'],
      ['«sin(»x)', '‸x)'],
      ['(«x»)', '(‸)'],
    ]);
  });

  describe('rule 2: deletes a builtin name( as one unit', () => {
    table({ type: 'backspace' }, [
      ['sin(‸)', '‸'],
      ['asin(‸)', '‸'],
      ['2sin(‸)', '2‸'],
      ['arcsinh(‸)', '‸'],
      ['x+sqrt(‸)+1', 'x+‸+1'],
      ['y=min(‸)', 'y=‸'],
      ['πsin(‸)', 'π‸'],
      ['(ln(‸))', '(‸)'],
      // Non-empty parentheses: only the name and '(' go.
      ['sin(‸x)', '‸x)'],
      ['sin(‸', '‸'],
      ['2 cos(‸x', '2 ‸x'],
      ['√(‸)', '‸'],
      ['x+∛(‸)', 'x+‸'],
      ['√(‸x)', '‸x)'],
      ['2√(‸', '2‸'],
    ]);
  });

  describe('rule 2 splits letter runs the way the engine does', () => {
    table({ type: 'backspace' }, [
      // The engine reads these as x·sin(…), b·asin(…) and so on.
      ['xsin(‸)', 'x‸'],
      ['y=xsin(‸)', 'y=x‸'],
      ['basin(‸)', 'b‸'],
      ['θsin(‸)', 'θ‸'],
      ['r=θsin(‸)', 'r=θ‸'],
      ['(tcos(‸),t)', '(t‸,t)'],
      ['pisin(‸)', 'pi‸'],
      ['tausin(‸)', 'tau‸'],
      ['thetasin(‸)', 'theta‸'],
      ['x_{1}sin(‸)', 'x_{1}‸'],
      ['a_1θsin(‸)', 'a_1θ‸'],
      // The last unit is not a builtin, so the empty pair goes instead.
      ['sinx(‸)', 'sinx‸'],
      ['absin(‸)', 'absin‸'],
      ['Sin(‸)', 'Sin‸'],
      ['theta(‸)', 'theta‸'],
      ['f(‸x', 'f‸x'],
      // A subscript runs over ASCII letters and digits, so these are names, then a call.
      ['v_max(‸)', 'v_max‸'],
      ['a_1sin(‸)', 'a_1‸'],
      ['a_b2sin(‸)', 'a_b2sin‸'],
    ]);
  });

  describe("rule 2 keeps a ')' that an outer '(' needs", () => {
    table({ type: 'backspace' }, [
      ['sin(sqrt(‸)', 'sin(‸)'],
      ['sin(sqrt(‸))', 'sin(‸)'],
      ['(sin(‸)', '(‸)'],
    ]);
  });

  describe('rule 3: deletes an empty pair', () => {
    table({ type: 'backspace' }, [
      ['(‸)', '‸'],
      ['2(‸)3', '2‸3'],
      ['f(‸)', 'f‸'],
      ['((‸))', '(‸)'],
      ['|‸|', '‸'],
      ['x+|‸|', 'x+‸'],
      ['2|‸|x', '2‸x'],
    ]);
  });

  describe("rule 3 deletes only a '(' whose ')' an outer '(' needs", () => {
    table({ type: 'backspace' }, [
      ['sin((‸)', 'sin(‸)'],
      ['y=sin((‸)+1', 'y=sin(‸)+1'],
      ['((‸)', '(‸)'],
    ]);
  });

  describe('rule 3 reads nested bars the way the parser does', () => {
    table({ type: 'backspace' }, [
      // A bar after an opening bar opens: ||x|| is abs(abs(x)).
      ['||‸||', '|‸|'],
      ['|x-|‸||', '|x-‸|'],
      ['|(|‸|)|', '|(‸)|'],
    ]);
  });

  describe('rule 3 does not join a closing bar and an opening bar', () => {
    table({ type: 'backspace' }, [
      ['|a|‸|b|', '|a‸|b|'],
      ['||x|‸||', '||x‸||'],
    ]);
  });

  describe('rule 4: deletes one code point', () => {
    table({ type: 'backspace' }, [
      ['ab‸', 'a‸'],
      ['sin(x‸', 'sin(‸'],
      ['sin‸', 'si‸'],
      ['(‸x', '‸x'],
      ['(‸', '‸'],
      ['|‸x|', '‸x|'],
      ['θ‸', '‸'],
      ['2π‸', '2‸'],
      ['x😀‸', 'x‸'],
      ['😀‸y', '‸y'],
      ['x)‸', 'x‸'],
    ]);
  });

  describe('rule 5: caret at 0 is a no-op', () => {
    table({ type: 'backspace' }, [
      ['‸', '‸'],
      ['‸abc', '‸abc'],
      ['‸)', '‸)'],
    ]);
  });
});

describe('deleteForward', () => {
  table({ type: 'deleteForward' }, [
    ['‸ab', '‸b'],
    ['a‸b', 'a‸'],
    ['ab‸', 'ab‸'],
    ['‸', '‸'],
    ['a«bc»d', 'a‸d'],
    ['‸😀x', '‸x'],
    ['‸sin(', '‸in('],
  ]);
});

describe('left', () => {
  describe('moves one code point', () => {
    table({ type: 'left' }, [
      ['ab‸', 'a‸b'],
      ['‸ab', '‸ab'],
      ['‸', '‸'],
      ['x😀‸', 'x‸😀'],
      ['sin(x)‸', 'sin(x‸)'],
      ['sin(x‸)', 'sin(‸x)'],
      ['sinx‸', 'sin‸x'],
    ]);
  });

  describe('collapses a selection to its start', () => {
    table({ type: 'left' }, [
      ['a«bc»d', 'a‸bcd'],
      ['«abc»', '‸abc'],
      ['x+s«in»(', 'x+‸sin('],
    ]);
  });

  describe('jumps over builtin call tokens', () => {
    table({ type: 'left' }, [
      ['sin(‸x)', '‸sin(x)'],
      ['2asin(‸', '2‸asin('],
      ['y=arcsinh(‸)', 'y=‸arcsinh()'],
      ['sin‸(', '‸sin('],
      ['si‸n(x)', '‸sin(x)'],
      ['xsin(‸)', 'x‸sin()'],
      ['basin(‸', 'b‸asin('],
      ['y=xsin(‸x)', 'y=x‸sin(x)'],
      ['√(‸x)', '‸√(x)'],
      ['f(‸x)', 'f‸(x)'],
      ['v_max(‸x)', 'v_max‸(x)'],
      ['a_1sin(‸x)', 'a_1‸sin(x)'],
    ]);
  });
});

describe('right', () => {
  describe('moves one code point', () => {
    table({ type: 'right' }, [
      ['‸ab', 'a‸b'],
      ['ab‸', 'ab‸'],
      ['‸', '‸'],
      ['‸😀x', '😀‸x'],
      ['‸sinx', 's‸inx'],
      ['sin(‸x)', 'sin(x‸)'],
    ]);
  });

  describe('collapses a selection to its end', () => {
    table({ type: 'right' }, [
      ['a«bc»d', 'abc‸d'],
      ['«abc»', 'abc‸'],
      ['«s»in(x)', 'sin(‸x)'],
    ]);
  });

  describe('jumps over builtin call tokens', () => {
    table({ type: 'right' }, [
      ['‸sin(x)', 'sin(‸x)'],
      ['2‸asin(x)', '2asin(‸x)'],
      ['s‸in(', 'sin(‸'],
      ['sin‸(', 'sin(‸'],
      ['‸xsin(', 'x‸sin('],
      ['x‸sin(', 'xsin(‸'],
      ['y=x‸sin(x)', 'y=xsin(‸x)'],
      ['‸basin(', 'b‸asin('],
      ['b‸asin(', 'basin(‸'],
      ['θ‸sin(θ)', 'θsin(‸θ)'],
      ['‸√(x)', '√(‸x)'],
      ['v_‸max(', 'v_m‸ax('],
      ['a_1‸sin(x)', 'a_1sin(‸x)'],
    ]);
  });

  it('never stops inside a builtin name when stepping through text', () => {
    let s = parse('‸2sin(x)+cos(y)');
    const stops: string[] = [];
    while (true) {
      const next = applyEdit(s, { type: 'right' });
      if (next.selStart === s.selStart) break;
      s = next;
      stops.push(show(s));
    }
    expect(stops).toEqual([
      '2‸sin(x)+cos(y)',
      '2sin(‸x)+cos(y)',
      '2sin(x‸)+cos(y)',
      '2sin(x)‸+cos(y)',
      '2sin(x)+‸cos(y)',
      '2sin(x)+cos(‸y)',
      '2sin(x)+cos(y‸)',
      '2sin(x)+cos(y)‸',
    ]);
    const back: string[] = [];
    while (s.selStart > 0) {
      s = applyEdit(s, { type: 'left' });
      back.push(show(s));
    }
    expect(back).toEqual([...stops.slice(0, -1).reverse(), '‸2sin(x)+cos(y)']);
  });
});

describe('home, end and clear', () => {
  it.each<[string, EditOp, string]>([
    ['a‸b', { type: 'home' }, '‸ab'],
    ['a«b»c', { type: 'home' }, '‸abc'],
    ['a‸b', { type: 'end' }, 'ab‸'],
    ['a«b»c', { type: 'end' }, 'abc‸'],
    ['‸', { type: 'end' }, '‸'],
    ['a«b»c', { type: 'clear' }, '‸'],
    ['sin(x)‸', { type: 'clear' }, '‸'],
  ])('%s %o → %s', (before, op, after) => {
    expect(run(before, op)).toBe(after);
  });
});

describe('selection normalization', () => {
  const text = 'abc';
  it.each<[string, number, number, EditOp, EditState]>([
    [
      'past the end',
      10,
      20,
      { type: 'insert', text: 'x' },
      { text: 'abcx', selStart: 4, selEnd: 4 },
    ],
    ['negative', -5, -1, { type: 'insert', text: 'x' }, { text: 'xabc', selStart: 1, selEnd: 1 }],
    ['reversed', 3, 1, { type: 'backspace' }, { text: 'a', selStart: 1, selEnd: 1 }],
    [
      'NaN goes to the end',
      Number.NaN,
      Number.NaN,
      { type: 'left' },
      { text, selStart: 2, selEnd: 2 },
    ],
    [
      'fractional',
      1.7,
      1.2,
      { type: 'insert', text: 'x' },
      { text: 'axbc', selStart: 2, selEnd: 2 },
    ],
    ['infinite', -Infinity, Infinity, { type: 'backspace' }, { text: '', selStart: 0, selEnd: 0 }],
    ['partly out of range', 1, 99, { type: 'right' }, { text, selStart: 3, selEnd: 3 }],
  ])('%s', (_name, selStart, selEnd, op, expected) => {
    expect(applyEdit({ text, selStart, selEnd }, op)).toEqual(expected);
  });

  it('returns a normalized state for an unknown op instead of throwing', () => {
    const bogus = { type: 'teleport' } as unknown as EditOp;
    expect(applyEdit({ text, selStart: 9, selEnd: -1 }, bogus)).toEqual({
      text,
      selStart: 0,
      selEnd: 3,
    });
  });

  it('does not mutate its input', () => {
    const input = { text: 'sin()', selStart: 4, selEnd: 4 };
    applyEdit(input, { type: 'backspace' });
    expect(input).toEqual({ text: 'sin()', selStart: 4, selEnd: 4 });
  });
});

describe('typing on the keypad', () => {
  const KEYS = PAGE_ORDER.flatMap((id) => getPage(id, false).rows.flat());

  function press(ids: string[]): EditState {
    let s: EditState = { text: '', selStart: 0, selEnd: 0 };
    for (const id of ids) {
      const def = KEYS.find((k) => k.id === id);
      if (def?.action.type !== 'edit') throw new Error(`no edit key '${id}'`);
      s = applyEdit(s, def.action.op);
    }
    return s;
  }

  it.each<[keys: string, after: string]>([
    ['sqrt lparen x sub 1 rparen sq add 1', 'sqrt((x-1)^2+1‸)'],
    ['exp sub lparen x sub 1 rparen sq div 2', 'exp(-(x-1)^2/2‸)'],
    ['sin lparen x add 1 rparen div 2', 'sin((x+1)/2‸)'],
    ['sin sin x rparen add 1 rparen', 'sin(sin(x)+1)‸'],
    // A mistyped '(' inside a template backspaces cleanly.
    ['sin lparen backspace x', 'sin(x‸)'],
    ['y eq x sin backspace', 'y=x‸'],
    ['y eq x sin x right', 'y=xsin(x)‸'],
    ['r eq theta sin theta', 'r=θsin(θ‸)'],
    ['lparen t cos t rparen comma t sin t', '(tcos(t),tsin(t‸))'],
  ])('%s → %s', (keys, after) => {
    const s = press(keys.split(' '));
    expect(show(s)).toBe(after);
    const source = /[=,]/.test(s.text) ? s.text : `y=${s.text}`;
    expect(parseMath(source).ok, source).toBe(true);
  });

  it.each<[keys: string, after: string]>([
    ['abs abs backspace', '|‸|'],
    ['abs abs backspace backspace', '‸'],
    ['abs x sub abs y backspace backspace', '|x-‸|'],
  ])('%s → %s', (keys, after) => {
    expect(show(press(keys.split(' ')))).toBe(after);
  });
});

describe('agrees with the engine on which names are builtin calls', () => {
  // Backspace on `y=word(‸)` removes `name()` when the keypad reads the word as ending in a
  // builtin call, and just `()` otherwise; the engine's parse of `y=word(7)` must agree.
  const WORDS = [
    'sin',
    'asinh',
    'arcsinh',
    '2sin',
    'xsin',
    'tcos',
    'rcos',
    'θsin',
    'basin',
    'absin',
    'thetasin',
    'theta',
    'pisin',
    'πsin',
    'tausin',
    'esin',
    'expsin',
    'xln',
    'lnx',
    'sinx',
    'Sin',
    'xsqrt',
    '√',
    'x√',
    '∛',
    'v_max',
    'v_maxθsin',
    'a_1sin',
    'a_1θsin',
    'a_1xθsin',
    'x_{1}sin',
  ];

  it.each(WORDS)('%s(…)', (word) => {
    const parsed = parseMath(`y=${word}(7)`);
    if (!parsed.ok) throw new Error(parsed.error.message);
    const engineCall = /\(([a-z]+) 7\)/.exec(printStatement(parsed.statement))?.[1] ?? null;

    const text = `y=${word}()`;
    const after = applyEdit(
      { text, selStart: text.length - 1, selEnd: text.length - 1 },
      { type: 'backspace' },
    ).text;
    const removed = `y=${word}`.slice(after.length);
    const keypadCall =
      after === `y=${word}` ? null : removed.replace('√', 'sqrt').replace('∛', 'cbrt');
    expect(keypadCall).toBe(engineCall);
  });
});

describe('fuzz', () => {
  // Small deterministic PRNG (mulberry32) so failures reproduce.
  function rng(seed: number): () => number {
    let a = seed;
    return () => {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const OPS: EditOp[] = [
    { type: 'insert', text: 'x' },
    { type: 'insert', text: ')' },
    { type: 'insert', text: '|' },
    { type: 'insert', text: '^2' },
    { type: 'insert', text: '😀' },
    { type: 'insert', text: 'θ' },
    { type: 'wrap', before: '|', after: '|' },
    { type: 'function', name: 'asin' },
    { type: 'function', name: 'sqrt' },
    { type: 'backspace' },
    { type: 'deleteForward' },
    { type: 'left' },
    { type: 'right' },
    { type: 'home' },
    { type: 'end' },
  ];

  const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

  it('keeps the selection in range over random edits and selections', () => {
    const rand = rng(42);
    let s: EditState = { text: '', selStart: 0, selEnd: 0 };
    for (let i = 0; i < 5000; i++) {
      const op = OPS[Math.floor(rand() * OPS.length)];
      if (rand() < 0.1) {
        const a = Math.floor(rand() * (s.text.length + 1));
        const b = Math.floor(rand() * (s.text.length + 1));
        s = { ...s, selStart: a, selEnd: b };
      }
      s = applyEdit(s, op);
      expect(s.selStart).toBeGreaterThanOrEqual(0);
      expect(s.selStart).toBeLessThanOrEqual(s.selEnd);
      expect(s.selEnd).toBeLessThanOrEqual(s.text.length);
      if (s.text.length > 200) s = applyEdit(s, { type: 'clear' });
    }
  });

  it('never splits a surrogate pair when editing from a collapsed caret', () => {
    const rand = rng(7);
    let s: EditState = { text: '', selStart: 0, selEnd: 0 };
    for (let i = 0; i < 5000; i++) {
      s = applyEdit(s, OPS[Math.floor(rand() * OPS.length)]);
      expect(LONE_SURROGATE.test(s.text)).toBe(false);
      if (s.text.length > 200) s = applyEdit(s, { type: 'clear' });
    }
  });
});
