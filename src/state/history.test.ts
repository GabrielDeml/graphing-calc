import { describe, expect, it } from 'vitest';
import {
  caretAfterChange,
  editGroup,
  editKind,
  History,
  historyShortcut,
  type ShortcutKey,
} from './history';

/** A tiny "document": the history stores strings, the test applies changes itself. */
function editor(options: ConstructorParameters<typeof History<string>>[0] = {}) {
  const history = new History<string>(options);
  let text = '';
  return {
    history,
    get text() {
      return text;
    },
    change(next: string, group: string | null, now: number, windowMs?: number) {
      history.record(text, group, now, windowMs);
      text = next;
    },
    undo() {
      const s = history.undo(text);
      if (s !== undefined) text = s;
      return s !== undefined;
    },
    redo() {
      const s = history.redo(text);
      if (s !== undefined) text = s;
      return s !== undefined;
    },
  };
}

describe('History', () => {
  it('undoes and redoes steps in order', () => {
    const e = editor();
    e.change('a', null, 0);
    e.change('ab', null, 1);
    expect(e.undo()).toBe(true);
    expect(e.text).toBe('a');
    expect(e.undo()).toBe(true);
    expect(e.text).toBe('');
    expect(e.undo()).toBe(false);
    expect(e.redo()).toBe(true);
    expect(e.text).toBe('a');
    expect(e.redo()).toBe(true);
    expect(e.text).toBe('ab');
    expect(e.redo()).toBe(false);
  });

  it('coalesces a burst of typing in one group into one step', () => {
    const e = editor();
    e.change('y', 'edit:r1', 0);
    e.change('y=', 'edit:r1', 300);
    e.change('y=x', 'edit:r1', 900);
    // The window runs from the last change, so a long steady burst stays one step.
    e.change('y=x+', 'edit:r1', 1800);
    e.undo();
    expect(e.text).toBe('');
  });

  it('starts a new step after a pause', () => {
    const e = editor();
    e.change('y=x', 'edit:r1', 0);
    e.change('y=x^2', 'edit:r1', 1001);
    e.undo();
    expect(e.text).toBe('y=x');
  });

  it('starts a new step for another group or an ungrouped change', () => {
    const e = editor();
    e.change('a', 'edit:r1', 0);
    e.change('ab', 'edit:r2', 10);
    e.change('abc', null, 20);
    e.change('abcd', 'edit:r2', 30);
    e.undo();
    expect(e.text).toBe('abc');
    e.undo();
    expect(e.text).toBe('ab');
    e.undo();
    expect(e.text).toBe('a');
  });

  it('keeps an unbounded group open until sealed (one step per slider drag)', () => {
    const e = editor();
    e.change('a=1', null, 0);
    e.change('a=2', 'drag:r1', 100, Number.POSITIVE_INFINITY);
    e.change('a=5', 'drag:r1', 60_000, Number.POSITIVE_INFINITY);
    e.history.seal();
    e.change('a=7', 'drag:r1', 60_010, Number.POSITIVE_INFINITY);
    e.undo();
    expect(e.text).toBe('a=5');
    e.undo();
    expect(e.text).toBe('a=1');
  });

  it('reports whether a step was started', () => {
    const h = new History<string>();
    expect(h.record('', 'g', 0)).toBe(true);
    expect(h.record('a', 'g', 1)).toBe(false);
    expect(h.record('ab', null, 2)).toBe(true);
    expect(h.canUndo).toBe(true);
    expect(h.canRedo).toBe(false);
  });

  it('a new change clears redo, and undo ends coalescing', () => {
    const e = editor();
    e.change('a', 'edit:r1', 0);
    e.change('ab', 'edit:r1', 10);
    e.undo();
    expect(e.history.canRedo).toBe(true);
    // Typing again right away is a new step, not a continuation of the undone one.
    e.change('x', 'edit:r1', 20);
    expect(e.history.canRedo).toBe(false);
    e.undo();
    expect(e.text).toBe('');
    expect(e.redo()).toBe(true);
    expect(e.text).toBe('x');
  });

  it('drops the oldest steps beyond the limit', () => {
    const e = editor({ limit: 3 });
    for (let i = 1; i <= 5; i++) e.change(String(i), null, i);
    while (e.undo());
    expect(e.text).toBe('2');
  });

  it('skips steps that would change nothing', () => {
    const e = editor({ same: (a, b) => a === b });
    e.change('a', null, 0);
    // Typed and deleted again within one burst: nothing to see.
    e.change('ab', 'edit:r1', 5000);
    e.change('a', 'edit:r1', 5100);
    expect(e.undo()).toBe(true);
    expect(e.text).toBe('');
    expect(e.redo()).toBe(true);
    expect(e.text).toBe('a');
    expect(e.redo()).toBe(false);
  });

  it('amend() rewrites the nearest states on both sides until one differs', () => {
    // States are [slider, other row]; the slider is `a`.
    const h = new History<string[]>();
    const steps: string[][] = [
      ['a=1', ''],
      ['a=5', ''], // a drag moved a from 5 to 1: the walk must stop here
      ['a=1', 'y'],
      ['a=1', 'y=a'],
    ];
    steps.forEach((s, i) => {
      h.record(s, null, i);
    });
    // Live: ['a=1', 'y=a+1']. One undo puts a state on the redo side.
    const redone = h.undo(['a=1', 'y=a+1']);
    expect(redone).toEqual(['a=1', 'y=a']);
    // The slider plays from a=1 to a=2 (live state is now ['a=2', 'y=a']).
    const amend = (from: string, to: string) =>
      h.amend((s) => {
        if (s[0] !== from) return false;
        s[0] = to;
        return true;
      });
    amend('a=1', 'a=2');
    expect(h.redo(['a=2', 'y=a'])).toEqual(['a=2', 'y=a+1']);
    expect(h.undo(['a=2', 'y=a+1'])).toEqual(['a=2', 'y=a']);
    expect(h.undo(['a=2', 'y=a'])).toEqual(['a=2', 'y']);
    expect(h.undo(['a=2', 'y'])).toEqual(['a=5', '']);
    // Older states, before the drag, keep the value they had.
    expect(h.undo(['a=5', ''])).toEqual(['a=1', '']);
  });

  it('clear() forgets everything', () => {
    const e = editor();
    e.change('a', null, 0);
    e.undo();
    e.history.clear();
    expect(e.history.canUndo).toBe(false);
    expect(e.history.canRedo).toBe(false);
  });
});

describe('caretAfterChange', () => {
  it.each([
    // [before, after, caret] with the caret at the end of the changed part of `after`.
    ['y = 2x', 'y = x', 4], // undo an insertion: where the typing started
    ['y = x', 'y = 2x', 5], // redo it: after the inserted text
    ['y = x^', 'y = x^2', 7], // undo a deletion at the end
    ['y = x', 'y = sin(x)', 10],
    ['', 'y = x', 5],
    ['y = x', '', 0],
    ['aa', 'aaa', 3], // repeated characters: the change is placed last
    ['abc', 'abc', 3],
  ])('%j → %j puts the caret at %i', (before, after, caret) => {
    expect(caretAfterChange(before, after)).toBe(caret);
  });
});

describe('editKind', () => {
  it.each([
    ['y = x', 'y = 2x', 'insert'],
    ['', 'y = x', 'insert'],
    ['aa', 'aaa', 'insert'],
    ['y = 2x', 'y = x', 'delete'],
    ['y = x^2', '', 'delete'],
    ['y = x^2', 'b', 'replace'], // select all, type
    // Select all and type `y` reads as deleting the rest: text alone can't tell them apart.
    ['y = x^2', 'y', 'delete'],
    ['a = 1.1', 'a = 1.2', 'replace'],
  ] as const)('%j → %j is %s', (before, after, kind) => {
    expect(editKind(before, after)).toBe(kind);
  });
});

describe('editGroup', () => {
  /** Apply edits to a field the way the document does, a few ms apart (one burst). */
  function typeIn(texts: string[]) {
    const e = editor();
    texts.forEach((text, i) => {
      const { group, fresh } = editGroup('r1', e.text, text);
      if (fresh) e.history.seal();
      e.change(text, group, i * 50);
    });
    return e;
  }

  it('keeps a burst of typing, or of deleting, in one step', () => {
    const e = typeIn(['y', 'y=', 'y=x', 'y=', 'y']);
    e.undo();
    expect(e.text).toBe('y=x');
    e.undo();
    expect(e.text).toBe('');
  });

  it('brings back text deleted or typed over right after typing it', () => {
    const deleted = typeIn(['y', 'y=', 'y=x', '']);
    deleted.undo();
    expect(deleted.text).toBe('y=x');
    const replaced = typeIn(['y', 'y=', 'y=x', 'b', 'b=', 'b=2']);
    replaced.undo();
    expect(replaced.text).toBe('y=x');
    replaced.undo();
    expect(replaced.text).toBe('');
    replaced.redo();
    replaced.redo();
    expect(replaced.text).toBe('b=2');
  });

  it('keeps fields apart', () => {
    expect(editGroup('r1', '', 'a').group).not.toBe(editGroup('r2', '', 'a').group);
  });
});

describe('historyShortcut', () => {
  const key = (k: Partial<ShortcutKey>): ShortcutKey => ({
    key: '',
    code: '',
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    ...k,
  });

  it('maps Mod+Z, Mod+Shift+Z and Ctrl+Y', () => {
    expect(historyShortcut(key({ key: 'z', ctrlKey: true }))).toBe('undo');
    expect(historyShortcut(key({ key: 'z', metaKey: true }))).toBe('undo');
    expect(historyShortcut(key({ key: 'Z', ctrlKey: true, shiftKey: true }))).toBe('redo');
    expect(historyShortcut(key({ key: 'z', metaKey: true, shiftKey: true }))).toBe('redo');
    expect(historyShortcut(key({ key: 'y', ctrlKey: true }))).toBe('redo');
  });

  it('leaves other shortcuts and plain typing to the browser', () => {
    for (const k of ['a', 'c', 'v', 'x']) {
      expect(historyShortcut(key({ key: k, ctrlKey: true }))).toBeNull();
      expect(historyShortcut(key({ key: k, metaKey: true }))).toBeNull();
    }
    expect(historyShortcut(key({ key: 'z' }))).toBeNull();
    expect(historyShortcut(key({ key: 'Z', shiftKey: true }))).toBeNull();
    expect(historyShortcut(key({ key: 'z', ctrlKey: true, altKey: true }))).toBeNull();
    // ⌘Y is not redo on a Mac (it opens history in browsers).
    expect(historyShortcut(key({ key: 'y', metaKey: true }))).toBeNull();
  });

  it('falls back to the physical key on non-Latin layouts', () => {
    expect(historyShortcut(key({ key: 'я', code: 'KeyZ', ctrlKey: true }))).toBe('undo');
    expect(historyShortcut(key({ key: 'н', code: 'KeyY', ctrlKey: true }))).toBe('redo');
    // A Latin layout with Z elsewhere (QWERTZ) goes by the letter, not the position.
    expect(historyShortcut(key({ key: 'y', code: 'KeyZ', ctrlKey: true }))).toBe('redo');
  });
});
