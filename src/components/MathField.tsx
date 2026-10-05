import { createEffect, createMemo, createSignal, on, onCleanup, Show } from 'solid-js';
import type { Span } from '../engine/types';
import type { Names } from '../mathedit';
import { type EditTarget, keypad } from '../state/keypad';
import { MathView, type MathViewHandle } from './MathView';

/**
 * ↵ handler for small fields (slider bounds, t/θ ranges): finish editing. The keypad closes too,
 * so it is not left bound to a field that no longer has focus (the slider step field is even
 * hidden once its row loses focus).
 */
export function blurActive(): void {
  const el = document.activeElement;
  if (el instanceof HTMLElement) el.blur();
  if (keypad.target()?.el === el) keypad.setTarget(null);
  keypad.setOpen(false);
}

let measureCtx: CanvasRenderingContext2D | null | undefined;

/** Width of some text in a field's font (its computed style); null without a canvas. */
function textWidth(style: CSSStyleDeclaration, text: string): number | null {
  if (measureCtx === undefined) measureCtx = document.createElement('canvas').getContext('2d');
  if (!measureCtx) return null;
  measureCtx.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
  return measureCtx.measureText(text).width;
}

/**
 * Scroll a text input so its caret is visible. Browsers do this for typing, but not for a
 * selection set from script (keypad edits and arrows), so long expressions would hide the caret.
 */
export function revealCaret(el: HTMLInputElement): void {
  if (el.scrollWidth <= el.clientWidth) return;
  const style = getComputedStyle(el);
  const pad = Number.parseFloat(style.paddingLeft) || 0;
  const caret = el.selectionDirection === 'backward' ? el.selectionStart : el.selectionEnd;
  const width = textWidth(style, el.value.slice(0, caret ?? el.value.length));
  if (width === null) return;
  const x = pad + width;
  const margin = Math.min(24, el.clientWidth / 4);
  if (x - margin < el.scrollLeft) el.scrollLeft = Math.max(0, x - margin);
  else if (x + margin > el.scrollLeft + el.clientWidth) el.scrollLeft = x + margin - el.clientWidth;
}

/**
 * Where a left-aligned input's text ends on screen (client x), within the field's box: the
 * typeset math's end while that is what shows.
 */
export function textEndX(el: HTMLInputElement): number {
  const field = el.parentElement;
  const math =
    field?.classList.contains('typeset') && document.activeElement !== el
      ? field.querySelector('.math-view > *')
      : null;
  if (math?.parentElement) {
    return Math.min(
      math.getBoundingClientRect().right,
      math.parentElement.getBoundingClientRect().right,
    );
  }
  const rect = el.getBoundingClientRect();
  const style = getComputedStyle(el);
  const width = textWidth(style, el.value);
  const end = rect.right - (Number.parseFloat(style.paddingRight) || 0);
  if (width === null) return end;
  return Math.min(
    end,
    rect.left + (Number.parseFloat(style.paddingLeft) || 0) + width - el.scrollLeft,
  );
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
  /** Marks the field invalid without an underline (e.g. a bound that doesn't evaluate). */
  invalid?: boolean;
  ariaLabel: string;
  placeholder?: string;
  class?: string;
  testId?: string;
  /**
   * Typeset the math, grouping letters with these names, while the field isn't focused
   * (expression rows). The input then lies over the typeset view, invisible, and still takes
   * every click and key; focused, it shows and edits the plain text.
   */
  names?: Names;
}

/**
 * A plain-text math input that cooperates with the on-screen keypad: while keypad mode is on it
 * sets inputmode="none" so the device keyboard stays hidden, yet remains a real focused <input>
 * (caret, selection, paste and hardware keyboards keep working).
 */
export function MathField(props: MathFieldProps) {
  let input!: HTMLInputElement;
  let mirror: HTMLDivElement | undefined;
  let view: MathViewHandle | undefined;
  const [focused, setFocused] = createSignal(false);
  /** Where a click on the typeset math puts the caret, once the click has focused the input. */
  let pendingCaret: number | null = null;

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

  // The mirror mounts when an error appears (after the typing pause), so it must pick up the
  // input's current scroll then, not only on the next scroll or key.
  createEffect(on(underline, syncMirror));

  const openKeypad = () => {
    if (keypad.enabled() && keypad.nativeEl() !== input) keypad.setOpen(true);
  };

  /**
   * A click on the typeset math lands on the invisible input, whose own text is laid out
   * differently: the browser puts the caret by that. Once the click has focused the field, the
   * caret goes where the clicked symbol is in the text instead: on the click, or in the task
   * after the focus (a tap's click can land elsewhere once the keypad opens and moves the list).
   * Only after a press on the typeset math, and only over a collapsed caret: Playwright's fill()
   * selects everything, then focuses.
   */
  const placeCaret = () => {
    const at = pendingCaret;
    pendingCaret = null;
    if (at === null || input.selectionStart !== input.selectionEnd) return;
    input.setSelectionRange(at, at);
    revealCaret(input);
  };

  onCleanup(() => {
    if (keypad.target()?.el === input) keypad.setTarget(null);
    if (keypad.nativeEl() === input) keypad.setNativeEl(null);
  });

  return (
    <div class={`math-field ${props.class ?? ''}`} classList={{ typeset: !!props.names }}>
      <Show when={props.names}>
        {(names) => (
          <MathView
            source={props.value}
            names={names()}
            errorSpan={props.errorSpan ?? null}
            placeholder={props.placeholder}
            frozen={focused()}
            ref={(handle) => {
              view = handle;
            }}
          />
        )}
      </Show>
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
        aria-invalid={props.errorSpan || props.invalid ? 'true' : undefined}
        placeholder={props.placeholder}
        data-testid={props.testId}
        onInput={(e) => {
          props.onChange(e.currentTarget.value);
          syncMirror();
        }}
        onScroll={syncMirror}
        onKeyUp={syncMirror}
        onKeyDown={(e) => {
          if (props.onKeyDown) props.onKeyDown(e);
          else if (e.key === 'Enter') {
            e.preventDefault();
            props.onEnter();
          } else if (e.key === 'Escape') e.currentTarget.blur();
        }}
        onFocus={() => {
          setFocused(true);
          if (pendingCaret !== null) setTimeout(placeCaret, 0);
          keypad.setTarget(target);
          openKeypad();
          props.onFocus?.();
        }}
        onBlur={() => {
          setFocused(false);
          pendingCaret = null;
          if (keypad.nativeEl() === input) keypad.setNativeEl(null);
          props.onBlur?.();
        }}
        onPointerDown={(e) => {
          pendingCaret =
            view && e.button === 0 && document.activeElement !== input
              ? view.offsetAt(e.clientX, e.clientY)
              : null;
        }}
        onPointerCancel={() => {
          pendingCaret = null;
        }}
        onClick={() => {
          placeCaret();
          openKeypad();
        }}
      />
    </div>
  );
}
