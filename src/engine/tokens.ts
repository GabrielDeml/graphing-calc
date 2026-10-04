// Token stream produced by tokenizer.ts and consumed by parser.ts / definition.ts.

export type TokenKind =
  | 'num'
  | 'ident'
  | 'op'
  | 'rel'
  | 'lparen'
  | 'rparen'
  | 'comma'
  | 'pipe'
  | 'bang'
  | 'eof';

export interface Token {
  kind: TokenKind;
  /**
   * Normalized text. 'op': one of + - * / ^ ('·' '×' become '*', '÷' becomes '/', '**' becomes
   * '^', '−' becomes '-'). 'rel': one of = < > <= >= ('≤' becomes '<='). 'ident': the name with
   * its subscript as `base_sub` ('v_{max}' becomes 'v_max'; 'π' becomes 'pi', 'τ' 'tau',
   * the whole run 'theta' 'θ', '√' 'sqrt', '∛' 'cbrt'). 'eof': ''.
   */
  text: string;
  /** Half-open UTF-16 offsets into the ORIGINAL source (they match input.selectionStart). */
  start: number;
  end: number;
  /** Numeric value of a 'num' token. */
  value?: number;
  /** Subscript of an 'ident' token, without '_' or braces ('max' for 'v_{max}'). */
  sub?: string;
  /** For an 'ident' with a subscript: offset of its '_' in the original source. */
  subStart?: number;
}
