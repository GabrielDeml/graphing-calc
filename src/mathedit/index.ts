// Typeset math for the expression rows: the tolerant layout parse (layout.ts), the render plan
// (plan.ts) and caret stops (caret.ts). Pure TS, like the engine.

import type { NameContext } from '../engine/names';
import { layoutParse } from './layout';
import { flatPlan, type Plan, renderPlan } from './plan';

export { type CaretStop, type CaretStops, caretStops } from './caret';
export { type Layout, layoutParse, printLayout } from './layout';
export * from './plan';

/** The document's names, as DocumentEngine.names() gives them. */
export interface Names {
  ctx: NameContext;
  /** Changes whenever `ctx` does. */
  signature: string;
}

/**
 * Plans rows, remembering the last `limit` (source, names) pairs: rows re-render for reasons
 * other than their text (a playing slider re-renders every frame, its error comes and goes).
 */
export function createTypesetter(limit = 256): (source: string, names: Names) => Plan {
  const cache = new Map<string, Plan>();
  return (source, names) => {
    const key = `${source}\u0000${names.signature}`;
    let plan = cache.get(key);
    if (plan) {
      cache.delete(key);
    } else {
      try {
        plan = renderPlan(layoutParse(source, names.ctx));
      } catch {
        // Not expected (both never throw), but one row's drawing must not take the list down.
        plan = flatPlan(source);
      }
      if (cache.size >= limit) cache.delete(cache.keys().next().value as string);
    }
    cache.set(key, plan);
    return plan;
  };
}
