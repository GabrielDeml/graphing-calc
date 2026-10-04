import { formatSliderValue } from '../engine/format';
import { analysis, evalNumber } from './analysis';
import { addRowAfter, type ChangeOrigin, doc, getRow, removeRow, updateSource } from './doc';
import { focusRow } from './focus';

function position(id: string): number {
  return doc.rows.findIndex((r) => r.id === id);
}

/**
 * Enter: move to the next row if it is empty, otherwise insert a new row below. An empty row
 * never adds another one: it moves on to the next row, and the empty row at the end (already the
 * place for a new expression) stays put. Returns whether focus moved.
 */
export function enterFrom(id: string): boolean {
  const i = position(id);
  if (i < 0) return false;
  const empty = doc.rows[i].source.trim() === '';
  const next = doc.rows[i + 1];
  if (next && (empty || next.source.trim() === '')) {
    focusRow(next.id, 'end');
    return true;
  }
  if (empty) return false;
  focusRow(addRowAfter(id), 'end');
  return true;
}

/** Backspace in an empty row deletes it and focuses the end of the previous row. */
export function deleteEmptyBackward(id: string): boolean {
  const i = position(id);
  if (i < 0 || doc.rows.length <= 1) return false;
  const target = doc.rows[i - 1] ?? doc.rows[i + 1];
  removeRow(id);
  if (target) focusRow(target.id, 'end');
  return true;
}

/** Delete in an empty row deletes it and focuses the start of the next row. */
export function deleteEmptyForward(id: string): boolean {
  const i = position(id);
  if (i < 0 || doc.rows.length <= 1 || i === doc.rows.length - 1) return false;
  const target = doc.rows[i + 1];
  removeRow(id);
  focusRow(target.id, 'start');
  return true;
}

export function focusSibling(id: string, delta: -1 | 1, caret: number): boolean {
  const target = doc.rows[position(id) + delta];
  if (!target) return false;
  focusRow(target.id, caret);
  return true;
}

/** Resolved numeric slider settings for a row; NaN fields mean "invalid". */
export function sliderBounds(id: string): { min: number; max: number; step: number } {
  const row = getRow(id);
  if (!row) return { min: Number.NaN, max: Number.NaN, step: 0 };
  const step = row.slider.step.trim() === '' ? 0 : evalNumber(row.slider.step);
  return {
    min: evalNumber(row.slider.min),
    max: evalNumber(row.slider.max),
    step: Number.isFinite(step) && step > 0 ? step : 0,
  };
}

/**
 * Rewrite just the slider's numeric literal in the row's source. A drag is one undo step (the
 * range's change event ends it); animation frames are not undo steps.
 */
export function setSliderValue(
  id: string,
  value: number,
  origin: Extract<ChangeOrigin, 'drag' | 'animation'>,
): void {
  const row = getRow(id);
  const res = analysis().byId.get(id);
  if (!row || !res?.slider) return;
  const { min, max, step } = sliderBounds(id);
  let v = value;
  if (step > 0 && Number.isFinite(min)) {
    // Snap to the step grid without leaving the bounds: when the step doesn't divide the range,
    // the last grid point is below max (rounding past it would widen max, an undo step).
    const last = Number.isFinite(max)
      ? Math.floor((max - min) / step + 1e-9)
      : Number.POSITIVE_INFINITY;
    v = min + Math.max(0, Math.min(last, Math.round((v - min) / step))) * step;
  }
  const text = formatSliderValue(v, step, min, max);
  const { start, end } = res.slider.valueSpan;
  updateSource(id, row.source.slice(0, start) + text + row.source.slice(end), origin);
}

/** Quick fix for unknown names: add `name = 1` slider rows below the row. */
export function addSliders(afterId: string, names: readonly string[]): void {
  let after = afterId;
  for (const name of names) after = addRowAfter(after, `${name} = 1`);
}
