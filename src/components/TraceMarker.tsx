import { createSignal, onCleanup, Show } from 'solid-js';
import { formatCoordinate } from '../engine/format';
import type { TraceHit } from '../render/controller';

/** The pill's distance from the traced point, and the room it keeps from the graph's edge. */
const PILL_INSET_PX = 12;

/**
 * DOM overlay for the traced point, so hovering never repaints the canvas. `kind` names what the
 * point is ("Root", "Intersection with …") beside its coordinates; a plain curve point has none.
 */
export function TraceMarker(props: { hit: TraceHit | null; kind?: string }) {
  return (
    <Show when={props.hit}>
      {(hit) => {
        const label = () =>
          `(${formatCoordinate(hit().x, hit().ppu)}, ${formatCoordinate(hit().y, hit().ppu)})`;
        // The pill goes to the point's left where it would run off the graph: as wide as its text.
        const [pillWidth, setPillWidth] = createSignal(156);
        const measure = (el: HTMLElement) => {
          if (typeof ResizeObserver === 'undefined') return;
          const ro = new ResizeObserver(() => setPillWidth(el.offsetWidth));
          ro.observe(el);
          onCleanup(() => ro.disconnect());
        };
        return (
          <div
            class="trace"
            classList={{
              'flip-x': hit().sx + pillWidth() + 2 * PILL_INSET_PX > hit().viewWidth,
              'flip-y': hit().sy < 48,
            }}
            style={{
              transform: `translate(${hit().sx}px, ${hit().sy}px)`,
              '--trace-color': hit().color,
            }}
            data-testid="trace"
          >
            <span class="trace-dot" />
            <span class="trace-pill" ref={measure}>
              <span class="trace-swatch" />
              <Show when={props.kind}>
                <span class="trace-kind">{props.kind}</span>
              </Show>
              {/* The status holds only "(x, y)". */}
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
