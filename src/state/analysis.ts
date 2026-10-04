import { createMemo, createRoot } from 'solid-js';
import { DocumentEngine } from '../engine/document';
import type { DocAnalysis } from '../engine/types';
import { doc } from './doc';

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

/** Evaluate a constant expression (slider bounds, domains); NaN when invalid. */
export function evalNumber(source: string): number {
  // Track analysis so callers re-evaluate when variables change.
  analysis();
  if (source.trim() === '') return Number.NaN;
  const res = engine.evalConstant(source);
  return res.ok ? res.value : Number.NaN;
}
