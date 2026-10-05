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
import { insightSources } from '../state/insight';
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
 * while the same one with new values (a slider moving) only updates the line.
 */
type Reading =
  | 'closed'
  | 'pending'
  | { ident: unknown; input: InsightInput; values: readonly number[] };

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
      if (res.definedName && !res.plot) {
        input.usedBy = insightSources.usersOf(res.definedName, id);
      }
      if (res.plot) {
        const a = analysis();
        const valuesOf = (deps: ReadonlySet<string>) => {
          for (const dep of deps) values.push(a.values.get(dep) ?? Number.NaN);
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
          const census = insightSources.census(id);
          input.inView = census?.plot === res.plot ? census.facts : null;
        }
      }
      return { ident: res.plot ?? `${res.kind} ${res.definedName ?? ''}`, input, values };
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
  createEffect(() => {
    const next = insight();
    clearTimeout(closeTimer);
    if (next) {
      setShown(next);
      setClosing(false);
    } else if (untrack(shown)) {
      setClosing(true);
      closeTimer = setTimeout(() => {
        setShown(null);
        setClosing(false);
      }, CLOSE_MS);
    }
  });
  let line: HTMLParagraphElement | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let lastRun = Number.NEGATIVE_INFINITY;
  let lastIdent: unknown;

  const read = (r: Exclude<Reading, string>, fresh: boolean) => {
    timer = undefined;
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
    const shownBefore = untrack(shown) !== null && !untrack(closing);
    batch(() => {
      setDim(false);
      setInsight(next);
    });
    // A new line over an old one fades in (a first one opens: see .expr-insight).
    if (fresh && next && shownBefore && line) {
      line.classList.remove('fresh');
      void line.offsetWidth; // restart the animation
      line.classList.add('fresh');
    }
  };

  createEffect(
    on(reading, (r) => {
      clearTimeout(timer);
      if (r === 'closed') {
        lastIdent = undefined;
        batch(() => {
          setDim(false);
          setInsight(null);
        });
        return;
      }
      if (r === 'pending') {
        setDim(untrack(insight) !== null);
        return;
      }
      if (r.ident === lastIdent) {
        timer = setTimeout(
          () => read(r, false),
          Math.max(0, lastRun + THROTTLE_MS - performance.now()),
        );
      } else {
        setDim(untrack(insight) !== null);
        timer = setTimeout(() => read(r, true), SETTLE_MS);
      }
    }),
  );

  onCleanup(() => {
    clearTimeout(timer);
    clearTimeout(closeTimer);
  });

  return (
    <Show when={shown()}>
      {(s) => (
        <div
          class="expr-insight"
          classList={{ closing: closing(), dim: dim() }}
          aria-hidden={closing() || undefined}
          inert={closing() || undefined}
        >
          <p class="expr-insight-line" ref={line} data-testid="insight">
            <Show when={s().title}>{(title) => <span class="insight-title">{title()}</span>}</Show>
            {/* By place, so a line updated in place (a slider moving) keeps its nodes. */}
            <Index each={s().facts}>
              {(fact, i) => (
                <>
                  <Show when={i > 0 || s().title}>
                    <span class="insight-sep" aria-hidden="true">
                      {' · '}
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
  /** Before the n-th thing named after the label: a space, then commas. */
  const gap = (n: number, before: boolean) => (n > 0 ? ', ' : before ? ' ' : '');
  const values = () => props.fact.values ?? [];
  return (
    <span class="insight-fact">
      {label()}
      <Index each={values()}>
        {(value, j) => (
          <>
            {gap(j, label() !== '')}
            <Value value={value()} rowId={props.rowId} onMouseDown={props.onMouseDown} />
          </>
        )}
      </Index>
      <Index each={props.fact.rows ?? []}>
        {(id, j) => (
          <>
            {gap(j, label() !== '' || values().length > 0)}
            <RowRef id={id()} />
          </>
        )}
      </Index>
      <Show when={props.fact.tail}>{(tail) => ` ${tail()}`}</Show>
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

/** Another row, as its color and its math ("● y = x/3"). */
function RowRef(props: { id: string }) {
  const row = () => doc.rows.find((r) => r.id === props.id);
  const color = () => {
    const i = row()?.colorIndex ?? -1;
    return i >= 0 ? (palette()[i] ?? palette()[0]) : undefined;
  };
  return (
    <span class="insight-row" classList={{ colored: !!color() }} style={{ '--ref-color': color() }}>
      <InlineMath text={row()?.source.trim() ?? ''} />
    </span>
  );
}

function sameReading(a: Reading, b: Reading): boolean {
  if (typeof a === 'string' || typeof b === 'string') return a === b;
  const [p, q] = [a.input, b.input];
  return (
    a.ident === b.ident &&
    p.kind === q.kind &&
    p.plot === q.plot &&
    p.inView === q.inView &&
    sameList(p.usedBy, q.usedBy, (x, y) => x === y) &&
    sameList(p.others, q.others, (x, y) => x.id === y.id && x.plot === y.plot) &&
    sameList(a.values, b.values, (x, y) => x === y || (Number.isNaN(x) && Number.isNaN(y)))
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
