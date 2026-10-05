// Row inputs register here so keyboard navigation and the keypad can move focus between rows.
const inputs = new Map<string, HTMLInputElement>();

export function registerRowInput(id: string, el: HTMLInputElement): void {
  inputs.set(id, el);
}

export function unregisterRowInput(id: string, el: HTMLInputElement): void {
  if (inputs.get(id) === el) inputs.delete(id);
}

export function rowInput(id: string): HTMLInputElement | undefined {
  return inputs.get(id);
}

/**
 * A row edited in its typeset form (MathField) knows more about its caret than its input does:
 * how deep it is (at the end of a denominator, or after the fraction), and where it was before
 * an edit the input has already made.
 */
export interface RowCaret {
  /** The caret as the editor last left it, or undefined when it doesn't know. */
  get(): { offset: number; depth: number } | undefined;
  /** Put the caret, already at its offset, at this depth. */
  set(depth: number): void;
  /** Where the caret is drawn (client x), when it is. */
  x(): number | undefined;
  /** Put the caret at the place nearest this x (client) on the row's line; false if it can't. */
  placeAtX(x: number): boolean;
}

const carets = new WeakMap<HTMLInputElement, RowCaret>();

export function registerRowCaret(el: HTMLInputElement, caret: RowCaret): () => void {
  carets.set(el, caret);
  return () => {
    if (carets.get(el) === caret) carets.delete(el);
  };
}

/** Where a row input's caret is drawn (client x), if it is drawn by its row's editor. */
export function rowCaretX(el: HTMLInputElement): number | undefined {
  return carets.get(el)?.x();
}

/** The row whose expression input has focus, and its caret (undo returns there). */
export function focusedRow(): { id: string; caret: number; depth?: number } | null {
  const el = typeof document === 'undefined' ? null : document.activeElement;
  for (const [id, input] of inputs) {
    if (input !== el) continue;
    const known = carets.get(input)?.get();
    if (known) return { id, caret: known.offset, depth: known.depth };
    return { id, caret: input.selectionStart ?? input.value.length };
  }
  return null;
}

/**
 * Focus a row's input once it exists (it may have just been inserted), with the caret at an
 * offset (and a depth, in a typeset row; else the shallowest place there). With `x`, a typeset
 * row puts the caret where it is drawn nearest that x instead (↑ and ↓ keep the caret's column).
 */
export function focusRow(
  id: string,
  caret: 'start' | 'end' | number = 'end',
  depth?: number,
  x?: number,
): void {
  const apply = () => {
    const el = inputs.get(id);
    if (!el) return false;
    el.focus({ preventScroll: true });
    if (x === undefined || !carets.get(el)?.placeAtX(x)) {
      const len = el.value.length;
      const pos = caret === 'start' ? 0 : caret === 'end' ? len : Math.min(caret, len);
      el.setSelectionRange(pos, pos);
      if (depth !== undefined) carets.get(el)?.set(depth);
    }
    el.scrollIntoView({ block: 'nearest' });
    return true;
  };
  if (!apply()) queueMicrotask(() => apply() || requestAnimationFrame(apply));
}

/** Scroll the expression row holding `el` (any of its fields) into view, if it isn't already. */
export function revealRow(el: Element | null): void {
  const row = el?.closest('.expr-row');
  if (row) row.scrollIntoView({ block: 'nearest' });
}
