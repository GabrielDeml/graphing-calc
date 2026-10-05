import { applyFix } from '../engine/errors';
import { formatSliderValue } from '../engine/format';
import type { QuickFix } from '../engine/types';
import { analysis, engine, evalNumber } from './analysis';
import { type AutoTrigger, autoSliderNames, smartRange } from './autoSlider';
import {
  addRowAfter,
  type ChangeOrigin,
  doc,
  endUndoStep,
  getRow,
  isRestoring,
  removeRow,
  updateSource,
} from './doc';
import { focusedRow, focusRow, rowInput } from './focus';
import { ui } from './ui';

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

/**
 * Backspace in an empty row deletes it and focuses the end of the previous row. The empty row at
 * the end stays (removeRow leaves it), so there it only moves up.
 */
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

export function focusSibling(id: string, delta: -1 | 1, caret: number, x?: number): boolean {
  const target = doc.rows[position(id) + delta];
  if (!target) return false;
  focusRow(target.id, caret, undefined, x);
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
 * range's change event ends it), arrow keys coalesce like typing, and animation frames are not
 * undo steps.
 */
export function setSliderValue(
  id: string,
  value: number,
  origin: Exclude<ChangeOrigin, 'edit'>,
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

/** Quick fix for unknown names: add `name = 1` slider rows below the row. Returns their ids. */
export function addSliders(afterId: string, names: readonly string[]): string[] {
  const ids: string[] = [];
  let after = afterId;
  for (const name of names) {
    after = addRowAfter(after, `${name} = 1`);
    ids.push(after);
  }
  return ids;
}

/**
 * Sliders made automatically (this session), with every pair of bounds they have been given:
 * while a slider's bounds are still one of those, the user hasn't set them (see smartBounds).
 */
const autoSliders = new Map<string, Set<string>>();

const boundsKey = (min: string, max: string) => `${min}\u0000${max}`;

/**
 * Unknown names in a row become `name = 1` sliders below it by themselves, when its edit ends or
 * typing pauses (autoSlider.ts says which names, and when): one undo step, and the new rows
 * pulse. `tried` holds the names the row made sliders of before, which it never makes again
 * (they were undone or deleted since); the new ones are added to it. `selection`: the caret, for
 * a pause. Returns the names made; the caller offers to undo them (sliderToast), once whatever
 * else the key does is part of the same step.
 */
export function autoAddSliders(
  id: string,
  trigger: AutoTrigger,
  tried: Set<string>,
  selection?: { start: number; end: number },
): { names: string[]; ids: string[] } {
  const row = getRow(id);
  const error = analysis().byId.get(id)?.error;
  if (!row || error?.code !== 'unknown-name' || isRestoring()) return { names: [], ids: [] };
  const names = autoSliderNames(row.source, engine.unknownUses(id), trigger, {
    selection,
    skip: tried,
  });
  if (names.length === 0) return { names, ids: [] };
  for (const name of names) tried.add(name);
  const ids = addSliders(id, names);
  for (const s of ids) {
    const slider = getRow(s)?.slider;
    if (slider) autoSliders.set(s, new Set([boundsKey(slider.min, slider.max)]));
  }
  ui.flashRows(ids, false);
  return { names, ids };
}

/** "Added sliders a, b": what a toast says of sliders made automatically. */
export function sliderToast(names: readonly string[]): string {
  return `Added slider${names.length > 1 ? 's' : ''} ${names.join(', ')}`;
}

/**
 * The bounds a slider made automatically takes when a value outside them is typed into it, while
 * the user hasn't set them: a round range around the value (autoSlider.ts smartRange, `a = 50` →
 * 0…100). Null for every other slider, which widens to the typed value instead.
 */
export function smartBounds(id: string, value: number): { min: string; max: string } | null {
  const given = autoSliders.get(id);
  const slider = getRow(id)?.slider;
  if (!given || !slider || !given.has(boundsKey(slider.min, slider.max))) return null;
  const range = smartRange(value);
  if (range) given.add(boundsKey(range.min, range.max));
  return range;
}

/**
 * A fix that rewrites part of the row's text (`x2` → `x^2`): one undo step. A row being edited
 * keeps its caret where it was in the text (at the end of the new text, if it was in what was
 * replaced); `focus` puts the caret there in a row that isn't (the fix's button had focus, and
 * goes away with the error).
 */
export function applyTextFix(
  id: string,
  fix: Extract<QuickFix, { kind: 'replace' }>,
  focus = false,
): void {
  const row = getRow(id);
  if (!row) return;
  const { text, caret: end } = applyFix(row.source, fix);
  const editing = focusedRow();
  const was = editing?.id === id ? editing.caret : null;
  const delta = text.length - row.source.length;
  const caret =
    was === null || (was > fix.span.start && was < fix.span.end)
      ? end
      : was >= fix.span.end
        ? was + delta
        : was;
  const focused = was !== null || (rowInput(id) !== undefined && focus);
  updateSource(id, text, 'edit', 'replace');
  // Typing on after it is a step of its own.
  endUndoStep();
  if (focused) focusRow(id, caret);
}

/**
 * A row the trace adds (a tangent, a point), below the traced curve's row, pulsed into view. One
 * already in the list (a second tap) is only pulsed. Returns whether a row was added.
 */
export function addTraceRow(afterId: string, source: string): boolean {
  const same = doc.rows.find((r) => r.source.trim() === source);
  if (same) {
    ui.flashRows([same.id], true);
    return false;
  }
  ui.flashRows([addRowAfter(afterId, source)], true);
  return true;
}
