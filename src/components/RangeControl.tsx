import { evalNumber } from '../state/analysis';
import { type Row, setDomain } from '../state/doc';
import { blurActive, MathField } from './MathField';

/** "0 ≤ t ≤ 2π" parameter range for parametric and polar rows. */
export function RangeControl(props: {
  row: Row;
  variable: 't' | 'θ';
  /** The row's error is showing: flag the bound(s) that don't evaluate. */
  showInvalid: boolean;
}) {
  // An empty bound means the default range, as in the engine.
  const bad = (text: string) =>
    props.showInvalid && text.trim() !== '' && !Number.isFinite(evalNumber(text));
  return (
    <div class="range-control">
      <MathField
        class="range-bound"
        value={props.row.domain.min}
        onChange={(t) => setDomain(props.row.id, 'min', t)}
        onEnter={blurActive}
        invalid={bad(props.row.domain.min)}
        ariaLabel={`${props.variable} minimum`}
      />
      <span class="range-var">≤ {props.variable} ≤</span>
      <MathField
        class="range-bound"
        value={props.row.domain.max}
        onChange={(t) => setDomain(props.row.id, 'max', t)}
        onEnter={blurActive}
        invalid={bad(props.row.domain.max)}
        ariaLabel={`${props.variable} maximum`}
      />
    </div>
  );
}
