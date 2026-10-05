import { type Accessor, createEffect, createSignal, For, on, type Setter } from 'solid-js';
import { formatCoordinate } from '../engine/format';
import type { Poi } from '../plot/poi';
import type { Viewport } from '../plot/types';
import { toScreenX, toScreenY } from '../plot/viewport';

/** Points of interest as the controller found them: on which row, and in which view. */
export interface PoiSet {
  rowId: string;
  pois: readonly Poi[];
  view: Viewport;
}

export interface PoiLayerHandle {
  /** Move the dots to where `view` puts them: one style write for the whole layer per frame. */
  place(view: Viewport): void;
}

/** A point that persists across recomputations (a pan, a zoom, a slider) keeps its dot. */
interface Item {
  poi: Accessor<Poi>;
  setPoi: Setter<Poi>;
  /** Place among the dots that appeared with it, left to right: they bloom one after another. */
  order: number;
}

/** Recomputed points within this many px of an old one, of the same kinds, are that one. */
const SAME_PX = 2;
/** Bloom delays stop growing after this many dots. */
const STAGGER_MAX = 8;

const KIND_NAMES = {
  max: 'Local maximum',
  min: 'Local minimum',
  root: 'Root',
  xIntercept: 'x-intercept',
  yIntercept: 'y-intercept',
  intersection: 'Intersection',
} as const;

/** "Local maximum (1.41, 2)", "Intersection with y = x/3 (2.28, 0.76)". */
export function poiLabel(poi: Poi, ppu: number, meets: readonly string[]): string {
  const names = poi.kinds.map((k) =>
    k === 'intersection' && meets.length > 0
      ? `Intersection with ${meets.join(' and ')}`
      : KIND_NAMES[k],
  );
  const at = `(${formatCoordinate(poi.x, ppu)}, ${formatCoordinate(poi.y, ppu)})`;
  return `${names.join(', ')} ${at}`;
}

function sameKinds(a: Poi, b: Poi): boolean {
  return a.kinds.length === b.kinds.length && a.kinds.every((k, i) => k === b.kinds[i]);
}

/**
 * The points of interest of the emphasised curve: grey rings over the graph that bloom in when
 * found. Each is a button (outside the canvas's img role) labelled with what and where it is;
 * keyboard focus or Enter pins the trace on it (`onPin`), and the arrow keys move between them.
 * Pointers go through to the graph, whose trace snaps to a point near the pointer.
 */
export function PoiLayer(props: {
  set: PoiSet | null;
  /** Names of the curves an intersection is with ("y = x/3"). */
  meets: (poi: Poi) => string[];
  onPin: (poi: Poi, rowId: string) => void;
  ref: (handle: PoiLayerHandle) => void;
}) {
  let layer!: HTMLDivElement;
  let items: Item[] = [];
  const [list, setList] = createSignal<Item[]>([]);
  /** The dot the Tab key lands on (roving tabindex): the last one focused, else the first. */
  const [active, setActive] = createSignal<Item | null>(null);
  /** The view the dots' base positions were computed in. */
  const [ref, setRef] = createSignal<Viewport | null>(null);

  createEffect(
    on(
      () => props.set,
      (set) => {
        if (!set) {
          items = [];
          setList([]);
          return;
        }
        const { view } = set;
        const left = [...set.pois];
        const px = (a: Poi, b: Poi) => Math.hypot((a.x - b.x) * view.ppuX, (a.y - b.y) * view.ppuY);
        // Dots that are still there keep their place in the DOM (moving one would restart its
        // bloom); new ones go after them.
        const next: Item[] = [];
        for (const it of items) {
          const i = left.findIndex(
            (poi) => sameKinds(it.poi(), poi) && px(it.poi(), poi) < SAME_PX,
          );
          if (i < 0) continue;
          it.setPoi(left[i]);
          left.splice(i, 1);
          next.push(it);
        }
        left.sort((a, b) => a.x - b.x);
        left.forEach((poi, k) => {
          const [get, put] = createSignal(poi);
          next.push({ poi: get, setPoi: put, order: Math.min(k, STAGGER_MAX) });
        });
        const a = active();
        if (a && !next.includes(a)) setActive(null);
        items = next;
        setRef(view);
        // Found in the current view: the positions need no mapping until it moves.
        const s = layer.style;
        for (const v of ['--kx', '--ky']) s.setProperty(v, '1');
        for (const v of ['--ox', '--oy']) s.setProperty(v, '0');
        setList(next);
      },
    ),
  );

  props.ref({
    place(view) {
      const r = ref();
      if (!r) return;
      const kx = view.ppuX / r.ppuX;
      const ky = view.ppuY / r.ppuY;
      const s = layer.style;
      s.setProperty('--kx', String(kx));
      s.setProperty('--ky', String(ky));
      s.setProperty(
        '--ox',
        String((r.cx - view.cx) * view.ppuX + view.width / 2 - (kx * r.width) / 2),
      );
      s.setProperty(
        '--oy',
        String(view.height / 2 - (r.cy - view.cy) * view.ppuY - (ky * r.height) / 2),
      );
    },
  });

  /** Arrow keys walk the dots left to right (then by height). */
  const step = (from: HTMLElement, delta: 1 | -1) => {
    const dots = [...layer.querySelectorAll<HTMLButtonElement>('.poi')];
    dots.sort((a, b) => {
      const ra = a.getBoundingClientRect();
      const rb = b.getBoundingClientRect();
      return ra.left - rb.left || ra.top - rb.top;
    });
    const i = dots.indexOf(from as HTMLButtonElement);
    dots[(i + delta + dots.length) % dots.length]?.focus();
  };

  return (
    // biome-ignore lint/a11y/useSemanticElements: an overlay of point buttons, not a form fieldset.
    <div class="poi-layer" ref={layer} role="group" aria-label="Points of interest">
      <For each={list()}>
        {(item) => {
          const pin = () => {
            const set = props.set;
            if (set) props.onPin(item.poi(), set.rowId);
          };
          return (
            <button
              type="button"
              class="poi"
              tabindex={item === (active() ?? list()[0]) ? 0 : -1}
              aria-label={poiLabel(item.poi(), ref()?.ppuX ?? 1, props.meets(item.poi()))}
              style={{
                '--sx0': String(toScreenX(ref() ?? props.set?.view ?? ZERO, item.poi().x)),
                '--sy0': String(toScreenY(ref() ?? props.set?.view ?? ZERO, item.poi().y)),
                '--i': String(item.order),
              }}
              onFocus={(e) => {
                setActive(item);
                // Keyboard focus pins the trace here; a click goes through the graph's tap.
                if (e.currentTarget.matches(':focus-visible')) pin();
              }}
              onClick={(e) => {
                if (e.detail === 0) pin();
              }}
              onKeyDown={(e) => {
                if (e.key === 'ArrowRight' || e.key === 'ArrowDown') step(e.currentTarget, 1);
                else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') step(e.currentTarget, -1);
                else return;
                e.preventDefault();
              }}
            />
          );
        }}
      </For>
    </div>
  );
}

const ZERO: Viewport = { cx: 0, cy: 0, ppuX: 1, ppuY: 1, width: 0, height: 0 };
