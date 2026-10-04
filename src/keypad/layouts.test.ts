import { describe, expect, it } from 'vitest';
import { isBuiltinFunction } from '../engine/builtinNames';
import type { EditOp } from './editing';
import { ACTION_COLUMN, getPage, type KeyDef, type KeypadPage, PAGE_ORDER } from './layouts';

const ALL: { page: KeypadPage; shift: boolean }[] = PAGE_ORDER.flatMap((id) => [
  { page: getPage(id, false), shift: false },
  { page: getPage(id, true), shift: true },
]);

function keys(page: KeypadPage): KeyDef[] {
  return page.rows.flat();
}

function byId(page: KeypadPage, id: string): KeyDef {
  const def = keys(page).find((k) => k.id === id);
  if (!def) throw new Error(`no key '${id}' on page ${page.id}`);
  return def;
}

function opOf(def: KeyDef): EditOp | undefined {
  return def.action.type === 'edit' ? def.action.op : undefined;
}

describe('pages', () => {
  it('has three tabs in order', () => {
    expect(PAGE_ORDER).toEqual(['123', 'fx', 'abc']);
  });

  describe.each(ALL)('$page.id (shift: $shift)', ({ page, shift }) => {
    it('matches its id', () => {
      expect(PAGE_ORDER).toContain(page.id);
      expect(page.label).not.toBe('');
      expect(getPage(page.id, shift)).toBe(page);
    });

    it('has 4 full rows of at most 10 keys', () => {
      expect(page.rows).toHaveLength(4);
      for (const row of page.rows) {
        expect(row.length).toBeLessThanOrEqual(10);
        expect(row.reduce((n, k) => n + (k.span ?? 1), 0)).toBe(page.columns);
      }
    });

    it('has no key narrower than the action column', () => {
      for (const k of keys(page)) {
        expect(k.span ?? 1, k.id).toBeGreaterThanOrEqual(ACTION_COLUMN[0]?.span ?? 1);
      }
    });

    it('has unique ids', () => {
      const ids = keys(page).map((k) => k.id);
      expect(new Set(ids).size).toBe(ids.length);
      for (const id of ids) expect(id).toMatch(/^[a-z0-9]+$/);
    });

    it('labels every key with a glyph and human words', () => {
      for (const k of keys(page)) {
        expect(k.label.trim()).not.toBe('');
        expect(k.ariaLabel, k.id).toMatch(/^[\p{L}\p{N}][\p{L}\p{N} ']*$/u);
      }
    });

    it('uses positive integer spans', () => {
      for (const k of keys(page)) {
        if (k.span !== undefined) {
          expect(Number.isInteger(k.span) && k.span > 1, k.id).toBe(true);
        }
      }
    });

    it('ends every row with the shared action column', () => {
      expect(page.rows.map((row) => row[row.length - 1])).toEqual([...ACTION_COLUMN]);
      page.rows.forEach((row, i) => {
        expect(row[row.length - 1]).toBe(ACTION_COLUMN[i]);
      });
    });

    it('auto-repeats only backspace and the arrows', () => {
      const repeating = keys(page)
        .filter((k) => k.repeat)
        .map((k) => k.id);
      expect(repeating).toEqual(['backspace', 'left', 'right']);
    });
  });
});

describe('action column', () => {
  it('has the same width and place on every page', () => {
    const columns = new Set(ALL.map(({ page }) => page.columns));
    expect(columns.size).toBe(1);
    const spans = new Set(ACTION_COLUMN.map((k) => k.span ?? 1));
    expect(spans.size).toBe(1);
    // A tenth of the row, like each ABC letter.
    expect([...spans][0]).toBe(getPage('abc', false).columns / 10);
  });

  it('is ⌫ ← → ↵ with the right actions', () => {
    expect(ACTION_COLUMN.map((k) => [k.id, k.label, k.ariaLabel, k.variant])).toEqual([
      ['backspace', '⌫', 'backspace', 'action'],
      ['left', '←', 'move left', 'action'],
      ['right', '→', 'move right', 'action'],
      ['enter', '↵', 'enter', 'primary'],
    ]);
    expect(ACTION_COLUMN.map((k) => k.action)).toEqual([
      { type: 'edit', op: { type: 'backspace' } },
      { type: 'edit', op: { type: 'left' } },
      { type: 'edit', op: { type: 'right' } },
      { type: 'enter' },
    ]);
  });
});

describe("'123' page", () => {
  const page = getPage('123', false);

  const required: [label: string, op: EditOp][] = [
    ['x', { type: 'insert', text: 'x' }],
    ['y', { type: 'insert', text: 'y' }],
    ['a²', { type: 'insert', text: '^2' }],
    ['aᵇ', { type: 'insert', text: '^' }],
    ...[...'0123456789'].map((d): [string, EditOp] => [d, { type: 'insert', text: d }]),
    ['.', { type: 'insert', text: '.' }],
    ['÷', { type: 'insert', text: '/' }],
    ['×', { type: 'insert', text: '*' }],
    ['−', { type: 'insert', text: '-' }],
    ['+', { type: 'insert', text: '+' }],
    ['=', { type: 'insert', text: '=' }],
    ['(', { type: 'insert', text: '(' }],
    [')', { type: 'insert', text: ')' }],
    ['<', { type: 'insert', text: '<' }],
    ['>', { type: 'insert', text: '>' }],
    ['≤', { type: 'insert', text: '≤' }],
    ['≥', { type: 'insert', text: '≥' }],
    ['|a|', { type: 'wrap', before: '|', after: '|' }],
    [',', { type: 'insert', text: ',' }],
    ['√', { type: 'function', name: 'sqrt' }],
    ['π', { type: 'insert', text: 'π' }],
  ];

  it.each(required)('has %s', (label, op) => {
    const def = keys(page).find((k) => k.label === label);
    expect(def).toBeDefined();
    expect(def && opOf(def)).toEqual(op);
  });

  it('has nothing beyond the required keys and the action column', () => {
    expect(keys(page)).toHaveLength(required.length + ACTION_COLUMN.length);
  });

  it('keeps the ids the e2e tests and component rely on', () => {
    for (const id of ['x', 'y', 'eq', 'pow', 'sq', '2', '7', 'sqrt', 'backspace', 'enter']) {
      expect(byId(page, id)).toBeDefined();
    }
  });

  it('has the documented aria labels', () => {
    expect(byId(page, 'sq').ariaLabel).toBe('squared');
    expect(byId(page, 'pow').ariaLabel).toBe('power');
    expect(byId(page, 'sqrt').ariaLabel).toBe('square root');
    expect(byId(page, 'div').ariaLabel).toBe('divide');
  });
});

describe("'fx' page", () => {
  const page = getPage('fx', false);
  const functionKeys = keys(page).filter((k) => opOf(k)?.type === 'function');

  it('has the function keys', () => {
    const names = functionKeys.map((k) => {
      const op = opOf(k);
      return op?.type === 'function' ? op.name : '';
    });
    expect(names.sort()).toEqual(
      [
        'sin',
        'cos',
        'tan',
        'arcsin',
        'arccos',
        'arctan',
        'sinh',
        'cosh',
        'tanh',
        'ln',
        'log',
        'exp',
        'sqrt',
        'cbrt',
        'floor',
        'ceil',
        'round',
        'min',
        'max',
        'mod',
      ].sort(),
    );
  });

  it('only offers builtin functions', () => {
    for (const k of functionKeys) {
      const op = opOf(k);
      expect(op?.type === 'function' && isBuiltinFunction(op.name), k.id).toBe(true);
    }
  });

  it.each<[label: string, op: EditOp]>([
    ['e', { type: 'insert', text: 'e' }],
    ['θ', { type: 'insert', text: 'θ' }],
    ['t', { type: 'insert', text: 't' }],
    ['r', { type: 'insert', text: 'r' }],
    ['!', { type: 'insert', text: '!' }],
    ['∛', { type: 'function', name: 'cbrt' }],
    ['|a|', { type: 'wrap', before: '|', after: '|' }],
  ])('has %s', (label, op) => {
    const def = keys(page).find((k) => k.label === label);
    expect(def && opOf(def)).toEqual(op);
  });

  it("keeps the 'sin' id the e2e tests rely on", () => {
    expect(opOf(byId(page, 'sin'))).toEqual({ type: 'function', name: 'sin' });
  });
});

describe("'abc' page", () => {
  const lower = getPage('abc', false);
  const upper = getPage('abc', true);

  it('has each letter exactly once', () => {
    const letters = keys(lower)
      .map((k) => opOf(k))
      .flatMap((op) => (op?.type === 'insert' && /^[a-z]$/.test(op.text) ? [op.text] : []));
    expect(letters.sort()).toEqual([...'abcdefghijklmnopqrstuvwxyz']);
  });

  it('keeps QWERTY order', () => {
    const rowText = (row: KeyDef[]) =>
      row
        .map((k) => opOf(k))
        .map((op) => (op?.type === 'insert' && /^[a-z]$/.test(op.text) ? op.text : ''))
        .join('');
    expect(lower.rows.slice(0, 3).map(rowText)).toEqual(['qwertyuio', 'asdfghjkl', 'zxcvbnmp']);
  });

  it('has shift, θ, subscript, space and the device-keyboard key', () => {
    expect(byId(lower, 'shift').action).toEqual({ type: 'shift' });
    expect(opOf(byId(lower, 'theta'))).toEqual({ type: 'insert', text: 'θ' });
    expect(opOf(byId(lower, 'underscore'))).toEqual({ type: 'insert', text: '_' });
    expect(opOf(byId(lower, 'space'))).toEqual({ type: 'insert', text: ' ' });
    const native = byId(lower, 'native');
    expect(native.action).toEqual({ type: 'native' });
    expect(native.ariaLabel).toBe('Use device keyboard');
    expect(native.label).toBe('⌨');
  });

  it('shift uppercases letters and changes nothing else but the shift key', () => {
    expect(upper.columns).toBe(lower.columns);
    lower.rows.forEach((row, r) => {
      const shiftedRow = upper.rows[r] ?? [];
      expect(shiftedRow).toHaveLength(row.length);
      row.forEach((k, c) => {
        const u = shiftedRow[c] as KeyDef;
        const op = opOf(k);
        expect(u.id).toBe(k.id);
        if (op?.type === 'insert' && /^[a-z]$/.test(op.text)) {
          const cap = op.text.toUpperCase();
          expect(u).toEqual({
            ...k,
            label: cap,
            ariaLabel: `capital ${cap}`,
            action: { type: 'edit', op: { type: 'insert', text: cap } },
          });
        } else if (k.id === 'shift') {
          expect(u.action).toEqual({ type: 'shift' });
          expect(u.ariaLabel).not.toBe(k.ariaLabel);
        } else {
          expect(u).toBe(k);
        }
      });
    });
  });

  it('shift does not change the other pages', () => {
    expect(getPage('123', true)).toBe(getPage('123', false));
    expect(getPage('fx', true)).toBe(getPage('fx', false));
  });
});

describe('stability', () => {
  it('returns the same frozen objects on every call', () => {
    for (const id of PAGE_ORDER) {
      for (const shift of [false, true]) {
        const page = getPage(id, shift);
        expect(getPage(id, shift)).toBe(page);
        expect(Object.isFrozen(page)).toBe(true);
        expect(Object.isFrozen(page.rows[0])).toBe(true);
        expect(Object.isFrozen(page.rows[0]?.[0])).toBe(true);
      }
    }
  });
});
