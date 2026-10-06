// Keeps the graph and the list steady while a row is being typed, free of Solid and the DOM so it
// can be unit-tested. Half-typed math is broken most of the time (`y = x^` on the way to
// `y = x^2`); rather than make its curve, color mark and slider blink out at every keystroke,
// the row being edited holds on to its last good result, and so do the rows it breaks in passing
// (a slider being retyped breaks every curve that uses it). Their errors stay quiet until the
// edit is done: the edited row's own error still shows after the usual pause.

import { detectDefinition } from '../engine/definition';
import { sliderFixNames } from '../engine/errors';
import type { RowResult } from '../engine/types';

/**
 * Where the engine keeps variable values (DocumentEngine.globalsGeneration and variableSlots):
 * compiled closures read them there.
 */
export interface Globals {
  readonly generation: number;
  readonly slots: ReadonlyMap<string, number>;
}

/** A row's last good result, and where the variables its closures read were kept then. */
interface Good {
  readonly result: RowResult;
  readonly generation: number;
  readonly slots: ReadonlyMap<string, number>;
}

export interface SteadyState {
  /** Each row's last good result. */
  readonly good: ReadonlyMap<string, Good>;
  /** The row being edited, and every name it has defined since it was focused. */
  readonly editing: string | null;
  readonly names: ReadonlySet<string>;
}

export const EMPTY_STEADY: SteadyState = { good: new Map(), editing: null, names: new Set() };

export interface Steady {
  readonly state: SteadyState;
  /**
   * Rows momentarily broken by the edit, with their last good result to show instead: the
   * curve drawn as a faint ghost, the color mark and slider kept in place.
   */
  readonly held: ReadonlyMap<string, RowResult>;
  /** Rows (other than the edited one) whose errors come from the edit, kept quiet meanwhile. */
  readonly quiet: ReadonlySet<string>;
}

const headNames = new Map<string, string | null>();

/** The name a row's text defines (`a = …`, `f(x) = …`), even when the rest is broken. */
function headName(source: string): string | null {
  let name = headNames.get(source);
  if (name === undefined) {
    name = detectDefinition(source)?.name ?? null;
    if (headNames.size > 512) headNames.clear();
    headNames.set(source, name);
  }
  return name;
}

/**
 * The next steady view, from the previous state, the rows (in order), their current results,
 * the row being edited (null when none is) and the engine's current globals. Once nothing is
 * being edited, nothing is held: a broken row shows as broken.
 */
export function steady(
  prev: SteadyState,
  rows: readonly { readonly id: string; readonly source: string }[],
  results: ReadonlyMap<string, RowResult>,
  editing: string | null,
  globals: Globals,
): Steady {
  const editRow = editing === null ? undefined : rows.find((r) => r.id === editing);
  const names = new Set(editRow && editing === prev.editing ? prev.names : []);
  if (editRow) {
    // The name it had when the edit began counts too: renaming `a` to `ab` breaks uses of `a`.
    const before = prev.good.get(editRow.id)?.result.definedName;
    if (before !== undefined) names.add(before);
    const now = results.get(editRow.id)?.definedName ?? headName(editRow.source);
    if (now !== null) names.add(now);
  }

  // Whether a row's error comes from the edit, directly or through broken definitions.
  const blame = new Map<string, boolean>();
  const blamed = (id: string): boolean => {
    if (id === editRow?.id) return true;
    const known = blame.get(id);
    if (known !== undefined) return known;
    blame.set(id, false); // a cycle blames nothing
    const error = results.get(id)?.error;
    let yes = false;
    if (error?.dependsOn !== undefined) {
      const name = error.dependsOn;
      yes =
        names.has(name) ||
        rows.some(
          (r) =>
            (results.get(r.id)?.definedName ?? headName(r.source)) === name &&
            results.get(r.id)?.status === 'error' &&
            blamed(r.id),
        );
    } else if (sliderFixNames(error).length > 0) {
      // Unknown names (in the row, or in its t range): a name the edited row had a moment ago.
      yes = sliderFixNames(error).some((n) => names.has(n));
    } else if (error?.code === 'duplicate') {
      const row = rows.find((r) => r.id === id);
      yes = row !== undefined && names.has(headName(row.source) ?? '');
    }
    blame.set(id, yes);
    return yes;
  };

  // Which variable owns each slot now (made when first needed).
  let owners: Map<number, string> | null = null;
  const ownerOf = (slot: number) => {
    owners ??= new Map([...globals.slots].map(([name, s]) => [s, name]));
    return owners.get(slot);
  };
  /**
   * Whether a kept result's closures still read what they read when it was good: not after a
   * reallocation of the globals (they would read storage that no longer changes), nor once a
   * slot of theirs has gone to another name (they would read its value).
   */
  const intact = (last: Good) =>
    last.generation === globals.generation &&
    [...last.slots].every(([name, slot]) => {
      const owner = ownerOf(slot);
      return owner === undefined || owner === name;
    });

  const good = new Map<string, Good>();
  const held = new Map<string, RowResult>();
  const quiet = new Set<string>();
  for (const row of rows) {
    const result = results.get(row.id);
    if (result?.status === 'ok') {
      const last = prev.good.get(row.id);
      if (last?.result === result && last.generation === globals.generation) {
        good.set(row.id, last);
        continue;
      }
      const slots = new Map<string, number>();
      for (const name of result.deps) {
        const slot = globals.slots.get(name);
        if (slot !== undefined) slots.set(name, slot);
      }
      good.set(row.id, { result, generation: globals.generation, slots });
      continue;
    }
    if (!editRow || result?.status !== 'error' || !blamed(row.id)) continue;
    if (row.id !== editRow.id) quiet.add(row.id);
    const last = prev.good.get(row.id);
    if (last && intact(last)) {
      good.set(row.id, last);
      held.set(row.id, last.result);
    }
  }
  return { state: { good, editing: editRow ? editRow.id : null, names }, held, quiet };
}
