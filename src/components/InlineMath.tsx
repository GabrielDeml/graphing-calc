import { For } from 'solid-js';
import type { NameContext } from '../engine';
import { type InlinePiece, inlineMath } from '../mathedit';

/**
 * Short math set in a line of UI text (a fix chip's `x²`, a row named by an insight): italic
 * letters, upright names, raised exponents (src/mathedit/inline.ts). `max`: past this many
 * characters it ends in an ellipsis (a long row named in an insight's line). `names`: the
 * document's, for a row's math, so it reads as it does in the row (`asin` as a·sin with a slider
 * a).
 */
export function InlineMath(props: { text: string; max?: number; names?: NameContext }) {
  const pieces = (): InlinePiece[] => {
    const all = inlineMath(props.text, props.names);
    const max = props.max;
    if (max === undefined) return all;
    let length = 0;
    for (let i = 0; i < all.length; i++) {
      length += all[i].text.length;
      if (length > max) return [...all.slice(0, i), { text: '…', role: 'punct' }];
    }
    return all;
  };
  return (
    <span class="inline-math">
      <For each={pieces()}>
        {(piece) => (
          <span
            class={`m-a qm-${piece.role}`}
            classList={{
              'm-var': piece.role === 'var',
              'qm-sup': piece.script === 'sup',
              'qm-sub': piece.script === 'sub',
            }}
          >
            {piece.text}
          </span>
        )}
      </For>
    </span>
  );
}
