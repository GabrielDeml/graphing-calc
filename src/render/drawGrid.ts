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

/** Gap kept between neighbouring x labels, in CSS px. */
const LABEL_GAP = 8;

function isOneTwoFive(v: number): boolean {
  const m = v / 10 ** Math.floor(Math.log10(v));
  return [1, 2, 5, 10].some((n) => Math.abs(m - n) < 1e-6);
}

/**
 * Label every k-th major x tick so labels `widthPx` wide don't overprint each other: zoomed in
 * far from the origin they need many digits ("13.5999980") and outgrow the ~100px tick spacing.
 * k keeps labelled values on a coarser 1-2-5 step (2 → every 5th, giving 10, 20, 30, …).
 */
export function labelStride(step: number, spacingPx: number, widthPx: number): number {
  if (!(step > 0) || !(spacingPx > 0) || spacingPx >= widthPx + LABEL_GAP) return 1;
  for (const k of [2, 5, 10, 20, 50, 100, 200, 500, 1000]) {
    if (isOneTwoFive(k * step) && k * spacingPx >= widthPx + LABEL_GAP) return k;
  }
  return Number.POSITIVE_INFINITY;
}

export function drawGrid(
  ctx: CanvasRenderingContext2D,
  view: Viewport,
  theme: Theme,
  /** Device pixels per CSS pixel, per axis. */
  scale: { x: number; y: number },
) {
  const w = view.width;
  const h = view.height;
  ctx.fillStyle = theme.background;
  ctx.fillRect(0, 0, w, h);

  const b = viewBounds(view);
  const tx = computeTicks(b.xmin, b.xmax, view.ppuX);
  const ty = computeTicks(b.ymin, b.ymax, view.ppuY);

  // Vertical lines snap on the x scale, horizontal ones on the y scale (they differ slightly
  // when the graph's CSS size is fractional).
  const thinX = snapper(scale.x, 1);
  const thinY = snapper(scale.y, 1);
  ctx.lineWidth = thinX.width;

  // Minor lines (skipping those under major lines).
  ctx.strokeStyle = theme.gridMinor;
  ctx.beginPath();
  for (const x of tx.minor) {
    if (isMultiple(x, tx.step)) continue;
    const sx = thinX.snap(toScreenX(view, x));
    ctx.moveTo(sx, 0);
    ctx.lineTo(sx, h);
  }
  for (const y of ty.minor) {
    if (isMultiple(y, ty.step)) continue;
    const sy = thinY.snap(toScreenY(view, y));
    ctx.moveTo(0, sy);
    ctx.lineTo(w, sy);
  }
  ctx.stroke();

  ctx.strokeStyle = theme.gridMajor;
  ctx.beginPath();
  for (const x of tx.major) {
    if (x === 0) continue;
    const sx = thinX.snap(toScreenX(view, x));
    ctx.moveTo(sx, 0);
    ctx.lineTo(sx, h);
  }
  for (const y of ty.major) {
    if (y === 0) continue;
    const sy = thinY.snap(toScreenY(view, y));
    ctx.moveTo(0, sy);
    ctx.lineTo(w, sy);
  }
  ctx.stroke();

  // Axes.
  const axisX = snapper(scale.x, 1.5);
  const axisY = snapper(scale.y, 1.5);
  const ox = toScreenX(view, 0);
  const oy = toScreenY(view, 0);
  const yAxisVisible = ox >= 0 && ox <= w;
  const xAxisVisible = oy >= 0 && oy <= h;
  ctx.strokeStyle = theme.axis;
  ctx.lineWidth = axisX.width;
  ctx.beginPath();
  if (yAxisVisible) {
    const sx = axisX.snap(ox);
    ctx.moveTo(sx, 0);
    ctx.lineTo(sx, h);
  }
  if (xAxisVisible) {
    const sy = axisY.snap(oy);
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

  // x labels below the x-axis, thinned out when they are wider than the tick spacing, and
  // skipped when they would be cut off at an edge.
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  const labelY = Math.min(Math.max(oy + 4, 4), h - 18);
  const xLabels: Array<{ i: number; text: string; sx: number; width: number }> = [];
  let widest = 0;
  for (const x of tx.major) {
    if (x === 0) continue;
    const sx = toScreenX(view, x);
    if (sx < 0 || sx > w) continue;
    const text = formatTick(x, tx.step);
    const width = ctx.measureText(text).width;
    widest = Math.max(widest, width);
    xLabels.push({ i: Math.round(x / tx.step), text, sx, width });
  }
  const stride = labelStride(tx.step, tx.step * view.ppuX, widest);
  for (const l of xLabels) {
    if (l.i % stride !== 0) continue;
    if (l.sx - l.width / 2 < 2 || l.sx + l.width / 2 > w - 2) continue;
    label(l.text, l.sx, labelY);
  }

  // y labels left of the y-axis (right of it when they would not fit to its left).
  ctx.textBaseline = 'middle';
  const yLabels: Array<{ text: string; sy: number }> = [];
  let widestY = 0;
  for (const y of ty.major) {
    if (y === 0) continue;
    const sy = toScreenY(view, y);
    if (sy < 8 || sy > h - 8) continue;
    const text = formatTick(y, ty.step);
    widestY = Math.max(widestY, ctx.measureText(text).width);
    yLabels.push({ text, sy });
  }
  let labelX: number;
  if (ox - 6 - Math.max(20, widestY) < 4) {
    ctx.textAlign = 'left';
    labelX = Math.max(ox + 6, 4);
  } else {
    ctx.textAlign = 'right';
    labelX = Math.min(ox - 6, w - 4);
  }
  for (const l of yLabels) label(l.text, labelX, l.sy);

  if (yAxisVisible && xAxisVisible) {
    ctx.textAlign = 'right';
    ctx.textBaseline = 'top';
    label('0', ox - 5, oy + 4);
  }
}
