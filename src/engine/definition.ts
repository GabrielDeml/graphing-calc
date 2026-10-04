// Recognizes definition rows (`a = 2`, `f(x) = x^2`) from raw tokens, before any parsing. The
// document engine runs this over every row first to learn which names the user defines.

import { isDefinableName, isPlotVariable } from './names';
import { tokenizeLenient } from './tokenizer';
import type { Span } from './types';

export interface DefinitionHead {
  kind: 'var' | 'fn';
  name: string;
  /** Span of the defined name in the source. */
  nameSpan: Span;
  /** Parameter names in order (empty for variables). */
  params: string[];
  paramSpans: Span[];
}

function isParamName(name: string): boolean {
  return isPlotVariable(name) || isDefinableName(name);
}

/**
 * Returns the definition head of `source`, or null when the row is not a definition.
 *
 * - `NAME = …` defines a variable when NAME is definable (`a = 2`, `a_1 = 3`, `speed = 3`; not
 *   `y = 2`, `r = 2`, `ax = 1`, `sin = 2`, `pi = 3`).
 * - `NAME(P1, …, Pk) = …` defines a function when NAME is definable and the parameters are
 *   distinct plot variables or definable names (`f(x) = x^2`, `g(u, v) = u + v`, `a(x) = …`).
 *
 * Only the head is checked: `a = ` and `a = 2$` still define `a` (the parser reports the error
 * in the rest). Never throws.
 */
export function detectDefinition(source: string): DefinitionHead | null {
  const { tokens } = tokenizeLenient(source);
  const head = tokens[0];
  const second = tokens[1];
  if (head?.kind !== 'ident' || second === undefined || !isDefinableName(head.text)) return null;
  const nameSpan = { start: head.start, end: head.end };

  if (second.kind === 'rel' && second.text === '=') {
    return { kind: 'var', name: head.text, nameSpan, params: [], paramSpans: [] };
  }
  if (second.kind !== 'lparen') return null;

  const params: string[] = [];
  const paramSpans: Span[] = [];
  let k = 2;
  for (;;) {
    const param = tokens[k++];
    if (param?.kind !== 'ident' || !isParamName(param.text) || params.includes(param.text)) {
      return null;
    }
    params.push(param.text);
    paramSpans.push({ start: param.start, end: param.end });
    const sep = tokens[k++];
    if (sep?.kind === 'rparen') break;
    if (sep?.kind !== 'comma') return null;
  }
  const eq = tokens[k];
  if (eq?.kind !== 'rel' || eq.text !== '=') return null;
  return { kind: 'fn', name: head.text, nameSpan, params, paramSpans };
}
