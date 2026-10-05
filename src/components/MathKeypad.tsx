import { createEffect, createSignal, For, on, onCleanup, onMount } from 'solid-js';
import { applyEdit, type EditOp } from '../keypad/editing';
import { getPage, type KeyAction, type KeyDef, PAGE_ORDER, type PageId } from '../keypad/layouts';
import { canUndo, doc } from '../state/doc';
import { focusRow, revealRow } from '../state/focus';
import { offerRedo, runHistory } from '../state/historyUi';
import { type EditTarget, keypad } from '../state/keypad';
import { DUR_2, DUR_3, EASE_OUT, reducedMotion } from '../state/motion';
import { Icon } from './icons';
import { revealCaret } from './MathField';

const REPEAT_DELAY_MS = 400;
const REPEAT_EVERY_MS = 60;

const PAGE_LABELS: Record<PageId, string> = { '123': '123', fx: 'f(x)', abc: 'ABC' };

/**
 * The keypad button a pointer last pressed, until the click that ends the press (see the
 * keypad's own handlers). Keys, tabs and Undo act on the press, Hide on its click. A click acts
 * on no button but the one pressed: a tap while the sheet slides up can press one button and
 * click whichever slid under the finger meanwhile. A click with no press before it comes from
 * the keyboard or a screen reader, and acts.
 */
let pressed: Element | null = null;

/**
 * Where a click on `el` comes from: the keyboard or a screen reader, a press on `el` itself, or
 * a press on another button (a stray).
 */
function clickOn(el: Element): 'keyboard' | 'press' | 'stray' {
  const from = pressed;
  pressed = null;
  return from === null ? 'keyboard' : from === el ? 'press' : 'stray';
}

/** The field keys should act on; falls back to the last (empty) expression row. */
function currentTarget(): EditTarget | null {
  const t = keypad.target();
  if (t?.el.isConnected) return t;
  const last = doc.rows[doc.rows.length - 1];
  if (last) focusRow(last.id, 'end');
  const next = keypad.target();
  return next?.el.isConnected ? next : null;
}

/**
 * Apply one edit to the current field. Returns false when an auto-repeating key should stop:
 * a repeated ⌫ never deletes an emptied row (only a fresh press does), and nothing is edited in
 * a field that can no longer take focus.
 */
function runEdit(op: EditOp, repeated: boolean): boolean {
  const t = currentTarget();
  if (!t) return false;
  const el = t.el;
  if (document.activeElement !== el) {
    el.focus({ preventScroll: true });
    // A hidden (e.g. slider step after its row blurred) or disabled field: drop it, edit nothing.
    if (document.activeElement !== el) {
      keypad.setTarget(null);
      return false;
    }
  }
  if (op.type === 'backspace' && el.value === '') {
    if (repeated) return false;
    t.deleteEmpty?.();
    return true;
  }
  // A row edited in its typeset form makes the edit by its own rules (and keeps its caret in
  // view itself).
  if (t.apply) {
    t.apply(op, repeated);
    revealRow(el);
    return true;
  }
  const len = el.value.length;
  const next = applyEdit(
    { text: el.value, selStart: el.selectionStart ?? len, selEnd: el.selectionEnd ?? len },
    op,
  );
  if (next.text !== el.value) {
    // Set the DOM value first so the caret can be placed before Solid re-renders.
    el.value = next.text;
    t.commit(next.text);
  }
  el.setSelectionRange(next.selStart, next.selEnd);
  revealCaret(el);
  revealRow(el);
  return true;
}

function runAction(action: KeyAction, repeated = false): boolean {
  switch (action.type) {
    case 'edit':
      if (!runEdit(action.op, repeated)) return false;
      if (keypad.shift() && action.op.type === 'insert') keypad.setShift(false);
      break;
    case 'enter':
      currentTarget()?.enter();
      break;
    case 'page':
      keypad.setPage(action.page);
      break;
    case 'shift':
      keypad.setShift((s) => !s);
      break;
    case 'hide':
      keypad.setOpen(false);
      break;
    case 'native':
      // Handled on click: iOS only opens its keyboard from focus() inside a user gesture.
      break;
  }
  return true;
}

/** ⌨ key: let this field use the device keyboard until it loses focus. */
function useNativeKeyboard(): void {
  const t = currentTarget();
  if (!t) return;
  // Blur first: MathField's blur handler ends native mode, so the flag must be set after it.
  // Solid applies inputmode="text" synchronously, before the focus() that opens the keyboard.
  t.el.blur();
  keypad.setNativeEl(t.el);
  keypad.setOpen(false);
  t.el.focus();
}

function Key(props: { def: KeyDef }) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  /** Held down: the key sinks a little (:active alone misses touches, whose press is prevented). */
  const [down, setDown] = createSignal(false);
  const stop = () => {
    clearTimeout(timer);
    timer = undefined;
    setDown(false);
  };
  onCleanup(stop);

  let el!: HTMLButtonElement;

  return (
    <button
      type="button"
      ref={el}
      class={`key key-${props.def.variant}`}
      classList={{ wide: (props.def.span ?? 1) > 1, down: down() }}
      style={{ 'grid-column': `span ${props.def.span ?? 1}` }}
      aria-label={props.def.ariaLabel}
      data-testid={`key-${props.def.id}`}
      onPointerDown={(e) => {
        // Keep focus (and the caret) in the field being edited.
        e.preventDefault();
        if (e.button !== 0) return;
        stop();
        setDown(true);
        if (!runAction(props.def.action) || !props.def.repeat) return;
        const repeat = () => {
          if (runAction(props.def.action, true)) timer = setTimeout(repeat, REPEAT_EVERY_MS);
          else stop();
        };
        timer = setTimeout(repeat, REPEAT_DELAY_MS);
      }}
      onPointerUp={stop}
      onPointerLeave={stop}
      onPointerCancel={stop}
      onClick={() => {
        const from = clickOn(el);
        if (from === 'stray') return;
        if (props.def.action.type === 'native') useNativeKeyboard();
        // Keyboard or assistive-technology activation: a click without a pointer press. (Not
        // `detail === 0`: Chromium also reports 0 for the click ending a long touch press.)
        else if (from === 'keyboard') runAction(props.def.action);
      }}
    >
      {props.def.icon ? <Icon name={props.def.icon} size={20} /> : props.def.label}
    </button>
  );
}

/** A page tab: acts on the press, like the keys. */
function PageTab(props: { id: PageId }) {
  let el!: HTMLButtonElement;
  return (
    <button
      type="button"
      ref={el}
      role="tab"
      class="keypad-tab"
      aria-selected={keypad.page() === props.id}
      data-testid={`keypad-tab-${props.id}`}
      onPointerDown={(e) => {
        e.preventDefault();
        if (e.button === 0) keypad.setPage(props.id);
      }}
      onClick={() => {
        if (clickOn(el) === 'keyboard') keypad.setPage(props.id);
      }}
    >
      {PAGE_LABELS[props.id]}
    </button>
  );
}

/** Undo one step; then, with no redo key on a phone, a toast offers the step back. */
function keypadUndo(): void {
  if (canUndo() && runHistory('undo')) offerRedo();
}

/**
 * The keypad's Undo: on a phone, with no undo key, the way back from a slip. It acts on the
 * press, like the keys. Dimmed with nothing to undo; it stays focusable and pressable
 * (aria-disabled), so a press never takes the focus from the field being edited.
 */
function UndoKey() {
  let el!: HTMLButtonElement;
  return (
    <button
      type="button"
      ref={el}
      class="keypad-tool"
      aria-label="Undo"
      aria-disabled={!canUndo()}
      data-testid="keypad-undo"
      onPointerDown={(e) => {
        e.preventDefault();
        if (e.button === 0) keypadUndo();
      }}
      onClick={() => {
        if (clickOn(el) === 'keyboard') keypadUndo();
      }}
    >
      <Icon name="undo" size={20} />
    </button>
  );
}

/**
 * The keypad sheet: the page tabs (a segmented control), Undo and Hide in a bar over the keys.
 * `leaving`: it slides away (App keeps it a moment once hidden), out of the layout, inert.
 */
export function MathKeypad(props: { leaving?: boolean }) {
  const page = () => getPage(keypad.page(), keypad.shift());
  let sheet!: HTMLElement;
  let hide!: HTMLButtonElement;

  /**
   * The sheet's slide (WAAPI: the CSP forbids style attributes): up into place as it shows, down
   * out of sight as it leaves, each from wherever it is (`from`, px down; where the running slide
   * has it by default), so shown again while it goes, it turns back instead of starting over.
   */
  let slide: Animation | undefined;
  const slideTo = (leaving: boolean, from?: number) => {
    const at = from ?? new DOMMatrixReadOnly(getComputedStyle(sheet).transform).m42;
    slide?.cancel();
    slide = undefined;
    const height = sheet.offsetHeight;
    if (reducedMotion() || typeof sheet.animate !== 'function' || !(height > 0)) return;
    slide = sheet.animate(
      [
        { transform: `translateY(${at}px)` },
        { transform: `translateY(${leaving ? height : 0}px)` },
      ],
      // Gone, it stays out of sight until App takes it away.
      { duration: leaving ? DUR_2 : DUR_3, easing: EASE_OUT, fill: leaving ? 'forwards' : 'none' },
    );
  };
  onMount(() => slideTo(false, sheet.offsetHeight));
  createEffect(
    on(
      () => !!props.leaving,
      (leaving) => slideTo(leaving),
      { defer: true },
    ),
  );
  onCleanup(() => slide?.cancel());

  return (
    <section
      ref={sheet}
      class="keypad"
      classList={{ leaving: props.leaving }}
      aria-label="Math keypad"
      aria-hidden={props.leaving || undefined}
      inert={props.leaving || undefined}
      data-testid="keypad"
      // Which button a press is on, for the click that ends it (see `pressed`). A mouse's click
      // comes right after its release, in the same task; a touch's may never come.
      onPointerDown={(e) => {
        if (e.button === 0) pressed = (e.target as Element).closest('button');
      }}
      onPointerUp={(e) => {
        if (e.pointerType === 'mouse') setTimeout(() => (pressed = null));
      }}
      onPointerCancel={() => {
        pressed = null;
      }}
      onKeyDown={() => {
        pressed = null;
      }}
    >
      <div class="keypad-bar">
        <div class="keypad-tabs" role="tablist" aria-label="Keypad pages">
          <For each={PAGE_ORDER}>{(id) => <PageTab id={id} />}</For>
        </div>
        <UndoKey />
        <button
          type="button"
          ref={hide}
          class="keypad-tool keypad-hide"
          aria-label="Hide keypad"
          data-testid="keypad-hide"
          onPointerDown={(e) => e.preventDefault()}
          // On the click: hidden on the press, the sheet would let the click through to what is
          // under it.
          onClick={() => {
            if (clickOn(hide) !== 'stray') keypad.setOpen(false);
          }}
        >
          <Icon name="chevron-down" size={20} />
        </button>
      </div>
      <div class="keypad-grid" style={{ '--cols': String(page().columns) }}>
        <For each={page().rows.flat()}>{(def) => <Key def={def} />}</For>
      </div>
    </section>
  );
}
