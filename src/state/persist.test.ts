import { describe, expect, it } from 'vitest';
import {
  decode,
  encode,
  isNewerVersion,
  type Migrations,
  migrate,
  SAVE_VERSION,
  type SavedRow,
  type SavedState,
  validate,
} from './persist';

const row = (source: string, extra: Partial<SavedRow> = {}): SavedRow => ({
  source,
  colorIndex: -1,
  hidden: false,
  slider: { min: '-10', max: '10', step: '' },
  domain: { min: '0', max: '2pi' },
  ...extra,
});

const state: SavedState = {
  rows: [
    row('a = 3', { slider: { min: '0', max: '20', step: '0.5' } }),
    row('y = a x', { colorIndex: 3, hidden: true }),
    row('(cos t, sin t)', { colorIndex: 1, domain: { min: '0', max: 'pi' } }),
    row(''),
  ],
  view: { cx: 1.5, cy: -2, ppuX: 80, ppuY: 80 },
  keypad: true,
  sidebarOpen: false,
  panelSnap: 'full',
};

describe('encode / decode', () => {
  it('round-trips a full state', () => {
    expect(decode(encode(state))).toEqual(state);
  });

  it('stores the version and no playing flags', () => {
    const json = JSON.parse(encode(state));
    expect(json.version).toBe(SAVE_VERSION);
    expect(JSON.stringify(json)).not.toContain('playing');
  });

  it('a home view and device defaults stay unset', () => {
    const minimal: SavedState = { rows: [row('y = x', { colorIndex: 0 })], view: null };
    expect(decode(encode(minimal))).toEqual(minimal);
  });

  it.each([
    ['nothing stored', null],
    ['empty string', ''],
    ['truncated JSON', '{"version":1,"rows":[{"source":"y'],
    ['not JSON', 'y = x'],
    ['a JSON string', '"hello"'],
    ['a JSON array', '[1, 2]'],
    ['null', 'null'],
    ['no version', '{"rows":[]}'],
    ['a future version', '{"version":99,"rows":[]}'],
    ['rows not an array', '{"version":1,"rows":"y = x"}'],
  ])('%s decodes to null', (_label, text) => {
    expect(decode(text)).toBeNull();
  });
});

describe('validate', () => {
  it('drops rows without a source and repairs bad fields', () => {
    const v = validate({
      version: 1,
      rows: [
        null,
        'y = x',
        { colorIndex: 2 },
        { source: 42 },
        {
          source: 'y = x',
          colorIndex: 99,
          hidden: 'yes',
          slider: { min: 0, max: '5', step: null, playing: true },
          domain: 'all',
        },
        { source: 'y = 2', colorIndex: 2.5 },
        { source: 'y = 3', colorIndex: 5 },
      ],
    });
    expect(v?.rows).toEqual([
      row('y = x', { slider: { min: '-10', max: '5', step: '' } }),
      row('y = 2'),
      row('y = 3', { colorIndex: 5 }),
    ]);
  });

  it('keeps an empty list (the app then starts with one empty row)', () => {
    expect(validate({ version: 1, rows: [] })).toEqual({ rows: [], view: null });
  });

  it('drops a bad view and bad layout fields', () => {
    const bad = [
      { cx: 0, cy: 0, ppuX: 0, ppuY: 40 },
      { cx: 0, cy: 0, ppuX: -1, ppuY: -1 },
      { cx: Number.NaN, cy: 0, ppuX: 40, ppuY: 40 },
      { cx: '0', cy: 0, ppuX: 40, ppuY: 40 },
      { cx: 0, cy: 0, ppuX: 40 },
      [0, 0, 40, 40],
      'home',
    ];
    for (const view of bad) {
      expect(validate({ version: 1, rows: [], view })?.view).toBeNull();
    }
    const v = validate({ version: 1, rows: [], keypad: 'on', sidebarOpen: 1, panelSnap: 'tall' });
    expect(v).toEqual({ rows: [], view: null });
  });

  it('accepts every panel snap', () => {
    for (const panelSnap of ['collapsed', 'half', 'full'] as const) {
      expect(validate({ version: 1, rows: [], panelSnap })?.panelSnap).toBe(panelSnap);
    }
  });

  it('rejects other versions (migrate brings old ones up first)', () => {
    expect(validate({ version: 2, rows: [] })).toBeNull();
    expect(validate({ version: '1', rows: [] })).toBeNull();
  });
});

describe('migrate', () => {
  it('passes the current version through', () => {
    const data = { version: SAVE_VERSION, rows: [] };
    expect(migrate(data)).toBe(data);
  });

  it('rejects unknown versions and non-objects', () => {
    expect(migrate({ version: 0, rows: [] })).toBeNull();
    expect(migrate({ version: SAVE_VERSION + 1, rows: [] })).toBeNull();
    expect(migrate({ rows: [] })).toBeNull();
    expect(migrate([])).toBeNull();
    expect(migrate('{"version":1}')).toBeNull();
    expect(migrate(null)).toBeNull();
  });

  // Steps for two made-up older formats: v-1 kept bare sources, v0 called the list `exprs`.
  const migrations: Migrations = {
    [-1]: (d) => ({ version: 0, exprs: (d.sources as string[]).map((source) => ({ source })) }),
    0: (d) => ({ version: SAVE_VERSION, rows: d.exprs }),
  };

  it('upgrades old data one step at a time', () => {
    const upgraded = migrate({ version: -1, sources: ['y = x', 'a = 2'] }, migrations);
    expect(upgraded).toEqual({
      version: SAVE_VERSION,
      rows: [{ source: 'y = x' }, { source: 'a = 2' }],
    });
    expect(validate(upgraded)?.rows.map((r) => r.source)).toEqual(['y = x', 'a = 2']);
  });

  it('gives up on a step that fails, or one that does not raise the version', () => {
    // Bad old data: the step throws.
    expect(migrate({ version: -1, sources: 'y = x' }, migrations)).toBeNull();
    // A step going nowhere (or backwards) would never end.
    expect(migrate({ version: 0 }, { 0: (d) => d })).toBeNull();
    const back: Migrations = { 0: () => ({ version: -1 }), [-1]: () => ({ version: 0 }) };
    expect(migrate({ version: 0 }, back)).toBeNull();
    // A step returning something other than an object.
    expect(migrate({ version: 0 }, { 0: () => 'v1' })).toBeNull();
  });
});

describe('isNewerVersion', () => {
  it('is true only for readable data with a higher version', () => {
    expect(isNewerVersion(`{"version":${SAVE_VERSION + 1},"rows":[]}`)).toBe(true);
    expect(isNewerVersion('{"version":99}')).toBe(true);
    // The current and older versions, and anything unreadable, may be saved over.
    expect(isNewerVersion(encode({ rows: [], view: null }))).toBe(false);
    expect(isNewerVersion('{"version":0,"rows":[]}')).toBe(false);
    expect(isNewerVersion('{"version":"99","rows":[]}')).toBe(false);
    expect(isNewerVersion('{"rows":[]}')).toBe(false);
    expect(isNewerVersion('{"version":99,"rows":[')).toBe(false);
    expect(isNewerVersion('[{"version":99}]')).toBe(false);
    expect(isNewerVersion(null)).toBe(false);
  });
});
