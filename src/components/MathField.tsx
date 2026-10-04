import { createMemo, onCleanup, Show } from 'solid-js';
import type { Span } from '../engine/types';
import { type EditTarget, keypad } from '../state/keypad';

/** ↵ handler for small fields: finish editing. */
export function blurActive(): void {
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
}

export interface MathFieldProps {
  value: string;
  onChange: (text: string) => void;
  onEnter: () => void;
  /** Keypad ⌫ on an empty field (expression rows delete themselves). */
  onDeleteEmpty?: () => void;
  onKeyDown?: (e: KeyboardEvent & { currentTarget: HTMLInputElement }) => void;
  onFocus?: () => void;
  onBlur?: () => void;
  ref?: (el: HTMLInputElement) => void;
  /** Draw a wavy underline under this span (error location). */
  errorSpan?: Span | null;
  ariaLabel: string;
  placeholder?: string;
  class?: string;
  testId?: string;
}

/**
 * A plain-text math input that cooperates with the on-screen keypad: while keypad mode is on it
 * sets inputmode="none" so the device keyboard stays hidden, yet remains a real focused <input>
 * (caret, selection, paste and hardware keyboards keep working).
 */
export function MathField(props: MathFieldProps) {
  let input!: HTMLInputElement;
  let mirror: HTMLDivElement | undefined;

  const target: EditTarget = {
    get el() {
      return input;
    },
    commit: (text) => props.onChange(text),
    enter: () => props.onEnter(),
    deleteEmpty: () => props.onDeleteEmpty?.(),
  };

  const syncMirror = () => {
    if (mirror) mirror.scrollLeft = input.scrollLeft;
  };

  const underline = createMemo(() => {
    const span = props.errorSpan;
    if (!span) return null;
    const text = props.value;
    const start = Math.max(0, Math.min(span.start, text.length));
    const end = Math.max(start, Math.min(span.end, text.length));
    // Zero-width spans (e.g. "expected expression" at the end) still get a visible mark.
    return {
      before: text.slice(0, start),
      mid: end > start ? text.slice(start, end) : ' ',
      after: text.slice(end),
    };
  });

  const openKeypad = () => {
    if (keypad.enabled() && keypad.nativeEl() !== input) keypad.setOpen(true);
  };

  onCleanup(() => {
    if (keypad.target()?.el === input) keypad.setTarget(null);
    if (keypad.nativeEl() === input) keypad.setNativeEl(null);
  });

  return (
    <div class={`math-field ${props.class ?? ''}`}>
      <Show when={underline()}>
        {(u) => (
          <div class="math-mirror" aria-hidden="true" ref={mirror}>
            {u().before}
            <span class="math-mirror-error">{u().mid}</span>
            {u().after}
          </div>
        )}
      </Show>
      <input
        ref={(el) => {
          input = el;
          props.ref?.(el);
        }}
        class="math-input"
        type="text"
        value={props.value}
        inputmode={keypad.suppressNative(input) ? 'none' : 'text'}
        enterkeyhint="enter"
        autocomplete="off"
        autocapitalize="off"
        spellcheck={false}
        aria-label={props.ariaLabel}
        aria-invalid={props.errorSpan ? 'true' : undefined}
        placeholder={props.placeholder}
        data-testid={props.testId}
        onInput={(e) => {
          props.onChange(e.currentTarget.value);
          syncMirror();
        }}
        onScroll={syncMirror}
        onKeyUp={syncMirror}
        onKeyDown={(e) => props.onKeyDown?.(e)}
        onFocus={() => {
          keypad.setTarget(target);
          openKeypad();
          props.onFocus?.();
        }}
        onBlur={() => {
          if (keypad.nativeEl() === input) keypad.setNativeEl(null);
          props.onBlur?.();
        }}
        onClick={openKeypad}
      />
    </div>
  );
}
