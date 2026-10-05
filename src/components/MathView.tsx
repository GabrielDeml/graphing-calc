import { createEffect, createRoot, createSignal, onCleanup, onMount } from 'solid-js';
import type { Span } from '../engine/types';
import {
  type AtomBox,
  type Block,
  type Box,
  createTypesetter,
  errorLeaves,
  forEachLeaf,
  type Leaf,
  leafSpan,
  type Names,
  type Plan,
  planShape,
  type RadicalBox,
} from '../mathedit';

const SVG = 'http://www.w3.org/2000/svg';

/** One typesetter for every row, so a plan is reused while its text and names stay the same. */
const typeset = createTypesetter();

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

/** Something a click can land on, and the source offsets on either side of it. */
interface Target {
  el: HTMLElement;
  start: number;
  end: number;
  /** The element's text is the source's, so a click can land between its characters. */
  chars: boolean;
}

/** A box drawn around others (a fraction, a radical, a base and its scripts…). */
interface Structure {
  start: number;
  end: number;
  /** A radical's sign is a click target of its own, before the radicand. */
  radical?: RadicalBox;
}

interface Drawn {
  plan: Plan;
  placeholder: string;
  shape: string;
  /** Elements of the plan's leaves, in forEachLeaf order. */
  leafEls: HTMLElement[];
  /** Elements of the plan's structures, in structuresOf order. */
  structureEls: HTMLElement[];
  /** Elements of the radical signs, in the same order. */
  signEls: HTMLElement[];
}

/** Where a click can land: worked out on a click, not on each redraw (a playing slider's). */
interface Targets {
  targets: Target[];
  /** The structures, outermost first, with their elements. */
  structures: (Structure & { el: HTMLElement })[];
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

/**
 * Builds the elements of a plan and records those of its leaves and structures on the way, in
 * the orders forEachLeaf and structuresOf walk the plan.
 */
class Painter {
  readonly leafEls: HTMLElement[] = [];
  readonly structureEls: HTMLElement[] = [];
  readonly signEls: HTMLElement[] = [];

  private structure(e: HTMLElement): HTMLElement {
    this.structureEls.push(e);
    return e;
  }

  block(block: Block, parent: HTMLElement): void {
    const { boxes } = block;
    for (let i = 0; i < boxes.length; i++) {
      const box = boxes[i] as Box;
      const next = boxes[i + 1];
      if (next?.kind === 'sup') {
        // A base and its scripts go in one grid (global.css): the exponent over a subscript.
        const wrap = this.structure(el('span', `m-scripts${SPACE_CLASS[box.space]}`));
        if (box.kind === 'atom' && box.role === 'var') wrap.classList.add('m-after-it');
        if (box.kind === 'atom' && box.sub) {
          wrap.append(this.leaf(box), this.sub(box.sub));
        } else {
          wrap.append(this.box(box, ''));
        }
        wrap.append(this.sup(next.body));
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
    switch (box.kind) {
      case 'atom':
        return this.atom(box, space);
      case 'slot': {
        // Something to underline when it is marked: an en space.
        const e = el('span', `m-slot${space}`, '\u2002');
        this.leafEls.push(e);
        return e;
      }
      case 'frac': {
        const e = this.structure(el('span', `m-frac${space}`));
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
        const e = this.structure(el('span', `m-fence${box.tall ? ' m-tall' : ''}${space}`));
        const body = el('span', 'm-fence-body');
        e.append(this.delimiter(box.open, box.tall, false));
        this.block(box.body, body);
        e.append(body);
        if (box.close) e.append(this.delimiter(box.close, box.tall, true));
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
    const e = this.structure(el('span', `m-subbed${space}`));
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

  private radical(box: RadicalBox, space: string): HTMLElement {
    const e = this.structure(el('span', `m-sqrt${space}`));
    if (box.index) e.append(el('span', 'm-sqrt-index', box.index));
    const sign = el('span', 'm-sqrt-sign');
    sign.append(radicalSign());
    this.signEls.push(sign);
    const body = el('span', 'm-sqrt-body');
    this.block(box.body, body);
    e.append(sign, body);
    return e;
  }
}

/** The structures of a block, in the order Painter makes their elements (outer ones first). */
function structuresOf(block: Block, out: Structure[] = []): Structure[] {
  const { boxes } = block;
  for (let i = 0; i < boxes.length; i++) {
    const box = boxes[i] as Box;
    const next = boxes[i + 1];
    if (next?.kind === 'sup') {
      out.push({ start: box.span.start, end: next.span.end });
      if (box.kind !== 'atom') boxStructures(box, out);
      else if (box.sub) structuresOf(box.sub, out);
      structuresOf(next.body, out);
      i++;
    } else {
      boxStructures(box, out);
    }
  }
  return out;
}

function boxStructures(box: Box, out: Structure[]): void {
  switch (box.kind) {
    case 'atom':
      if (box.sub) {
        out.push({ start: box.span.start, end: box.span.end });
        structuresOf(box.sub, out);
      }
      break;
    case 'frac':
      out.push({ start: box.span.start, end: box.span.end });
      structuresOf(box.num, out);
      structuresOf(box.den, out);
      break;
    case 'radical':
      out.push({ start: box.span.start, end: box.span.end, radical: box });
      structuresOf(box.body, out);
      break;
    case 'fence':
      out.push({ start: box.span.start, end: box.span.end });
      structuresOf(box.body, out);
      break;
    case 'sup':
      structuresOf(box.body, out);
      break;
    case 'slot':
      break;
  }
}

/**
 * Click targets: every leaf, and each radical sign (its left half is before the radical); and the
 * structures, with their elements.
 */
function targetsOf(drawn: Drawn): Targets {
  const targets: Target[] = [];
  let k = 0;
  forEachLeaf(drawn.plan.root, (leaf: Leaf) => {
    const span = leafSpan(leaf);
    const e = drawn.leafEls[k++];
    if (e) targets.push({ el: e, ...span, chars: leaf.kind === 'atom' && leaf.chars === true });
  });
  const structures: Targets['structures'] = [];
  let signs = 0;
  structuresOf(drawn.plan.root).forEach((s, i) => {
    const e = drawn.structureEls[i];
    if (e) structures.push({ ...s, el: e });
    const sign = s.radical ? drawn.signEls[signs++] : undefined;
    if (sign && s.radical) {
      targets.push({ el: sign, start: s.start, end: s.radical.body.start, chars: false });
    }
  });
  return { targets, structures };
}

/**
 * Draws a plan into `view`. A plan of the same shape as the last one (a slider's value changed)
 * only updates texts in place.
 */
function draw(view: HTMLElement, plan: Plan, placeholder: string, prev: Drawn | null): Drawn {
  const shape = `${planShape(plan)}\u0000${placeholder}`;
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
    return { ...prev, plan, placeholder };
  }
  const painter = new Painter();
  const frag = document.createDocumentFragment();
  if (placeholder && plan.root.boxes.length === 0) {
    frag.append(el('span', 'm-placeholder', placeholder));
  } else {
    const root = el('span', 'm-root');
    painter.block(plan.root, root);
    frag.append(root);
  }
  view.replaceChildren(frag);
  const { leafEls, structureEls, signEls } = painter;
  return { plan, placeholder, shape, leafEls, structureEls, signEls };
}

/** Wavy underlines on the leaves an error span marks. */
function mark(drawn: Drawn, span: Span | null): void {
  const marked = new Set<Leaf>(span ? errorLeaves(drawn.plan, span) : []);
  let k = 0;
  forEachLeaf(drawn.plan.root, (leaf) => {
    drawn.leafEls[k++]?.classList.toggle('m-mark', marked.has(leaf));
  });
}

/** x of each boundary between the characters of a target's text, both ends included. */
function boundaries(target: Target): number[] | null {
  const node = target.el.firstChild;
  if (!(node instanceof Text)) return null;
  const range = document.createRange();
  const xs: number[] = [];
  for (let i = 0; i <= node.length; i++) {
    range.setStart(node, i);
    range.setEnd(node, i);
    xs.push(range.getBoundingClientRect().left);
  }
  return xs;
}

/** The source offset a point lands on: the nearest side (or character gap) of what it hits. */
function hitTest(drawn: Drawn, x: number, y: number, length: number): number {
  let best: { t: Target; r: DOMRect } | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  let right = Number.NEGATIVE_INFINITY;
  let left = Number.POSITIVE_INFINITY;
  const { targets, structures } = targetsOf(drawn);
  for (const t of targets) {
    const r = t.el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;
    right = Math.max(right, r.right);
    left = Math.min(left, r.left);
    const dx = x < r.left ? r.left - x : x > r.right ? x - r.right : 0;
    const dy = y < r.top ? r.top - y : y > r.bottom ? y - r.bottom : 0;
    // Mostly sideways: a click beside a fraction goes to the nearer of its parts' ends.
    const distance = dx + 2 * dy;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = { t, r };
    }
  }
  if (!best || x >= right) return length;
  if (x <= left) return 0;
  const { t, r } = best;
  // Beside a structure, before or after all of it, not at the nearest symbol inside: past a
  // radicand's or a denominator's invisible `)`.
  for (const s of structures) {
    if (!s.el.contains(t.el)) continue;
    const sr = s.el.getBoundingClientRect();
    if (x > sr.right) return s.end;
    if (x < sr.left) return s.start;
  }
  if (t.chars) {
    const xs = boundaries(t);
    if (xs && xs.length === t.end - t.start + 1) {
      let k = 0;
      for (let i = 1; i < xs.length; i++) {
        if (Math.abs((xs[i] as number) - x) < Math.abs((xs[k] as number) - x)) k = i;
      }
      return t.start + k;
    }
  }
  return x < r.left + r.width / 2 ? t.start : t.end;
}

export interface MathViewHandle {
  /** The source offset a point (client coordinates) is on, for putting the caret there. */
  offsetAt(x: number, y: number): number;
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
  ref?: (handle: MathViewHandle) => void;
}

/**
 * A row's math, typeset: fractions, exponents, radicals, sized parentheses, upright function
 * names and italic letters (src/mathedit lays it out; this only builds elements). Purely
 * visual: the row's <input> lies over it and takes every click and key.
 */
export function MathView(props: MathViewProps) {
  let view!: HTMLDivElement;
  let drawn: Drawn | null = null;
  let frame = 0;

  const measure = () => {
    view.classList.toggle('overflowing', view.scrollWidth > view.clientWidth + 1);
  };

  createEffect(() => {
    if (props.frozen) return;
    const plan = typeset(props.source, props.names);
    const placeholder = props.source === '' ? (props.placeholder ?? '') : '';
    if (drawn?.plan !== plan || drawn.placeholder !== placeholder) {
      drawn = draw(view, plan, placeholder, drawn);
    }
    mark(drawn, props.errorSpan);
    fontsVersion();
    if (!frame) {
      frame = requestAnimationFrame(() => {
        frame = 0;
        measure();
      });
    }
  });
  onMount(() => onCleanup(observeSize(view, measure)));
  onCleanup(() => cancelAnimationFrame(frame));

  props.ref?.({
    offsetAt: (x, y) => (drawn ? hitTest(drawn, x, y, props.source.length) : 0),
  });

  return <div class="math-view" aria-hidden="true" ref={view} />;
}
