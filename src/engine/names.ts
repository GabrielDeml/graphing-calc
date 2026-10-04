// Name resolution and identifier splitting. A letter run like "sinx" or "pix" is read as a product
// of known names (sin·x, pi·x), the way people write math by hand.

import {
  BUILTIN_CONSTANTS,
  BUILTIN_FUNCTION_NAMES,
  isBuiltinFunction,
  PLOT_VARIABLES,
} from './builtinNames';
import type { Token } from './tokens';

export type NameKind =
  | 'builtinFn'
  | 'const'
  | 'plotVar'
  | 'userVar'
  | 'userFn'
  | 'param'
  | 'unknown';

/** The user-defined names visible to a row. */
export interface NameContext {
  /** User variable names (sliders and derived variables). */
  vars: ReadonlySet<string>;
  /** User function names mapped to their parameter count. */
  fns: ReadonlyMap<string, number>;
  /** Parameters of the function defined on this row. They shadow user names of the same name. */
  params?: readonly string[];
  /** Variable defined on this row. `a = asin(0.5)` keeps asin whole: a·sin would be a cycle. */
  self?: string;
}

export const EMPTY_CONTEXT: NameContext = {
  vars: new Set<string>(),
  fns: new Map<string, number>(),
};

/** One name read from an identifier token. Spans are offsets into the original source. */
export interface NameUnit {
  name: string;
  kind: NameKind;
  start: number;
  end: number;
}

const PLOT_VARIABLE_SET: ReadonlySet<string> = new Set<string>(PLOT_VARIABLES);

const LONGEST_BUILTIN = Math.max(
  ...BUILTIN_FUNCTION_NAMES.map((n) => n.length),
  ...Object.keys(BUILTIN_CONSTANTS).map((n) => n.length),
);

/** A letter run (Latin or Greek) with an optional `_sub` of ASCII letters and digits. */
const NAME_PATTERN = /^([A-Za-zΑ-Ωα-ω]+)(?:_([A-Za-z0-9]+))?$/;

export function isBuiltinConstant(name: string): boolean {
  return Object.hasOwn(BUILTIN_CONSTANTS, name);
}

export function isPlotVariable(name: string): boolean {
  return PLOT_VARIABLE_SET.has(name);
}

/** Kind priority: param > userFn > userVar > builtinFn > const > plotVar. */
function lookup(name: string, ctx: NameContext): NameKind | null {
  if (ctx.params?.includes(name)) return 'param';
  if (ctx.fns.has(name)) return 'userFn';
  if (ctx.vars.has(name)) return 'userVar';
  if (isBuiltinFunction(name)) return 'builtinFn';
  if (isBuiltinConstant(name)) return 'const';
  if (PLOT_VARIABLE_SET.has(name)) return 'plotVar';
  return null;
}

/** Resolves a whole name (no splitting); 'unknown' when nothing defines it. */
export function resolveName(name: string, ctx: NameContext): NameKind {
  return lookup(name, ctx) ?? 'unknown';
}

/**
 * Whether `name` is an inverse function written `a` + function (`asin`, `atanh`) that should read
 * as a·sin, a·tanh because the user defined `a`: `y = asin(bx) + c` with sliders a, b, c is the
 * textbook sinusoid. The `arc…` spellings always mean the inverse.
 */
function splitsOffA(name: string, ctx: NameContext): boolean {
  if (name.length < 3 || name.charCodeAt(0) !== 97 || !isBuiltinFunction(name.slice(1))) {
    return false;
  }
  if (ctx.self === 'a') return false;
  const a = lookup('a', ctx);
  return a === 'userVar' || a === 'param';
}

/**
 * Whether an inverse function name like `asin` currently reads as a·sin (see splitsOffA). The
 * parser uses it to suggest `arcsin` instead.
 */
export function readsAsProductWithA(name: string, ctx: NameContext): boolean {
  return isBuiltinFunction(name) && splitsOffA(name, ctx);
}

/**
 * Greedy split of a letter run (no subscript) whose letters map one-to-one onto source offsets.
 * At each position it takes the longest known name (builtins, constants, the word 'theta', user
 * names, parameters) or else one letter, and calls `unit(offset, length, name)`.
 */
function splitRun(
  run: string,
  ctx: NameContext,
  unit: (offset: number, length: number, name: string) => void,
): void {
  const maxLen = Math.max(LONGEST_BUILTIN, longestUserName(ctx));
  let i = 0;
  while (i < run.length) {
    let len = 1;
    let name = run[i] ?? '';
    for (let l = Math.min(maxLen, run.length - i); l >= 2; l--) {
      const candidate = run.slice(i, i + l);
      if (candidate === 'theta') {
        len = l;
        name = 'θ';
        break;
      }
      const kind = lookup(candidate, ctx);
      if (kind !== null) {
        // `asin` with a user `a`: take just the 'a' here, and 'sin' on the next step.
        if (kind !== 'builtinFn' || !splitsOffA(candidate, ctx)) {
          len = l;
          name = candidate;
        }
        break;
      }
    }
    unit(i, len, name);
    i += len;
  }
}

/**
 * Whether a user may define `name` as a variable or function. Builtin functions, constants, plot
 * variables (x y t θ r) and 'theta' are reserved. Subscripted names (x_1, v_x, e_1, log_2) are
 * always allowed. Multi-letter names without a subscript may not contain x, y or θ, so `ax = 1`
 * stays the implicit line a·x = 1 while `speed = 3` defines speed. Nor may a builtin function or
 * constant follow other letters: `bcos(x) = 1` is b·cos(x) = 1 and `rcosθ = 1` is r·cos θ = 1,
 * while words that merely start with one (`cost`, `second`) stay definable.
 */
export function isDefinableName(name: string): boolean {
  const m = NAME_PATTERN.exec(name);
  if (m === null) return false;
  const base = m[1] ?? '';
  // π and τ never appear in identifier text (the tokenizer turns them into 'pi' and 'tau').
  if (base.includes('π') || base.includes('τ')) return false;
  if (m[2] !== undefined) return true;
  if (lookup(name, EMPTY_CONTEXT) !== null || name === 'theta') return false;
  if (name.length === 1) return true;
  if (name.includes('x') || name.includes('y') || name.includes('θ')) return false;
  let definable = true;
  splitRun(name, EMPTY_CONTEXT, (offset, length, unit) => {
    if (unit === 'θ' || (offset > 0 && length > 1)) definable = false;
  });
  return definable;
}

function longestUserName(ctx: NameContext): number {
  let longest = 0;
  for (const v of ctx.vars) if (v.length > longest) longest = v.length;
  for (const f of ctx.fns.keys()) if (f.length > longest) longest = f.length;
  if (ctx.params) for (const p of ctx.params) if (p.length > longest) longest = p.length;
  return longest;
}

/**
 * Reads an 'ident' token as one or more names.
 *
 * 1. If the whole token (with its subscript) is a known name, it is one unit, except that
 *    `asin`-style names read as a·sin when the user defined `a` (see splitsOffA).
 * 2. Otherwise the letter run is scanned left to right, taking the longest known multi-letter
 *    name at each position (builtins, constants, 'theta', user names, parameters) or else one
 *    letter: `sinx` → sin, x; `pix` → pi, x; `xy` → x, y; `atheta` → a, θ; `asinx` → asin, x
 *    (a, sin, x once `a` is defined).
 * 3. A subscript attaches to the last unit, which is then resolved as a whole name:
 *    `ka_1` → k, a_1.
 */
export function splitIdentifier(token: Token, ctx: NameContext): NameUnit[] {
  const whole = lookup(token.text, ctx);
  if (whole !== null && !(whole === 'builtinFn' && splitsOffA(token.text, ctx))) {
    return [{ name: token.text, kind: whole, start: token.start, end: token.end }];
  }

  const sub = token.sub;
  const base = sub === undefined ? token.text : token.text.slice(0, -(sub.length + 1));
  const baseEnd = sub === undefined ? token.end : (token.subStart ?? token.start + base.length);
  const units: NameUnit[] = [];

  if (baseEnd - token.start !== base.length) {
    // A normalized alias ('theta' → θ, 'π' → pi): its letters don't map onto source offsets.
    units.push({ name: base, kind: resolveName(base, ctx), start: token.start, end: baseEnd });
  } else {
    splitRun(base, ctx, (offset, length, name) => {
      units.push({
        name,
        kind: resolveName(name, ctx),
        start: token.start + offset,
        end: token.start + offset + length,
      });
    });
  }

  if (sub !== undefined) {
    const last = units[units.length - 1];
    if (last !== undefined) {
      const name = `${last.name}_${sub}`;
      units[units.length - 1] = {
        name,
        kind: resolveName(name, ctx),
        start: last.start,
        end: token.end,
      };
    }
  }
  return units;
}
