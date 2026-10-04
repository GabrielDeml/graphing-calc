// Autosave: keeps localStorage in step with the document, the graph's view and the layout, in
// the format of persist.ts. Saves follow a pause in changes, and leaving the page saves at once.

import { createEffect, createRoot, untrack } from 'solid-js';
import type { ViewCenter } from '../plot/types';
import { adoptRows, doc, revision } from './doc';
import { keypad } from './keypad';
import {
  decode,
  encode,
  isNewerVersion,
  type SavedState,
  STORAGE_KEY,
  savedByNewerVersion,
  savedState,
  writeSaved,
} from './persist';
import { ui } from './ui';

const SAVE_DELAY_MS = 400;

/**
 * The graph's view. Not a signal: it changes on every frame of a pan or pinch, which must not
 * re-run the effect below (and re-read every row) each time.
 */
let view: ViewCenter | null = savedState()?.view ?? null;

/** The graph's view after a change; null while it is (or is animating to) the home view. */
export function noteView(v: ViewCenter | null): void {
  const next = v && { cx: v.cx, cy: v.cy, ppuX: v.ppuX, ppuY: v.ppuY };
  if (
    next === view ||
    (next !== null &&
      view !== null &&
      next.cx === view.cx &&
      next.cy === view.cy &&
      next.ppuX === view.ppuX &&
      next.ppuY === view.ppuY)
  ) {
    return;
  }
  view = next;
  schedule();
}

function current(): SavedState {
  const state: SavedState = {
    rows: doc.rows.map((r) => ({
      source: r.source,
      colorIndex: r.colorIndex,
      hidden: r.hidden,
      slider: { min: r.slider.min, max: r.slider.max, step: r.slider.step },
      domain: { min: r.domain.min, max: r.domain.max },
    })),
    view,
    sidebarOpen: ui.sidebarOpen(),
    panelSnap: ui.panelSnap(),
  };
  // Only a mode picked with ⌨ is saved; otherwise the device default applies on the next visit.
  const mode = keypad.choice();
  if (mode !== undefined) state.keypad = mode;
  return state;
}

/**
 * What storage holds, as far as this window knows. It starts as the state the page loaded with,
 * so a visit that changes nothing writes nothing.
 */
let written: string | null = untrack(() => encode(current()));
/** The document's revision as of the last save: anything later is an edit not saved yet. */
let savedRevision = untrack(revision);
/** Storage holds a newer version's data: this build leaves it alone. */
let locked = savedByNewerVersion();
let timer: ReturnType<typeof setTimeout> | undefined;
/**
 * A slider is playing. It rewrites its row every frame, so saving waits until it stops (or the
 * page is hidden) rather than following the document through every frame.
 */
let animating = false;

/** Save after a pause in changes. */
function schedule(): void {
  clearTimeout(timer);
  timer = animating ? undefined : setTimeout(flush, SAVE_DELAY_MS);
}

/** Save now if anything differs from what storage holds (encoding is cheap; rows are short). */
function flush(): void {
  clearTimeout(timer);
  timer = undefined;
  if (locked) return;
  const text = untrack(() => encode(current()));
  if (text === written || writeSaved(text)) {
    written = text;
    savedRevision = untrack(revision);
  }
}

createRoot(() => {
  createEffect(() => {
    animating = doc.rows.some((r) => r.slider.playing);
    // While playing, only the rows list and the playing flags are tracked; the effect runs again
    // (and reads everything) once the slider stops.
    if (!animating) current();
    schedule();
  });
});

/**
 * Another window (a second tab, the installed app next to a browser tab) saved. Unless this one
 * has edits of its own waiting, it takes the other window's rows (a playing slider here stops),
 * so its next save builds on them instead of putting back the list it loaded with. Each window
 * keeps its own view and layout.
 */
function onStorage(e: StorageEvent): void {
  if (e.key !== null && e.key !== STORAGE_KEY) return;
  written = e.newValue;
  locked = isNewerVersion(e.newValue);
  const state = decode(e.newValue);
  // Edits made here and not saved yet win: they are saved over it shortly.
  if (!state || untrack(revision) !== savedRevision) return;
  const waiting = timer !== undefined;
  adoptRows(state.rows);
  savedRevision = untrack(revision);
  // A view or layout change that was waiting is saved, with the new rows. Otherwise storage
  // holds what this window shows, as far as it matters: only a later change here needs a save.
  if (waiting) return;
  clearTimeout(timer);
  timer = undefined;
  written = untrack(() => encode(current()));
}

if (typeof window !== 'undefined') {
  // Leaving or backgrounding the page (a phone switching apps) saves right away.
  window.addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush();
  });
  window.addEventListener('storage', onStorage);
}
