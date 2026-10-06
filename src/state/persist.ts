// Autosave format: the expression list, the view and a few layout choices, as JSON in
// localStorage, and reading it back. The stores hydrate from savedState() before they are
// created; autosave.ts does the saving (it imports the stores, so it can't be what they import).
// Decoding is pure and never throws: anything unreadable comes back as null (an empty graph) and
// malformed fields fall back to their defaults. Data from a newer version of the app is
// unreadable too, but it is not written over (see isNewerVersion). Nothing here writes to the
// console, since the e2e suite fails on any console error.

import type { ViewCenter } from '../plot/types';
import { PALETTE_SIZE } from './colors';
import { clampSidebarWidth, PANEL_SNAPS, type PanelSnap } from './layout';

/**
 * One key for every format: the `version` inside says which one it is, and MIGRATIONS upgrade
 * older data in place. Changing the key would strand the old data instead.
 */
export const STORAGE_KEY = 'graphing-calc:v1';
export const SAVE_VERSION = 1;

export interface SavedRow {
  source: string;
  /** Palette index, or -1 for a row that hasn't plotted yet. */
  colorIndex: number;
  hidden: boolean;
  /** Playing is not saved: a restored slider is always paused. */
  slider: { min: string; max: string; step: string };
  domain: { min: string; max: string };
}

export interface SavedState {
  rows: SavedRow[];
  /** null while the view is the home view, which then follows the window size. */
  view: ViewCenter | null;
  /** Keypad mode; absent means the device default. */
  keypad?: boolean;
  sidebarOpen?: boolean;
  /** Desktop sidebar width in CSS px; absent means the default. */
  sidebarWidth?: number;
  panelSnap?: PanelSnap;
}

/** A new row's slider bounds and parameter range (and what a saved row lacking them gets). */
export const DEFAULT_SLIDER: Readonly<{ min: string; max: string; step: string }> = {
  min: '-10',
  max: '10',
  step: '',
};
export const DEFAULT_DOMAIN: Readonly<{ min: string; max: string }> = { min: '0', max: '2pi' };

type Json = Record<string, unknown>;

function isObject(v: unknown): v is Json {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function str(v: unknown, fallback: string): string {
  return typeof v === 'string' ? v : fallback;
}

function finite(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/** Upgrades from older versions, keyed by the version they upgrade from. */
export type Migrations = Readonly<Record<number, (data: Json) => unknown>>;

const MIGRATIONS: Migrations = {};

/**
 * Bring saved data up to the current version; null when it is not a version this app knows. Each
 * step must raise the version (so a chain always ends), and one that fails loses only the data.
 */
export function migrate(raw: unknown, migrations: Migrations = MIGRATIONS): Json | null {
  let data = raw;
  while (isObject(data) && data.version !== SAVE_VERSION) {
    const from = data.version;
    if (typeof from !== 'number') return null;
    const step = migrations[from];
    if (!step) return null;
    try {
      data = step(data);
    } catch {
      return null;
    }
    if (isObject(data) && !(typeof data.version === 'number' && data.version > from)) return null;
  }
  return isObject(data) ? data : null;
}

function validateRow(raw: unknown): SavedRow | null {
  if (!isObject(raw) || typeof raw.source !== 'string') return null;
  const color = raw.colorIndex;
  const slider = isObject(raw.slider) ? raw.slider : {};
  const domain = isObject(raw.domain) ? raw.domain : {};
  return {
    source: raw.source,
    colorIndex:
      typeof color === 'number' && Number.isInteger(color) && color >= -1 && color < PALETTE_SIZE
        ? color
        : -1,
    hidden: raw.hidden === true,
    slider: {
      min: str(slider.min, DEFAULT_SLIDER.min),
      max: str(slider.max, DEFAULT_SLIDER.max),
      step: str(slider.step, DEFAULT_SLIDER.step),
    },
    domain: {
      min: str(domain.min, DEFAULT_DOMAIN.min),
      max: str(domain.max, DEFAULT_DOMAIN.max),
    },
  };
}

function validateView(raw: unknown): ViewCenter | null {
  if (!isObject(raw)) return null;
  const { cx, cy, ppuX, ppuY } = raw;
  if (!finite(cx) || !finite(cy) || !finite(ppuX) || !finite(ppuY)) return null;
  return ppuX > 0 && ppuY > 0 ? { cx, cy, ppuX, ppuY } : null;
}

/**
 * Check data of the current version. Rows without a source are dropped and other bad fields
 * get their defaults, so one damaged row doesn't cost the whole list.
 */
export function validate(data: unknown): SavedState | null {
  if (!isObject(data) || data.version !== SAVE_VERSION || !Array.isArray(data.rows)) return null;
  const rows: SavedRow[] = [];
  for (const raw of data.rows) {
    const row = validateRow(raw);
    if (row) rows.push(row);
  }
  const state: SavedState = { rows, view: validateView(data.view) };
  if (typeof data.keypad === 'boolean') state.keypad = data.keypad;
  if (typeof data.sidebarOpen === 'boolean') state.sidebarOpen = data.sidebarOpen;
  if (finite(data.sidebarWidth)) state.sidebarWidth = clampSidebarWidth(data.sidebarWidth);
  if (typeof data.panelSnap === 'string' && (PANEL_SNAPS as string[]).includes(data.panelSnap)) {
    state.panelSnap = data.panelSnap as PanelSnap;
  }
  return state;
}

/** Parse stored text; null for nothing stored, bad JSON, an unknown version or a bad shape. */
export function decode(text: string | null): SavedState | null {
  if (text === null) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  return validate(migrate(raw));
}

/**
 * Whether stored text comes from a newer version of the app (an older build still cached, or
 * running in another tab). This build can't read it, and must not save over it either.
 */
export function isNewerVersion(text: string | null): boolean {
  if (text === null) return false;
  try {
    const raw: unknown = JSON.parse(text);
    return isObject(raw) && typeof raw.version === 'number' && raw.version > SAVE_VERSION;
  } catch {
    return false;
  }
}

export function encode(state: SavedState): string {
  return JSON.stringify({ version: SAVE_VERSION, ...state });
}

/** localStorage, or null where it is missing or blocked (reading it can throw). */
function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

let loaded: { state: SavedState | null; newer: boolean } | undefined;

/** What storage held when the page loaded, read once (lazily, so importing this is pure). */
function load(): { state: SavedState | null; newer: boolean } {
  if (loaded === undefined) {
    let text: string | null = null;
    try {
      text = storage()?.getItem(STORAGE_KEY) ?? null;
    } catch {
      text = null;
    }
    loaded = { state: decode(text), newer: isNewerVersion(text) };
  }
  return loaded;
}

/** The state saved by the last session. */
export function savedState(): SavedState | null {
  return load().state;
}

/** Whether the last session was a newer version of the app (see isNewerVersion). */
export function savedByNewerVersion(): boolean {
  return load().newer;
}

/** Store encoded state. Returns false when storage is unavailable or full. */
export function writeSaved(text: string): boolean {
  try {
    const s = storage();
    if (!s) return false;
    s.setItem(STORAGE_KEY, text);
    return true;
  } catch {
    return false;
  }
}
