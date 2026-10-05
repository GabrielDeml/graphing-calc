// Ghost completions: the rest of a function's name, offered faintly after the caret while its
// first letters are typed (`si‸` offers `n(`). Tab or → takes it (components/MathField.tsx).

import { BUILTIN_FUNCTION_NAMES } from '../engine/builtinNames';
import { type NameContext, resolveName, splitIdentifier } from '../engine/names';
import type { Caret } from './caret';
import { resolveCaret } from './caret';
import { analyze } from './commands';
import type { Plan } from './plan';

/** Builtins offered first when several fit (the rest follow in the engine's order). */
const PREFERRED = [
  'sin',
  'cos',
  'tan',
  'sqrt',
  'ln',
  'log',
  'exp',
  'abs',
  'sec',
  'csc',
  'cot',
  'asin',
  'acos',
  'atan',
  'sinh',
  'cosh',
  'tanh',
  'cbrt',
  'floor',
  'ceil',
  'round',
  'sign',
  'min',
  'max',
  'mod',
  'gcd',
  'lcm',
] as const;

const BUILTIN_ORDER: readonly string[] = [
  ...PREFERRED,
  ...BUILTIN_FUNCTION_NAMES.filter((n) => !(PREFERRED as readonly string[]).includes(n)),
];

/** The fewest letters typed before a completion is offered: one letter is mostly a variable. */
const MIN_PREFIX = 2;

export interface Completion {
  /** The function name it completes to. */
  name: string;
  /** Where the typed part of the name starts in the text. */
  from: number;
  /** What taking it types after the caret: the rest of the name, and its `(`. */
  text: string;
  /** A builtin (drawn upright) rather than a function the user defined (italic). */
  builtin: boolean;
}

/** Function names that start with `prefix` and are longer, the likeliest first. */
function candidates(prefix: string, ctx: NameContext): { name: string; builtin: boolean }[] {
  const user = [...ctx.fns.keys()]
    .filter((n) => /^[A-Za-z]+$/.test(n) && n.length > prefix.length && n.startsWith(prefix))
    .sort((a, b) => a.length - b.length || (a < b ? -1 : 1))
    .map((name) => ({ name, builtin: false }));
  const builtin = BUILTIN_ORDER.filter(
    (n) => n.length > prefix.length && n.startsWith(prefix) && !ctx.fns.has(n),
  ).map((name) => ({ name, builtin: true }));
  return [...user, ...builtin];
}

/**
 * The completion to offer at a caret, or null. Only at the end of a run of letters that the
 * engine would not read as names it knows (`ex` is e·x, `ab` with sliders a and b is a·b), at
 * least two letters long and not a whole name already (`cos` is not on its way to `cosh`), and
 * only where the caret ends its part of the math with nothing but a closer or a comma after it,
 * so the ghost can sit after the caret without covering anything. Builtin names and the
 * document's own functions (`area(r)` once defined) count; the user's are offered first.
 */
export function completionAt(plan: Plan, caret: Caret, ctx: NameContext): Completion | null {
  const text = plan.source;
  const offset = caret.offset;
  if (offset < MIN_PREFIX || offset > text.length) return null;
  if (!/^\s*(?:$|[),])/.test(text.slice(offset))) return null;
  const before = text.slice(0, offset);
  const run = /[A-Za-z]+$/.exec(before)?.[0] ?? '';
  if (run.length < MIN_PREFIX) return null;
  // A subscript's letters (`a_si`, `v_{ma`) are no name of their own.
  if (/_\{?[A-Za-z0-9]*$/.test(before)) return null;
  const stop = resolveCaret(analyze(plan).stops, offset, caret.depth);
  const last = stop.block.boxes[stop.index - 1];
  if (
    stop.offset !== offset ||
    stop.inside ||
    stop.index !== stop.block.boxes.length ||
    last?.kind !== 'atom' ||
    last.span.end !== offset
  ) {
    return null;
  }
  for (let len = run.length; len >= MIN_PREFIX; len--) {
    const prefix = run.slice(-len);
    // A name already: done typing it.
    if (prefix === 'theta' || resolveName(prefix, ctx) !== 'unknown') return null;
    const units = splitIdentifier(
      { kind: 'ident', text: prefix, start: 0, end: prefix.length },
      ctx,
    );
    if (units.every((u) => u.kind !== 'unknown')) continue;
    const [best] = candidates(prefix, ctx);
    if (best) {
      return {
        name: best.name,
        from: offset - len,
        text: `${best.name.slice(len)}(`,
        builtin: best.builtin,
      };
    }
  }
  return null;
}
