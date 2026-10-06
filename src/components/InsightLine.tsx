import {
  batch,
  createEffect,
  createMemo,
  createSignal,
  Index,
  on,
  onCleanup,
  Show,
  untrack,
} from 'solid-js';
import type { PlotItem, RowResult } from '../engine/types';
import {
  type Insight,
  type InsightFact,
  type InsightInput,
  type InsightValue,
  rowInsight,
} from '../plot/insights';
import { analysis, engine } from '../state/analysis';
import { doc } from '../state/doc';
import { censusHolds, insightSources } from '../state/insight';
import { palette } from '../state/theme';
import { ui } from '../state/ui';
import { InlineMath } from './InlineMath';

/** A row's line is read this long after what it reads last changed (typing, a new curve)… */
const SETTLE_MS = 300;
/** …and while only values change (a slider playing or dragged), at most this often. */
const THROTTLE_MS = 300;
/** How long the line takes to close (--dur-2 in global.css). */
const CLOSE_MS = 160;

/**
 * What the line is read from. 'closed': nothing to say (no math, an error showing, a hidden
 * curve); 'pending': broken for a moment while it is typed in, so the line waits, dimmed.
 * `ident` is what the row is (its plot, or the name it defines): a new one fades a new line in,
 * while the same one with new values (a slider moving) only updates the line. `waiting`: what
 * the graph counted in view no longer holds (the values moved), and a new count is to come.
 */
type Reading =
  | 'closed'
  | 'pending'
  | { ident: unknown; input: InsightInput; values: readonly number[]; waiting: boolean };

/**
 * One quiet line under a row that says what its curve is (src/plot/insights.ts): "Parabola ·
 * vertex (1, −2) · roots −0.414, 2.414 · axis x = 1"; for a slider, variable or function, the
 * rows that use it; for the selected row, also where it meets the other curves. It is read off
 * the per-frame path, once the row settles, and fades in. Values at a point are chips: one flies
 * the graph there and pins the trace on it.
 */
export function InsightLine(props: {
  rowId: string;
  /** The row's current result (not the one held while it is typed in). */
  result: RowResult | undefined;
  /** Say nothing: the row's error line shows, or its curve is hidden. */
  closed: boolean;
  /** Pressing a chip (the row being edited keeps its caret). */
  onMouseDown: (e: MouseEvent) => void;
}) {
  const reading = createMemo<Reading>(
    () => {
      const res = props.result;
      if (props.closed || !res || res.status === 'empty') return 'closed';
      if (res.status !== 'ok' || !res.kind) return 'pending';
      const id = props.rowId;
      const input: InsightInput = { kind: res.kind, plot: res.plot };
      const values: number[] = [];
      let waiting = false;
      // A slider, a variable or a function (one that plots too, f(x) = x²): the rows using it.
      if (res.definedName) input.usedBy = insightSources.usersOf(res.definedName, id);
      if (res.plot) {
        const a = analysis();
        const deps: string[] = [];
        const valuesOf = (names: ReadonlySet<string>) => {
          for (const dep of names) {
            deps.push(dep);
            values.push(a.values.get(dep) ?? Number.NaN);
          }
        };
        valuesOf(res.deps);
        if (ui.selectedRowId() === id) {
          const others: { id: string; plot: PlotItem }[] = [];
          for (const row of doc.rows) {
            const r = a.byId.get(row.id);
            if (row.id === id || row.hidden || r?.status !== 'ok' || !r.plot) continue;
            others.push({ id: row.id, plot: r.plot });
            valuesOf(r.deps);
          }
          input.others = others;
          // What the graph counted in view, while it holds (a slider moving makes it wait).
          const census = insightSources.census(id);
          const plots = others.map((o) => o.plot);
          if (census && censusHolds(census, res.plot, plots, deps, a.values)) {
            input.inView = census.facts;
          } else {
            input.inView = null;
            waiting = census?.plot === res.plot;
          }
        }
      }
      return { ident: res.plot ?? `${res.kind} ${res.definedName ?? ''}`, input, values, waiting };
    },
    'closed',
    { equals: sameReading },
  );

  const [insight, setInsight] = createSignal<Insight | null>(null);
  /** The line waits for its row to settle: what it says may no longer hold. */
  const [dim, setDim] = createSignal(false);
  // The line keeps showing what it said while it closes.
  const [shown, setShown] = createSignal<Insight | null>(null);
  const [closing, setClosing] = createSignal(false);
  let closeTimer: ReturnType<typeof setTimeout> | undefined;
  /**
   * The row came with its math already settled (a reload, an undo, a slider made for it): its
   * line is there at once, as the row is, rather than opening under it a moment later and
   * pushing the list down. Only that first line: one that opens later opens.
   */
  const [instant, setInstant] = createSignal(false);
  createEffect(() => {
    const next = insight();
    clearTimeout(closeTimer);
    if (next) {
      setShown(next);
      setClosing(false);
    } else if (untrack(shown)) {
      setClosing(true);
      closeTimer = setTimeout(() => {
        batch(() => {
          setShown(null);
          setClosing(false);
          setInstant(false);
        });
      }, CLOSE_MS);
    } else setInstant(false);
  });
  let line: HTMLParagraphElement | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let lastRun = Number.NEGATIVE_INFINITY;
  /** What the line last read… */
  let lastIdent: unknown;
  /** …and what it waits to read, once it settles. */
  let pendingIdent: unknown;
  /** The reading as it is now: a timer reads this, not the one it was set for. */
  let latest: Reading = 'closed';

  const read = (fresh: boolean) => {
    const r = latest;
    timer = undefined;
    pendingIdent = undefined;
    if (typeof r === 'string') return;
    lastRun = performance.now();
    lastIdent = r.ident;
    let next: Insight | null = null;
    try {
      const plot = r.input.plot;
      const trigArgs = plot ? engine.trigArguments(props.rowId, plot) : null;
      next = rowInsight({ ...r.input, trigArgs });
    } catch (err) {
      console.warn('Failed to read the curve of row', props.rowId, err);
    }
    // Nothing to say until the graph counts again (a slider moving): the line waits, dimmed.
    if (!next && r.waiting && untrack(insight)) {
      setDim(true);
      return;
    }
    const shownBefore = untrack(shown) !== null && !untrack(closing);
    batch(() => {
      setDim(false);
      // The same words and places (a slider moving what the line doesn't name): left as it is.
      if (!sameInsight(next, untrack(insight))) setInsight(next);
    });
    // A new line over an old one fades in (a first one opens: see .expr-insight).
    if (fresh && next && shownBefore && line) {
      line.classList.remove('fresh');
      void line.offsetWidth; // restart the animation
      line.classList.add('fresh');
    }
  };

  let mounting = true;
  createEffect(
    on(reading, (r) => {
      const atMount = mounting;
      mounting = false;
      latest = r;
      if (r === 'closed' || r === 'pending') {
        clearTimeout(timer);
        timer = undefined;
        pendingIdent = undefined;
        if (r === 'pending') {
          setDim(untrack(insight) !== null);
          return;
        }
        lastIdent = undefined;
        batch(() => {
          setDim(false);
          setInsight(null);
        });
        return;
      }
      if (atMount) {
        setInstant(true);
        read(false);
        return;
      }
      if (r.ident === lastIdent) {
        // The same curve with new values (a slider moving): read at most every THROTTLE_MS. A
        // read already due takes the latest values.
        if (pendingIdent !== undefined) {
          clearTimeout(timer);
          timer = undefined;
          pendingIdent = undefined;
        }
        timer ??= setTimeout(
          () => read(false),
          Math.max(0, lastRun + THROTTLE_MS - performance.now()),
        );
      } else if (r.ident !== pendingIdent) {
        // Something new: read once it has stayed for SETTLE_MS, however its values move meanwhile
        // (a row typed in while a slider it uses plays).
        clearTimeout(timer);
        pendingIdent = r.ident;
        setDim(untrack(insight) !== null);
        timer = setTimeout(() => read(true), SETTLE_MS);
      }
    }),
  );

  onCleanup(() => {
    clearTimeout(timer);
    clearTimeout(closeTimer);
  });

  /** A line longer than the row fades out at its end (and its start, once scrolled along). */
  const measure = () => {
    if (!line) return;
    const overflow = line.scrollWidth > line.clientWidth + 1;
    line.classList.toggle('overflowing', overflow);
    line.classList.toggle('scrolled', overflow && line.scrollLeft > 0);
  };
  createEffect(on(shown, measure));
  const watch = (el: HTMLParagraphElement) => {
    line = el;
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    onCleanup(() => ro.disconnect());
  };

  return (
    <Show when={shown()}>
      {(s) => (
        <div
          class="expr-insight"
          classList={{ closing: closing(), dim: dim(), instant: instant() }}
          aria-hidden={closing() || undefined}
          inert={closing() || undefined}
        >
          <p
            class="expr-insight-line"
            ref={watch}
            data-testid="insight"
            onScroll={measure}
            onFocusOut={(e) => {
              // A chip focused past the end scrolled the line along; it starts over after.
              if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
                e.currentTarget.scrollLeft = 0;
              }
            }}
          >
            <Show when={s().title}>{(title) => <span class="insight-title">{title()}</span>}</Show>
            {/* By place, so a line updated in place (a slider moving) keeps its nodes. */}
            <Index each={s().facts}>
              {(fact, i) => (
                <>
                  <Show when={i > 0 || s().title}>
                    {/* The dot ends a line rather than starts one. */}
                    <span class="insight-sep" aria-hidden="true">
                      {'\u00a0· '}
                    </span>
                  </Show>
                  <Fact
                    fact={fact()}
                    first={i === 0 && !s().title}
                    rowId={props.rowId}
                    onMouseDown={props.onMouseDown}
                  />
                </>
              )}
            </Index>
          </p>
        </div>
      )}
    </Show>
  );
}

/** "roots −1.414, 1.414", "used by ● y = a x", "meets ● y = x/3 at 3 points". */
function Fact(props: {
  fact: InsightFact;
  /** It starts the line: its first word is capitalised. */
  first: boolean;
  rowId: string;
  onMouseDown: (e: MouseEvent) => void;
}) {
  const label = () => {
    const l = props.fact.label;
    return props.first ? l.charAt(0).toUpperCase() + l.slice(1) : l;
  };
  /** The values, then the rows, it names. */
  const items = (): { value?: InsightValue; row?: string }[] => [
    ...(props.fact.values ?? []).map((value) => ({ value })),
    ...(props.fact.rows ?? []).map((row) => ({ row })),
  ];
  return (
    <span class="insight-fact">
      <Show when={items().length === 0}>{label()}</Show>
      {/*
        Each item in its own span: its words and comma are then text updated in place, beside a
        chip that stays put. (Bare strings in a fragment are made anew on every update, and the
        chip between them is taken out and put back: a press on it while a slider plays is lost,
        and its focus with it.)
      */}
      <Index each={items()}>
        {(item, j) => (
          <span>
            {j > 0 ? ' ' : ''}
            {j === 0 && label() !== '' ? `${label()}\u00a0` : ''}
            <Show when={item().value} fallback={<RowRef id={item().row ?? ''} />}>
              {(value) => (
                <Value value={value()} rowId={props.rowId} onMouseDown={props.onMouseDown} />
              )}
            </Show>
            {j < items().length - 1 ? ',' : ''}
          </span>
        )}
      </Index>
      {/* (An expression, not a <Show> callback: that would keep the first tail it was given.) */}
      {props.fact.tail ? `\u00a0${props.fact.tail}` : ''}
    </span>
  );
}

/** A value; at a point, a chip that flies the graph there (and pins the trace on the curve). */
function Value(props: {
  value: InsightValue;
  rowId: string;
  onMouseDown: (e: MouseEvent) => void;
}) {
  return (
    <Show when={props.value.at} fallback={<span class="insight-value">{props.value.text}</span>}>
      {(at) => (
        <button
          type="button"
          class="insight-value insight-chip"
          aria-label={`${props.value.name} ${props.value.text}`}
          onMouseDown={(e) => props.onMouseDown(e)}
          onClick={() => ui.flyTo(props.rowId, at().x, at().y, !props.value.offCurve)}
        >
          {props.value.text}
        </button>
      )}
    </Show>
  );
}

/** A row named in a line is cut short past this many characters. */
const ROW_REF_MAX = 24;

/** Another row, as its color and its math ("● y = x/3"). */
function RowRef(props: { id: string }) {
  const row = () => doc.rows.find((r) => r.id === props.id);
  const color = () => {
    const i = row()?.colorIndex ?? -1;
    return i >= 0 ? (palette()[i] ?? palette()[0]) : undefined;
  };
  return (
    <span class="insight-row" classList={{ colored: !!color() }} style={{ '--ref-color': color() }}>
      <InlineMath text={row()?.source.trim() ?? ''} max={ROW_REF_MAX} />
    </span>
  );
}

function sameReading(a: Reading, b: Reading): boolean {
  if (typeof a === 'string' || typeof b === 'string') return a === b;
  const [p, q] = [a.input, b.input];
  return (
    a.ident === b.ident &&
    a.waiting === b.waiting &&
    p.kind === q.kind &&
    p.plot === q.plot &&
    p.inView === q.inView &&
    sameList(p.usedBy, q.usedBy, (x, y) => x === y) &&
    sameList(p.others, q.others, (x, y) => x.id === y.id && x.plot === y.plot) &&
    sameList(a.values, b.values, (x, y) => x === y || (Number.isNaN(x) && Number.isNaN(y)))
  );
}

function sameInsight(a: Insight | null, b: Insight | null): boolean {
  if (a === b) return true;
  if (!a || !b || a.title !== b.title) return false;
  return sameList(
    a.facts,
    b.facts,
    (f, g) =>
      f.label === g.label &&
      f.tail === g.tail &&
      sameList(f.rows, g.rows, (x, y) => x === y) &&
      sameList(
        f.values,
        g.values,
        (v, w) =>
          v.text === w.text &&
          v.name === w.name &&
          v.offCurve === w.offCurve &&
          v.at?.x === w.at?.x &&
          v.at?.y === w.at?.y,
      ),
  );
}

function sameList<T>(
  a: readonly T[] | undefined,
  b: readonly T[] | undefined,
  same: (x: T, y: T) => boolean,
): boolean {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return false;
  return a.every((x, i) => same(x, b[i] as T));
}
