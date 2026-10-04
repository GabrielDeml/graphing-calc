import { batch, createSignal } from 'solid-js';
import { createStore, produce, reconcile, unwrap } from 'solid-js/store';
import { focusedRow, focusRow } from './focus';
import { caretAfterChange, History } from './history';
import { type SavedRow, savedState } from './persist';

export interface SliderSettings {
  /** Bounds are expression strings (e.g. "2pi"), evaluated against current variables. */
  min: string;
  max: string;
  /** Empty string means continuous. */
  step: string;
  playing: boolean;
}

export interface Row {
  id: string;
  source: string;
  /** Palette index; -1 until the row first plots (see assignColor). */
  colorIndex: number;
  hidden: boolean;
  slider: SliderSettings;
  /** Parameter range for parametric (t) and polar (θ) rows. */
  domain: { min: string; max: string };
}

let idCounter = 0;

export function newRow(source = ''): Row {
  idCounter += 1;
  return {
    id: `r${idCounter}`,
    source,
    colorIndex: -1,
    hidden: false,
    slider: { min: '-10', max: '10', step: '', playing: false },
    domain: { min: '0', max: '2pi' },
  };
}

/** A saved row as a document row (sliders paused), with a fresh id unless one is given. */
function fromSaved(saved: SavedRow, id?: string): Row {
  const row = {
    ...newRow(saved.source),
    colorIndex: saved.colorIndex,
    hidden: saved.hidden,
    slider: { ...saved.slider, playing: false },
    domain: { ...saved.domain },
  };
  if (id !== undefined) row.id = id;
  return row;
}

/** The last session's rows, or one empty row. */
function initialRows(): Row[] {
  const rows = (savedState()?.rows ?? []).map((saved) => fromSaved(saved));
  return rows.length > 0 ? rows : [newRow()];
}

// The document stays plain serializable data: autosave and undo snapshots are copies of it.
const [doc, setDoc] = createStore<{ rows: Row[] }>({ rows: initialRows() });

export { doc };

// ---- undo ----

/**
 * What a change came from. Typing coalesces per field into one undo step per burst, a slider
 * drag is one step (closed by endUndoStep), and a playing slider's frames are not undo steps.
 */
export type ChangeOrigin = 'edit' | 'drag' | 'animation';

interface Snapshot {
  rows: Row[];
  /** The row being edited when the snapshot was taken; undo puts the caret back there. */
  focus: { id: string; caret: number } | null;
}

/** Undo history copies; whether a slider is playing is live state, not part of a step. */
function copyRows(rows: readonly Row[]): Row[] {
  return rows.map((r) => ({
    ...r,
    slider: { ...r.slider, playing: false },
    domain: { ...r.domain },
  }));
}

const history = new History<Snapshot>({
  same: (a, b) => JSON.stringify(a.rows) === JSON.stringify(b.rows),
});

// Writes during startup (hydration, the first render) are not undo steps: the first tick counts
// as already inside one.
let inStep = true;
queueMicrotask(() => {
  inStep = false;
});
let restoring = false;

/**
 * Counts undo steps taken and undone (not slider frames or automatic colors), so UI that offers
 * to undo one change (the "Graph cleared · Undo" toast) can tell when something else happened.
 */
const [revision, setRevision] = createSignal(0);

export { revision };

function snapshot(): Snapshot {
  return { rows: copyRows(unwrap(doc).rows), focus: focusedRow() };
}

/**
 * Every edit calls this before it changes the document. The first change in a tick opens an undo
 * step (or continues the open one of the same group, see History.record); follow-ups in the same
 * tick (the trailing empty row, a slider widening its bounds, a new curve's color) fold into it.
 */
function willChange(group: string | null = null, windowMs?: number): void {
  if (inStep || restoring) return;
  inStep = true;
  queueMicrotask(() => {
    inStep = false;
  });
  history.record(snapshot(), group, Date.now(), windowMs);
  setRevision((n) => n + 1);
}

/**
 * A playing slider's frame is live state, like the play button, not an undo step. The stored
 * states that hold the row as the frame found it take the new value too, so undoing something
 * else leaves the slider where it is (undoing past the drag or edit that last set it still goes
 * back), and writes that follow in the same tick are not steps either.
 */
function animationWrite(id: string, from: string, to: string): void {
  history.amend((s) => {
    const row = s.rows.find((r) => r.id === id);
    if (!row || row.source !== from) return false;
    row.source = to;
    return true;
  });
  if (inStep) return;
  inStep = true;
  queueMicrotask(() => {
    inStep = false;
  });
}

/** Close the open undo step (a slider drag ended), so the next change starts a new one. */
export function endUndoStep(): void {
  history.seal();
}

/**
 * What an undo or redo showed: the row it put the caret in (`focused`), or else the first row it
 * changed, for the caller to select and scroll to. Null when there was nothing to undo or redo.
 */
export interface Restored {
  rowId: string | null;
  focused: boolean;
}

export function undo(): Restored | null {
  return restore(history.undo(snapshot()));
}

export function redo(): Restored | null {
  return restore(history.redo(snapshot()));
}

/** Rows that look the same (playing aside, which is live state). */
function sameRow(a: Row, b: Row): boolean {
  return (
    a.source === b.source &&
    a.colorIndex === b.colorIndex &&
    a.hidden === b.hidden &&
    a.slider.min === b.slider.min &&
    a.slider.max === b.slider.max &&
    a.slider.step === b.slider.step &&
    a.domain.min === b.domain.min &&
    a.domain.max === b.domain.max
  );
}

function restore(target: Snapshot | undefined): Restored | null {
  if (!target) return null;
  const current = new Map(unwrap(doc).rows.map((r) => [r.id, r]));
  const sources = new Map([...current].map(([id, r]) => [id, r.source]));
  const active = focusedRow();
  const rows = copyRows(target.rows).map((r) => {
    r.slider.playing = current.get(r.id)?.slider.playing ?? false;
    return r;
  });
  const changed = rows.find((r) => {
    const old = current.get(r.id);
    return !old || !sameRow(old, r);
  });
  restoring = true;
  try {
    // Keyed by id, so rows that survive keep their components (and their focused input).
    batch(() => setDoc('rows', reconcile(rows, { key: 'id' })));
  } finally {
    restoring = false;
  }
  setRevision((n) => n + 1);
  const caret = (id: string, fallback: number) => {
    const before = sources.get(id);
    const after = getRow(id)?.source;
    return before !== undefined && after !== undefined && before !== after
      ? caretAfterChange(before, after)
      : fallback;
  };
  // Back to the row the step was made in, with the caret where the text changed.
  if (target.focus && getRow(target.focus.id)) {
    focusRow(target.focus.id, caret(target.focus.id, target.focus.caret));
    return { rowId: target.focus.id, focused: true };
  }
  // A step made outside the rows (×, a color, New graph). The row being edited keeps focus; if
  // the step takes it away, focus moves to the first changed row so it stays in the list.
  if (active && getRow(active.id)) {
    focusRow(active.id, caret(active.id, active.caret));
    return { rowId: active.id, focused: true };
  }
  if (active && changed) {
    focusRow(changed.id, 'end');
    return { rowId: changed.id, focused: true };
  }
  return { rowId: changed?.id ?? null, focused: false };
}

// ---- edits ----

function indexOf(id: string): number {
  return doc.rows.findIndex((r) => r.id === id);
}

export function getRow(id: string): Row | undefined {
  return doc.rows.find((r) => r.id === id);
}

/** Insert a new row after `afterId` (or at the end) and return its id. */
export function addRowAfter(afterId: string | null, source = ''): string {
  willChange();
  const row = newRow(source);
  setDoc(
    produce((d) => {
      const i = afterId === null ? -1 : d.rows.findIndex((r) => r.id === afterId);
      if (i < 0) d.rows.push(row);
      else d.rows.splice(i + 1, 0, row);
    }),
  );
  ensureTrailingEmpty();
  return row.id;
}

export function removeRow(id: string): void {
  if (indexOf(id) < 0) return;
  willChange();
  setDoc('rows', (rows) => rows.filter((r) => r.id !== id));
  ensureTrailingEmpty();
}

/** Whether every row is empty: a new graph, or one cleared down to nothing. */
export function isBlank(): boolean {
  return doc.rows.every((r) => r.source.trim() === '');
}

/** "New graph": one empty row (undoable like any other edit). */
export function clearRows(): void {
  if (isBlank()) return;
  willChange();
  setDoc('rows', [newRow()]);
}

/**
 * Take the rows another window saved (this window has no unsaved edits). Rows keep the ids of
 * the rows at the same place, so their components and a focused input stay. Not an undo step:
 * this window's history was of a document that is gone, so it is cleared, unless the rows are
 * the same anyway (the other window only saved its view). Returns whether anything changed.
 */
export function adoptRows(saved: readonly SavedRow[]): boolean {
  const current = unwrap(doc).rows;
  const rows = saved.map((r, i) => fromSaved(r, current[i]?.id));
  if (rows.length === current.length && rows.every((r, i) => sameRow(r, current[i]))) return false;
  if (rows.length === 0) rows.push(newRow());
  history.clear();
  restoring = true;
  try {
    batch(() => {
      setDoc('rows', reconcile(rows, { key: 'id' }));
      ensureTrailingEmpty();
    });
  } finally {
    restoring = false;
  }
  setRevision((n) => n + 1);
  return true;
}

export function updateSource(id: string, source: string, origin: ChangeOrigin = 'edit'): void {
  const i = indexOf(id);
  if (i < 0) return;
  const before = doc.rows[i].source;
  if (before === source) return;
  if (origin === 'edit') willChange(`edit:${id}`);
  else if (origin === 'drag') willChange(`drag:${id}`, Number.POSITIVE_INFINITY);
  else animationWrite(id, before, source);
  batch(() => {
    setDoc('rows', i, 'source', source);
    // An emptied row gives its color back; it picks one again when it next plots.
    if (source.trim() === '') setDoc('rows', i, 'colorIndex', -1);
  });
  ensureTrailingEmpty();
}

export function toggleHidden(id: string): void {
  const i = indexOf(id);
  if (i < 0) return;
  willChange();
  setDoc('rows', i, 'hidden', (h) => !h);
}

export function setColor(id: string, colorIndex: number): void {
  const i = indexOf(id);
  if (i < 0 || doc.rows[i].colorIndex === colorIndex) return;
  willChange();
  setDoc('rows', i, 'colorIndex', colorIndex);
}

/** The automatic color of a row that has just started to plot (part of the edit that did it). */
export function assignColor(id: string, colorIndex: number): void {
  const i = indexOf(id);
  if (i >= 0) setDoc('rows', i, 'colorIndex', colorIndex);
}

export function setSliderField(id: string, field: 'min' | 'max' | 'step', value: string): void {
  const i = indexOf(id);
  if (i < 0 || doc.rows[i].slider[field] === value) return;
  willChange(`slider:${id}:${field}`);
  setDoc('rows', i, 'slider', field, value);
}

/** Play and pause are not undo steps. */
export function setSliderPlaying(id: string, playing: boolean): void {
  const i = indexOf(id);
  if (i >= 0) setDoc('rows', i, 'slider', 'playing', playing);
}

export function setDomain(id: string, field: 'min' | 'max', value: string): void {
  const i = indexOf(id);
  if (i < 0 || doc.rows[i].domain[field] === value) return;
  willChange(`domain:${id}:${field}`);
  setDoc('rows', i, 'domain', field, value);
}

/** The list always ends with an empty row to type into. */
export function ensureTrailingEmpty(): void {
  const rows = doc.rows;
  if (rows.length === 0 || rows[rows.length - 1].source.trim() !== '') {
    setDoc('rows', rows.length, newRow());
  }
}

ensureTrailingEmpty();
