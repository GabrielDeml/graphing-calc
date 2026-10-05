import { For, Show } from 'solid-js';
import { isBlank } from '../state/doc';
import { focusedRow } from '../state/focus';
import { fillExample } from '../state/rowActions';
import { InlineMath } from './InlineMath';

/** What each example puts in the first row, and how its button reads it out. */
const EXAMPLES: ReadonlyArray<{ source: string; name: string }> = [
  { source: 'y = x^2', name: 'y = x²' },
  { source: 'x^2 + y^2 = 9', name: 'x² + y² = 9' },
  { source: 'r = 1 + cos θ', name: 'r = 1 + cos θ' },
];

/**
 * First run (and a new graph): while the list is blank, three examples sit under it, typeset. A
 * tap puts one in the first row and graphs it, as one undo step; they go as soon as there is
 * any math. In the list's own flow, never over the graph.
 */
export function Examples() {
  return (
    <Show when={isBlank()}>
      <div class="examples">
        <span class="examples-label">Examples</span>
        <For each={EXAMPLES}>
          {(example) => (
            <button
              type="button"
              class="example-chip"
              aria-label={`Graph ${example.name}`}
              // A row being edited keeps its focus (and the caret goes to the example's end).
              onMouseDown={(e) => {
                if (focusedRow() !== null) e.preventDefault();
              }}
              onClick={(e) => fillExample(example.source, e.detail === 0)}
            >
              <InlineMath text={example.source} />
            </button>
          )}
        </For>
      </div>
    </Show>
  );
}
