import { redo, revision, undo } from './doc';
import { revealRow, rowInput } from './focus';
import { historyShortcut } from './history';
import { isCoarsePointer } from './keypad';
import { toast } from './toast';
import { ui } from './ui';

/**
 * Undo or redo, and show where. The caret goes back to the row the change was made in; a change
 * made outside the rows (×, New graph, a color) is scrolled into view instead, and selected when
 * no row has focus, without focusing it, so no keyboard pops up on a phone. `focusChanged`: see
 * undo().
 */
export function runHistory(command: 'undo' | 'redo', focusChanged = false): boolean {
  const restored = command === 'undo' ? undo(focusChanged) : redo();
  if (!restored) return false;
  const { focused, changed } = restored;
  if (changed !== null && changed !== focused) {
    if (focused === null) ui.setSelectedRowId(changed);
    revealRow(rowInput(changed) ?? null);
  }
  return true;
}

/**
 * A toast with an Undo button for the change just made, the way to undo on touch screens. It goes
 * away once anything else changes, so it never undoes something other than what it names.
 */
export function offerUndo(message: string): void {
  const at = revision();
  toast.show({
    message,
    action: {
      label: 'Undo',
      // When the button had focus (keyboard, or a click in most desktop browsers), the caret
      // goes to what came back rather than being lost with the toast. A tap leaves focus be,
      // so no keyboard pops up.
      run: (hadFocus) => runHistory('undo', hadFocus && !isCoarsePointer),
    },
    stale: () => revision() !== at,
  });
}

/**
 * Undo and redo for the whole document, from anywhere on the page: Mod+Z, Mod+Shift+Z and Ctrl+Y
 * (capture phase, ahead of the inputs' own text undo), and the browser's undo commands (Edit
 * menu, context menu, shake to undo), which arrive as beforeinput historyUndo/historyRedo.
 */
export function attachHistoryKeys(target: Document): () => void {
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.isComposing) return;
    const command = historyShortcut(e);
    if (!command) return;
    e.preventDefault();
    runHistory(command);
  };
  const onBeforeInput = (e: InputEvent) => {
    if (e.inputType !== 'historyUndo' && e.inputType !== 'historyRedo') return;
    e.preventDefault();
    runHistory(e.inputType === 'historyUndo' ? 'undo' : 'redo');
  };
  target.addEventListener('keydown', onKeyDown, true);
  target.addEventListener('beforeinput', onBeforeInput, true);
  return () => {
    target.removeEventListener('keydown', onKeyDown, true);
    target.removeEventListener('beforeinput', onBeforeInput, true);
  };
}
