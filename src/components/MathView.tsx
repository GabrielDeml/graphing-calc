import { createEffect, createRoot, createSignal, onCleanup, onMount } from 'solid-js';
import type { Span } from '../engine/types';
import {
  type AtomBox,
  analyze,
  type Block,
  type Box,
  type Caret,
  type CaretStop,
  type CaretStops,
  createTypesetter,
  errorLeaves,
  type FenceBox,
  forEachLeaf,
  type Leaf,
  type Names,
  type Plan,
  planShape,
  type RadicalBox,
  readSelection,
  resolveCaret,
} from '../mathedit';

const SVG = 'http://www.w3.org/2000/svg';

/** One typesetter for every row, so a plan is reused while its text and names stay the same. */
const typeset = createTypesetter();

/** The plan of a row's text (shared with the row editor, so both read the same plan). */
export function typesetRow(source: string, names: Names): Plan {
  return typeset(source, names);
}

/**
 * Bumped when a web font finishes loading: the views then check their width again. (Their
 * layout is CSS, so nothing else needs measuring.)
 */
const fontsVersion = createRoot(() => {
  const [version, setVersion] = createSignal(0);
  const fonts = typeof document === 'undefined' ? undefined : document.fonts;
  if (fonts) {
    const bump = () => setVersion((v) => v + 1);
    fonts.addEventListener('loadingdone', bump);
    void fonts.ready.then(bump);
    // The plain inputs use the same files under another family name ("STIX Math Letters"), so
    // the browser would only fetch the typeset faces once the first row is drawn, and lay that
    // row out with a fallback font first. Ask for them now.
    const ignore = () => undefined;
    void fonts.load('19px "STIX Two Text"', '1').catch(ignore);
    void fonts.load('italic 19px "STIX Two Text"', 'xθ').catch(ignore);
  }
  return version;
});

/**
 * One observer for every view: a view's width follows the list's (the sidebar's drag, a rotation,
 * a selected row's margin), and with it whether the math overflows.
 */
const onResize = new WeakMap<Element, () => void>();
let resizeObserver: ResizeObserver | undefined;

function observeSize(e: Element, callback: () => void): () => void {
  if (typeof ResizeObserver === 'undefined') return () => undefined;
  resizeObserver ??= new ResizeObserver((entries) => {
    for (const entry of entries) onResize.get(entry.target)?.();
  });
  onResize.set(e, callback);
  resizeObserver.observe(e);
  return () => {
    resizeObserver?.unobserve(e);
    onResize.delete(e);
  };
}

/**
 * Caret stops of a plan, worked out once per plan (a plan is reused while its text is), and
 * shared with the row's editor, which reads the same plans.
 */
function stopsOf(plan: Plan): CaretStops {
  return analyze(plan).stops;
}

interface Drawn {
  plan: Plan;
  placeholder: string;
  /** Drawn for editing: ghost closers after open groups. */
  ghosts: boolean;
  shape: string;
  /** Elements of the plan's leaves, in forEachLeaf order. */
  leafEls: HTMLElement[];
  /** The elements each box is drawn as (an atom with a subscript: its letters, and the script). */
  boxEls: Map<Box, HTMLElement[]>;
  /** An empty mark at the start of each block, on its baseline, in its font. */
  struts: Map<Block, HTMLElement>;
}

function el(tag: 'span' | 'div', cls: string, text?: string): HTMLElement {
  const e = document.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function svg<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string>,
): SVGElementTagNameMap[K] {
  const e = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
}

/**
 * A parenthesis that stretches to any height: a crescent filled in a box whose aspect ratio
 * follows the content, so its stroke keeps its width while it grows taller.
 */
function tallParen(right: boolean): SVGSVGElement {
  const s = svg('svg', {
    viewBox: '0 0 10 100',
    preserveAspectRatio: 'none',
    'aria-hidden': 'true',
  });
  const d = 'M9 0.5C1.6 20 1.6 80 9 99.5C4.4 80 4.4 20 9 0.5Z';
  const path = svg('path', { d, fill: 'currentColor' });
  if (right) path.setAttribute('transform', 'matrix(-1 0 0 1 10 0)');
  s.append(path);
  return s;
}

/**
 * The radical sign: a short hook and a stroke down to the vertex, of fixed size at the bottom,
 * and a stroke from the vertex up to the top right, where the overline over the radicand starts.
 * Drawn in ems so it scales with the text, and as tall as the radicand.
 */
function radicalSign(): SVGSVGElement {
  const s = svg('svg', { 'aria-hidden': 'true' });
  const thin = { stroke: 'currentColor', 'stroke-width': '0.055em', 'stroke-linecap': 'round' };
  const foot = svg('svg', { x: '0', y: '100%', overflow: 'visible' });
  foot.append(
    svg('line', { x1: '0.06em', y1: '-0.4em', x2: '0.15em', y2: '-0.46em', ...thin }),
    svg('line', {
      x1: '0.15em',
      y1: '-0.46em',
      x2: '0.33em',
      y2: '-0.03em',
      stroke: 'currentColor',
      'stroke-width': '0.09em',
      'stroke-linecap': 'round',
    }),
  );
  s.append(
    foot,
    svg('line', {
      x1: '0.33em',
      y1: '100%',
      x2: '100%',
      y2: '0.03em',
      ...thin,
      'stroke-linecap': 'butt',
    }),
  );
  return s;
}

const SPACE_CLASS = ['', ' m-s1', ' m-s2', ' m-s3'] as const;

/** The blocks a box holds, in drawing order. */
function innerBlocks(box: Box): Block[] {
  switch (box.kind) {
    case 'frac':
      return [box.num, box.den];
    case 'sup':
    case 'radical':
    case 'fence':
      return [box.body];
    case 'atom':
      return box.sub ? [box.sub] : [];
    case 'slot':
      return [];
  }
}

/** Builds the elements of a plan and records those of its leaves, boxes and blocks. */
class Painter {
  readonly leafEls: HTMLElement[] = [];
  readonly boxEls = new Map<Box, HTMLElement[]>();
  readonly struts = new Map<Block, HTMLElement>();

  constructor(private readonly ghosts: boolean) {}

  block(block: Block, parent: HTMLElement): void {
    const strut = el('span', 'm-strut');
    parent.append(strut);
    this.struts.set(block, strut);
    const { boxes } = block;
    for (let i = 0; i < boxes.length; i++) {
      const box = boxes[i] as Box;
      const next = boxes[i + 1];
      if (next?.kind === 'sup') {
        // A base and its scripts go in one grid (global.css): the exponent over a subscript.
        const wrap = el('span', `m-scripts${SPACE_CLASS[box.space]}`);
        if (box.kind === 'atom' && box.role === 'var') wrap.classList.add('m-after-it');
        if (box.kind === 'atom' && box.sub) {
          const leaf = this.leaf(box);
          const sub = this.sub(box.sub);
          wrap.append(leaf, sub);
          this.boxEls.set(box, [leaf, sub]);
        } else {
          wrap.append(this.box(box, ''));
        }
        const sup = this.sup(next.body);
        this.boxEls.set(next, [sup]);
        wrap.append(sup);
        parent.append(wrap);
        i++;
      } else {
        parent.append(this.box(box, SPACE_CLASS[box.space]));
      }
    }
  }

  private sup(body: Block): HTMLElement {
    const e = el('span', 'm-sup');
    this.block(body, e);
    return e;
  }

  private box(box: Box, space: string): HTMLElement {
    const e = this.paint(box, space);
    this.boxEls.set(box, [e]);
    return e;
  }

  private paint(box: Box, space: string): HTMLElement {
    switch (box.kind) {
      case 'atom':
        return this.atom(box, space);
      case 'slot': {
        // Something to underline when it is marked: an en space.
        const e = el('span', `m-slot${space}`, ' ');
        this.leafEls.push(e);
        return e;
      }
      case 'frac': {
        const e = el('span', `m-frac${space}`);
        const num = el('span', 'm-numer');
        const den = el('span', 'm-denom');
        this.block(box.num, num);
        this.block(box.den, den);
        e.append(el('span', 'm-frac-base'), num, el('span', 'm-frac-bar'), den);
        return e;
      }
      case 'sup':
        // Not reached: block() draws an exponent with its base (`^2` has an empty one).
        return this.sup(box.body);
      case 'radical':
        return this.radical(box, space);
      case 'fence': {
        const e = el('span', `m-fence${box.tall ? ' m-tall' : ''}${space}`);
        const body = el('span', 'm-fence-body');
        e.append(this.delimiter(box.open, box.tall, false));
        this.block(box.body, body);
        e.append(body);
        if (box.close) e.append(this.delimiter(box.close, box.tall, true));
        else if (this.ghosts) e.append(this.ghost(box));
        return e;
      }
    }
  }

  private sub(body: Block): HTMLElement {
    const e = el('span', 'm-sub');
    this.block(body, e);
    return e;
  }

  /** An atom's own text. */
  private leaf(box: AtomBox, space = ''): HTMLElement {
    const e = el('span', `m-a m-${box.role}${space}`, box.text);
    this.leafEls.push(e);
    return e;
  }

  private atom(box: AtomBox, space: string): HTMLElement {
    if (!box.sub) return this.leaf(box, space);
    const e = el('span', `m-subbed${space}`);
    e.append(this.leaf(box), this.sub(box.sub));
    return e;
  }

  private delimiter(atom: AtomBox, tall: boolean, right: boolean): HTMLElement {
    if (!tall) {
      const e = el('span', 'm-a m-paren', atom.text);
      this.leafEls.push(e);
      return e;
    }
    const e = el('span', atom.text === '|' ? 'm-delim m-delim-bar' : 'm-delim');
    if (atom.text !== '|') e.append(tallParen(right));
    this.leafEls.push(e);
    return e;
  }

  /** The closer an open group will need, drawn faintly while the row is edited. */
  private ghost(box: FenceBox): HTMLElement {
    if (!box.tall) return el('span', 'm-a m-paren m-ghost', box.bars ? '|' : ')');
    const e = el('span', `m-delim m-ghost${box.bars ? ' m-delim-bar' : ''}`);
    if (!box.bars) e.append(tallParen(true));
    return e;
  }

  private radical(box: RadicalBox, space: string): HTMLElement {
    const e = el('span', `m-sqrt${space}`);
    if (box.index) e.append(el('span', 'm-sqrt-index', box.index));
    const sign = el('span', 'm-sqrt-sign');
    sign.append(radicalSign());
    const body = el('span', 'm-sqrt-body');
    this.block(box.body, body);
    e.append(sign, body);
    return e;
  }
}

/** The elements of `prev` for the boxes and blocks of `plan`, which has the same shape. */
function rebind(prev: Drawn, plan: Plan): Pick<Drawn, 'boxEls' | 'struts'> {
  const boxEls = new Map<Box, HTMLElement[]>();
  const struts = new Map<Block, HTMLElement>();
  const walk = (a: Block, b: Block) => {
    const strut = prev.struts.get(a);
    if (strut) struts.set(b, strut);
    a.boxes.forEach((x, i) => {
      const y = b.boxes[i];
      if (!y) return;
      const els = prev.boxEls.get(x);
      if (els) boxEls.set(y, els);
      const inner = innerBlocks(y);
      innerBlocks(x).forEach((c, k) => {
        const d = inner[k];
        if (d) walk(c, d);
      });
    });
  };
  walk(prev.plan.root, plan.root);
  return { boxEls, struts };
}

/**
 * Draws a plan into `view` (before `keep`, the caret's layer). A plan of the same shape as the
 * last one (a slider's value changed, a digit typed) only updates texts in place.
 */
function draw(
  view: HTMLElement,
  plan: Plan,
  placeholder: string,
  ghosts: boolean,
  prev: Drawn | null,
  keep: Element[],
): Drawn {
  const shape = `${planShape(plan)}\u0000${placeholder}\u0000${ghosts}`;
  if (prev && prev.shape === shape) {
    let k = 0;
    forEachLeaf(plan.root, (leaf) => {
      const e = prev.leafEls[k++];
      if (
        e &&
        leaf.kind === 'atom' &&
        e.firstChild?.nodeType === Node.TEXT_NODE &&
        e.textContent !== leaf.text
      ) {
        e.textContent = leaf.text;
      }
    });
    return { ...prev, ...rebind(prev, plan), plan, placeholder };
  }
  const painter = new Painter(ghosts);
  const frag = document.createDocumentFragment();
  const root = el('span', 'm-root');
  painter.block(plan.root, root);
  frag.append(root);
  if (placeholder && plan.root.boxes.length === 0) {
    frag.append(el('span', 'm-placeholder', placeholder));
  }
  view.replaceChildren(frag, ...keep);
  const { leafEls, boxEls, struts } = painter;
  return { plan, placeholder, ghosts, shape, leafEls, boxEls, struts };
}

/** Wavy underlines on the leaves an error span marks. */
function mark(drawn: Drawn, span: Span | null): void {
  const marked = new Set<Leaf>(span ? errorLeaves(drawn.plan, span) : []);
  let k = 0;
  forEachLeaf(drawn.plan.root, (leaf) => {
    drawn.leafEls[k++]?.classList.toggle('m-mark', marked.has(leaf));
  });
}

// ---- where things are ----

interface Rect {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/** Reads element boxes, each once per measurement (a hit test reads many). */
class Measure {
  private readonly rects = new Map<Element, DOMRect>();
  private readonly sizes = new Map<Element, number>();

  rect(e: Element): DOMRect {
    let r = this.rects.get(e);
    if (!r) {
      r = e.getBoundingClientRect();
      this.rects.set(e, r);
    }
    return r;
  }

  /** The font size of an element (px). */
  em(e: Element): number {
    let s = this.sizes.get(e);
    if (s === undefined) {
      s = Number.parseFloat(getComputedStyle(e).fontSize) || 19;
      this.sizes.set(e, s);
    }
    return s;
  }

  union(els: readonly Element[] | undefined): Rect | null {
    if (!els || els.length === 0) return null;
    let out: Rect | null = null;
    for (const e of els) {
      const r = this.rect(e);
      out = out
        ? {
            left: Math.min(out.left, r.left),
            right: Math.max(out.right, r.right),
            top: Math.min(out.top, r.top),
            bottom: Math.max(out.bottom, r.bottom),
          }
        : { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
    }
    return out;
  }
}

/** A caret on screen (client coordinates): its x, and the line it stands on. */
interface CaretBox {
  x: number;
  top: number;
  bottom: number;
}

/** x of the boundary before character `k` of an element's text. */
function charX(e: HTMLElement, k: number): number | null {
  const node = e.firstChild;
  if (!(node instanceof Text)) return null;
  const range = document.createRange();
  const at = Math.max(0, Math.min(k, node.length));
  range.setStart(node, at);
  range.setEnd(node, at);
  return range.getBoundingClientRect().left;
}

/**
 * Where a caret stop is drawn: inside an atom, at its character boundary; in a gap, between the
 * boxes on either side (each typed space a step further); at an empty place, inside it. It is
 * as tall as its block's line, from the block's strut (which sits on the baseline).
 */
function caretBox(drawn: Drawn, stop: CaretStop, m: Measure): CaretBox | null {
  const strut = drawn.struts.get(stop.block);
  if (!strut) return null;
  const s = m.rect(strut);
  const em = m.em(strut);
  const line = { top: s.top - 0.8 * em, bottom: s.top + 0.24 * em };
  const { boxes } = stop.block;
  if (stop.inside) {
    const leaf = drawn.boxEls.get(stop.inside)?.[0];
    const x = leaf ? charX(leaf, stop.offset - stop.inside.span.start) : null;
    if (x !== null) return { x, ...line };
  }
  const prev = stop.inside ? undefined : boxes[stop.index - 1];
  const next = stop.inside ? stop.inside : boxes[stop.index];
  const slot = next?.kind === 'slot' ? next : prev?.kind === 'slot' ? prev : undefined;
  if (slot) {
    const r = m.union(drawn.boxEls.get(slot));
    if (r) return { x: r.left + 0.14 * (r.right - r.left) + 1, ...line };
  }
  const pr = prev ? m.union(drawn.boxEls.get(prev)) : null;
  const nr = next ? m.union(drawn.boxEls.get(next)) : null;
  const g0 = prev ? prev.span.end : stop.block.start;
  const g1 = next ? next.span.start : Math.max(stop.block.end, g0);
  const left = pr ? pr.right : nr && stop.index === 0 ? Math.min(s.left, nr.left) : s.left;
  const right = nr ? nr.left : pr ? pr.right + (g1 - g0) * 0.25 * em : s.left;
  const t = (stop.offset - g0 + 0.5) / (g1 - g0 + 1);
  return { x: left + Math.max(0, right - left) * t, ...line };
}

/** The highlight of a selection: across the boxes it covers in its block. */
function selectionRect(
  drawn: Drawn,
  block: Block,
  start: number,
  end: number,
  m: Measure,
): Rect | null {
  let out: Rect | null = null;
  const add = (r: Rect | null) => {
    if (!r) return;
    out = out
      ? {
          left: Math.min(out.left, r.left),
          right: Math.max(out.right, r.right),
          top: Math.min(out.top, r.top),
          bottom: Math.max(out.bottom, r.bottom),
        }
      : r;
  };
  for (const box of block.boxes) {
    const { span } = box;
    if (span.end <= start || span.start >= end || box.kind === 'slot') continue;
    const r = m.union(drawn.boxEls.get(box));
    if (!r) continue;
    if (span.start >= start && span.end <= end) {
      add(r);
    } else if (box.kind === 'atom' && box.chars) {
      // Part of a number or a name.
      const leaf = drawn.boxEls.get(box)?.[0];
      const from = leaf ? charX(leaf, Math.max(start, span.start) - span.start) : null;
      const to = leaf ? charX(leaf, Math.min(end, box.subStart ?? span.end) - span.start) : null;
      if (from !== null && to !== null) add({ ...r, left: from, right: to });
    }
  }
  const strut = drawn.struts.get(block);
  if (out && strut) {
    const s = m.rect(strut);
    const em = m.em(strut);
    const top = Math.min((out as Rect).top, s.top - 0.8 * em);
    const bottom = Math.max((out as Rect).bottom, s.top + 0.24 * em);
    out = { ...(out as Rect), top, bottom };
  }
  return out;
}

/** The caret stop nearest a point (client coordinates): mostly by x, a line counting double. */
function hitTest(drawn: Drawn, x: number, y: number): Caret {
  const m = new Measure();
  let best: CaretStop | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const stop of stopsOf(drawn.plan).list) {
    const c = caretBox(drawn, stop, m);
    if (!c) continue;
    const dy = y < c.top ? c.top - y : y > c.bottom ? y - c.bottom : 0;
    const distance = Math.abs(x - c.x) + 2 * dy;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = stop;
    }
  }
  return best ? { offset: best.offset, depth: best.depth } : { offset: 0, depth: 0 };
}

/** The atom (a number, a name, a symbol) under a point, the smallest if several hold it. */
function wordAt(drawn: Drawn, x: number, y: number): { start: Caret; end: Caret } | null {
  const m = new Measure();
  let best: { box: Box; depth: number } | null = null;
  let bestArea = Number.POSITIVE_INFINITY;
  const blocks = [drawn.plan.root];
  for (let block = blocks.pop(); block; block = blocks.pop()) {
    for (const box of block.boxes) {
      blocks.push(...innerBlocks(box));
      const leaf = box.kind === 'atom' ? drawn.boxEls.get(box)?.[0] : undefined;
      if (!leaf) continue;
      const r = m.rect(leaf);
      if (x < r.left - 1 || x > r.right + 1 || y < r.top - 1 || y > r.bottom + 1) continue;
      const area = (r.right - r.left) * (r.bottom - r.top);
      if (area >= bestArea) continue;
      bestArea = area;
      best = { box, depth: block.depth };
    }
  }
  if (!best) return null;
  const { box, depth } = best;
  return { start: { offset: box.span.start, depth }, end: { offset: box.span.end, depth } };
}

// ---- the view ----

/** What the editor shows in the view while the row is edited in place. */
export interface CaretView {
  anchor: Caret;
  focus: Caret;
  /** Changes with each edit or move: the caret holds still (doesn't blink) for a moment. */
  seq: number;
}

export interface MathViewHandle {
  /** The caret position a point (client coordinates) is nearest to. */
  caretAt(x: number, y: number): Caret;
  /** Where a caret stop of the drawn text is (client x), for moving up and down. */
  xOf(stop: CaretStop): number;
  /** The middle of the math's first line (client y), to place a caret by x alone. */
  lineY(): number;
  /** Scrolls the math sideways (a wheel or a finger on a long row); false if it can't move. */
  scrollBy(dx: number): boolean;
  /** The number, name or symbol at a point (client coordinates): its two ends. */
  wordAt(x: number, y: number): { start: Caret; end: Caret } | null;
}

export interface MathViewProps {
  source: string;
  names: Names;
  /** Wavy underline under this span (the row's error, once it shows). */
  errorSpan: Span | null;
  /** Shown while the source is empty. */
  placeholder?: string;
  /** Keep the last drawing (while the row is edited as plain text, it holds the row's height). */
  frozen: boolean;
  /** Edited in place: the caret or selection, and the closers open groups still need. */
  caret?: CaretView | null;
  ref?: (handle: MathViewHandle) => void;
}

/** How long the caret holds still after an edit or a move before it blinks again. */
const CARET_HOLD_MS = 520;

/**
 * A row's math, typeset: fractions, exponents, radicals, sized parentheses, upright function
 * names and italic letters (src/mathedit lays it out; this only builds elements). Purely
 * visual: the row's <input> lies over it and takes every click and key. While the row is edited
 * in place it also draws the caret (in the row's color) and the selection, and scrolls to keep
 * the caret in view.
 */
export function MathView(props: MathViewProps) {
  let view!: HTMLDivElement;
  let drawn: Drawn | null = null;
  let frame = 0;
  let holdTimer: ReturnType<typeof setTimeout> | undefined;
  let lastSeq = -1;
  const caretEl = el('span', 'm-caret');
  const selectionEl = el('span', 'm-selection');
  caretEl.setAttribute('aria-hidden', 'true');

  const measure = () => {
    const overflow = view.scrollWidth > view.clientWidth + 1;
    view.classList.toggle('overflowing', overflow);
    view.classList.toggle('scrolled', overflow && view.scrollLeft > 0);
    view.classList.toggle(
      'scrolled-end',
      overflow && view.scrollLeft + view.clientWidth >= view.scrollWidth - 1,
    );
  };

  /**
   * Places the caret and the selection, and scrolls the caret into view when it moved (or
   * `reveal`): a row scrolled by hand stays put while it is redrawn.
   */
  const paintCaret = (caret: CaretView | null, reveal = false) => {
    if (!drawn || !caret) {
      caretEl.remove();
      selectionEl.remove();
      lastSeq = -1;
      if (view.scrollLeft !== 0) view.scrollLeft = 0;
      return;
    }
    const plan = drawn.plan;
    const sel = readSelection(
      { text: plan.source, anchor: caret.anchor, focus: caret.focus },
      { names: props.names.ctx, plan: () => plan },
    );
    const m = new Measure();
    const vr = m.rect(view);
    const ox = vr.left + view.clientLeft - view.scrollLeft;
    const oy = vr.top + view.clientTop - view.scrollTop;
    const focus = resolveCaret(stopsOf(plan), caret.focus.offset, caret.focus.depth);
    const box = caretBox(drawn, focus, m);
    if (!box) return;
    const moved = caret.seq !== lastSeq;
    if (sel.collapsed) {
      selectionEl.remove();
      if (!caretEl.isConnected) view.append(caretEl);
      caretEl.style.transform = `translate(${box.x - ox}px, ${box.top - oy}px)`;
      caretEl.style.height = `${box.bottom - box.top}px`;
    } else {
      caretEl.remove();
      const r = selectionRect(drawn, sel.block, sel.start, sel.end, m);
      if (r) {
        if (!selectionEl.isConnected) view.prepend(selectionEl);
        selectionEl.style.transform = `translate(${r.left - ox}px, ${r.top - oy}px)`;
        selectionEl.style.width = `${r.right - r.left}px`;
        selectionEl.style.height = `${r.bottom - r.top}px`;
      }
    }
    if (moved) {
      lastSeq = caret.seq;
      // Solid while typing and moving; it blinks again once things settle.
      caretEl.classList.add('m-caret-hold');
      clearTimeout(holdTimer);
      holdTimer = setTimeout(() => caretEl.classList.remove('m-caret-hold'), CARET_HOLD_MS);
    }
    if (!moved && !reveal) return;
    // Keep the caret in view, with some room on its side.
    const x = box.x - ox;
    const margin = Math.min(24, view.clientWidth / 4);
    if (x - margin < view.scrollLeft) view.scrollLeft = Math.max(0, x - margin);
    else if (x + margin > view.scrollLeft + view.clientWidth) {
      view.scrollLeft = x + margin - view.clientWidth;
    }
  };

  createEffect(() => {
    if (props.frozen) return;
    const caret = props.caret ?? null;
    const plan = typeset(props.source, props.names);
    const placeholder = props.source === '' ? (props.placeholder ?? '') : '';
    const ghosts = caret !== null;
    if (drawn?.plan !== plan || drawn.placeholder !== placeholder || drawn.ghosts !== ghosts) {
      const keep = [selectionEl, caretEl].filter((e) => e.isConnected);
      drawn = draw(view, plan, placeholder, ghosts, drawn, keep);
    }
    view.classList.toggle('editing', ghosts);
    mark(drawn, props.errorSpan);
    fontsVersion();
    paintCaret(caret);
    if (!frame) {
      frame = requestAnimationFrame(() => {
        frame = 0;
        measure();
      });
    }
  });
  onMount(() =>
    onCleanup(
      observeSize(view, () => {
        if (props.caret && !props.frozen) paintCaret(props.caret, true);
        measure();
      }),
    ),
  );
  onCleanup(() => {
    cancelAnimationFrame(frame);
    clearTimeout(holdTimer);
  });

  props.ref?.({
    caretAt: (x, y) => (drawn ? hitTest(drawn, x, y) : { offset: 0, depth: 0 }),
    xOf: (stop) => {
      if (!drawn) return 0;
      // The editor's plan of this text may be another object than the one drawn (the shared
      // typesetter forgets plans while a slider plays): the same place in the drawn one.
      const at = drawn.struts.has(stop.block)
        ? stop
        : resolveCaret(stopsOf(drawn.plan), stop.offset, stop.depth);
      return caretBox(drawn, at, new Measure())?.x ?? 0;
    },
    lineY: () => {
      const strut = drawn?.struts.get(drawn.plan.root);
      if (!strut) return view.getBoundingClientRect().top + view.clientHeight / 2;
      const m = new Measure();
      return m.rect(strut).top - 0.28 * m.em(strut);
    },
    wordAt: (x, y) => (drawn ? wordAt(drawn, x, y) : null),
    scrollBy: (dx) => {
      const before = view.scrollLeft;
      view.scrollLeft = before + dx;
      if (view.scrollLeft === before) return false;
      measure();
      return true;
    },
  });

  return <div class="math-view" aria-hidden="true" ref={view} />;
}
