import type { RowGeometry, Viewport } from '../plot/types';

export interface DrawRow {
  geometry: RowGeometry;
  color: string;
}

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

export function drawScene(
  ctx: CanvasRenderingContext2D,
  view: Viewport,
  rows: readonly DrawRow[],
  background: string,
): void {
  // Shading first so every curve sits on top of every region. Each row's polygons are filled as
  // one path, so abutting cells blend without seams or double alpha.
  ctx.globalAlpha = 0.25;
  for (const row of rows) {
    if (!row.geometry.fill || row.geometry.fill.length === 0) continue;
    ctx.fillStyle = row.color;
    ctx.beginPath();
    tracePath(ctx, row.geometry.fill, view);
    ctx.fill('nonzero');
  }
  ctx.globalAlpha = 1;

  ctx.lineWidth = 2.5;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  for (const row of rows) {
    const { curves, dashed } = row.geometry;
    if (curves.length === 0) continue;
    ctx.strokeStyle = row.color;
    ctx.setLineDash(dashed ? [8, 6] : []);
    ctx.beginPath();
    for (const curve of curves) tracePath(ctx, curve, view);
    ctx.stroke();
  }
  ctx.setLineDash([]);

  for (const row of rows) {
    const pts = row.geometry.points;
    if (!pts) continue;
    for (let i = 0; i + 1 < pts.length; i += 2) {
      const x = pts[i];
      const y = pts[i + 1];
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      const sx = (x - view.cx) * view.ppuX + view.width / 2;
      const sy = view.height / 2 - (y - view.cy) * view.ppuY;
      if (sx < -10 || sx > view.width + 10 || sy < -10 || sy > view.height + 10) continue;
      ctx.beginPath();
      ctx.arc(sx, sy, 5, 0, Math.PI * 2);
      ctx.fillStyle = row.color;
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = background;
      ctx.stroke();
    }
  }
}
