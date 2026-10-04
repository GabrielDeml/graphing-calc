import { computeTicks, formatTick } from '../plot/ticks';
import type { Viewport } from '../plot/types';
import { toScreenX, toScreenY, viewBounds } from '../plot/viewport';
import type { Theme } from './theme';

const FONT = '12px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

/** Crisp lines: snap to device pixels based on the line's device-pixel width. */
function snapper(dpr: number, lineWidthCss: number) {
  const dev = Math.max(1, Math.round(lineWidthCss * dpr));
  const offset = dev % 2 ? 0.5 : 0;
  return { width: dev / dpr, snap: (p: number) => (Math.round(p * dpr - offset) + offset) / dpr };
}

function isMultiple(v: number, step: number): boolean {
  const q = v / step;
  return Math.abs(q - Math.round(q)) < 1e-6;
}

export function drawGrid(ctx: CanvasRenderingContext2D, view: Viewport, theme: Theme, dpr: number) {
  const w = view.width;
  const h = view.height;
  ctx.fillStyle = theme.background;
  ctx.fillRect(0, 0, w, h);

  const b = viewBounds(view);
  const tx = computeTicks(b.xmin, b.xmax, view.ppuX);
  const ty = computeTicks(b.ymin, b.ymax, view.ppuY);

  const thin = snapper(dpr, 1);
  ctx.lineWidth = thin.width;

  // Minor lines (skipping those under major lines).
  ctx.strokeStyle = theme.gridMinor;
  ctx.beginPath();
  for (const x of tx.minor) {
    if (isMultiple(x, tx.step)) continue;
    const sx = thin.snap(toScreenX(view, x));
    ctx.moveTo(sx, 0);
    ctx.lineTo(sx, h);
  }
  for (const y of ty.minor) {
    if (isMultiple(y, ty.step)) continue;
    const sy = thin.snap(toScreenY(view, y));
    ctx.moveTo(0, sy);
    ctx.lineTo(w, sy);
  }
  ctx.stroke();

  ctx.strokeStyle = theme.gridMajor;
  ctx.beginPath();
  for (const x of tx.major) {
    if (x === 0) continue;
    const sx = thin.snap(toScreenX(view, x));
    ctx.moveTo(sx, 0);
    ctx.lineTo(sx, h);
  }
  for (const y of ty.major) {
    if (y === 0) continue;
    const sy = thin.snap(toScreenY(view, y));
    ctx.moveTo(0, sy);
    ctx.lineTo(w, sy);
  }
  ctx.stroke();

  // Axes.
  const axis = snapper(dpr, 1.5);
  const ox = toScreenX(view, 0);
  const oy = toScreenY(view, 0);
  const yAxisVisible = ox >= 0 && ox <= w;
  const xAxisVisible = oy >= 0 && oy <= h;
  ctx.strokeStyle = theme.axis;
  ctx.lineWidth = axis.width;
  ctx.beginPath();
  if (yAxisVisible) {
    const sx = axis.snap(ox);
    ctx.moveTo(sx, 0);
    ctx.lineTo(sx, h);
  }
  if (xAxisVisible) {
    const sy = axis.snap(oy);
    ctx.moveTo(0, sy);
    ctx.lineTo(w, sy);
  }
  ctx.stroke();

  // Labels, pinned to the edge when their axis is off-screen; drawn with a halo for legibility.
  ctx.font = FONT;
  ctx.lineJoin = 'round';
  ctx.lineWidth = 3;
  ctx.strokeStyle = theme.background;
  ctx.fillStyle = theme.label;

  const label = (text: string, x: number, y: number) => {
    ctx.strokeText(text, x, y);
    ctx.fillText(text, x, y);
  };

  // x labels below the x-axis.
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  const labelY = Math.min(Math.max(oy + 4, 4), h - 18);
  for (const x of tx.major) {
    if (x === 0) continue;
    const sx = toScreenX(view, x);
    if (sx < 8 || sx > w - 8) continue;
    label(formatTick(x, tx.step), sx, labelY);
  }

  // y labels left of the y-axis (right of it when pinned to the left edge).
  ctx.textBaseline = 'middle';
  let labelX: number;
  if (ox - 6 < 24) {
    ctx.textAlign = 'left';
    labelX = Math.max(ox + 6, 4);
  } else {
    ctx.textAlign = 'right';
    labelX = Math.min(ox - 6, w - 4);
  }
  for (const y of ty.major) {
    if (y === 0) continue;
    const sy = toScreenY(view, y);
    if (sy < 8 || sy > h - 8) continue;
    label(formatTick(y, ty.step), labelX, sy);
  }

  if (yAxisVisible && xAxisVisible) {
    ctx.textAlign = 'right';
    ctx.textBaseline = 'top';
    label('0', ox - 5, oy + 4);
  }
}
