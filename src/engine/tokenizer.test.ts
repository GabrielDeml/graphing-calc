import { describe, expect, it } from 'vitest';
import { MathSyntaxError } from './errors';
import { tokenize, tokenizeLenient, tokenizeTolerant } from './tokenizer';
import type { Token } from './tokens';
import type { MathError } from './types';

/** Compact view of tokens (without eof): kind, normalized text and original span. */
function lex(source: string): [string, string, number, number][] {
  return tokenize(source)
    .filter((t) => t.kind !== 'eof')
    .map((t) => [t.kind, t.text, t.start, t.end]);
}

function lexError(source: string): MathError {
  try {
    tokenize(source);
  } catch (e) {
    if (e instanceof MathSyntaxError) return e.error;
    throw e;
  }
  throw new Error(`expected a tokenizer error for ${JSON.stringify(source)}`);
}

function only(source: string): Token {
  const tokens = tokenize(source);
  expect(tokens).toHaveLength(2);
  return tokens[0] as Token;
}

describe('tokenize: basics', () => {
  it('always ends with an eof token at source.length', () => {
    expect(tokenize('')).toEqual([{ kind: 'eof', text: '', start: 0, end: 0 }]);
    expect(tokenize('  x ').at(-1)).toEqual({ kind: 'eof', text: '', start: 4, end: 4 });
  });

  it('skips whitespace, including tabs, newlines and non-breaking spaces', () => {
    expect(lex(' x \t+\n1 ')).toEqual([
      ['ident', 'x', 1, 2],
      ['op', '+', 4, 5],
      ['num', '1', 6, 7],
    ]);
  });

  it('lexes punctuation', () => {
    expect(lex('(a,b)|!')).toEqual([
      ['lparen', '(', 0, 1],
      ['ident', 'a', 1, 2],
      ['comma', ',', 2, 3],
      ['ident', 'b', 3, 4],
      ['rparen', ')', 4, 5],
      ['pipe', '|', 5, 6],
      ['bang', '!', 6, 7],
    ]);
  });

  it('lexes ASCII operators and relations', () => {
    expect(lex('+-*/^')).toEqual([
      ['op', '+', 0, 1],
      ['op', '-', 1, 2],
      ['op', '*', 2, 3],
      ['op', '/', 3, 4],
      ['op', '^', 4, 5],
    ]);
    expect(lex('= < > <= >=')).toEqual([
      ['rel', '=', 0, 1],
      ['rel', '<', 2, 3],
      ['rel', '>', 4, 5],
      ['rel', '<=', 6, 8],
      ['rel', '>=', 9, 11],
    ]);
  });
});

describe('tokenize: numbers', () => {
  it.each([
    ['0', 0],
    ['12', 12],
    ['007', 7],
    ['1.5', 1.5],
    ['.5', 0.5],
    ['1.', 1],
    ['2.71', 2.71],
  ])('%s', (source, value) => {
    const t = only(source);
    expect(t.kind).toBe('num');
    expect(t.text).toBe(source);
    expect(t.value).toBe(value);
    expect([t.start, t.end]).toEqual([0, source.length]);
  });

  it('does not continue numbers into letters (no scientific notation)', () => {
    expect(lex('2e3')).toEqual([
      ['num', '2', 0, 1],
      ['ident', 'e', 1, 2],
      ['num', '3', 2, 3],
    ]);
  });

  it.each([
    ['1.2.3', 0, 5],
    ['1..2', 0, 4],
    ['.5.', 0, 3],
    ['x + 2.3.4', 4, 9],
  ])('rejects %s as bad-number', (source, start, end) => {
    const error = lexError(source);
    expect(error.code).toBe('bad-number');
    expect(error.span).toEqual({ start, end });
  });

  it('treats a lone dot as an unexpected character', () => {
    expect(lexError('x.').code).toBe('unexpected-char');
  });
});

describe('tokenize: scientific notation with a signed exponent', () => {
  it.each([
    ['1e-3', 0, 4, 'Write 1*10^-3. For e - 3, put spaces: 1e - 3'],
    ['y = 2.5e-1x', 4, 10, 'Write 2.5*10^-1. For e - 1, put spaces: 2.5e - 1'],
    ['2e+3', 0, 4, 'Write 2*10^3. For e + 3, put spaces: 2e + 3'],
    ['3E-12', 0, 5, 'Write 3*10^-12. For E - 12, put spaces: 3E - 12'],
  ])('%s → bad-number', (source, start, end, hint) => {
    expect(lexError(source)).toMatchObject({
      code: 'bad-number',
      message: "Scientific notation isn't supported",
      span: { start, end },
      hint,
    });
  });

  it('offers both readings the hint names as fixes', () => {
    const error = lexError('y = 2.5e-1x');
    expect(error.quickFix).toEqual({
      kind: 'replace',
      span: { start: 4, end: 10 },
      text: '2.5*10^-1',
      label: '2.5*10^-1',
    });
    expect(error.alternatives).toEqual([
      { kind: 'replace', span: { start: 4, end: 10 }, text: '2.5e - 1', label: '2.5e - 1' },
    ]);
  });

  it.each(['1e - 3', '1e -3', '1e- 3', '1e-x', '1*e-3', 'e-3', '2e3'])(
    '%s keeps the e reading',
    (source) => {
      expect(() => tokenize(source)).not.toThrow();
    },
  );
});

describe('tokenize: superscripts', () => {
  it('x² reads as x^2, with every token on real source text', () => {
    expect(lex('x²')).toEqual([
      ['ident', 'x', 0, 1],
      ['op', '^', 1, 2],
      ['num', '2', 1, 2],
    ]);
  });

  it('reads runs of superscript digits and a superscript sign', () => {
    expect(lex('x¹⁰')).toEqual([
      ['ident', 'x', 0, 1],
      ['op', '^', 1, 2],
      ['num', '10', 1, 3],
    ]);
    expect(lex('x⁻¹')).toEqual([
      ['ident', 'x', 0, 1],
      ['op', '^', 1, 2],
      ['op', '-', 1, 2],
      ['num', '1', 2, 3],
    ]);
    expect(lex('⁰¹²³⁴⁵⁶⁷⁸⁹').at(-1)).toEqual(['num', '0123456789', 0, 10]);
  });

  it('a lone superscript sign is still an unexpected character', () => {
    expect(lexError('x⁻').code).toBe('unexpected-char');
  });
});

describe('tokenize: identifiers', () => {
  it('reads maximal letter runs; digits end them', () => {
    expect(lex('sinx')).toEqual([['ident', 'sinx', 0, 4]]);
    expect(lex('x2')).toEqual([
      ['ident', 'x', 0, 1],
      ['num', '2', 1, 2],
    ]);
    expect(lex('Ab αβ')).toEqual([
      ['ident', 'Ab', 0, 2],
      ['ident', 'αβ', 3, 5],
    ]);
  });

  it('reads simple subscripts', () => {
    const t = only('a_1');
    expect(t).toMatchObject({ kind: 'ident', text: 'a_1', sub: '1', start: 0, end: 3 });
    expect(t.subStart).toBe(1);
    expect(only('v_max')).toMatchObject({ text: 'v_max', sub: 'max', start: 0, end: 5 });
    expect(only('ka_12')).toMatchObject({ text: 'ka_12', sub: '12', subStart: 2 });
  });

  it('ends a digit subscript at the first non-digit: a_1x is a_1·x', () => {
    expect(lex('a_1x')).toEqual([
      ['ident', 'a_1', 0, 3],
      ['ident', 'x', 3, 4],
    ]);
    expect(lex('m_12x')).toEqual([
      ['ident', 'm_12', 0, 4],
      ['ident', 'x', 4, 5],
    ]);
    expect(lex('v_0t')).toEqual([
      ['ident', 'v_0', 0, 3],
      ['ident', 't', 3, 4],
    ]);
    // A subscript that starts with a letter still takes letters and digits.
    expect(only('v_x2')).toMatchObject({ text: 'v_x2', sub: 'x2' });
    // Braces can still hold a mixed subscript.
    expect(only('a_{1x}')).toMatchObject({ text: 'a_1x', sub: '1x', end: 6 });
  });

  it('reads braced subscripts with original spans', () => {
    const t = only('v_{max}');
    expect(t).toMatchObject({ kind: 'ident', text: 'v_max', sub: 'max', start: 0, end: 7 });
    expect(t.subStart).toBe(1);
    expect(lex('2v_{0}t')).toEqual([
      ['num', '2', 0, 1],
      ['ident', 'v_0', 1, 6],
      ['ident', 't', 6, 7],
    ]);
  });

  it.each([
    ['a_', 1, 2],
    ['a_ 1', 1, 2],
    ['a_{}', 1, 4],
    ['a_{1', 1, 4],
    ['a_{1 }', 1, 4],
  ])('rejects bad subscript %s', (source, start, end) => {
    const error = lexError(source);
    expect(error.code).toBe('bad-subscript');
    expect(error.span).toEqual({ start, end });
  });

  it('rejects a stray underscore with a hint', () => {
    const error = lexError('_1');
    expect(error.code).toBe('unexpected-char');
    expect(error.hint).toMatch(/a_1/);
  });
});

describe('tokenize: normalization keeps original spans', () => {
  it('multiplication signs', () => {
    expect(lex('x·y')).toEqual([
      ['ident', 'x', 0, 1],
      ['op', '*', 1, 2],
      ['ident', 'y', 2, 3],
    ]);
    expect(lex('2×3⋅4')).toEqual([
      ['num', '2', 0, 1],
      ['op', '*', 1, 2],
      ['num', '3', 2, 3],
      ['op', '*', 3, 4],
      ['num', '4', 4, 5],
    ]);
  });

  it('minus sign and division sign', () => {
    expect(lex('a−b÷c')).toEqual([
      ['ident', 'a', 0, 1],
      ['op', '-', 1, 2],
      ['ident', 'b', 2, 3],
      ['op', '/', 3, 4],
      ['ident', 'c', 4, 5],
    ]);
  });

  it('** is power', () => {
    expect(lex('x**2')).toEqual([
      ['ident', 'x', 0, 1],
      ['op', '^', 1, 3],
      ['num', '2', 3, 4],
    ]);
    expect(lex('x* *2').map((t) => t[1])).toEqual(['x', '*', '*', '2']);
  });

  it('≤ and ≥', () => {
    expect(lex('y≤x≥1')).toEqual([
      ['ident', 'y', 0, 1],
      ['rel', '<=', 1, 2],
      ['ident', 'x', 2, 3],
      ['rel', '>=', 3, 4],
      ['num', '1', 4, 5],
    ]);
  });

  it('π and τ become pi and tau, as their own tokens', () => {
    expect(lex('2πr')).toEqual([
      ['num', '2', 0, 1],
      ['ident', 'pi', 1, 2],
      ['ident', 'r', 2, 3],
    ]);
    expect(lex('aτ')).toEqual([
      ['ident', 'a', 0, 1],
      ['ident', 'tau', 1, 2],
    ]);
  });

  it('θ, and theta as a whole run, become θ', () => {
    expect(lex('θ')).toEqual([['ident', 'θ', 0, 1]]);
    expect(lex('sin theta')).toEqual([
      ['ident', 'sin', 0, 3],
      ['ident', 'θ', 4, 9],
    ]);
    expect(lex('rθ')).toEqual([['ident', 'rθ', 0, 2]]);
    expect(lex('thetax')).toEqual([['ident', 'thetax', 0, 6]]);
    expect(only('theta_1')).toMatchObject({ text: 'θ_1', sub: '1', start: 0, end: 7, subStart: 5 });
  });

  it('√ and ∛ become sqrt and cbrt', () => {
    expect(lex('√x')).toEqual([
      ['ident', 'sqrt', 0, 1],
      ['ident', 'x', 1, 2],
    ]);
    expect(lex('2∛(x)')).toEqual([
      ['num', '2', 0, 1],
      ['ident', 'cbrt', 1, 2],
      ['lparen', '(', 2, 3],
      ['ident', 'x', 3, 4],
      ['rparen', ')', 4, 5],
    ]);
  });

  it('spans line up after surrogate pairs elsewhere in the text', () => {
    expect(lexError('x😀').span).toEqual({ start: 1, end: 3 });
  });
});

describe('tokenize: errors', () => {
  it('== → double-equals', () => {
    const error = lexError('y==2');
    expect(error.code).toBe('double-equals');
    expect(error.message).toBe('Use a single =');
    expect(error.span).toEqual({ start: 1, end: 3 });
    expect(error.quickFix).toEqual({
      kind: 'replace',
      span: { start: 1, end: 3 },
      text: '=',
      label: '=',
    });
  });

  it.each([
    ['y=<x', '<='],
    ['y=>x', '>='],
  ])('%s → bad-relation suggesting %s', (source, fixed) => {
    const error = lexError(source);
    expect(error.code).toBe('bad-relation');
    expect(error.message).toContain(fixed);
    expect(error.span).toEqual({ start: 1, end: 3 });
    expect(error.quickFix).toEqual({
      kind: 'replace',
      span: { start: 1, end: 3 },
      text: fixed,
      label: fixed,
    });
    expect(error.alternatives).toBeUndefined();
  });

  it('≠ and != are unsupported', () => {
    expect(lexError('x ≠ 2')).toMatchObject({ code: 'unsupported', span: { start: 2, end: 3 } });
    expect(lexError('x != 2')).toMatchObject({ code: 'unsupported', span: { start: 2, end: 4 } });
  });

  it.each(['[1,2]', 'x]'])('%s → lists unsupported', (source) => {
    const error = lexError(source);
    expect(error.code).toBe('unsupported');
    expect(error.message).toBe("Lists aren't supported yet");
  });

  it.each([
    ['{a}', 0],
    ['y=}', 2],
    ['y = x^{2}', 6],
    ['y = e^{-x^2}', 6],
  ])('%s → braces get their own message, not "lists"', (source, at) => {
    expect(lexError(source)).toEqual({
      code: 'unsupported',
      message: 'Use ( ) instead of { }',
      span: { start: at, end: at + 1 },
      hint: 'Braces are only for subscripts, like v_{max}',
    });
  });

  it('unknown characters', () => {
    expect(lexError('2 $ x')).toEqual({
      code: 'unexpected-char',
      message: "Unexpected character '$'",
      span: { start: 2, end: 3 },
    });
    expect(lexError('é').code).toBe('unexpected-char');
    expect(lexError('😀')).toMatchObject({
      message: "Unexpected character '😀'",
      span: { start: 0, end: 2 },
    });
  });

  it('throws MathSyntaxError instances', () => {
    expect(() => tokenize('#')).toThrow(MathSyntaxError);
  });
});

describe('tokenizeLenient', () => {
  it('returns all tokens and no error for valid input', () => {
    const { tokens, error } = tokenizeLenient('a = 2');
    expect(error).toBeNull();
    expect(tokens.map((t) => t.kind)).toEqual(['ident', 'rel', 'num', 'eof']);
  });

  it('stops at the first error with eof at its start', () => {
    const { tokens, error } = tokenizeLenient('a = 2$ + 1');
    expect(error?.code).toBe('unexpected-char');
    expect(tokens.map((t) => t.text)).toEqual(['a', '=', '2', '']);
    expect(tokens.at(-1)).toMatchObject({ kind: 'eof', start: 5, end: 5 });
  });
});

describe('tokenizeTolerant', () => {
  /** Tokens (without eof) as kind:text, and errors as [code, start, end]. */
  function tolerant(source: string) {
    const { tokens, errors } = tokenizeTolerant(source);
    expect(tokens.at(-1)).toEqual({
      kind: 'eof',
      text: '',
      start: source.length,
      end: source.length,
    });
    return {
      tokens: tokens.slice(0, -1).map((t) => `${t.kind}:${t.text}`),
      errors: errors.map((e) => [e.code, e.span?.start, e.span?.end]),
    };
  }

  it('matches tokenize() on valid input', () => {
    for (const source of ['', 'y = x^2', 'v_{max} ≤ 2πr', 'x² + sin θ', '1.5e - 3']) {
      expect(tokenizeTolerant(source)).toEqual({ tokens: tokenize(source), errors: [] });
    }
  });

  it('skips each lexical error and goes on after it', () => {
    expect(tolerant('y == 2x')).toEqual({
      tokens: ['ident:y', 'num:2', 'ident:x'],
      errors: [['double-equals', 2, 4]],
    });
    expect(tolerant('a $ b # c')).toEqual({
      tokens: ['ident:a', 'ident:b', 'ident:c'],
      errors: [
        ['unexpected-char', 2, 3],
        ['unexpected-char', 6, 7],
      ],
    });
    expect(tolerant('y = 1e-3x').errors).toEqual([['bad-number', 4, 8]]);
    expect(tolerant('y = 1e-3x').tokens).toEqual(['ident:y', 'rel:=', 'ident:x']);
    expect(tolerant('x^{2}')).toEqual({
      tokens: ['ident:x', 'op:^', 'num:2'],
      errors: [
        ['unsupported', 2, 3],
        ['unsupported', 4, 5],
      ],
    });
  });

  it('keeps the good start of a lexeme whose error comes later', () => {
    expect(tolerant('a_ + 1')).toEqual({
      tokens: ['ident:a', 'op:+', 'num:1'],
      errors: [['bad-subscript', 1, 2]],
    });
    expect(tolerant('theta_{ab')).toEqual({
      tokens: ['ident:θ'],
      errors: [['bad-subscript', 5, 9]],
    });
    expect(tolerant('v_{}x').tokens).toEqual(['ident:v', 'ident:x']);
  });

  it('never throws, and tokens and errors never overlap', () => {
    const pieces = ['x', '_', '{', '}', '$', '==', '=<', '!=', '1.2.3', '😀', ' ', '2', 'e-', 'é'];
    let seed = 7;
    for (let k = 0; k < 2000; k++) {
      let source = '';
      for (let j = 0; j < 8; j++) {
        seed = (seed * 1103515245 + 12345) % 2147483648;
        source += pieces[seed % pieces.length];
      }
      const { tokens, errors } = tokenizeTolerant(source);
      const spans = [
        ...tokens.slice(0, -1),
        ...errors.map((e) => e.span as { start: number; end: number }),
      ];
      spans.sort((a, b) => a.start - b.start || a.end - b.end);
      for (let i = 1; i < spans.length; i++) {
        expect(spans[i].start, source).toBeGreaterThanOrEqual(spans[i - 1].end);
      }
    }
  });
});
