// Undo history core, free of Solid and the DOM so it can be unit-tested. Each undo step holds the
// state from *before* the step; the state after it is the next step's (or the live document),
// so a burst of typing coalesces by simply not recording again.

export interface HistoryOptions<S> {
  /** Changes in the same group within this many ms of the previous one join its step. */
  coalesceMs?: number;
  /** The oldest steps are dropped beyond this many. */
  limit?: number;
  /** States that look the same to the user: undo and redo skip steps that would change nothing. */
  same?: (a: S, b: S) => boolean;
}

const COALESCE_MS = 1000;
const LIMIT = 200;

export class History<S> {
  private undoStack: S[] = [];
  private redoStack: S[] = [];
  /** The newest step while it can still absorb changes of its group. */
  private open: { group: string; time: number; windowMs: number } | null = null;
  private readonly coalesceMs: number;
  private readonly limit: number;
  private readonly same: (a: S, b: S) => boolean;

  constructor(options: HistoryOptions<S> = {}) {
    this.coalesceMs = options.coalesceMs ?? COALESCE_MS;
    this.limit = options.limit ?? LIMIT;
    this.same = options.same ?? (() => false);
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  /**
   * A change is about to be made to the state `before`. It starts a new step (which clears redo)
   * unless it continues the open step: same non-null group, at most `windowMs` after that step's
   * last change. Returns whether a step was started.
   */
  record(before: S, group: string | null, now: number, windowMs = this.coalesceMs): boolean {
    const open = this.open;
    if (group !== null && open && open.group === group && now - open.time <= open.windowMs) {
      open.time = now;
      return false;
    }
    this.undoStack.push(before);
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    this.redoStack.length = 0;
    this.open = group === null ? null : { group, time: now, windowMs };
    return true;
  }

  /** End the open step: the next change starts a new one, even in the same group. */
  seal(): void {
    this.open = null;
  }

  /** The state to go back to from `current`, or undefined when there is nothing to undo. */
  undo(current: S): S | undefined {
    return this.move(this.undoStack, this.redoStack, current);
  }

  /** The state to go forward to from `current`, or undefined when there is nothing to redo. */
  redo(current: S): S | undefined {
    return this.move(this.redoStack, this.undoStack, current);
  }

  clear(): void {
    this.undoStack.length = 0;
    this.redoStack.length = 0;
    this.open = null;
  }

  /**
   * Rewrite stored states as if a live change (a playing slider's value) had always been there,
   * from the nearest state outwards on both sides. `fn` updates a state in place and returns
   * true, or returns false to stop the walk on that side: the change can't reach past a state
   * that differs where it applies.
   */
  amend(fn: (state: S) => boolean): void {
    for (const stack of [this.undoStack, this.redoStack]) {
      for (let i = stack.length - 1; i >= 0; i--) if (!fn(stack[i])) break;
    }
  }

  private move(from: S[], to: S[], current: S): S | undefined {
    this.open = null;
    let next = from.pop();
    // A step whose changes cancelled out (typing a character, then deleting it) would make the
    // key look broken; drop it and take the one before.
    while (next !== undefined && this.same(next, current)) next = from.pop();
    if (next === undefined) return undefined;
    to.push(current);
    return next;
  }
}

/**
 * The text two strings share at the start and at the end (not overlapping): what lies between
 * is what a change replaced. With repeated characters the change is placed as late as possible.
 */
function sharedEnds(before: string, after: string): { prefix: number; suffix: number } {
  const max = Math.min(before.length, after.length);
  let prefix = 0;
  while (prefix < max && before[prefix] === after[prefix]) prefix++;
  let suffix = 0;
  while (
    suffix < max - prefix &&
    before[before.length - 1 - suffix] === after[after.length - 1 - suffix]
  ) {
    suffix++;
  }
  return { prefix, suffix };
}

/**
 * Where the caret goes when undo or redo turns `before` into `after`: the end of the changed
 * part of `after`. Undoing typed text puts the caret where the typing started; redoing it puts
 * the caret after it again.
 */
export function caretAfterChange(before: string, after: string): number {
  return after.length - sharedEnds(before, after).suffix;
}

export type EditKind = 'insert' | 'delete' | 'replace';

/** Whether a text change only added text, only removed some, or replaced some (a selection). */
export function editKind(before: string, after: string): EditKind {
  const { prefix, suffix } = sharedEnds(before, after);
  if (before.length - prefix - suffix === 0) return 'insert';
  return after.length - prefix - suffix === 0 ? 'delete' : 'replace';
}

/**
 * The undo group of a text edit in `field`, and whether it must start a new step (`fresh`, by
 * sealing the open one). Typing coalesces with typing and deleting with deleting, but switching
 * between them starts a new step, so undo always brings back text that was typed and then
 * deleted, however quickly (select all + Backspace). Typing over a selection starts a new
 * typing burst. `kind` overrides what the texts suggest: a typeset row's editor knows that
 * typing `x` into `1/2` is an insertion, though its parentheses make `1/(2x)` look like a
 * replacement.
 */
export function editGroup(
  field: string,
  before: string,
  after: string,
  kind: EditKind = editKind(before, after),
): { group: string; fresh: boolean } {
  return { group: `${kind === 'delete' ? 'delete' : 'type'}:${field}`, fresh: kind === 'replace' };
}

export interface ShortcutKey {
  key: string;
  code: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

/**
 * The history command a key press asks for: Mod+Z undoes, Mod+Shift+Z and Ctrl+Y redo (Mod is
 * Ctrl or ⌘). Every other shortcut (Mod+A/C/V/X…) is left to the browser. Layouts without Latin
 * letters fall back to the physical key.
 */
export function historyShortcut(e: ShortcutKey): 'undo' | 'redo' | null {
  if (e.altKey || !(e.ctrlKey || e.metaKey)) return null;
  const latin = /^[a-z]$/i.test(e.key);
  const letter = latin
    ? e.key.toLowerCase()
    : e.code === 'KeyZ'
      ? 'z'
      : e.code === 'KeyY'
        ? 'y'
        : '';
  if (letter === 'z') return e.shiftKey ? 'redo' : 'undo';
  if (letter === 'y' && e.ctrlKey && !e.metaKey && !e.shiftKey) return 'redo';
  return null;
}
