import { createSignal, For, onCleanup, Show } from 'solid-js';
import { formatCoordinate } from '../engine/format';
import type { TraceHit } from '../render/controller';
import { Icon } from './icons';

/** The pill's distance from the traced point, and the room it keeps from the graph's sides. */
const PILL_INSET_PX = 12;
/** The room it keeps from the graph's top and bottom, and from the floating controls. */
const EDGE_PX = 8;

/** A box in the graph, in px from its top left corner. */
export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** What a traced point is: "Root", "Minimum · y-intercept", "Intersection with ● y = x/3". */
export interface TraceKind {
  /** The curves it meets there (their color and math), when it is an intersection. */
  meets: { color: string; text: string }[];
  /** Its other kinds, most notable first. */
  names: string[];
}

/** One-tap actions at a pinned point of an explicit curve, each adding a row. */
export interface TraceActions {
  /** The tangent line there; absent where the curve has no slope (a corner, an end). */
  tangent?: () => void;
  /** The point itself. */
  keep: () => void;
}

/**
 * DOM overlay for the traced point, so hovering never repaints the canvas. `kind` names what the
 * point is beside its coordinates; a plain curve point has none. `scrubbing`: a finger is
 * dragging the point along its curve (the dot grows under it). `actions`: buttons after the
 * coordinates, for a pinned point. `avoid`: what the pill must not cover (the zoom controls).
 */
export function TraceMarker(props: {
  hit: TraceHit | null;
  kind?: TraceKind | null;
  scrubbing?: boolean;
  actions?: TraceActions | null;
  avoid?: Rect | null;
}) {
  return (
    <Show when={props.hit}>
      {(hit) => {
        const label = () =>
          `(${formatCoordinate(hit().x, hit().ppu)}, ${formatCoordinate(hit().y, hit().ppu)})`;
        const [size, setSize] = createSignal({ width: 156, height: 28 });
        const measure = (el: HTMLElement) => {
          if (typeof ResizeObserver === 'undefined') return;
          const ro = new ResizeObserver(() =>
            setSize({ width: el.offsetWidth, height: el.offsetHeight }),
          );
          ro.observe(el);
          onCleanup(() => ro.disconnect());
        };
        // No wider than the graph (a long kind is cut short on a phone)…
        const maxWidth = () => Math.max(0, hit().viewWidth - 2 * PILL_INSET_PX);
        const width = () => Math.min(size().width, maxWidth());
        /** The pill's top, above the point or (`below`) under it. */
        const top = (below: boolean) =>
          hit().sy + (below ? PILL_INSET_PX : -PILL_INSET_PX - size().height);
        /** The controls beside the pill at that height, if any. */
        const beside = (below: boolean) => {
          const a = props.avoid;
          const t = top(below);
          return a && t < a.bottom + EDGE_PX && t + size().height > a.top - EDGE_PX ? a : null;
        };
        // …to the point's right, or its left where it would run off the graph (or under the
        // controls) there, and moved in from the edge where it runs off on both sides.
        const pillLeft = (below: boolean) => {
          const { sx, viewWidth } = hit();
          const w = width();
          const a = beside(below);
          const right = Math.min(viewWidth - PILL_INSET_PX, a ? a.left - EDGE_PX : viewWidth);
          const want = sx + 2 * PILL_INSET_PX + w <= right ? PILL_INSET_PX : -PILL_INSET_PX - w;
          return Math.max(PILL_INSET_PX - sx, Math.min(want, right - w - sx));
        };
        const covers = (below: boolean) => {
          const a = beside(below);
          return !!a && hit().sx + pillLeft(below) + width() > a.left - EDGE_PX;
        };
        // Above the point, unless it would run off the top (its height counts: the actions make
        // it taller) or, still, cover the controls where below would not.
        const below = () => {
          if (top(false) < EDGE_PX) return true;
          const fits = top(true) + size().height <= hit().viewHeight - EDGE_PX;
          return covers(false) && fits && !covers(true);
        };
        return (
          <div
            class="trace"
            classList={{ 'flip-y': below(), scrubbing: !!props.scrubbing }}
            style={{
              transform: `translate(${hit().sx}px, ${hit().sy}px)`,
              '--trace-color': hit().color,
            }}
            data-testid="trace"
          >
            <span class="trace-dot" />
            <span
              class="trace-pill"
              classList={{ 'has-actions': !!props.actions }}
              ref={measure}
              style={{ left: `${pillLeft(below())}px`, 'max-width': `${maxWidth()}px` }}
            >
              <span class="trace-line">
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
              {/* On the far side of the coordinates from the point: a finger reaching for a
                  point beside the pinned one lands on the graph, not on these. */}
              <Show when={props.actions}>
                {(actions) => (
                  <span class="trace-actions">
                    <Show when={actions().tangent}>
                      {(tangent) => (
                        <button type="button" class="trace-action" onClick={() => tangent()()}>
                          <Icon name="tangent" size={14} />
                          Tangent here
                        </button>
                      )}
                    </Show>
                    <button type="button" class="trace-action" onClick={() => actions().keep()}>
                      <Icon name="add-point" size={14} />
                      Keep point
                    </button>
                  </span>
                )}
              </Show>
            </span>
          </div>
        );
      }}
    </Show>
  );
}
