import { Show } from 'solid-js';
import { formatCoordinate } from '../engine/format';
import type { TraceHit } from '../render/controller';

/** DOM overlay for the traced point, so hovering never repaints the canvas. */
export function TraceMarker(props: { hit: TraceHit | null }) {
  return (
    <Show when={props.hit}>
      {(hit) => {
        const label = () =>
          `(${formatCoordinate(hit().x, hit().ppu)}, ${formatCoordinate(hit().y, hit().ppu)})`;
        return (
          <div
            class="trace"
            style={{
              transform: `translate(${hit().sx}px, ${hit().sy}px)`,
              '--swatch': hit().color,
            }}
            data-testid="trace"
          >
            <span class="trace-dot" />
            <span class="trace-label" role="status">
              {label()}
            </span>
          </div>
        );
      }}
    </Show>
  );
}
