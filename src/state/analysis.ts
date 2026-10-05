import { createEffect, createMemo, createRoot, untrack } from 'solid-js';
import { DocumentEngine } from '../engine/document';
import type { DocAnalysis } from '../engine/types';
import { type ColorUse, colorChanges } from './colors';
import { assignColor, doc } from './doc';

export const engine = new DocumentEngine();

/**
 * Reactive bridge to the math engine. Re-runs on any source/domain edit; the engine keeps
 * unchanged RowResult objects identical, so per-row memos downstream stay quiet.
 */
export const analysis = createRoot(() =>
  createMemo<DocAnalysis>(() =>
    engine.update(
      doc.rows.map((r) => ({
        id: r.id,
        source: r.source,
        domain: { min: r.domain.min, max: r.domain.max },
      })),
    ),
  ),
);

// A row gets its color when it first plots, and rows that draw nothing hold none (see
// colorChanges). Runs in the same tick as the edit that made the row plot (or stop), so it is
// part of that undo step.
createRoot(() => {
  createEffect(() => {
    const a = analysis();
    untrack(() => {
      const rows = doc.rows.map((row) => {
        const res = a.byId.get(row.id);
        const use: ColorUse =
          !res || res.status === 'error' ? 'broken' : res.plot ? 'plots' : 'none';
        return { id: row.id, colorIndex: row.colorIndex, use };
      });
      for (const [i, color] of colorChanges(rows)) assignColor(rows[i].id, color);
    });
  });
});

/** Evaluate a constant expression (slider bounds, domains); NaN when invalid. */
export function evalNumber(source: string): number {
  // Track analysis so callers re-evaluate when variables change.
  analysis();
  if (source.trim() === '') return Number.NaN;
  const res = engine.evalConstant(source);
  return res.ok ? res.value : Number.NaN;
}
