// Public contract of the math engine. The plot layer, scene builder and UI depend only on these
// types (plus DocumentEngine / evalConstant from document.ts), never on parser internals.

/** Half-open UTF-16 offsets into the row's source text (matches input.selectionStart). */
export interface Span {
  start: number;
  end: number;
}

export type QuickFix = { kind: 'addSliders'; names: string[] };

export interface MathError {
  /** Stable machine-readable code, e.g. 'unexpected-char', 'missing-rparen', 'unknown-name'. */
  code: string;
  /** Short human message shown under the row. */
  message: string;
  /** Where to draw the error underline; absent for whole-row errors. */
  span?: Span;
  hint?: string;
  quickFix?: QuickFix;
  /**
   * 'dependency-error' (also inside a 'bad-domain' error): the name whose definition the error
   * comes from, so the UI can tell which row is to blame.
   */
  dependsOn?: string;
}

export type RowKind =
  | 'empty'
  | 'constant' // bare expression with no plot variables: UI shows "= value"
  | 'explicitY' // y = f(x), or bare f(x)
  | 'explicitX' // x = f(y)
  | 'polar' // r = f(θ)
  | 'parametric' // (f(t), g(t))
  | 'point' // (1, 2)
  | 'points' // (1, 2), (3, 4)
  | 'varDef' // a = 2b + 1 (derived variable, shows "= value")
  | 'slider' // a = 2 (numeric literal right-hand side)
  | 'funcDef' // f(x) = x^2
  | 'implicit' // x^2 + y^2 = 1
  | 'ineqY' // y > f(x)
  | 'ineqX' // x <= g(y)
  | 'ineqImplicit'; // x^2 + y^2 < 1

export type Fn0 = () => number;
export type Fn1 = (v: number) => number;
export type Fn2 = (x: number, y: number) => number;

/**
 * Which side of an explicit boundary is shaded. 'greater' means y > f(x) for explicitY and
 * x > g(y) for explicitX; 'less' is the opposite side.
 */
export interface ExplicitInequality {
  side: 'greater' | 'less';
  /** true for < and > (dashed boundary, boundary excluded); false for <= and >=. */
  strict: boolean;
}

/**
 * Compiled, ready-to-sample geometry description of a row. Closures read slider values from the
 * engine's shared globals, so the same PlotItem stays valid (and keeps its identity) while
 * sliders move; only the values returned by the closures change.
 */
export type PlotItem =
  | { kind: 'explicitY'; f: Fn1; isConstant: boolean; ineq?: ExplicitInequality }
  | { kind: 'explicitX'; f: Fn1; isConstant: boolean; ineq?: ExplicitInequality }
  | { kind: 'parametric'; fx: Fn1; fy: Fn1; tMin: Fn0; tMax: Fn0 }
  | { kind: 'polar'; r: Fn1; thetaMin: Fn0; thetaMax: Fn0 }
  | { kind: 'points'; points: ReadonlyArray<{ x: Fn0; y: Fn0 }> }
  /**
   * Implicit curve F(x, y) = 0, or (with ineq) the region where F > 0 (strict) / F >= 0.
   * The engine orients F so that "inside the inequality" is always the positive side.
   */
  | { kind: 'implicit'; F: Fn2; ineq?: { strict: boolean } };

export interface RowInput {
  id: string;
  source: string;
  /** Parameter range for parametric (t) and polar (θ) rows, as expression strings. */
  domain?: { min: string; max: string };
}

export interface RowResult {
  id: string;
  status: 'empty' | 'ok' | 'error';
  kind?: RowKind;
  error?: MathError;
  /** Present for rows that draw something (status 'ok'). */
  plot?: PlotItem;
  /** Current numeric value for 'constant', 'varDef' and 'slider' rows. */
  value?: number;
  /** For 'slider' rows: the literal's location in the source so the UI can rewrite just it. */
  slider?: { name: string; value: number; valueSpan: Span };
  /** Name defined by 'varDef' / 'slider' / 'funcDef' rows. */
  definedName?: string;
  /** For 'funcDef' rows: parameter names, in order. */
  params?: readonly string[];
  /**
   * Transitive set of user *variable* names this row's output depends on (through variables,
   * functions and parameter-domain expressions). Used to re-sample only affected rows when a
   * slider moves.
   */
  deps: ReadonlySet<string>;
}

export interface DocAnalysis {
  /** Bumped whenever anything other than slider/derived values changed. */
  structureVersion: number;
  /** Bumped on every update that changed any variable value (including structure rebuilds). */
  valuesVersion: number;
  /** One result per input row, same order as the input. */
  rows: readonly RowResult[];
  byId: ReadonlyMap<string, RowResult>;
  /** Current value of every successfully defined user variable. */
  values: ReadonlyMap<string, number>;
  /**
   * Variables whose values changed in this update when it took the fast path (only slider
   * literals changed); null when the structure was rebuilt.
   */
  changedGlobals: ReadonlySet<string> | null;
}
