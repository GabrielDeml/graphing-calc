import { createEffect, createMemo, untrack } from 'solid-js';
import { formatSliderValue, formatValue } from '../engine/format';
import { analysis, evalNumber } from '../state/analysis';
import { endUndoStep, type Row, setSliderField, setSliderPlaying } from '../state/doc';
import { setSliderValue } from '../state/rowActions';
import { blurActive, MathField } from './MathField';

export function SliderControl(props: { row: Row; name: string; value: number }) {
  const min = createMemo(() => evalNumber(props.row.slider.min));
  const max = createMemo(() => evalNumber(props.row.slider.max));
  const step = createMemo(() => {
    const s = props.row.slider.step.trim() === '' ? 0 : evalNumber(props.row.slider.step);
    return Number.isFinite(s) && s > 0 ? s : 0;
  });
  const valid = () => Number.isFinite(min()) && Number.isFinite(max()) && max() > min();

  // Typing a value outside the bounds widens them (only when the bound is a plain number). The
  // new bound is the literal as typed, so rounding can't leave the value outside its range again.
  const plain = (s: string) => /^\s*-?\d*\.?\d+\s*$/.test(s);
  const typedLiteral = (v: number) => {
    const span = analysis().byId.get(props.row.id)?.slider?.valueSpan;
    const text = span ? props.row.source.slice(span.start, span.end) : '';
    const literal = text.replace(/\s+/g, '').replace('−', '-').replace(/^\+/, '');
    return plain(literal) && Number(literal) === v ? literal : formatSliderValue(v, 0, 0, 0);
  };
  createEffect(() => {
    const v = props.value;
    if (!Number.isFinite(v)) return;
    untrack(() => {
      if (Number.isFinite(max()) && v > max() && plain(props.row.slider.max)) {
        setSliderField(props.row.id, 'max', typedLiteral(v));
      } else if (Number.isFinite(min()) && v < min() && plain(props.row.slider.min)) {
        setSliderField(props.row.id, 'min', typedLiteral(v));
      }
    });
  });

  // One effect sets the bounds and then the value: the browser clamps `value` to the current
  // min/max, so it has to be re-applied whenever they change, not only when the value does.
  let range!: HTMLInputElement;
  createEffect(() => {
    const ok = valid();
    range.min = String(ok ? min() : 0);
    range.max = String(ok ? max() : 1);
    range.step = step() ? String(step()) : 'any';
    range.value = String(props.value);
  });

  return (
    <div class="slider" classList={{ invalid: !valid() }}>
      <button
        type="button"
        class="slider-play icon-button"
        aria-label={props.row.slider.playing ? `Pause ${props.name}` : `Play ${props.name}`}
        aria-pressed={props.row.slider.playing}
        onClick={() => setSliderPlaying(props.row.id, !props.row.slider.playing)}
      >
        {props.row.slider.playing ? '❚❚' : '▶'}
      </button>
      <MathField
        class="slider-bound"
        value={props.row.slider.min}
        onChange={(t) => setSliderField(props.row.id, 'min', t)}
        onEnter={blurActive}
        ariaLabel={`${props.name} slider minimum`}
      />
      <input
        ref={range}
        class="slider-range"
        type="range"
        disabled={!valid()}
        aria-label={`${props.name} value`}
        aria-valuetext={formatValue(props.value)}
        data-testid={`slider-${props.name}`}
        onInput={(e) => setSliderValue(props.row.id, e.currentTarget.valueAsNumber, 'drag')}
        // Fires when the drag (or a key press) ends: the next move is a new undo step.
        onChange={endUndoStep}
      />
      <MathField
        class="slider-bound"
        value={props.row.slider.max}
        onChange={(t) => setSliderField(props.row.id, 'max', t)}
        onEnter={blurActive}
        ariaLabel={`${props.name} slider maximum`}
      />
      <span class="slider-step">
        <span aria-hidden="true">step</span>
        <MathField
          class="slider-bound"
          value={props.row.slider.step}
          placeholder="any"
          onChange={(t) => setSliderField(props.row.id, 'step', t)}
          onEnter={blurActive}
          ariaLabel={`${props.name} slider step`}
        />
      </span>
    </div>
  );
}
