import { For, onCleanup, onMount } from 'solid-js';
import { PALETTE_NAMES } from '../state/colors';

export function ColorPicker(props: {
  palette: readonly string[];
  selected: number;
  onPick: (index: number) => void;
  onClose: () => void;
}) {
  let el!: HTMLFieldSetElement;
  onMount(() => {
    const away = (e: PointerEvent) => {
      if (!el.contains(e.target as Node)) props.onClose();
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && props.onClose();
    document.addEventListener('pointerdown', away, true);
    document.addEventListener('keydown', esc);
    onCleanup(() => {
      document.removeEventListener('pointerdown', away, true);
      document.removeEventListener('keydown', esc);
    });
    (el.querySelector('[aria-pressed="true"]') as HTMLElement | null)?.focus();
  });
  return (
    <fieldset class="color-picker" ref={el}>
      <legend class="visually-hidden">Curve color</legend>
      <For each={props.palette}>
        {(color, i) => (
          <button
            type="button"
            class="color-choice"
            aria-pressed={i() === props.selected}
            aria-label={PALETTE_NAMES[i()]}
            style={{ '--swatch': color }}
            onClick={() => {
              props.onPick(i());
              props.onClose();
            }}
          />
        )}
      </For>
    </fieldset>
  );
}
