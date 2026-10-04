import { createStore, produce } from 'solid-js/store';
import { takeNextColor } from './colors';

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
    colorIndex: takeNextColor(),
    hidden: false,
    slider: { min: '-10', max: '10', step: '', playing: false },
    domain: { min: '0', max: '2pi' },
  };
}

// The document stays plain serializable data so persistence/sharing can be added later.
const [doc, setDoc] = createStore<{ rows: Row[] }>({ rows: [newRow()] });

export { doc };

function indexOf(id: string): number {
  return doc.rows.findIndex((r) => r.id === id);
}

export function getRow(id: string): Row | undefined {
  return doc.rows.find((r) => r.id === id);
}

/** Insert a new row after `afterId` (or at the end) and return its id. */
export function addRowAfter(afterId: string | null, source = ''): string {
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
  setDoc('rows', (rows) => rows.filter((r) => r.id !== id));
  ensureTrailingEmpty();
}

export function updateSource(id: string, source: string): void {
  const i = indexOf(id);
  if (i < 0 || doc.rows[i].source === source) return;
  setDoc('rows', i, 'source', source);
  ensureTrailingEmpty();
}

export function toggleHidden(id: string): void {
  const i = indexOf(id);
  if (i >= 0) setDoc('rows', i, 'hidden', (h) => !h);
}

export function setColor(id: string, colorIndex: number): void {
  const i = indexOf(id);
  if (i >= 0) setDoc('rows', i, 'colorIndex', colorIndex);
}

export function setSliderField(id: string, field: 'min' | 'max' | 'step', value: string): void {
  const i = indexOf(id);
  if (i >= 0) setDoc('rows', i, 'slider', field, value);
}

export function setSliderPlaying(id: string, playing: boolean): void {
  const i = indexOf(id);
  if (i >= 0) setDoc('rows', i, 'slider', 'playing', playing);
}

export function setDomain(id: string, field: 'min' | 'max', value: string): void {
  const i = indexOf(id);
  if (i >= 0) setDoc('rows', i, 'domain', field, value);
}

/** The list always ends with an empty row to type into. */
export function ensureTrailingEmpty(): void {
  const rows = doc.rows;
  if (rows.length === 0 || rows[rows.length - 1].source.trim() !== '') {
    setDoc('rows', rows.length, newRow());
  }
}
