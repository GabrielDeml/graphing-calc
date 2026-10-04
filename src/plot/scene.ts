import type { PlotItem } from '../engine/types';
import { contourImplicit } from './marchingSquares';
import { explicitRegion } from './regions';
import { sampleExplicit } from './sampleExplicit';
import { sampleParametric, samplePolar } from './sampleParametric';
import type { Quality, RowGeometry, Viewport } from './types';
import { viewKey } from './viewport';

/** Turn a compiled plot item into drawable world-space geometry for the given view. */
export function buildRowGeometry(plot: PlotItem, view: Viewport, quality: Quality): RowGeometry {
  switch (plot.kind) {
    case 'explicitY':
    case 'explicitX': {
      const axis = plot.kind === 'explicitY' ? 'x' : 'y';
      const curve = sampleExplicit(plot.f, view, axis, { quality, constant: plot.isConstant });
      return {
        curves: [curve],
        dashed: plot.ineq?.strict ?? false,
        fill: plot.ineq ? explicitRegion(curve, view, axis, plot.ineq.side) : null,
        points: null,
      };
    }
    case 'parametric':
      return curveOnly(
        sampleParametric(plot.fx, plot.fy, plot.tMin(), plot.tMax(), view, { quality }),
      );
    case 'polar':
      return curveOnly(samplePolar(plot.r, plot.thetaMin(), plot.thetaMax(), view, { quality }));
    case 'points': {
      const pts = new Float64Array(plot.points.length * 2);
      plot.points.forEach((p, i) => {
        pts[2 * i] = p.x();
        pts[2 * i + 1] = p.y();
      });
      return { curves: [], dashed: false, fill: null, points: pts };
    }
    case 'implicit': {
      const res = contourImplicit(plot.F, view, {
        quality,
        curve: true,
        region: !!plot.ineq,
        strict: plot.ineq?.strict ?? false,
      });
      return {
        curves: [res.curve],
        dashed: plot.ineq?.strict ?? false,
        fill: res.region,
        points: null,
      };
    }
  }
}

function curveOnly(curve: Float64Array): RowGeometry {
  return { curves: [curve], dashed: false, fill: null, points: null };
}

export interface SceneEntry {
  plot: PlotItem;
  deps: ReadonlySet<string>;
}

/**
 * Per-row geometry cache. Keyed by PlotItem identity (stable across slider moves), the view, the
 * quality level and the current values of the row's dependencies — so moving a slider re-samples
 * only the rows that depend on it, and hovering never re-samples anything.
 */
export class SceneCache {
  private cache = new WeakMap<PlotItem, { key: string; geometry: RowGeometry }>();

  geometry(
    entry: SceneEntry,
    values: ReadonlyMap<string, number>,
    view: Viewport,
    quality: Quality,
  ): RowGeometry {
    let key = `${viewKey(view)}|${quality}`;
    for (const dep of entry.deps) key += `|${values.get(dep)}`;
    const hit = this.cache.get(entry.plot);
    if (hit && hit.key === key) return hit.geometry;
    const geometry = buildRowGeometry(entry.plot, view, quality);
    this.cache.set(entry.plot, { key, geometry });
    return geometry;
  }

  /** Last geometry computed for this plot, regardless of view (for hit-testing). */
  peek(plot: PlotItem): RowGeometry | undefined {
    return this.cache.get(plot)?.geometry;
  }
}
