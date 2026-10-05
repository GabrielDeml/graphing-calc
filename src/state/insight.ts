import { createMemo, createRoot, createSignal, untrack } from 'solid-js';
import type { PlotItem } from '../engine/types';
import type { InViewFacts } from '../plot/insights';
import { analysis, engine } from './analysis';

/** What the graph counted in view for a row (its points of interest), and on which of its plots. */
export interface RowCensus {
  plot: PlotItem;
  facts: InViewFacts;
}

/**
 * What the insight line under a row reads besides the row itself (src/plot/insights.ts): which
 * rows use each name, and what the graph last counted in view for each row it searched. Both
 * change rarely (an edit, a search at final quality), never per frame.
 */
export const insightSources = createRoot(() => {
  const [censuses, setCensuses] = createSignal<ReadonlyMap<string, RowCensus>>(new Map());
  /** Bumped by the engine whenever anything but values changed. */
  const structure = createMemo(() => analysis().structureVersion);
  /** The rows that use each name directly, in list order. */
  const users = createMemo(() => {
    structure();
    return untrack(() => {
      const map = new Map<string, string[]>();
      for (const row of analysis().rows) {
        for (const name of new Set(engine.refsOf(row.id))) {
          const list = map.get(name);
          if (list) list.push(row.id);
          else map.set(name, [row.id]);
        }
      }
      return map;
    });
  });
  return {
    /** The rows that use `name` (a slider, a variable, a function), other than `self`. */
    usersOf(name: string, self: string): readonly string[] {
      return (users().get(name) ?? []).filter((id) => id !== self);
    },
    /** What the graph last counted in view for a row (a row searched again replaces it). */
    census(rowId: string): RowCensus | undefined {
      return censuses().get(rowId);
    },
    setCensus(rowId: string, census: RowCensus): void {
      setCensuses((m) => {
        const next = new Map(m);
        // Only the rows still there.
        const rows = untrack(analysis).byId;
        for (const id of next.keys()) if (!rows.has(id)) next.delete(id);
        next.set(rowId, census);
        return next;
      });
    },
  };
});
