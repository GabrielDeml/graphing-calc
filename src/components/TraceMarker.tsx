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
            classList={{
              'flip-x': hit().sx > hit().viewWidth - 180,
              'flip-y': hit().sy < 48,
            }}
            style={{
              transform: `translate(${hit().sx}px, ${hit().sy}px)`,
              '--trace-color': hit().color,
            }}
            data-testid="trace"
          >
            <span class="trace-dot" />
            {/* The status holds only "(x, y)"; what the point is will sit beside it. */}
            <span class="trace-pill">
              <span class="trace-swatch" />
              <span class="trace-label" role="status">
                {label()}
              </span>
            </span>
          </div>
        );
      }}
    </Show>
  );
}
