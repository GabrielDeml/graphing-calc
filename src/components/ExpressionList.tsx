import { For, onMount } from 'solid-js';
import { doc } from '../state/doc';
import { palette } from '../state/theme';
import { ExpressionRow } from './ExpressionRow';
import { armRowMotion } from './rowMotion';

export function ExpressionList() {
  // The rows it opens with just show; those added or removed later come and go smoothly.
  onMount(armRowMotion);
  return (
    <ol class="expr-list" aria-label="Expressions">
      <For each={doc.rows}>
        {(row, i) => <ExpressionRow row={row} index={i()} palette={palette()} />}
      </For>
    </ol>
  );
}
