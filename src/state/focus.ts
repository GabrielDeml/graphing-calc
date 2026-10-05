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
}

const carets = new WeakMap<HTMLInputElement, RowCaret>();

export function registerRowCaret(el: HTMLInputElement, caret: RowCaret): () => void {
  carets.set(el, caret);
  return () => {
    if (carets.get(el) === caret) carets.delete(el);
  };
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
 * offset (and a depth, in a typeset row; else the shallowest place there).
 */
export function focusRow(
  id: string,
  caret: 'start' | 'end' | number = 'end',
  depth?: number,
): void {
  const apply = () => {
    const el = inputs.get(id);
    if (!el) return false;
    el.focus({ preventScroll: true });
    const len = el.value.length;
    const pos = caret === 'start' ? 0 : caret === 'end' ? len : Math.min(caret, len);
    el.setSelectionRange(pos, pos);
    if (depth !== undefined) carets.get(el)?.set(depth);
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
