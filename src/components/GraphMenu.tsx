import { createEffect, createSignal, onCleanup, Show } from 'solid-js';
import { clearRows, doc, isBlank } from '../state/doc';
import { focusRow } from '../state/focus';
import { offerUndo } from '../state/historyUi';
import { isCoarsePointer } from '../state/keypad';
import { ui } from '../state/ui';

/** The header's ⋯ menu: a menu button with document-level actions. */
export function GraphMenu() {
  const [open, setOpen] = createSignal(false);
  let button!: HTMLButtonElement;
  let menu: HTMLDivElement | undefined;

  const items = () => [...(menu?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
  /** Close; focus goes back to the button unless the user clicked somewhere else. */
  const close = (refocus = true) => {
    setOpen(false);
    if (refocus) button.focus();
  };

  createEffect(() => {
    if (!open()) return;
    items()[0]?.focus();
    const away = (e: PointerEvent) => {
      const target = e.target as Node;
      if (!menu?.contains(target) && !button.contains(target)) close(false);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      close();
    };
    document.addEventListener('pointerdown', away, true);
    document.addEventListener('keydown', esc);
    onCleanup(() => {
      document.removeEventListener('pointerdown', away, true);
      document.removeEventListener('keydown', esc);
    });
  });

  const onMenuKeyDown = (e: KeyboardEvent) => {
    const list = items();
    const i = list.indexOf(document.activeElement as HTMLElement);
    const step = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0;
    if (step) {
      e.preventDefault();
      list[(i + step + list.length) % list.length]?.focus();
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      (e.key === 'Home' ? list[0] : list[list.length - 1])?.focus();
    } else if (e.key === 'Tab') {
      close(false);
    }
  };

  /**
   * Start over, at the home view (undoable, and the toast's Undo is the way back on a phone; the
   * view stays home). With a keyboard the caret goes to the new empty row, ready to type; on touch
   * focus stays on ⋯, so no keypad or keyboard pops up.
   */
  const newGraph = () => {
    if (isBlank()) return;
    clearRows();
    ui.requestHome();
    close(isCoarsePointer);
    if (!isCoarsePointer) focusRow(doc.rows[0].id, 'end');
    offerUndo('Graph cleared');
  };

  return (
    <div class="menu-anchor">
      <button
        type="button"
        class="icon-button"
        aria-label="More options"
        aria-haspopup="menu"
        aria-expanded={open()}
        aria-controls={open() ? 'graph-menu' : undefined}
        data-testid="graph-menu-button"
        ref={button}
        onClick={() => (open() ? close() : setOpen(true))}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' && !open()) {
            e.preventDefault();
            setOpen(true);
          }
        }}
      >
        ⋯
      </button>
      <Show when={open()}>
        <div
          class="menu"
          id="graph-menu"
          role="menu"
          aria-label="Graph"
          ref={menu}
          onKeyDown={onMenuKeyDown}
        >
          <button
            type="button"
            class="menu-item"
            role="menuitem"
            tabindex="-1"
            aria-disabled={isBlank()}
            onClick={newGraph}
          >
            New graph
          </button>
        </div>
      </Show>
    </div>
  );
}
