import type { MathError, QuickFix, Span } from './types';

/** Error codes produced by the tokenizer and parser. Later layers add their own (e.g. 'unknown-name'). */
export type ParseErrorCode =
  | 'unexpected-char'
  | 'bad-number'
  | 'bad-subscript'
  | 'unsupported'
  | 'double-equals'
  | 'bad-relation'
  | 'missing-rparen'
  | 'unexpected-rparen'
  | 'expected-expr'
  | 'unexpected-token'
  | 'missing-operator'
  | 'arity'
  | 'fn-needs-call'
  | 'use-inverse'
  | 'missing-pipe'
  | 'chained-relation'
  | 'list-relation'
  | 'empty-parens'
  | 'too-deep'
  | 'internal';

/**
 * Thrown inside the tokenizer and parser to abort at the first error. `parse()` catches it and
 * returns `{ ok: false, error }`, so callers of `parse()` never see it; `tokenize()` lets it escape.
 */
export class MathSyntaxError extends Error {
  readonly error: MathError;

  constructor(error: MathError) {
    super(error.message);
    this.name = 'MathSyntaxError';
    this.error = error;
  }
}

/** Builds a MathError. The span is copied so errors never alias AST or token spans. */
export function mathError(
  code: string,
  message: string,
  span?: Span,
  extra?: {
    hint?: string;
    quickFix?: QuickFix;
    alternatives?: QuickFix[];
    dependsOn?: string;
  },
): MathError {
  const error: MathError = { code, message };
  if (span) error.span = { start: span.start, end: span.end };
  if (extra?.hint !== undefined) error.hint = extra.hint;
  if (extra?.quickFix !== undefined) error.quickFix = extra.quickFix;
  if (extra?.alternatives !== undefined && extra.alternatives.length > 0) {
    error.alternatives = extra.alternatives;
  }
  if (extra?.dependsOn !== undefined) error.dependsOn = extra.dependsOn;
  return error;
}

/**
 * Throws a MathSyntaxError; used by the tokenizer and parser. `fixes`: the rewrites the hint
 * names, the first offered first.
 */
export function syntaxError(
  code: ParseErrorCode,
  message: string,
  span?: Span,
  hint?: string,
  fixes: readonly QuickFix[] = [],
): never {
  const [quickFix, ...alternatives] = fixes;
  throw new MathSyntaxError(mathError(code, message, span, { hint, quickFix, alternatives }));
}

/** A fix that replaces `span` of the row's text with `text` (shown as `label`). */
export function replaceFix(span: Span, text: string, label = text): QuickFix {
  return { kind: 'replace', span: { start: span.start, end: span.end }, text, label };
}

/** Every fix an error offers, the one to offer first first. */
export function errorFixes(error: MathError | undefined): QuickFix[] {
  if (!error?.quickFix) return [];
  return [error.quickFix, ...(error.alternatives ?? [])];
}

/**
 * What an error's hint says beside the rewrites offered as fixes, which show them: nothing for
 * "Did you mean x^2 or 2x?" or "Write 1*10^-3…", "Logs with a base aren't supported yet" for
 * "…; write log(x)/log(2)", nothing where that part only repeats the message. The whole hint
 * when no rewrite is offered.
 */
export function hintBesideFixes(error: MathError): string | undefined {
  const { hint } = error;
  if (!hint || !errorFixes(error).some((fix) => fix.kind === 'replace')) return hint;
  if (hint.startsWith('Did you mean ') || hint.startsWith('Write ')) return undefined;
  const cut = hint.indexOf('; write ');
  const rest = cut < 0 ? hint : hint.slice(0, cut);
  return rest === error.message ? undefined : rest;
}

/** The unknown names an error offers sliders for (none when it offers none). */
export function sliderFixNames(error: MathError | undefined): readonly string[] {
  for (const fix of errorFixes(error)) if (fix.kind === 'addSliders') return fix.names;
  return [];
}

/** The text with a replace fix applied, and where its new text ends (for the caret). */
export function applyFix(
  source: string,
  fix: Extract<QuickFix, { kind: 'replace' }>,
): { text: string; caret: number } {
  const start = Math.max(0, Math.min(fix.span.start, source.length));
  const end = Math.max(start, Math.min(fix.span.end, source.length));
  return {
    text: source.slice(0, start) + fix.text + source.slice(end),
    caret: start + fix.text.length,
  };
}
