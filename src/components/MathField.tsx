import { batch, createEffect, createMemo, createSignal, on, onCleanup, Show } from 'solid-js';
import type { Span } from '../engine/types';
import { type EditOp, nextCodePoint, prevCodePoint } from '../keypad/editing';
import {
  type Caret,
  caretAt,
  completionAt,
  completionCommand,
  type EditKind,
  type EditorCommand,
  type EditorOptions,
  type EditorState,
  type Names,
  readSelection,
  runCommand,
  type Selection,
} from '../mathedit';
import { registerRowCaret } from '../state/focus';
import { type EditTarget, keypad } from '../state/keypad';
import { type CaretView, MathView, type MathViewHandle, typesetRow } from './MathView';

const PLAIN_KEY = 'graphing-calc:plain';

/**
 * `?plain` in the URL: rows are edited as plain text while focused, as before they were edited
 * in their typeset form (a way out if a browser or keyboard misbehaves with the editor). It is
 * remembered, so an installed app (no address bar) keeps it once opened that way; `?plain=0`
 * turns it off.
 */
export const plainEditing = ((): boolean => {
  if (typeof location === 'undefined') return false;
  const param = new URLSearchParams(location.search).get('plain');
  const on = param !== null && param !== '0' && param !== 'false';
  try {
    if (param !== null) {
      if (on) localStorage.setItem(PLAIN_KEY, '1');
      else localStorage.removeItem(PLAIN_KEY);
    }
    return localStorage.getItem(PLAIN_KEY) === '1';
  } catch {
    // No storage (private mode, blocked): just this visit.
    return on;
  }
})();

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

/** How far (px) a press on the typeset math may move and still be a click, not a drag. */
const DRAG_SLOP = 5;

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
 * (Rows edited in their typeset form scroll their math instead.)
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
  const shown =
    field?.classList.contains('typeset') &&
    (document.activeElement !== el || field.classList.contains('in-place'));
  const math = shown ? field?.querySelector('.math-view > .m-root') : null;
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

/** What a native edit of the input would make of it: its text, and its caret. */
function nativeEdit(
  el: HTMLInputElement,
  type: string,
  data: string | null,
): { text: string; caret: number } {
  const text = el.value;
  const s = el.selectionStart ?? text.length;
  const e = el.selectionEnd ?? s;
  const splice = (from: number, to: number, insert: string) =>
    text.slice(0, from) + insert + text.slice(to);
  if (type === 'insertText')
    return { text: splice(s, e, data ?? ''), caret: s + (data ?? '').length };
  if (s !== e) return { text: splice(s, e, ''), caret: s };
  if (type === 'deleteContentBackward') {
    if (s === 0) return { text, caret: 0 };
    const p = prevCodePoint(text, s);
    return { text: splice(p, s, ''), caret: p };
  }
  if (s >= text.length) return { text, caret: s };
  return { text: splice(s, nextCodePoint(text, s), ''), caret: s };
}

/**
 * What an IME committed, as an editor command from the state before it composed: a word or a
 * number a phone keyboard composed (or one character) goes through the typing rules, like keys;
 * anything else is text, inserted as it is. Null when the input changed some other way.
 */
function committed(from: Selection, value: string): EditorCommand | null {
  const { text } = from.doc;
  const head = text.slice(0, from.start);
  const tail = text.slice(from.end);
  if (
    value.length < head.length + tail.length ||
    !value.startsWith(head) ||
    !value.endsWith(tail)
  ) {
    return null;
  }
  const inserted = value.slice(head.length, value.length - tail.length);
  if (inserted === '') return null;
  const keys = /^[\p{L}\p{N}]{1,24}$/u.test(inserted) || [...inserted].length === 1;
  return { type: keys ? 'type' : 'insert', text: inserted };
}

/** A keypad edit as an editor command. */
function keypadCommand(op: EditOp): EditorCommand | null {
  switch (op.type) {
    case 'insert':
      return { type: 'type', text: op.text };
    case 'wrap':
      return { type: 'wrap', before: op.before, after: op.after };
    case 'function':
      return { type: 'function', name: op.name };
    case 'power':
      return { type: 'power', exponent: op.exponent };
    case 'backspace':
      return { type: 'backspace' };
    case 'deleteForward':
      return { type: 'delete' };
    case 'left':
    case 'right':
    case 'home':
    case 'end':
    case 'clear':
      return { type: op.type };
    default:
      return null;
  }
}

export interface MathFieldProps {
  value: string;
  /** New text; `kind`: how the edit changed it, when the editor knows (see editGroup). */
  onChange: (text: string, kind?: EditKind) => void;
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
   * Typeset the math, grouping letters with these names. The input then lies over the typeset
   * view, invisible, and still takes every click and key; focused, it shows and edits the
   * plain text, unless `inPlace`.
   */
  names?: Names;
  /**
   * Edit the typeset math in place (expression rows): a caret and selection drawn in the math,
   * and keys, the keypad and pointer going through the editor (src/mathedit/commands.ts).
   * Off with `?plain`.
   */
  inPlace?: boolean;
}

/**
 * A math input that cooperates with the on-screen keypad: while keypad mode is on it sets
 * inputmode="none" so the device keyboard stays hidden, yet remains a real focused <input>
 * (caret, selection, paste and hardware keyboards keep working).
 *
 * Edited in place, the <input> stays the model: its value is the row's text and its selection
 * the editor's, as text offsets. Keys arrive as keydown (moves) and beforeinput (typing and
 * deleting), which the editor turns into text splices; only where its result differs from the
 * browser's own edit is that prevented (mobile keyboards keep their state otherwise), and a
 * typed character the browser inserted unasked goes through the typing rules on `input`.
 * Nothing is written during an IME composition; what it commits goes through the editor from
 * where it started (a word a phone keyboard composed, by the typing rules). The selection is
 * read again whenever it was moved by something else (select all, a test, undo), and never set
 * while the field takes focus (Playwright's fill() selects, then focuses, then types).
 */
export function MathField(props: MathFieldProps) {
  let input!: HTMLInputElement;
  let mirror: HTMLDivElement | undefined;
  let view: MathViewHandle | undefined;
  const [focused, setFocused] = createSignal(false);
  const inPlace = () => !!props.names && props.inPlace === true && !plainEditing;
  /** A press on the typeset math (plain editing): where it was, and the offset it is on. */
  let press: { x: number; y: number; offset: number } | null = null;

  // ---- editing in place ----

  /** The editor's state: the input's text and selection, with the caret's depth. */
  let state: EditorState | null = null;
  /** The selection the editor last gave the input, to tell when something else moved it. */
  let given: { start: number; end: number } | null = null;
  /** A depth for the caret next read from the input (undo puts it back in a denominator). */
  let hint: { offset: number; depth: number } | null = null;
  /** What the browser's own edit will make, when it is what the editor wants too. */
  let pending: { state: EditorState; kind: EditKind | null } | null = null;
  let composing = false;
  /** The editor's state when an IME started composing (what it commits is applied to it). */
  let composeFrom: EditorState | null = null;
  /**
   * A press on the math being edited: where, the caret position it is on, and (a finger, which
   * slides a long row sideways) where it last was.
   */
  let drag: {
    id: number;
    x: number;
    y: number;
    lastX: number;
    at: Caret;
    mouse: boolean;
    extend: boolean;
    moved: boolean;
  } | null = null;
  let seq = 0;
  const [caret, setCaret] = createSignal<CaretView | null>(null);
  /** The input's text while an IME composes (shown, not yet written). */
  const [live, setLive] = createSignal<string | null>(null);

  const options = (): EditorOptions => {
    const names = props.names as Names;
    return {
      names: names.ctx,
      plan: (text) => typesetRow(text, names),
      xOf: (stop) => view?.xOf(stop) ?? 0,
    };
  };

  /** The editor's state, read again from the input when something else changed it. */
  const sync = (): EditorState => {
    const text = input.value;
    const s = input.selectionStart ?? text.length;
    const e = input.selectionEnd ?? s;
    if (state && given && state.text === text && given.start === s && given.end === e) return state;
    const opts = options();
    if (s === e) {
      const depth = hint?.offset === s ? hint.depth : undefined;
      const c = caretAt(text, s, opts, depth);
      state = { text, anchor: c, focus: c };
    } else {
      const back = input.selectionDirection === 'backward';
      state = {
        text,
        anchor: caretAt(text, back ? e : s, opts),
        focus: caretAt(text, back ? s : e, opts),
      };
    }
    hint = null;
    given = { start: s, end: e };
    return state;
  };

  /** Draws the caret where the editor has it. */
  const showCaret = (st: EditorState) =>
    setCaret({ anchor: st.anchor, focus: st.focus, seq: ++seq });

  /**
   * Puts an editor state in the input and the view. The store hears of the edit first, while
   * the input still has the caret from before it (an undo step records that).
   */
  const show = (next: EditorState, kind: EditKind | null) => {
    const sel = readSelection(next, options());
    const backward = !sel.collapsed && next.focus.offset < next.anchor.offset;
    batch(() => {
      if (kind !== null && next.text !== props.value) props.onChange(next.text, kind);
      if (input.value !== next.text) input.value = next.text;
      input.setSelectionRange(sel.start, sel.end, backward ? 'backward' : 'forward');
      state = next;
      given = { start: sel.start, end: sel.end };
      showCaret(next);
    });
  };

  /** Runs an editor command; false when it had nothing to do (Up/Down with nowhere to go). */
  const run = (cmd: EditorCommand): boolean => {
    const result = runCommand(sync(), cmd, options());
    if (!result) return false;
    show(result.state, result.edit);
    return true;
  };

  /**
   * The rest of a function's name, offered faintly after the caret while its first letters are
   * typed (src/mathedit/complete.ts): `si‸` offers `n(`.
   */
  const completion = createMemo(() => {
    const c = caret();
    const names = props.names;
    if (!c || !names || !inPlace() || live() !== null) return null;
    if (c.anchor.offset !== c.focus.offset || c.anchor.depth !== c.focus.depth) return null;
    const text = props.value;
    if (c.focus.offset > text.length) return null;
    return completionAt(typesetRow(text, names), c.focus, names.ctx);
  });

  /** Tab or → takes the completion on offer: the rest of the name, typed. */
  const accept = (): boolean => {
    const c = completion();
    return c !== null && run(completionCommand(c));
  };

  /**
   * The caret moved without the editor (select all, a click elsewhere, undo), or the field just
   * took focus: draw it where it is.
   */
  const refresh = () => {
    if (!inPlace() || !focused()) return;
    if (composing) {
      // At the depth the composition started at (or the deepest place there above it).
      const text = input.value;
      const at = input.selectionEnd ?? text.length;
      const c = caretAt(text, at, options(), composeFrom?.focus.depth ?? 0);
      showCaret({ text, anchor: c, focus: c });
      return;
    }
    const before = state;
    const st = sync();
    if (st !== before || caret() === null) showCaret(st);
  };

  // Undo and other edits from outside change the text under the caret.
  createEffect(on(() => props.value, refresh, { defer: true }));

  const onSelectionChange = () => {
    if (document.activeElement === input) refresh();
  };

  const onBeforeInput = (e: InputEvent) => {
    if (!inPlace() || e.defaultPrevented || composing || e.isComposing) return;
    pending = null;
    // An edit the browser makes anyway (some phone keyboards): `input` sees to it.
    if (!e.cancelable) return;
    let cmd: EditorCommand | null = null;
    if (e.inputType === 'insertText' && e.data && [...e.data].length === 1) {
      cmd = { type: 'type', text: e.data };
    } else if (e.inputType === 'deleteContentBackward') {
      cmd = { type: 'backspace' };
    } else if (e.inputType === 'deleteContentForward') {
      cmd = { type: 'delete' };
    }
    // Pastes, longer insertions (autocorrect, fill()) and word deletes are the browser's.
    if (!cmd) return;
    const result = runCommand(sync(), cmd, options());
    if (!result) return;
    const native = nativeEdit(input, e.inputType, e.data);
    const sel = readSelection(result.state, options());
    if (
      result.state.text !== input.value &&
      result.state.text === native.text &&
      sel.collapsed &&
      sel.start === native.caret
    ) {
      // The browser's edit is the editor's: let it happen (a keyboard keeps its own state).
      pending = { state: result.state, kind: result.edit };
      return;
    }
    e.preventDefault();
    show(result.state, result.edit);
  };

  const onInput = (e: InputEvent) => {
    const value = input.value;
    if (!inPlace()) {
      props.onChange(value);
      syncMirror();
      return;
    }
    if (composing) {
      setLive(value);
      refresh();
      return;
    }
    const expected = pending;
    pending = null;
    if (expected && expected.state.text === value) {
      batch(() => {
        props.onChange(value, expected.kind ?? undefined);
        state = expected.state;
        given = { start: input.selectionStart ?? 0, end: input.selectionEnd ?? 0 };
        showCaret(expected.state);
      });
      return;
    }
    // A character the browser inserted without a beforeinput the editor could act on (some
    // keyboards): it goes through the typing rules now.
    const before = state;
    if (before && e.inputType === 'insertText' && e.data && [...e.data].length === 1) {
      const sel = readSelection(before, options());
      const inserted = before.text.slice(0, sel.start) + e.data + before.text.slice(sel.end);
      if (inserted === value) {
        const result = runCommand(before, { type: 'type', text: e.data }, options());
        if (result && result.state.text !== value) {
          show(result.state, result.edit);
          return;
        }
      }
    }
    props.onChange(value);
    refresh();
  };

  const target: EditTarget = {
    get el() {
      return input;
    },
    commit: (text) => props.onChange(text),
    enter: () => props.onEnter(),
    deleteEmpty: () => props.onDeleteEmpty?.(),
    get apply() {
      if (!inPlace()) return undefined;
      return (op: EditOp, repeated = false) => {
        if (op.type === 'right' && !repeated && accept()) return;
        const cmd = keypadCommand(op);
        if (cmd) run(cmd);
      };
    },
  };

  /** Moves the editor makes from the keyboard; false for keys it leaves alone. */
  const moveKey = (e: KeyboardEvent): boolean => {
    if (e.ctrlKey || e.metaKey || e.altKey) return false;
    let cmd: EditorCommand | null = null;
    switch (e.key) {
      case 'ArrowLeft':
        cmd = { type: 'left', extend: e.shiftKey };
        break;
      case 'ArrowRight':
        cmd = { type: 'right', extend: e.shiftKey };
        break;
      case 'Home':
        cmd = { type: 'home', extend: e.shiftKey };
        break;
      case 'End':
        cmd = { type: 'end', extend: e.shiftKey };
        break;
      case 'ArrowUp':
        if (!e.shiftKey) cmd = { type: 'up' };
        break;
      case 'ArrowDown':
        if (!e.shiftKey) cmd = { type: 'down' };
        break;
    }
    // Up and Down with nowhere to go in the row move to the next row (the row's own handler).
    if (!cmd || !run(cmd)) return false;
    e.preventDefault();
    return true;
  };

  /**
   * Focuses the field (if it isn't) and puts the caret, or extends the selection, at `at`. An
   * empty exponent the caret leaves goes, as it does with the arrows.
   */
  const place = (at: Caret, extend: boolean) => {
    if (document.activeElement !== input) input.focus({ preventScroll: true });
    if (document.activeElement !== input) return;
    run({ type: 'place', at, extend });
  };

  /** An IME committed: through the editor, from where the composition started. */
  const commitComposition = () => {
    const from = composeFrom;
    composeFrom = null;
    const value = input.value;
    const cmd = from ? committed(readSelection(from, options()), value) : null;
    const result = from && cmd ? runCommand(from, cmd, options()) : null;
    if (result) {
      batch(() => {
        setLive(null);
        show(result.state, result.edit ?? 'insert');
      });
      return;
    }
    // Changed some other way: as it is, the caret as deep as where it started.
    batch(() => {
      setLive(null);
      state = null;
      if (from) hint = { offset: input.selectionStart ?? value.length, depth: from.focus.depth };
      if (value !== props.value) props.onChange(value);
    });
    refresh();
  };

  // ---- plain editing ----

  const syncMirror = () => {
    if (mirror) mirror.scrollLeft = input.scrollLeft;
  };

  const underline = createMemo(() => {
    const span = props.errorSpan;
    if (!span || inPlace()) return null;
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
   * A click on the typeset math of a field edited as plain text lands on the invisible input,
   * whose own text is laid out differently: the browser puts the caret by that. Once the press
   * has focused the field, the caret goes where the pressed symbol is in the text instead: in
   * the task after the focus (a tap's click can land elsewhere once the keypad opens and moves
   * the list), and again on the click, since a mouse that moves while held makes the browser
   * put it back by the plain text. The task after the focus leaves a selection alone
   * (Playwright's fill() selects everything, then focuses); a press that dragged keeps the
   * selection it made in the text, shown by then.
   */
  const placeCaret = () => {
    if (!press) return;
    input.setSelectionRange(press.offset, press.offset);
    revealCaret(input);
  };

  onCleanup(() => {
    if (keypad.target()?.el === input) keypad.setTarget(null);
    if (keypad.nativeEl() === input) keypad.setNativeEl(null);
    document.removeEventListener('selectionchange', onSelectionChange);
  });

  return (
    <div
      class={`math-field ${props.class ?? ''}`}
      classList={{ typeset: !!props.names, 'in-place': inPlace() }}
    >
      <Show when={props.names}>
        {(names) => (
          <MathView
            source={live() ?? props.value}
            names={names()}
            errorSpan={props.errorSpan ?? null}
            placeholder={props.placeholder}
            frozen={focused() && !inPlace()}
            caret={caret()}
            completion={completion()}
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
          onCleanup(
            registerRowCaret(el, {
              // Before an edit the input has already made, the editor still has the caret
              // from before it.
              get: () => {
                if (!inPlace() || !focused() || !state) return undefined;
                return { offset: state.focus.offset, depth: state.focus.depth };
              },
              set: (depth) => {
                if (!inPlace()) return;
                hint = { offset: input.selectionStart ?? 0, depth };
                state = null;
                refresh();
              },
              x: () => {
                if (!inPlace() || !focused() || !view) return undefined;
                return view.xOf(readSelection(sync(), options()).focus);
              },
              placeAtX: (x) => {
                if (!inPlace() || !view || document.activeElement !== input) return false;
                place(view.caretAt(x, view.lineY()), false);
                return true;
              },
            }),
          );
        }}
        class="math-input"
        type="text"
        value={props.value}
        inputmode={keypad.suppressNative(input) ? 'none' : 'text'}
        enterkeyhint="enter"
        autocomplete="off"
        autocapitalize="off"
        autocorrect="off"
        spellcheck={false}
        aria-label={props.ariaLabel}
        aria-invalid={props.errorSpan || props.invalid ? 'true' : undefined}
        placeholder={props.placeholder}
        data-testid={props.testId}
        onBeforeInput={onBeforeInput}
        onInput={onInput}
        onCompositionStart={() => {
          composing = true;
          pending = null;
          // Read, not set: the input's selection is still the one from before.
          composeFrom = inPlace() ? sync() : null;
        }}
        onCompositionEnd={() => {
          composing = false;
          if (inPlace()) commitComposition();
        }}
        onScroll={syncMirror}
        onKeyUp={syncMirror}
        onKeyDown={(e) => {
          // Keys an IME uses to pick and commit (↑, ↓, Enter) are its own while it composes.
          if (composing || e.isComposing) return;
          // Only a fresh press: holding → moves the caret, it never types.
          const plainKey = !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey && !e.repeat;
          if ((e.key === 'Tab' || e.key === 'ArrowRight') && plainKey && accept()) {
            e.preventDefault();
            return;
          }
          if (inPlace() && moveKey(e)) return;
          if (props.onKeyDown) props.onKeyDown(e);
          else if (e.key === 'Enter') {
            e.preventDefault();
            props.onEnter();
          } else if (e.key === 'Escape') e.currentTarget.blur();
        }}
        onFocus={() => {
          setFocused(true);
          if (inPlace()) {
            // Reads the selection, never sets it (see the comment above); drawn once what
            // focused the field (a click, ↑ from the row below, undo) has put the caret, so it
            // doesn't first show, and scroll to, where the input's caret was left.
            document.addEventListener('selectionchange', onSelectionChange);
            queueMicrotask(refresh);
          } else if (press) {
            setTimeout(() => {
              if (input.selectionStart === input.selectionEnd) placeCaret();
            }, 0);
          }
          keypad.setTarget(target);
          openKeypad();
          props.onFocus?.();
        }}
        onBlur={() => {
          setFocused(false);
          press = null;
          drag = null;
          // The editor's state stays (the caret's depth: back in the denominator when the
          // focus returns); sync() drops it if the text or the selection change meanwhile.
          pending = null;
          composing = false;
          composeFrom = null;
          batch(() => {
            setLive(null);
            setCaret(null);
          });
          document.removeEventListener('selectionchange', onSelectionChange);
          if (keypad.nativeEl() === input) keypad.setNativeEl(null);
          props.onBlur?.();
        }}
        onPointerDown={(e) => {
          if (inPlace()) {
            if (e.button !== 0 || !view) return;
            // No native caret, selection handles or magnifier: the editor places the caret.
            e.preventDefault();
            drag = {
              id: e.pointerId,
              x: e.clientX,
              y: e.clientY,
              lastX: e.clientX,
              at: view.caretAt(e.clientX, e.clientY),
              mouse: e.pointerType !== 'touch',
              extend: e.shiftKey && document.activeElement === input,
              moved: false,
            };
            if (drag.mouse) {
              try {
                input.setPointerCapture(e.pointerId);
              } catch {
                // Not capturable (a synthetic pointer): moves outside the field are lost.
              }
            }
            return;
          }
          press =
            view && e.button === 0 && document.activeElement !== input
              ? {
                  x: e.clientX,
                  y: e.clientY,
                  offset: view.caretAt(e.clientX, e.clientY).offset,
                }
              : null;
        }}
        onPointerMove={(e) => {
          // A mouse or pen drag selects; a finger slides a long row being edited sideways (up
          // and down, it scrolls the list: touch-action in global.css).
          const d = drag;
          if (!d || e.pointerId !== d.id || !view) return;
          if (!d.moved && Math.hypot(e.clientX - d.x, e.clientY - d.y) <= DRAG_SLOP) return;
          if (!d.mouse) {
            if (document.activeElement === input) view.scrollBy(d.lastX - e.clientX);
            d.lastX = e.clientX;
            d.moved = true;
            return;
          }
          d.moved = true;
          if (document.activeElement !== input) input.focus({ preventScroll: true });
          if (document.activeElement !== input) return;
          const st = sync();
          show(
            {
              text: st.text,
              anchor: d.extend ? st.anchor : d.at,
              focus: view.caretAt(e.clientX, e.clientY),
            },
            null,
          );
        }}
        onPointerUp={(e) => {
          const d = drag;
          if (!d || e.pointerId !== d.id) return;
          drag = null;
          // Focused here, inside the gesture, so a phone opens its keyboard.
          if (!d.moved) place(d.at, d.extend);
        }}
        onPointerCancel={() => {
          press = null;
          drag = null;
        }}
        onWheel={(e) => {
          // The math scrolls, not the invisible input under the pointer.
          if (!inPlace() || !view || document.activeElement !== input) return;
          const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? input.clientWidth : 1;
          const sideways = Math.abs(e.deltaX) > Math.abs(e.deltaY);
          const dx = (sideways ? e.deltaX : e.shiftKey ? e.deltaY : 0) * unit;
          if (dx === 0) return;
          e.preventDefault();
          view.scrollBy(dx);
        }}
        onDblClick={(e) => {
          // The number, name or symbol under the pointer.
          if (!inPlace() || !view || document.activeElement !== input) return;
          const word = view.wordAt(e.clientX, e.clientY);
          if (!word) return;
          const st = sync();
          show({ text: st.text, anchor: word.start, focus: word.end }, null);
        }}
        onClick={(e) => {
          if (inPlace()) {
            if (document.activeElement !== input) input.focus({ preventScroll: true });
          } else if (press && Math.hypot(e.clientX - press.x, e.clientY - press.y) <= DRAG_SLOP) {
            placeCaret();
          }
          press = null;
          openKeypad();
        }}
      />
    </div>
  );
}
