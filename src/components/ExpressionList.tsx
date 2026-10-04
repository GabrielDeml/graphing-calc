import { For } from 'solid-js';
import { doc } from '../state/doc';
import { palette } from '../state/theme';
import { ExpressionRow } from './ExpressionRow';

export function ExpressionList() {
  return (
    <ol class="expr-list" aria-label="Expressions">
      <For each={doc.rows}>
        {(row, i) => <ExpressionRow row={row} index={i()} palette={palette()} />}
      </For>
    </ol>
  );
}
