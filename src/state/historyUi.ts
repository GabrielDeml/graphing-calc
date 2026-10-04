import { redo, revision, undo } from './doc';
import { revealRow, rowInput } from './focus';
import { historyShortcut } from './history';
import { toast } from './toast';
import { ui } from './ui';

/**
 * Undo or redo, and show where. The caret goes back to the row the change was made in; a change
 * made outside the rows (×, New graph, a color) selects the first row it changed and scrolls it
 * into view instead, without focusing it, so no keyboard pops up on a phone.
 */
export function runHistory(command: 'undo' | 'redo'): boolean {
  const restored = command === 'undo' ? undo() : redo();
  if (!restored) return false;
  const id = restored.rowId;
  if (id !== null && !restored.focused) {
    ui.setSelectedRowId(id);
    revealRow(rowInput(id) ?? null);
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
    action: { label: 'Undo', run: () => runHistory('undo') },
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
