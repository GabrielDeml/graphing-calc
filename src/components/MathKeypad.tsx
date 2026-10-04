import { For, onCleanup } from 'solid-js';
import { applyEdit, type EditOp } from '../keypad/editing';
import { getPage, type KeyAction, type KeyDef, PAGE_ORDER, type PageId } from '../keypad/layouts';
import { doc } from '../state/doc';
import { focusRow, revealRow } from '../state/focus';
import { type EditTarget, keypad } from '../state/keypad';
import { revealCaret } from './MathField';

const REPEAT_DELAY_MS = 400;
const REPEAT_EVERY_MS = 60;

const PAGE_LABELS: Record<PageId, string> = { '123': '123', fx: 'f(x)', abc: 'ABC' };

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
  /** A pointer press already ran the action, so the click that follows it must not. */
  let pressed = false;
  const stop = () => {
    clearTimeout(timer);
    timer = undefined;
  };
  onCleanup(stop);

  return (
    <button
      type="button"
      class={`key key-${props.def.variant}`}
      classList={{ wide: (props.def.span ?? 1) > 1 }}
      style={{ 'grid-column': `span ${props.def.span ?? 1}` }}
      aria-label={props.def.ariaLabel}
      data-testid={`key-${props.def.id}`}
      onPointerDown={(e) => {
        // Keep focus (and the caret) in the field being edited.
        e.preventDefault();
        if (e.button !== 0) return;
        pressed = true;
        stop();
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
      onKeyDown={() => {
        pressed = false;
      }}
      onClick={() => {
        const handled = pressed;
        pressed = false;
        if (props.def.action.type === 'native') useNativeKeyboard();
        // Keyboard or assistive-technology activation: a click without a pointer press. (Not
        // `detail === 0`: Chromium also reports 0 for the click ending a long touch press.)
        else if (!handled) runAction(props.def.action);
      }}
    >
      {props.def.label}
    </button>
  );
}

export function MathKeypad() {
  const page = () => getPage(keypad.page(), keypad.shift());
  return (
    <section class="keypad" aria-label="Math keypad" data-testid="keypad">
      <div class="keypad-tabs" role="tablist">
        <For each={PAGE_ORDER}>
          {(id) => (
            <button
              type="button"
              role="tab"
              class="keypad-tab"
              aria-selected={keypad.page() === id}
              data-testid={`keypad-tab-${id}`}
              onPointerDown={(e) => e.preventDefault()}
              onClick={() => keypad.setPage(id)}
            >
              {PAGE_LABELS[id]}
            </button>
          )}
        </For>
        <button
          type="button"
          class="keypad-hide"
          aria-label="Hide keypad"
          data-testid="keypad-hide"
          onPointerDown={(e) => e.preventDefault()}
          onClick={() => keypad.setOpen(false)}
        >
          ⌄
        </button>
      </div>
      <div class="keypad-grid" style={{ '--cols': String(page().columns) }}>
        <For each={page().rows.flat()}>{(def) => <Key def={def} />}</For>
      </div>
    </section>
  );
}
