import { createSignal, For, onCleanup, Show } from 'solid-js';
import { formatCoordinate } from '../engine/format';
import type { TraceHit } from '../render/controller';

/** The pill's distance from the traced point, and the room it keeps from the graph's edge. */
const PILL_INSET_PX = 12;

/** What a traced point is: "Root", "Minimum · y-intercept", "Intersection with ● y = x/3". */
export interface TraceKind {
  /** The curves it meets there (their color and math), when it is an intersection. */
  meets: { color: string; text: string }[];
  /** Its other kinds, most notable first. */
  names: string[];
}

/**
 * DOM overlay for the traced point, so hovering never repaints the canvas. `kind` names what the
 * point is beside its coordinates; a plain curve point has none.
 */
export function TraceMarker(props: { hit: TraceHit | null; kind?: TraceKind | null }) {
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
                {(kind) => (
                  <span class="trace-kind">
                    <Show when={kind().meets.length > 0}>
                      <span>Intersection with</span>
                      <For each={kind().meets}>
                        {(m) => (
                          <span class="trace-meet" style={{ '--meet-color': m.color }}>
                            <span class="trace-meet-text">{m.text}</span>
                          </span>
                        )}
                      </For>
                    </Show>
                    <For each={kind().names}>
                      {(name) => <span class="trace-kind-name">{name}</span>}
                    </For>
                  </span>
                )}
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
