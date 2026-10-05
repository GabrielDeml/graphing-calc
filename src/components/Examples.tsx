import { For, Show } from 'solid-js';
import { doc, isBlank } from '../state/doc';
import { focusedRow } from '../state/focus';
import { isCoarsePointer, keypad } from '../state/keypad';
import { fillExample } from '../state/rowActions';
import { InlineMath } from './InlineMath';

/** What each example puts in the first row, and how its button reads it out. */
const EXAMPLES: ReadonlyArray<{ source: string; name: string }> = [
  { source: 'y = x^2', name: 'y = x²' },
  { source: 'x^2 + y^2 = 9', name: 'x² + y² = 9' },
  { source: 'r = 1 + cos θ', name: 'r = 1 + cos θ' },
];

/**
 * First run (and a new graph): while the list is its one empty row, three examples sit under it,
 * typeset. A tap puts one in the first row and graphs it, as one undo step; they go as soon as
 * there is any math (and stay away while a row is emptied to retype it). In the list's own flow,
 * never over the graph.
 */
export function Examples() {
  /** The kind of pointer pressing an example (null: none, so the keyboard or a screen reader). */
  let pressedWith: string | null = null;
  /**
   * Whether the caret goes into the filled row: from the keyboard (the example had focus), or a
   * mouse at a desk, as on first run. Never from a touch, which would bring up a keypad or the
   * device's keyboard uninvited (a row being edited keeps the caret anyway, see fillExample).
   */
  const focusAfter = (via: string | null) =>
    via === null || (via === 'mouse' && !isCoarsePointer && !keypad.enabled());
  return (
    <Show when={doc.rows.length === 1 && isBlank()}>
      <div class="examples">
        <span class="examples-label">Examples</span>
        <For each={EXAMPLES}>
          {(example) => (
            <button
              type="button"
              class="example-chip"
              aria-label={`Graph ${example.name}`}
              onPointerDown={(e) => {
                pressedWith = e.pointerType;
              }}
              onPointerCancel={() => {
                pressedWith = null;
              }}
              onKeyDown={() => {
                pressedWith = null;
              }}
              // A row being edited keeps its focus (and the caret goes to the example's end).
              onMouseDown={(e) => {
                if (focusedRow() !== null) e.preventDefault();
              }}
              onClick={() => {
                const via = pressedWith;
                pressedWith = null;
                fillExample(example.source, focusAfter(via));
              }}
            >
              <InlineMath text={example.source} />
            </button>
          )}
        </For>
      </div>
    </Show>
  );
}
