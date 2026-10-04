import { type Row, setDomain } from '../state/doc';
import { blurActive, MathField } from './MathField';

/** "0 ≤ t ≤ 2π" parameter range for parametric and polar rows. */
export function RangeControl(props: { row: Row; variable: 't' | 'θ' }) {
  return (
    <div class="range-control">
      <MathField
        class="range-bound"
        value={props.row.domain.min}
        onChange={(t) => setDomain(props.row.id, 'min', t)}
        onEnter={blurActive}
        ariaLabel={`${props.variable} minimum`}
      />
      <span class="range-var">≤ {props.variable} ≤</span>
      <MathField
        class="range-bound"
        value={props.row.domain.max}
        onChange={(t) => setDomain(props.row.id, 'max', t)}
        onEnter={blurActive}
        ariaLabel={`${props.variable} maximum`}
      />
    </div>
  );
}
