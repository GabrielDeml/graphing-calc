import { For, onCleanup, onMount } from 'solid-js';
import { PALETTE_NAMES } from '../state/colors';

export function ColorPicker(props: {
  palette: readonly string[];
  selected: number;
  onPick: (index: number) => void;
  onClose: () => void;
}) {
  let el!: HTMLDivElement;
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
    (el.querySelector('[aria-checked="true"]') as HTMLElement | null)?.focus();
  });
  return (
    <div class="color-picker" role="radiogroup" aria-label="Curve color" ref={el}>
      <For each={props.palette}>
        {(color, i) => (
          <button
            type="button"
            role="radio"
            class="color-choice"
            aria-checked={i() === props.selected}
            aria-label={PALETTE_NAMES[i()]}
            style={{ '--swatch': color }}
            onClick={() => {
              props.onPick(i());
              props.onClose();
            }}
          />
        )}
      </For>
    </div>
  );
}
