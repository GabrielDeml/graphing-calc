import { createEffect, createMemo, untrack } from 'solid-js';
import { formatSliderValue, formatValue } from '../engine/format';
import { evalNumber } from '../state/analysis';
import { type Row, setSliderField, setSliderPlaying } from '../state/doc';
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

  // Typing a value outside the bounds widens them (only when the bound is a plain number).
  createEffect(() => {
    const v = props.value;
    if (!Number.isFinite(v)) return;
    untrack(() => {
      const plain = (s: string) => /^\s*-?\d*\.?\d+\s*$/.test(s);
      if (Number.isFinite(max()) && v > max() && plain(props.row.slider.max)) {
        setSliderField(props.row.id, 'max', formatSliderValue(v, step(), min(), v));
      } else if (Number.isFinite(min()) && v < min() && plain(props.row.slider.min)) {
        setSliderField(props.row.id, 'min', formatSliderValue(v, step(), v, max()));
      }
    });
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
        class="slider-range"
        type="range"
        min={valid() ? min() : 0}
        max={valid() ? max() : 1}
        step={step() || 'any'}
        value={props.value}
        disabled={!valid()}
        aria-label={`${props.name} value`}
        aria-valuetext={formatValue(props.value)}
        data-testid={`slider-${props.name}`}
        onInput={(e) => setSliderValue(props.row.id, e.currentTarget.valueAsNumber)}
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
