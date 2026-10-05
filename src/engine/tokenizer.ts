import { MathSyntaxError, syntaxError } from './errors';
import type { Token, TokenKind } from './tokens';
import type { MathError, Span } from './types';

const DIGIT_0 = 48;
const DIGIT_9 = 57;
const DOT = 46;
const UNDERSCORE = 95;
const LBRACE = 123;
const RBRACE = 125;
const EQUALS = 61;
const LESS = 60;
const GREATER = 62;
const STAR = 42;
const PLUS = 43;
const MINUS = 45;
const CARET = 94;
const PI = 0x3c0;
const TAU = 0x3c4;
const SUPERSCRIPT_PLUS = 0x207a;
const SUPERSCRIPT_MINUS = 0x207b;

function isDigit(c: number): boolean {
  return c >= DIGIT_0 && c <= DIGIT_9;
}

function isLatin(c: number): boolean {
  return (c >= 65 && c <= 90) || (c >= 97 && c <= 122);
}

/**
 * Letters that continue an identifier run. π and τ are excluded because they normalize to
 * longer names ('pi', 'tau'); keeping them as their own tokens keeps every run's letters in
 * one-to-one correspondence with source offsets.
 */
function isRunLetter(c: number): boolean {
  if (isLatin(c)) return true;
  return ((c >= 0x391 && c <= 0x3a9) || (c >= 0x3b1 && c <= 0x3c9)) && c !== PI && c !== TAU;
}

function isSubscriptChar(c: number): boolean {
  return isDigit(c) || isLatin(c);
}

/** The digit a superscript character stands for (² → 2), or -1. */
function superscriptDigit(c: number): number {
  if (c === 0xb9) return 1;
  if (c === 0xb2 || c === 0xb3) return c - 0xb0;
  if (c === 0x2070 || (c >= 0x2074 && c <= 0x2079)) return c - 0x2070;
  return -1;
}

function isSpace(c: number): boolean {
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

/**
 * Splits a row's source into tokens, normalizing Unicode aliases. Spans are UTF-16 offsets into
 * the original string. The result always ends with an 'eof' token at `source.length`.
 * Throws MathSyntaxError at the first lexical error.
 */
export function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  scan(source, tokens);
  tokens.push({ kind: 'eof', text: '', start: source.length, end: source.length });
  return tokens;
}

export interface LenientTokens {
  /** Tokens before the first lexical error, followed by an 'eof' token. */
  tokens: Token[];
  /** The first lexical error, or null when the whole source tokenized cleanly. */
  error: MathError | null;
}

/**
 * Like tokenize(), but never throws: it stops at the first lexical error and returns the tokens
 * before it (terminated by 'eof' at the error's start). Lets the definition pre-pass recognize
 * `a = 2$` as a definition of `a` even though the row itself has an error.
 */
export function tokenizeLenient(source: string): LenientTokens {
  const tokens: Token[] = [];
  let error: MathError | null = null;
  try {
    scan(source, tokens);
  } catch (e) {
    if (!(e instanceof MathSyntaxError)) throw e;
    error = e.error;
  }
  const end = error?.span ? error.span.start : source.length;
  tokens.push({ kind: 'eof', text: '', start: end, end });
  return { tokens, error };
}

export interface TolerantTokens {
  /** Every token outside the lexical errors, in order, followed by an 'eof' at source.length. */
  tokens: Token[];
  /** Lexical errors in source order, each with a span that no token overlaps. */
  errors: MathError[];
}

/**
 * Like tokenize(), but reads past lexical errors: each one is reported and skipped, and the scan
 * resumes after it, so `y == 2x` still yields y, 2 and x. The typeset view draws the skipped text
 * as error atoms.
 */
export function tokenizeTolerant(source: string): TolerantTokens {
  const tokens: Token[] = [];
  const errors: MathError[] = [];
  let from = 0;
  for (;;) {
    try {
      scan(source, tokens, from);
      break;
    } catch (e) {
      if (!(e instanceof MathSyntaxError) || e.error.span === undefined) throw e;
      const error = e.error;
      const span = error.span as Span;
      // The lexeme that failed may start before its error (an identifier before a bad
      // subscript, `a_`): its good part becomes tokens, scanned on its own.
      const lexeme = Math.max(from, tokens.at(-1)?.end ?? 0);
      if (span.start > lexeme) {
        const count = tokens.length;
        try {
          scan(source.slice(0, span.start), tokens, lexeme);
        } catch {
          tokens.length = count;
          span.start = lexeme;
        }
      }
      errors.push(error);
      from = Math.max(span.end, span.start + 1);
    }
  }
  tokens.push({ kind: 'eof', text: '', start: source.length, end: source.length });
  return { tokens, errors };
}

function push(tokens: Token[], kind: TokenKind, text: string, start: number, end: number): void {
  tokens.push({ kind, text, start, end });
}

/** Appends the tokens of `source` from offset `from` on; throws at the first lexical error. */
function scan(source: string, tokens: Token[], from = 0): void {
  const n = source.length;
  let i = from;
  while (i < n) {
    const c = source.charCodeAt(i);
    if (isSpace(c)) {
      i++;
      continue;
    }
    const next = i + 1 < n ? source.charCodeAt(i + 1) : -1;
    if (isDigit(c) || (c === DOT && isDigit(next))) {
      i = scanNumber(source, i, tokens);
      continue;
    }
    if (isRunLetter(c) || c === PI || c === TAU) {
      i = scanIdentifier(source, i, tokens);
      continue;
    }
    if (
      superscriptDigit(c) >= 0 ||
      ((c === SUPERSCRIPT_MINUS || c === SUPERSCRIPT_PLUS) && superscriptDigit(next) >= 0)
    ) {
      i = scanSuperscript(source, i, tokens);
      continue;
    }
    switch (c) {
      case PLUS:
        push(tokens, 'op', '+', i, i + 1);
        break;
      case MINUS:
      case 0x2212: // − minus sign
        push(tokens, 'op', '-', i, i + 1);
        break;
      case STAR:
        if (next === STAR) {
          push(tokens, 'op', '^', i, i + 2);
          i++;
        } else {
          push(tokens, 'op', '*', i, i + 1);
        }
        break;
      case 0xb7: // · middle dot
      case 0xd7: // × multiplication sign
      case 0x22c5: // ⋅ dot operator
        push(tokens, 'op', '*', i, i + 1);
        break;
      case 47: // /
      case 0xf7: // ÷
        push(tokens, 'op', '/', i, i + 1);
        break;
      case CARET:
        push(tokens, 'op', '^', i, i + 1);
        break;
      case EQUALS:
        if (next === EQUALS) {
          syntaxError('double-equals', 'Use a single =', { start: i, end: i + 2 });
        }
        if (next === LESS || next === GREATER) {
          const fixed = next === LESS ? '<=' : '>=';
          syntaxError('bad-relation', `Write ${fixed} instead of ${source.slice(i, i + 2)}`, {
            start: i,
            end: i + 2,
          });
        }
        push(tokens, 'rel', '=', i, i + 1);
        break;
      case LESS:
      case GREATER: {
        const op = c === LESS ? '<' : '>';
        if (next === EQUALS) {
          push(tokens, 'rel', `${op}=`, i, i + 2);
          i++;
        } else {
          push(tokens, 'rel', op, i, i + 1);
        }
        break;
      }
      case 0x2264: // ≤
        push(tokens, 'rel', '<=', i, i + 1);
        break;
      case 0x2265: // ≥
        push(tokens, 'rel', '>=', i, i + 1);
        break;
      case 0x2260: // ≠
        syntaxError('unsupported', "≠ isn't supported", { start: i, end: i + 1 });
        break;
      case 33: // !
        if (next === EQUALS) {
          syntaxError(
            'unsupported',
            "≠ isn't supported",
            { start: i, end: i + 2 },
            'For a factorial equation, put a space: x! = 2',
          );
        }
        push(tokens, 'bang', '!', i, i + 1);
        break;
      case 40: // (
        push(tokens, 'lparen', '(', i, i + 1);
        break;
      case 41: // )
        push(tokens, 'rparen', ')', i, i + 1);
        break;
      case 44: // ,
        push(tokens, 'comma', ',', i, i + 1);
        break;
      case 124: // |
        push(tokens, 'pipe', '|', i, i + 1);
        break;
      case 0x221a: // √
        push(tokens, 'ident', 'sqrt', i, i + 1);
        break;
      case 0x221b: // ∛
        push(tokens, 'ident', 'cbrt', i, i + 1);
        break;
      case 91: // [
      case 93: // ]
        syntaxError('unsupported', "Lists aren't supported yet", { start: i, end: i + 1 });
        break;
      case LBRACE:
      case RBRACE:
        // Usually a LaTeX habit: x^{2}, e^{-x^2}.
        syntaxError(
          'unsupported',
          'Use ( ) instead of { }',
          { start: i, end: i + 1 },
          'Braces are only for subscripts, like v_{max}',
        );
        break;
      default: {
        const cp = source.codePointAt(i) ?? c;
        const len = cp > 0xffff ? 2 : 1;
        syntaxError(
          'unexpected-char',
          `Unexpected character '${String.fromCodePoint(cp)}'`,
          { start: i, end: i + len },
          c === UNDERSCORE ? 'Subscripts go right after a name, like a_1' : undefined,
        );
      }
    }
    i++;
  }
}

function scanNumber(source: string, start: number, tokens: Token[]): number {
  const n = source.length;
  let j = start;
  while (j < n && isDigit(source.charCodeAt(j))) j++;
  if (j < n && source.charCodeAt(j) === DOT) {
    j++;
    while (j < n && isDigit(source.charCodeAt(j))) j++;
  }
  if (j < n && source.charCodeAt(j) === DOT) {
    let k = j;
    while (k < n && (isDigit(source.charCodeAt(k)) || source.charCodeAt(k) === DOT)) k++;
    syntaxError(
      'bad-number',
      `'${source.slice(start, k)}' isn't a valid number`,
      { start, end: k },
      'A number can have only one decimal point',
    );
  }
  const text = source.slice(start, j);
  rejectScientific(source, start, j);
  tokens.push({ kind: 'num', text, start, end: j, value: Number(text) });
  return j;
}

/**
 * `1e-3` is valid syntax (1·e − 3) but almost always meant as scientific notation, which would
 * silently plot the wrong thing. Spaces (`1e - 3`) or `*` keep the e − 3 reading. `2e3` is left
 * to the parser, which reports the missing operator with the same advice.
 */
function rejectScientific(source: string, start: number, end: number): void {
  const n = source.length;
  const e = end < n ? source.charCodeAt(end) : -1;
  if (e !== 101 && e !== 69) return; // e E
  const sign = end + 1 < n ? source.charCodeAt(end + 1) : -1;
  if ((sign !== MINUS && sign !== PLUS) || end + 2 >= n || !isDigit(source.charCodeAt(end + 2))) {
    return;
  }
  let k = end + 2;
  while (k < n && isDigit(source.charCodeAt(k))) k++;
  const mantissa = source.slice(start, end);
  const digits = source.slice(end + 2, k);
  const op = sign === MINUS ? '-' : '+';
  const power = `${mantissa}*10^${sign === MINUS ? '-' : ''}${digits}`;
  const letter = source[end];
  const spaced = `${mantissa}${letter} ${op} ${digits}`;
  const hint = `Write ${power}. For ${letter} ${op} ${digits}, put spaces: ${spaced}`;
  syntaxError('bad-number', "Scientific notation isn't supported", { start, end: k }, hint);
}

/**
 * Pasted superscripts: `x²` → x^2, `x⁻¹` → x^-1. The '^' token shares its span with the first
 * superscript character, so every token still points at real source text.
 */
function scanSuperscript(source: string, start: number, tokens: Token[]): number {
  const n = source.length;
  push(tokens, 'op', '^', start, start + 1);
  let j = start;
  const c = source.charCodeAt(j);
  if (c === SUPERSCRIPT_MINUS || c === SUPERSCRIPT_PLUS) {
    push(tokens, 'op', c === SUPERSCRIPT_MINUS ? '-' : '+', j, j + 1);
    j++;
  }
  let digits = '';
  const digitsStart = j;
  while (j < n) {
    const d = superscriptDigit(source.charCodeAt(j));
    if (d < 0) break;
    digits += String.fromCharCode(DIGIT_0 + d);
    j++;
  }
  tokens.push({ kind: 'num', text: digits, start: digitsStart, end: j, value: Number(digits) });
  return j;
}

function scanIdentifier(source: string, start: number, tokens: Token[]): number {
  const n = source.length;
  const c = source.charCodeAt(start);
  let j = start + 1;
  let base: string;
  if (c === PI || c === TAU) {
    base = c === PI ? 'pi' : 'tau';
  } else {
    while (j < n && isRunLetter(source.charCodeAt(j))) j++;
    base = source.slice(start, j);
    if (base === 'theta') base = 'θ';
  }
  if (j >= n || source.charCodeAt(j) !== UNDERSCORE) {
    tokens.push({ kind: 'ident', text: base, start, end: j });
    return j;
  }

  const subStart = j;
  let sub: string;
  let end: number;
  if (j + 1 < n && source.charCodeAt(j + 1) === LBRACE) {
    let k = j + 2;
    while (k < n && isSubscriptChar(source.charCodeAt(k))) k++;
    if (k >= n || source.charCodeAt(k) !== RBRACE) {
      syntaxError('bad-subscript', "Missing '}' after the subscript", { start: subStart, end: k });
    }
    if (k === j + 2) {
      syntaxError('bad-subscript', "Expected a subscript inside '_{}'", {
        start: subStart,
        end: k + 1,
      });
    }
    sub = source.slice(j + 2, k);
    end = k + 1;
  } else {
    // A subscript that starts with a digit is a number, so `a_1x` is a_1·x and `v_0t` is v_0·t;
    // one that starts with a letter takes letters and digits (`v_max`, `v_x2`).
    const isPart = isDigit(j + 1 < n ? source.charCodeAt(j + 1) : -1) ? isDigit : isSubscriptChar;
    let k = j + 1;
    while (k < n && isPart(source.charCodeAt(k))) k++;
    if (k === j + 1) {
      syntaxError(
        'bad-subscript',
        "Expected a subscript after '_'",
        { start: subStart, end: subStart + 1 },
        'Subscripts are letters or digits, like a_1 or v_{max}',
      );
    }
    sub = source.slice(j + 1, k);
    end = k;
  }
  tokens.push({ kind: 'ident', text: `${base}_${sub}`, start, end, sub, subStart });
  return end;
}
