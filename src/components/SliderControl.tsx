import { batch, createEffect, createMemo, createSignal, Show, untrack } from 'solid-js';
import { formatSliderValue, formatValue } from '../engine/format';
import { analysis, evalNumber, nameContext } from '../state/analysis';
import { endUndoStep, type Row, setSliderField, setSliderPlaying } from '../state/doc';
import { rowInput } from '../state/focus';
import { setSliderValue, smartBounds } from '../state/rowActions';
import { Icon } from './icons';
import { blurActive, MathField, textEndX } from './MathField';

/** The range's thumb diameter (--thumb in global.css). */
const THUMB_PX = 16;
/** Room the value bubble keeps from the end of the row's own text. */
const BUBBLE_GAP_PX = 8;

/**
 * `stale`: the row's text is broken for a moment while it is being edited, and this is its last
 * good slider, kept in place (inert) so the list doesn't jump at every keystroke.
 */
export function SliderControl(props: { row: Row; name: string; value: number; stale?: boolean }) {
  const min = createMemo(() => evalNumber(props.row.slider.min));
  const max = createMemo(() => evalNumber(props.row.slider.max));
  const step = createMemo(() => {
    const s = props.row.slider.step.trim() === '' ? 0 : evalNumber(props.row.slider.step);
    return Number.isFinite(s) && s > 0 ? s : 0;
  });
  const valid = () => Number.isFinite(min()) && Number.isFinite(max()) && max() > min();

  // Typing a value outside the bounds widens them (only when the bound is a plain number). The
  // new bound is the literal as typed, so rounding can't leave the value outside its range again.
  // A slider made automatically from an unknown name takes a round range around the value
  // instead (`a = 50`: 0…100), as long as its bounds are still the ones it was given.
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
      const outside =
        (Number.isFinite(max()) && v > max()) || (Number.isFinite(min()) && v < min());
      const smart = outside ? smartBounds(props.row.id, v) : null;
      if (smart) {
        batch(() => {
          setSliderField(props.row.id, 'min', smart.min);
          setSliderField(props.row.id, 'max', smart.max);
        });
      } else if (Number.isFinite(max()) && v > max() && plain(props.row.slider.max)) {
        setSliderField(props.row.id, 'max', typedLiteral(v));
      } else if (Number.isFinite(min()) && v < min() && plain(props.row.slider.min)) {
        setSliderField(props.row.id, 'min', typedLiteral(v));
      }
    });
  });

  /**
   * The last move came from the keyboard. Each arrow key press fires `change` too, so only a
   * pointer's change ends the undo step; key presses coalesce like typing instead.
   */
  let byKey = false;

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

  /** Where the value sits on the track, 0 to 1 (the fill and the bubble end there). */
  const fraction = () => {
    if (!valid()) return 0;
    const f = (props.value - min()) / (max() - min());
    return Number.isFinite(f) ? Math.min(1, Math.max(0, f)) : 0;
  };
  /** A pointer is dragging the thumb: the value shows above it. */
  const [dragging, setDragging] = createSignal(false);

  /**
   * Keep the bubble over the thumb but inside the track, and off the row's own text above it:
   * where they would overlap it hides, as "a = -8.5" right there shows the same value.
   */
  let bubble: HTMLSpanElement | undefined;
  createEffect(() => {
    if (!dragging()) return;
    const frac = fraction(); // and the value, whose text sets the bubble's width
    if (!bubble?.isConnected) return;
    const track = range.getBoundingClientRect();
    const half = bubble.offsetWidth / 2;
    const thumbX = THUMB_PX / 2 + frac * (track.width - THUMB_PX);
    const x = Math.min(Math.max(thumbX, half), track.width - half);
    bubble.style.left = `${x}px`;
    const text = rowInput(props.row.id);
    const covers = !!text && track.left + x - half < textEndX(text) + BUBBLE_GAP_PX;
    bubble.classList.toggle('covering', covers);
  });

  return (
    <div
      class="slider"
      classList={{ invalid: !valid(), stale: props.stale }}
      inert={props.stale || undefined}
    >
      <button
        type="button"
        class="slider-play icon-button"
        aria-label={props.row.slider.playing ? `Pause ${props.name}` : `Play ${props.name}`}
        aria-pressed={props.row.slider.playing}
        onClick={() => setSliderPlaying(props.row.id, !props.row.slider.playing)}
      >
        <Icon name={props.row.slider.playing ? 'pause' : 'play'} size={14} />
      </button>
      <MathField
        class="slider-bound slider-min"
        value={props.row.slider.min}
        onChange={(t) => setSliderField(props.row.id, 'min', t)}
        onEnter={blurActive}
        ariaLabel={`${props.name} slider minimum`}
        names={nameContext()}
      />
      <div class="slider-track" style={{ '--frac': String(fraction()) }}>
        <input
          ref={range}
          class="slider-range"
          type="range"
          disabled={!valid()}
          aria-label={`${props.name} value`}
          aria-valuetext={formatValue(props.value)}
          data-testid={`slider-${props.name}`}
          onKeyDown={() => {
            byKey = true;
          }}
          onPointerDown={(e) => {
            byKey = false;
            // Only the primary button drags (a context menu would swallow the pointerup).
            if (e.button === 0) setDragging(true);
          }}
          onContextMenu={() => setDragging(false)}
          onPointerUp={() => setDragging(false)}
          onPointerCancel={() => setDragging(false)}
          onLostPointerCapture={() => setDragging(false)}
          onInput={(e) =>
            setSliderValue(props.row.id, e.currentTarget.valueAsNumber, byKey ? 'key' : 'drag')
          }
          // Fires when a drag ends: the next move is a new undo step.
          onChange={() => {
            setDragging(false);
            if (!byKey) endUndoStep();
          }}
        />
        <Show when={dragging() && valid()}>
          <span class="slider-bubble" aria-hidden="true" ref={bubble}>
            {formatValue(props.value)}
          </span>
        </Show>
      </div>
      <MathField
        class="slider-bound slider-max"
        value={props.row.slider.max}
        onChange={(t) => setSliderField(props.row.id, 'max', t)}
        onEnter={blurActive}
        ariaLabel={`${props.name} slider maximum`}
        names={nameContext()}
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
          names={nameContext()}
        />
      </span>
    </div>
  );
}
