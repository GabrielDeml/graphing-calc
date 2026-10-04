import { For, onCleanup, onMount } from 'solid-js';
import { PALETTE_NAMES } from '../state/colors';

export function ColorPicker(props: {
  palette: readonly string[];
  selected: number;
  /** The toggle button: its own clicks open and close the picker, so they don't count as "away". */
  anchor?: HTMLElement;
  onPick: (index: number) => void;
  onClose: () => void;
}) {
  let el!: HTMLFieldSetElement;
  /** Close; when focus is inside the picker it goes back to the toggle instead of <body>. */
  const close = () => {
    if (el.contains(document.activeElement)) props.anchor?.focus();
    props.onClose();
  };
  onMount(() => {
    const away = (e: PointerEvent) => {
      const target = e.target as Node;
      if (!el.contains(target) && !props.anchor?.contains(target)) props.onClose();
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && close();
    document.addEventListener('pointerdown', away, true);
    document.addEventListener('keydown', esc);
    onCleanup(() => {
      document.removeEventListener('pointerdown', away, true);
      document.removeEventListener('keydown', esc);
    });
    // Rows near the bottom of the list would otherwise have the picker cut off by the scroller.
    el.scrollIntoView({ block: 'nearest' });
    (el.querySelector('[aria-pressed="true"]') as HTMLElement | null)?.focus({
      preventScroll: true,
    });
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
              close();
            }}
          />
        )}
      </For>
    </fieldset>
  );
}
