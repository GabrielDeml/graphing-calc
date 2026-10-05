// Short math set in a line of UI text (a fix chip's `x^2`, `log(x)/log(2)`, a slider's name):
// italic letters, upright digits and function names, raised exponents, lowered subscripts, and
// − · ≤ ≥ instead of - * <= >=. No fractions or radicals: it stays one line, as tall as the text
// around it. The whole layout (src/mathedit/plan.ts) is for rows.

import { BUILTIN_FUNCTION_NAMES } from '../engine/builtinNames';

export interface InlinePiece {
  text: string;
  /** Letters (italic), digits, function names, binary operators, relations, a list's commas. */
  role: 'var' | 'num' | 'fn' | 'op' | 'rel' | 'sep' | 'punct';
  /** An exponent's or a subscript's. */
  script?: 'sup' | 'sub';
}

const FUNCTIONS: ReadonlySet<string> = new Set(BUILTIN_FUNCTION_NAMES);
const GREEK: Readonly<Record<string, string>> = { pi: 'π', theta: 'θ' };
const RELATIONS: Readonly<Record<string, string>> = { '<=': '≤', '>=': '≥' };

/** The end of the group opened at `open` (past its `)`), or the text's end when it isn't closed. */
function groupEnd(text: string, open: number): number {
  let depth = 0;
  for (let k = open; k < text.length; k++) {
    if (text[k] === '(') depth++;
    else if (text[k] === ')' && --depth === 0) return k + 1;
  }
  return text.length;
}

/** An exponent's or a subscript's text from `at` (`-3`, `(x+1)` without its parentheses, `ab`). */
function operand(text: string, at: number, sub: boolean): { inner: string; end: number } {
  let k = at;
  while (text[k] === ' ') k++;
  const start = k;
  if (sub && text[k] === '{') {
    const close = text.indexOf('}', k);
    const end = close < 0 ? text.length : close + 1;
    return { inner: text.slice(k + 1, close < 0 ? end : close), end };
  }
  if (!sub) while (text[k] === '-' || text[k] === '+' || text[k] === '−') k++;
  if (!sub && text[k] === '(') {
    const end = groupEnd(text, k);
    const closed = text[end - 1] === ')';
    return { inner: text.slice(start, k) + text.slice(k + 1, closed ? end - 1 : end), end };
  }
  const run = sub ? /^[\p{L}0-9]*/u : /^(?:[0-9.]+|\p{L}+)?/u;
  const match = run.exec(text.slice(k))?.[0] ?? '';
  return { inner: text.slice(start, k + match.length), end: k + match.length };
}

/** `text` as pieces of inline math, all in `script` when it is an exponent's or a subscript's. */
export function inlineMath(text: string, script?: 'sup' | 'sub'): InlinePiece[] {
  const out: InlinePiece[] = [];
  const push = (piece: InlinePiece) => out.push(script ? { ...piece, script } : piece);
  /** The last piece ends an operand, so a sign after it is a binary operator. */
  const afterOperand = () => {
    const last = out.at(-1);
    return (
      !!last && (last.role === 'var' || last.role === 'num' || last.text === ')' || !!last.script)
    );
  };
  let i = 0;
  while (i < text.length) {
    const ch = text[i] as string;
    const rest = text.slice(i);
    if (ch === ' ') {
      i++;
      continue;
    }
    const letters = /^\p{L}+/u.exec(rest)?.[0];
    if (letters) {
      const greek = GREEK[letters];
      // A subscript's letters are part of a name (`v_max`), not a function.
      const fn = script !== 'sub' && FUNCTIONS.has(letters);
      push({ text: greek ?? letters, role: fn ? 'fn' : 'var' });
      i += letters.length;
      if (text[i] === '_') {
        const { inner, end } = operand(text, i + 1, true);
        for (const p of inlineMath(inner, 'sub')) out.push(p);
        i = end;
      }
      continue;
    }
    const digits = /^[0-9.]+/.exec(rest)?.[0];
    if (digits) {
      push({ text: digits, role: 'num' });
      i += digits.length;
      continue;
    }
    if (ch === '^' || rest.startsWith('**')) {
      const { inner, end } = operand(text, i + (ch === '^' ? 1 : 2), false);
      for (const p of inlineMath(inner, 'sup')) out.push(p);
      i = end;
      continue;
    }
    const relation = RELATIONS[rest.slice(0, 2)];
    if (relation || '=<>≤≥'.includes(ch)) {
      push({ text: relation ?? ch, role: 'rel' });
      i += relation ? 2 : 1;
      continue;
    }
    if ('*·×'.includes(ch)) {
      push({ text: ch === '×' ? '×' : '·', role: 'op' });
      i++;
      continue;
    }
    // A sign right after an operand is a binary operator, spaced; else it is the operand's.
    if ('+-−'.includes(ch)) {
      push({ text: ch === '+' ? '+' : '−', role: afterOperand() ? 'op' : 'punct' });
      i++;
      continue;
    }
    push({ text: ch, role: ch === ',' ? 'sep' : 'punct' });
    i++;
  }
  return out;
}
