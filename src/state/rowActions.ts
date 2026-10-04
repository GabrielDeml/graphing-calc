import { formatSliderValue } from '../engine/format';
import { analysis, evalNumber } from './analysis';
import { addRowAfter, doc, getRow, removeRow, updateSource } from './doc';
import { focusRow } from './focus';

function position(id: string): number {
  return doc.rows.findIndex((r) => r.id === id);
}

/** Enter: move to the next row if it is empty, otherwise insert a new row below. */
export function enterFrom(id: string): void {
  const i = position(id);
  const next = doc.rows[i + 1];
  if (next && next.source.trim() === '') {
    focusRow(next.id, 'end');
    return;
  }
  focusRow(addRowAfter(id), 'end');
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

/** Rewrite just the slider's numeric literal in the row's source. */
export function setSliderValue(id: string, value: number): void {
  const row = getRow(id);
  const res = analysis().byId.get(id);
  if (!row || !res?.slider) return;
  const { min, max, step } = sliderBounds(id);
  let v = value;
  if (step > 0 && Number.isFinite(min)) v = min + Math.round((v - min) / step) * step;
  const text = formatSliderValue(v, step, min, max);
  const { start, end } = res.slider.valueSpan;
  updateSource(id, row.source.slice(0, start) + text + row.source.slice(end));
}

/** Quick fix for unknown names: add `name = 1` slider rows below the row. */
export function addSliders(afterId: string, names: readonly string[]): void {
  let after = afterId;
  for (const name of names) after = addRowAfter(after, `${name} = 1`);
}
