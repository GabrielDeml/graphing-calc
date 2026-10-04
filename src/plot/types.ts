// Public contract of the plot layer (pure geometry, no DOM).

/**
 * The visible window. Sizes are CSS pixels; ppuX/ppuY are CSS pixels per world unit
 * (kept equal in v1, separate so axis stretching can be added later).
 *   screenX = (x - cx) * ppuX + width / 2
 *   screenY = height / 2 - (y - cy) * ppuY
 */
export interface Viewport {
  cx: number;
  cy: number;
  ppuX: number;
  ppuY: number;
  width: number;
  height: number;
}

export interface Bounds {
  xmin: number;
  xmax: number;
  ymin: number;
  ymax: number;
}

/** 'interactive' while the user is panning/zooming (coarser, cheaper), then 'final'. */
export type Quality = 'interactive' | 'final';

/**
 * World-space polyline(s) as interleaved x,y pairs. A pair of NaNs separates disconnected
 * pieces (pen up). Consumers must tolerate leading/trailing/consecutive NaN pairs.
 */
export type Polyline = Float64Array;

/**
 * World-space filled polygons as interleaved x,y pairs, one polygon after another separated by
 * a NaN pair. Each polygon is implicitly closed. Polygons never overlap, so the whole set can be
 * filled as a single path (nonzero) without seams.
 */
export type Polygons = Float64Array;

/** Everything needed to draw one row. */
export interface RowGeometry {
  /** Stroked curves (graph or inequality boundary). */
  curves: Polyline[];
  /** Strict inequality boundaries are dashed. */
  dashed: boolean;
  /** Shaded inequality region, if any. */
  fill: Polygons | null;
  /** Point markers as interleaved x,y pairs (non-finite pairs are skipped). */
  points: Float64Array | null;
}
