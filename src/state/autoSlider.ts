// Unknown names become sliders by themselves (the UI wiring is in rowActions.ts and
// ExpressionRow): which names, and the range a slider made that way gets once a value is typed
// into it. Plain TS, like history.ts, so it can be unit-tested.

import { BUILTIN_CONSTANTS, BUILTIN_FUNCTION_NAMES } from '../engine/builtinNames';
import { formatPlain } from '../engine/format';
import type { UnknownUse } from '../engine/types';

/**
 * What asks for sliders: the edit ended (Enter, or the row lost focus), or typing paused in it
 * (the caret may be in the middle of a name then).
 */
export type AutoTrigger = 'commit' | 'idle';

/** Every name a builtin could be on the way to (`s`, `sq`, `sqr` for `sqrt`; `p` for `pi`). */
const BUILTIN_PREFIXES: ReadonlySet<string> = (() => {
  const prefixes = new Set<string>();
  for (const name of [...BUILTIN_FUNCTION_NAMES, ...Object.keys(BUILTIN_CONSTANTS), 'theta']) {
    for (let k = 1; k < name.length; k++) prefixes.add(name.slice(0, k));
  }
  return prefixes;
})();

/** Whether `name` is the start of a builtin function or constant name, but not all of it. */
export function isBuiltinPrefix(name: string): boolean {
  return BUILTIN_PREFIXES.has(name);
}

/** Characters a name is made of: letters, a subscript's `_`, braces and digits. */
const NAME_CHAR = /[\p{L}_{}0-9]/u;

/**
 * Whether the caret touches a name: a letter (or a subscript of one) right before it, or a
 * letter right after it. Typing may not be done with that name.
 */
export function caretTouchesName(text: string, caret: number): boolean {
  const after = text[caret] ?? '';
  if (/\p{L}/u.test(after) || after === '_') return true;
  // Back over the name's characters: a digit only counts as part of one in a subscript (`a_1‸`),
  // not in `2‸` or `x^2‸`.
  let k = caret;
  while (k > 0 && NAME_CHAR.test(text[k - 1] ?? '')) k--;
  const run = text.slice(k, caret);
  return /\p{L}/u.test(run) && (/\p{L}$/u.test(run) || /\p{L}_\{?[A-Za-z0-9]*\}?$/u.test(run));
}

/**
 * The name the caret is typing: the run of letters (and a subscript) it touches, as a span of
 * the text; null when it touches none. Digits before the letters (`2co‸`) are not part of it.
 */
export function nameRunAt(text: string, caret: number): { start: number; end: number } | null {
  if (!caretTouchesName(text, caret)) return null;
  let start = caret;
  while (start > 0 && NAME_CHAR.test(text[start - 1] ?? '')) start--;
  while (start < caret && !/\p{L}/u.test(text[start] ?? '')) start++;
  let end = caret;
  while (end < text.length && NAME_CHAR.test(text[end] ?? '')) end++;
  return { start, end };
}

/**
 * The unknown names to offer as sliders while the row is being edited: all but the one the
 * caret is typing (`co‸` may be on its way to `cos`), unless it is used elsewhere too.
 */
export function offeredNames(
  source: string,
  uses: readonly UnknownUse[],
  names: readonly string[],
  caret: number | null,
): string[] {
  const run = caret === null ? null : nameRunAt(source, caret);
  if (!run) return [...names];
  return names.filter((name) =>
    uses.some((u) => u.name === name && (u.span.end <= run.start || u.span.start >= run.end)),
  );
}

/**
 * The unknown names to make sliders of, in order of first use. `uses` is where the row's text
 * uses the names its error offers sliders for (DocumentEngine.unknownUses). Never a name in
 * `skip` (made once already, and undone or deleted since), nor one followed by `(` (`f(x)`: a
 * function still to be defined, more likely). A pause in typing (`idle`, with the selection)
 * makes none while the caret touches a name or text is selected, nor while any of them could be
 * a builtin on its way (`s`, `sq` on the way to `sqrt`): the rest wait for the edit to end, so
 * one row's sliders come as one step.
 */
export function autoSliderNames(
  source: string,
  uses: readonly UnknownUse[],
  trigger: AutoTrigger,
  options: { selection?: { start: number; end: number }; skip?: ReadonlySet<string> } = {},
): string[] {
  const calls = new Set<string>();
  for (const use of uses) {
    if (source.slice(use.span.end).trimStart().startsWith('(')) calls.add(use.name);
  }
  const names = [...new Set(uses.map((u) => u.name))].filter(
    (name) => !calls.has(name) && !options.skip?.has(name),
  );
  if (trigger === 'idle') {
    const sel = options.selection;
    if (!sel || sel.start !== sel.end || caretTouchesName(source, sel.end)) return [];
    if (names.some(isBuiltinPrefix)) return [];
  }
  return names;
}

/** The smallest 1, 2 or 5 times a power of ten that is at least `v` (> 0). */
function niceCeil(v: number): number {
  const p = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 2, 5, 10]) {
    // A little tolerance, so 20 stays 20 rather than turning into 50 by rounding.
    if (m * p >= v * (1 - 1e-9)) return m * p;
  }
  return 10 * p;
}

/**
 * The range for a slider made automatically, once a value outside its range is typed into it:
 * from 0 to a round number on the value's side, about twice its size, so the value sits near the
 * middle (`a = 50` → 0…100, `a = -3` → -10…0). Zero gets the usual -10…10. Bounds are plain
 * decimals (the engine has no exponent form); null when there is no such range.
 */
export function smartRange(value: number): { min: string; max: string } | null {
  if (!Number.isFinite(value)) return null;
  if (value === 0) return { min: '-10', max: '10' };
  const size = niceCeil(2 * Math.abs(value));
  // Beyond what plain decimals in a bound field can say sensibly.
  if (!(size >= 1e-9 && size <= 1e15)) return null;
  const bound = formatPlain(size, 1);
  return value > 0 ? { min: '0', max: bound } : { min: `-${bound}`, max: '0' };
}
