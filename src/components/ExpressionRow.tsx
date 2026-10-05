import {
  createEffect,
  createMemo,
  createSignal,
  For,
  Match,
  on,
  onCleanup,
  Show,
  Switch,
  untrack,
} from 'solid-js';
import { errorFixes, sliderFixNames } from '../engine/errors';
import { formatValue } from '../engine/format';
import type { MathError, QuickFix } from '../engine/types';
import { analysis, nameContext, steadyRows } from '../state/analysis';
import { doc, type Row, removeRow, setColor, toggleHidden, updateSource } from '../state/doc';
import { focusRow, registerRowInput, rowCaretX, unregisterRowInput } from '../state/focus';
import { offerUndo } from '../state/historyUi';
import { isCoarsePointer } from '../state/keypad';
import {
  addSliders,
  applyTextFix,
  autoAddSliders,
  deleteEmptyBackward,
  deleteEmptyForward,
  enterFrom,
  focusSibling,
  sliderToast,
} from '../state/rowActions';
import { ui } from '../state/ui';
import { ColorPicker } from './ColorPicker';
import { Icon } from './icons';
import { blurActive, MathField } from './MathField';
import { RangeControl } from './RangeControl';
import { SliderControl } from './SliderControl';

const ERROR_DELAY_MS = 500;
/** How long a fixed error's line takes to close (--dur-2 in global.css). */
const ERROR_CLOSE_MS = 160;
/** A mouse resting on a row this long makes its curve stand out (passing over it does not). */
const HOVER_INTENT_MS = 120;
/** The pulse of a row picked on the graph (keep in sync with .expr-row.pulse in global.css). */
const PULSE_MS = 700;
/** Typing paused this long makes sliders of the unknown names typed (see autoSlider.ts). */
const IDLE_SLIDERS_MS = 1500;
/**
 * Unknown names typed in the row are offered as sliders once typing settles this long: soon, but
 * not for the letters on their way to `sin`.
 */
const SUGGEST_MS = 200;

export function ExpressionRow(props: { row: Row; index: number; palette: readonly string[] }) {
  const result = createMemo(() => analysis().byId.get(props.row.id));
  /** Broken by an edit in progress: the last good result, still shown (state/steady.ts). */
  const held = createMemo(() => steadyRows().held.get(props.row.id));
  /** The error only comes from an edit in progress elsewhere: it waits for that to finish. */
  const quiet = createMemo(() => steadyRows().quiet.has(props.row.id));
  /** What the row shows: its result, or while it is held, the last good one. */
  const shown = () => {
    const r = result();
    return r?.status !== 'ok' && held() ? held() : r;
  };
  const [errorVisible, setErrorVisible] = createSignal(false);
  const [pickerOpen, setPickerOpen] = createSignal(false);
  let li!: HTMLLIElement;
  let input: HTMLInputElement | undefined;
  let colorButton: HTMLButtonElement | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let hoverTimer: ReturnType<typeof setTimeout> | undefined;
  let pulseTimer: ReturnType<typeof setTimeout> | undefined;
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  let suggestTimer: ReturnType<typeof setTimeout> | undefined;
  /** Typed into since its edit last ended: unknown names in it may become sliders. */
  let edited = false;
  /** Typed into since it took focus: Tab takes the fix offered (else it moves on). */
  let typedSinceFocus = false;
  /** Names this row made sliders of by itself: never again (undone, or deleted since). */
  const tried = new Set<string>();

  /**
   * Unknown names while the row is being edited: offered quietly as sliders (a chip, no alert),
   * since they become sliders by themselves once the edit ends. The chip appears once typing
   * settles, and then follows the names as they change.
   */
  const unknownNames = createMemo(
    (): readonly string[] | null => {
      const err = result()?.error;
      if (err?.code !== 'unknown-name' || ui.editingRowId() !== props.row.id || quiet()) {
        return null;
      }
      const names = sliderFixNames(err);
      return names.length > 0 ? names : null;
    },
    null,
    { equals: (a, b) => a === b || (!!a && !!b && a.join() === b.join()) },
  );
  const [suggestion, setSuggestion] = createSignal<readonly string[] | null>(null);
  createEffect(
    on([unknownNames, () => props.row.source], ([names]) => {
      clearTimeout(suggestTimer);
      if (!names) setSuggestion(null);
      else if (untrack(suggestion)) setSuggestion(names);
      else suggestTimer = setTimeout(() => setSuggestion(names), SUGGEST_MS);
    }),
  );

  // Errors show after a pause in typing (or on blur) and disappear as soon as they are fixed.
  // Unknown names in the row being edited are a suggestion meanwhile, not an error.
  createEffect(
    on(
      [() => props.row.source, () => result()?.error, quiet, () => suggestion() !== null],
      ([, error, isQuiet, suggested]) => {
        clearTimeout(timer);
        if (!error || isQuiet || suggested) setErrorVisible(false);
        else if (!errorVisible()) timer = setTimeout(() => setErrorVisible(true), ERROR_DELAY_MS);
      },
    ),
  );
  onCleanup(() => {
    clearTimeout(timer);
    clearTimeout(hoverTimer);
    clearTimeout(pulseTimer);
    clearTimeout(idleTimer);
    clearTimeout(suggestTimer);
    if (input) unregisterRowInput(props.row.id, input);
    if (ui.hoveredRowId() === props.row.id) ui.setHoveredRowId(null);
    if (ui.editingRowId() === props.row.id) ui.setEditingRowId(null);
  });

  // Picked on the graph (into view), or just added for the user: a brief pulse in its color.
  createEffect(
    on(
      ui.flash,
      (f) => {
        if (!f?.ids.includes(props.row.id)) return;
        if (f.reveal) li.scrollIntoView({ block: 'nearest' });
        li.classList.remove('pulse');
        void li.offsetWidth; // restart the animation
        li.classList.add('pulse');
        clearTimeout(pulseTimer);
        pulseTimer = setTimeout(() => li.classList.remove('pulse'), PULSE_MS);
      },
      { defer: true },
    ),
  );

  const error = () => (errorVisible() ? result()?.error : undefined);
  const color = () => props.palette[props.row.colorIndex] ?? props.palette[0];
  const plots = () => shown()?.status === 'ok' && !!shown()?.plot;
  /** Its curve is on the graph: only then does pointing at the row make it stand out. */
  const drawn = () => plots() && !props.row.hidden;
  createEffect(() => {
    if (!drawn() && untrack(ui.hoveredRowId) === props.row.id) ui.setHoveredRowId(null);
  });
  /**
   * While the row is held mid-edit, pressing its color mark or color button keeps the focus in
   * its field: where a button takes no focus (Safari), the edit would end on the press and
   * take the held mark, and the button under the pointer, away before the click.
   */
  const keepEditing = (e: MouseEvent) => {
    if (held()) e.preventDefault();
  };

  // The error line keeps showing a fixed error while it closes (no longer an alert by then).
  const [shownError, setShownError] = createSignal<MathError | undefined>();
  const [closing, setClosing] = createSignal(false);
  let closeTimer: ReturnType<typeof setTimeout> | undefined;
  createEffect(() => {
    const err = error();
    clearTimeout(closeTimer);
    if (err) {
      setShownError(err);
      setClosing(false);
    } else if (untrack(shownError)) {
      setClosing(true);
      closeTimer = setTimeout(() => {
        setShownError(undefined);
        setClosing(false);
      }, ERROR_CLOSE_MS);
    }
  });
  onCleanup(() => clearTimeout(closeTimer));
  const rangeVariable = (): 't' | 'θ' | null => {
    const kind = shown()?.kind;
    return kind === 'parametric' ? 't' : kind === 'polar' ? 'θ' : null;
  };

  /**
   * × button: keyboard users keep their place in the list (pointer users are left alone). On
   * touch, where there is no undo key and a thumb can land on × instead of the color button, a
   * toast offers to undo it.
   */
  const remove = (e: MouseEvent) => {
    const i = doc.rows.findIndex((r) => r.id === props.row.id);
    const hadMath = props.row.source.trim() !== '';
    removeRow(props.row.id);
    if (isCoarsePointer && hadMath) offerUndo('Expression deleted');
    if (e.detail !== 0) return;
    const next = doc.rows[i] ?? doc.rows[i - 1];
    if (next) focusRow(next.id, 'end');
  };

  /** A text edit by the user (keys, the keypad, a paste): sliders may follow (see autoSlider.ts). */
  const onEdit = () => {
    edited = true;
    typedSinceFocus = true;
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      idleTimer = undefined;
      if (!input || document.activeElement !== input) return;
      const selection = { start: input.selectionStart ?? 0, end: input.selectionEnd ?? 0 };
      const made = autoAddSliders(props.row.id, 'idle', tried, selection);
      if (made.names.length > 0) offerUndo(sliderToast(made.names));
    }, IDLE_SLIDERS_MS);
  };

  /** The edit ended (Enter, or the row lost focus): unknown names typed in it become sliders. */
  const commitSliders = () => {
    clearTimeout(idleTimer);
    if (!edited) return { names: [], ids: [] };
    edited = false;
    return autoAddSliders(props.row.id, 'commit', tried);
  };

  /**
   * Enter, or the keypad's ↵: sliders first, then on to the row after them (a new one there, or
   * the empty one at the end), as one undo step. Returns whether focus moved.
   */
  const enter = (): boolean => {
    const made = commitSliders();
    const moved = enterFrom(made.ids.at(-1) ?? props.row.id);
    if (made.names.length > 0) offerUndo(sliderToast(made.names));
    return moved;
  };

  /** The fixes on offer, the one Tab takes first: the error line's, or the sliders suggested. */
  const fixes = (): QuickFix[] => {
    const err = shownError();
    if (err && !closing()) return errorFixes(err);
    const names = suggestion();
    return names ? [{ kind: 'addSliders', names: [...names] }] : [];
  };

  /** Take a fix. `focus`: its button had focus (a keyboard), which goes away with the error. */
  const takeFix = (fix: QuickFix, focus: boolean) => {
    if (fix.kind === 'replace') {
      applyTextFix(props.row.id, fix, focus);
      return;
    }
    // The names unknown now (the error line may still show while it closes).
    const names = sliderFixNames(result()?.error);
    if (names.length === 0) return;
    ui.flashRows(addSliders(props.row.id, names), false);
    if (focus && input && document.activeElement !== input) focusRow(props.row.id, 'end');
  };

  /** Pressing a fix keeps the focus in the row being edited (its caret stays put). */
  const keepFocus = (e: MouseEvent) => {
    if (input && document.activeElement === input) e.preventDefault();
  };

  const onKeyDown = (e: KeyboardEvent & { currentTarget: HTMLInputElement }) => {
    const el = e.currentTarget;
    const empty = el.value === '';
    const caret = el.selectionStart ?? 0;
    switch (e.key) {
      case 'Enter':
        e.preventDefault();
        enter();
        break;
      // Tab takes the fix on offer, once something was typed (else it moves on as usual).
      case 'Tab': {
        if (e.shiftKey || e.ctrlKey || e.metaKey || e.altKey || !typedSinceFocus) break;
        const [fix] = fixes();
        if (!fix) break;
        e.preventDefault();
        takeFix(fix, false);
        break;
      }
      // Auto-repeat stops at an empty row: only a fresh press deletes it.
      case 'Backspace':
        if (empty && (e.repeat || deleteEmptyBackward(props.row.id))) e.preventDefault();
        break;
      case 'Delete':
        if (empty && (e.repeat || deleteEmptyForward(props.row.id))) e.preventDefault();
        break;
      // The caret keeps its column on screen (typeset rows), else its offset.
      case 'ArrowUp':
        if (focusSibling(props.row.id, -1, caret, rowCaretX(el))) e.preventDefault();
        break;
      case 'ArrowDown':
        if (focusSibling(props.row.id, 1, caret, rowCaretX(el))) e.preventDefault();
        break;
      case 'Escape':
        el.blur();
        break;
    }
  };

  return (
    <li
      ref={li}
      class="expr-row"
      classList={{
        'has-error': !!error(),
        hidden: props.row.hidden,
        'picker-open': pickerOpen(),
        plots: plots(),
        selected: ui.selectedRowId() === props.row.id,
        traced: ui.tracedRowId() === props.row.id,
      }}
      style={{ '--row-color': props.row.colorIndex >= 0 ? color() : undefined }}
      data-row-id={props.row.id}
      data-kind={shown()?.kind ?? ''}
      onFocusIn={(e) => {
        ui.setSelectedRowId(props.row.id);
        if (e.target.classList.contains('math-input')) ui.setEditingRowId(props.row.id);
      }}
      onFocusOut={(e) => {
        // The edit goes on while the focus stays in the row (its color mark, its picker).
        const next = e.relatedTarget;
        if (ui.editingRowId() === props.row.id && !(next instanceof Node && li.contains(next))) {
          ui.setEditingRowId(null);
        }
      }}
      onPointerMove={(e) => {
        if (e.pointerType !== 'mouse' || hoverTimer || ui.hoveredRowId() === props.row.id) return;
        if (!drawn()) return;
        hoverTimer = setTimeout(() => {
          hoverTimer = undefined;
          if (drawn()) ui.setHoveredRowId(props.row.id);
        }, HOVER_INTENT_MS);
      }}
      onPointerLeave={() => {
        clearTimeout(hoverTimer);
        hoverTimer = undefined;
        if (ui.hoveredRowId() === props.row.id) ui.setHoveredRowId(null);
      }}
    >
      <div class="expr-mark">
        <Show when={plots()}>
          <button
            type="button"
            class="expr-swatch"
            classList={{ off: props.row.hidden }}
            aria-label={props.row.hidden ? 'Show curve' : 'Hide curve'}
            aria-pressed={!props.row.hidden}
            onMouseDown={keepEditing}
            onClick={() => toggleHidden(props.row.id)}
          />
        </Show>
      </div>

      <div class="expr-body">
        <MathField
          value={props.row.source}
          onChange={(text, kind) => {
            updateSource(props.row.id, text, 'edit', kind);
            onEdit();
          }}
          // Keypad ↵ (the hardware key goes through onKeyDown): on the empty last row, where
          // Enter has nowhere to go, it means "done" and puts the keypad away.
          onEnter={() => enter() || blurActive()}
          onDeleteEmpty={() => deleteEmptyBackward(props.row.id)}
          onKeyDown={onKeyDown}
          onFocus={() => {
            typedSinceFocus = false;
          }}
          onBlur={() => {
            const made = commitSliders();
            if (made.names.length > 0) offerUndo(sliderToast(made.names));
            if (result()?.error && !quiet()) {
              clearTimeout(timer);
              setErrorVisible(true);
            }
          }}
          ref={(el) => {
            input = el;
            registerRowInput(props.row.id, el);
          }}
          errorSpan={error()?.span ?? null}
          ariaLabel={`Expression ${props.index + 1}`}
          placeholder={props.index === 0 ? 'Try y = sin(x)' : ''}
          testId="expr-input"
          names={nameContext()}
          inPlace
        />

        {/* Outside the error gate: a bad t/θ range is reported as a row error, and the fields
            must stay mounted (and focused) so it can be fixed. */}
        <Show when={rangeVariable()}>
          {(v) => <RangeControl row={props.row} variable={v()} showInvalid={!!error()} />}
        </Show>

        <Show when={shownError()}>
          {(err) => (
            <div
              class="expr-error"
              classList={{ closing: closing() }}
              role={closing() ? undefined : 'alert'}
              aria-hidden={closing() || undefined}
              inert={closing() || undefined}
            >
              <div class="expr-error-line">
                <span class="expr-error-icon" role="img" aria-label="Error">
                  <Icon name="alert" size={15} />
                </span>
                <span>{err().message}</span>
                <Show when={err().hint}>
                  <span class="expr-hint">{err().hint}</span>
                </Show>
                <For each={errorFixes(err())}>
                  {(fix) => <FixChip fix={fix} onMouseDown={keepFocus} onTake={takeFix} />}
                </For>
              </div>
            </div>
          )}
        </Show>

        <Show when={!shownError() && suggestion()}>
          {(names) => (
            <div class="expr-suggest">
              <div class="expr-suggest-line">
                <FixChip
                  fix={{ kind: 'addSliders', names: [...names()] }}
                  onMouseDown={keepFocus}
                  onTake={takeFix}
                />
              </div>
            </div>
          )}
        </Show>

        {/* While the row is held its slider and value stay, inert, rather than blink out. */}
        <Show when={(!error() || held()) && shown()}>
          {(res) => (
            <Switch>
              <Match when={res().kind === 'slider' && res().slider}>
                {(s) => (
                  <SliderControl
                    row={props.row}
                    name={s().name}
                    value={s().value}
                    stale={res() !== result()}
                  />
                )}
              </Match>
              <Match
                when={
                  (res().kind === 'constant' || res().kind === 'varDef') &&
                  res().value !== undefined
                }
              >
                <output class="expr-value" classList={{ stale: res() !== result() }}>
                  = {formatValue(res().value as number)}
                </output>
              </Match>
            </Switch>
          )}
        </Show>
      </div>

      <div class="expr-actions">
        <Show when={plots()}>
          <button
            type="button"
            class="icon-button expr-color"
            aria-label="Change color"
            aria-haspopup="true"
            aria-expanded={pickerOpen()}
            ref={colorButton}
            onMouseDown={keepEditing}
            onClick={() => setPickerOpen((o) => !o)}
          >
            <Icon name="palette" size={16} />
          </button>
        </Show>
        <button
          type="button"
          class="icon-button expr-delete"
          aria-label={`Delete expression ${props.index + 1}`}
          // The row being edited is deleted, not left first (which would end its edit: sliders).
          onMouseDown={keepFocus}
          onClick={remove}
        >
          <Icon name="close" size={16} />
        </button>
        <Show when={pickerOpen()}>
          <ColorPicker
            palette={props.palette}
            selected={props.row.colorIndex}
            anchor={colorButton}
            onPick={(i) => setColor(props.row.id, i)}
            onClose={() => setPickerOpen(false)}
          />
        </Show>
      </div>
    </li>
  );
}

/**
 * A fix offered with an error, or for unknown names while the row is edited: "→ x^2" rewrites
 * the text, "+ Add sliders: m, b" adds them. Neutral, like a suggestion; the error line says
 * what is wrong. `onTake` gets whether the button had focus (a keyboard press).
 */
function FixChip(props: {
  fix: QuickFix;
  onMouseDown: (e: MouseEvent) => void;
  onTake: (fix: QuickFix, focus: boolean) => void;
}) {
  return (
    <button
      type="button"
      class="quick-fix"
      onMouseDown={(e) => props.onMouseDown(e)}
      onClick={(e) => props.onTake(props.fix, e.detail === 0)}
    >
      <Switch>
        <Match when={props.fix.kind === 'replace' && props.fix}>
          {(fix) => (
            <>
              <Icon name="arrow-right" size={13} />
              <span class="visually-hidden">Write </span>
              <span class="quick-fix-text">{fix().label}</span>
            </>
          )}
        </Match>
        <Match when={props.fix.kind === 'addSliders' && props.fix}>
          {(fix) => (
            <>
              <Icon name="plus" size={13} />
              Add slider{fix().names.length > 1 ? 's' : ''}: {fix().names.join(', ')}
            </>
          )}
        </Match>
      </Switch>
    </button>
  );
}
