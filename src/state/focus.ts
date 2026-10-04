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

/** Focus a row's input once it exists (it may have just been inserted). */
export function focusRow(id: string, caret: 'start' | 'end' | number = 'end'): void {
  const apply = () => {
    const el = inputs.get(id);
    if (!el) return false;
    el.focus({ preventScroll: true });
    const len = el.value.length;
    const pos = caret === 'start' ? 0 : caret === 'end' ? len : Math.min(caret, len);
    el.setSelectionRange(pos, pos);
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
