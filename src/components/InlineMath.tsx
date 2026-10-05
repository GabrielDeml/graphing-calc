import { For } from 'solid-js';
import { inlineMath } from '../mathedit';

/**
 * Short math set in a line of UI text (a fix chip's `x²`, a row named by an insight): italic
 * letters, upright names, raised exponents (src/mathedit/inline.ts).
 */
export function InlineMath(props: { text: string }) {
  return (
    <span class="inline-math">
      <For each={inlineMath(props.text)}>
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
