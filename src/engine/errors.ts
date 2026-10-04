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
  extra?: { hint?: string; quickFix?: QuickFix },
): MathError {
  const error: MathError = { code, message };
  if (span) error.span = { start: span.start, end: span.end };
  if (extra?.hint !== undefined) error.hint = extra.hint;
  if (extra?.quickFix !== undefined) error.quickFix = extra.quickFix;
  return error;
}

/** Throws a MathSyntaxError; used by the tokenizer and parser. */
export function syntaxError(
  code: ParseErrorCode,
  message: string,
  span?: Span,
  hint?: string,
): never {
  throw new MathSyntaxError(
    mathError(code, message, span, hint === undefined ? undefined : { hint }),
  );
}
