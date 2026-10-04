import {
  createEffect,
  createMemo,
  createSignal,
  Match,
  on,
  onCleanup,
  Show,
  Switch,
} from 'solid-js';
import { formatValue } from '../engine/format';
import { analysis } from '../state/analysis';
import { type Row, removeRow, setColor, toggleHidden, updateSource } from '../state/doc';
import { registerRowInput, unregisterRowInput } from '../state/focus';
import {
  addSliders,
  deleteEmptyBackward,
  deleteEmptyForward,
  enterFrom,
  focusSibling,
} from '../state/rowActions';
import { ColorPicker } from './ColorPicker';
import { MathField } from './MathField';
import { RangeControl } from './RangeControl';
import { SliderControl } from './SliderControl';

const ERROR_DELAY_MS = 500;

export function ExpressionRow(props: { row: Row; index: number; palette: readonly string[] }) {
  const result = createMemo(() => analysis().byId.get(props.row.id));
  const [errorVisible, setErrorVisible] = createSignal(false);
  const [pickerOpen, setPickerOpen] = createSignal(false);
  let input: HTMLInputElement | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;

  // Errors show after a pause in typing (or on blur) and disappear as soon as they are fixed.
  createEffect(
    on([() => props.row.source, () => result()?.error], ([, error]) => {
      clearTimeout(timer);
      if (!error) setErrorVisible(false);
      else if (!errorVisible()) timer = setTimeout(() => setErrorVisible(true), ERROR_DELAY_MS);
    }),
  );
  onCleanup(() => {
    clearTimeout(timer);
    if (input) unregisterRowInput(props.row.id, input);
  });

  const error = () => (errorVisible() ? result()?.error : undefined);
  const color = () => props.palette[props.row.colorIndex] ?? props.palette[0];
  const plots = () => result()?.status === 'ok' && !!result()?.plot;

  const onKeyDown = (e: KeyboardEvent & { currentTarget: HTMLInputElement }) => {
    const el = e.currentTarget;
    const empty = el.value === '';
    const caret = el.selectionStart ?? 0;
    switch (e.key) {
      case 'Enter':
        e.preventDefault();
        enterFrom(props.row.id);
        break;
      case 'Backspace':
        if (empty && deleteEmptyBackward(props.row.id)) e.preventDefault();
        break;
      case 'Delete':
        if (empty && deleteEmptyForward(props.row.id)) e.preventDefault();
        break;
      case 'ArrowUp':
        if (focusSibling(props.row.id, -1, caret)) e.preventDefault();
        break;
      case 'ArrowDown':
        if (focusSibling(props.row.id, 1, caret)) e.preventDefault();
        break;
      case 'Escape':
        el.blur();
        break;
    }
  };

  return (
    <li
      class="expr-row"
      classList={{ 'has-error': !!error(), hidden: props.row.hidden }}
      data-row-id={props.row.id}
      data-kind={result()?.kind ?? ''}
    >
      <div class="expr-gutter">
        <span class="expr-index">{props.index + 1}</span>
        <Switch>
          <Match when={error()}>
            <span class="expr-warning" role="img" aria-label="Error">
              ⚠
            </span>
          </Match>
          <Match when={plots()}>
            <button
              type="button"
              class="expr-swatch"
              classList={{ off: props.row.hidden }}
              style={{ '--swatch': color() }}
              aria-label={props.row.hidden ? 'Show curve' : 'Hide curve'}
              aria-pressed={!props.row.hidden}
              onClick={() => toggleHidden(props.row.id)}
            />
          </Match>
        </Switch>
      </div>

      <div class="expr-body">
        <MathField
          value={props.row.source}
          onChange={(text) => updateSource(props.row.id, text)}
          onEnter={() => enterFrom(props.row.id)}
          onDeleteEmpty={() => deleteEmptyBackward(props.row.id)}
          onKeyDown={onKeyDown}
          onBlur={() => {
            if (result()?.error) {
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
        />

        <Show when={error()}>
          {(err) => (
            <div class="expr-error" role="alert">
              <span>{err().message}</span>
              <Show when={err().hint}>
                <span class="expr-hint">{err().hint}</span>
              </Show>
              <Show when={err().quickFix}>
                {(fix) => (
                  <button
                    type="button"
                    class="quick-fix"
                    onClick={() => addSliders(props.row.id, fix().names)}
                  >
                    Add slider{fix().names.length > 1 ? 's' : ''}: {fix().names.join(', ')}
                  </button>
                )}
              </Show>
            </div>
          )}
        </Show>

        <Show when={!error() && result()}>
          {(res) => (
            <Switch>
              <Match when={res().kind === 'slider' && res().slider}>
                {(s) => <SliderControl row={props.row} name={s().name} value={s().value} />}
              </Match>
              <Match
                when={
                  (res().kind === 'constant' || res().kind === 'varDef') &&
                  res().value !== undefined
                }
              >
                <output class="expr-value">= {formatValue(res().value as number)}</output>
              </Match>
              <Match when={res().kind === 'parametric'}>
                <RangeControl row={props.row} variable="t" />
              </Match>
              <Match when={res().kind === 'polar'}>
                <RangeControl row={props.row} variable="θ" />
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
            style={{ '--swatch': color() }}
            onClick={() => setPickerOpen((o) => !o)}
          >
            <span class="dot" />
          </button>
        </Show>
        <button
          type="button"
          class="icon-button expr-delete"
          aria-label={`Delete expression ${props.index + 1}`}
          onClick={() => removeRow(props.row.id)}
        >
          ×
        </button>
        <Show when={pickerOpen()}>
          <ColorPicker
            palette={props.palette}
            selected={props.row.colorIndex}
            onPick={(i) => setColor(props.row.id, i)}
            onClose={() => setPickerOpen(false)}
          />
        </Show>
      </div>
    </li>
  );
}
