import { createEffect, createMemo, createRoot, untrack } from 'solid-js';
import { DocumentEngine } from '../engine/document';
import type { DocAnalysis } from '../engine/types';
import { pickColor } from './colors';
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

// A row gets its color when it first plots: the least-used one among the rows holding a color.
// Rows that draw nothing (empty rows, sliders, values) don't take one or count against the
// others, while a curve that is only broken for now (mid-edit) keeps its color reserved. Runs in
// the same tick as the edit that made the row plot, so it is part of that undo step.
createRoot(() => {
  createEffect(() => {
    const a = analysis();
    untrack(() => {
      const used: number[] = [];
      const waiting: string[] = [];
      for (const row of doc.rows) {
        const res = a.byId.get(row.id);
        const plots = res?.status === 'ok' && !!res.plot;
        if (row.colorIndex < 0) {
          if (plots) waiting.push(row.id);
        } else if (plots || res?.status === 'error') {
          used.push(row.colorIndex);
        }
      }
      for (const id of waiting) {
        const color = pickColor(used);
        assignColor(id, color);
        used.push(color);
      }
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
