import type { RowGeometry, Viewport } from '../plot/types';
import type { Theme } from './theme';

export interface DrawRow {
  geometry: RowGeometry;
  color: string;
  /** The row being edited is broken for now: its last good plot, drawn faintly underneath. */
  ghost?: boolean;
  /**
   * The selected (or pointed at) row: drawn last, thicker, over a soft halo of its color. As a
   * ghost (the selected row is usually the one being typed in), thick but without the halo.
   */
  emphasis?: boolean;
}

const LINE_PX = 2.5;
const EMPHASIS_LINE_PX = 3.5;
/**
 * The emphasised curve's halo: two faint strokes, a wide one under a narrower one, so it fades
 * out like a glow rather than ending in an edge. Faint enough that none of its pixels comes near
 * a curve color (the e2e tests count those), so it reads as light around the curve rather than
 * as more curve; a little stronger over the dark background, where faint color reads as dull.
 */
const HALO_PX = [12, 7];
const HALO_ALPHA = 0.08;
const HALO_ALPHA_DARK = 0.13;
/** Ghosts are faint; the emphasised one less so, so typing doesn't flicker the selected curve. */
const GHOST_ALPHA = 0.3;
const EMPHASIS_GHOST_ALPHA = 0.5;
const FILL_ALPHA = 0.25;

// Canvas backends misbehave with huge coordinates; clamp far off-screen points.
const LIMIT = 1e4;
const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

/**
 * Trace a NaN-separated world-space polyline (or polygon list) into the current path. Polygons
 * are left open: fill() closes every subpath itself, and an explicit closePath() per polygon
 * makes building a region of thousands of marching-squares cells roughly quadratic in Chromium.
 */
function tracePath(ctx: CanvasRenderingContext2D, data: Float64Array, view: Viewport): void {
  const halfW = view.width / 2;
  const halfH = view.height / 2;
  let penDown = false;
  for (let i = 0; i + 1 < data.length; i += 2) {
    const x = data[i];
    const y = data[i + 1];
    if (Number.isNaN(x) || Number.isNaN(y)) {
      penDown = false;
      continue;
    }
    const sx = clamp((x - view.cx) * view.ppuX + halfW, -LIMIT, view.width + LIMIT);
    const sy = clamp(halfH - (y - view.cy) * view.ppuY, -LIMIT, view.height + LIMIT);
    if (penDown) ctx.lineTo(sx, sy);
    else {
      ctx.moveTo(sx, sy);
      penDown = true;
    }
  }
}

function strokeCurves(
  ctx: CanvasRenderingContext2D,
  view: Viewport,
  row: DrawRow,
  width: number,
  dashed: boolean,
): void {
  ctx.lineWidth = width;
  ctx.strokeStyle = row.color;
  ctx.setLineDash(dashed ? [8, 6] : []);
  ctx.beginPath();
  for (const curve of row.geometry.curves) tracePath(ctx, curve, view);
  ctx.stroke();
}

function drawPoints(
  ctx: CanvasRenderingContext2D,
  view: Viewport,
  row: DrawRow,
  background: string,
  haloAlpha: number,
): void {
  const pts = row.geometry.points;
  if (!pts) return;
  const radius = row.emphasis ? 6 : 5;
  for (let i = 0; i + 1 < pts.length; i += 2) {
    const x = pts[i];
    const y = pts[i + 1];
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    const sx = (x - view.cx) * view.ppuX + view.width / 2;
    const sy = view.height / 2 - (y - view.cy) * view.ppuY;
    if (sx < -10 || sx > view.width + 10 || sy < -10 || sy > view.height + 10) continue;
    if (row.emphasis) {
      ctx.globalAlpha = haloAlpha;
      ctx.fillStyle = row.color;
      for (const px of HALO_PX) {
        ctx.beginPath();
        ctx.arc(sx, sy, radius + px / 2, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
    ctx.beginPath();
    ctx.arc(sx, sy, radius, 0, Math.PI * 2);
    ctx.fillStyle = row.color;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = background;
    ctx.stroke();
  }
}

/**
 * Draw the rows: shading, then ghosts, curves and points, with the emphasised row on top. Other
 * curves are never dimmed: emphasis only adds.
 */
export function drawScene(
  ctx: CanvasRenderingContext2D,
  view: Viewport,
  rows: readonly DrawRow[],
  theme: Pick<Theme, 'background' | 'dark'>,
): void {
  const { background } = theme;
  const haloAlpha = theme.dark ? HALO_ALPHA_DARK : HALO_ALPHA;
  // Shading first so every curve sits on top of every region. Each row's polygons are filled as
  // one path, so abutting cells blend without seams or double alpha.
  for (const row of rows) {
    if (!row.geometry.fill || row.geometry.fill.length === 0) continue;
    ctx.globalAlpha = row.ghost ? FILL_ALPHA * GHOST_ALPHA : FILL_ALPHA;
    ctx.fillStyle = row.color;
    ctx.beginPath();
    tracePath(ctx, row.geometry.fill, view);
    ctx.fill('nonzero');
  }

  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  for (const row of rows) {
    if (!row.ghost) continue;
    ctx.globalAlpha = row.emphasis ? EMPHASIS_GHOST_ALPHA : GHOST_ALPHA;
    const width = row.emphasis ? EMPHASIS_LINE_PX : LINE_PX;
    strokeCurves(ctx, view, row, width, row.geometry.dashed);
  }
  ctx.globalAlpha = 1;
  for (const row of rows) {
    if (!row.ghost && !row.emphasis) strokeCurves(ctx, view, row, LINE_PX, row.geometry.dashed);
  }
  for (const row of rows) {
    if (row.ghost || !row.emphasis) continue;
    ctx.globalAlpha = haloAlpha;
    for (const px of HALO_PX) strokeCurves(ctx, view, row, px, false);
    ctx.globalAlpha = 1;
    strokeCurves(ctx, view, row, EMPHASIS_LINE_PX, row.geometry.dashed);
  }
  ctx.setLineDash([]);

  for (const row of rows) {
    if (row.emphasis && !row.ghost) continue;
    ctx.globalAlpha = row.ghost ? (row.emphasis ? EMPHASIS_GHOST_ALPHA : GHOST_ALPHA) : 1;
    drawPoints(ctx, view, { ...row, emphasis: false }, background, haloAlpha);
  }
  ctx.globalAlpha = 1;
  for (const row of rows) {
    if (row.emphasis && !row.ghost) drawPoints(ctx, view, row, background, haloAlpha);
  }
}
