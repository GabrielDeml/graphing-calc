import { describe, expect, it } from 'vitest';
import { EMPTY_CONTEXT, type NameContext } from '../engine/names';
import { mulberry32, randomSource } from '../engine/testing/fuzz';
import type { Span } from '../engine/types';
import { caretStops } from './caret';
import { createTypesetter } from './index';
import { layoutParse } from './layout';
import {
  type AtomBox,
  type Block,
  type Box,
  errorLeaves,
  forEachLeaf,
  leafSpan,
  MAX_PLAN_DEPTH,
  type Plan,
  planShape,
  renderPlan,
} from './plan';

function ctxOf(vars: string[] = [], fns: Record<string, number> = {}): NameContext {
  return { vars: new Set(vars), fns: new Map(Object.entries(fns)) };
}

function plan(source: string, ctx: NameContext = EMPTY_CONTEXT): Plan {
  return renderPlan(layoutParse(source, ctx));
}

/**
 * A plan as text: spaces as that many blanks (1 thin, 2 medium, 3 thick), {num/den}, ^{exp}
 * (^!{…} for x²), √{…} ∛{…}, (…) and |…| (⟮…⟯ when tall, no closer while unclosed), a_{1},
 * □ for a slot and ‹…› for text that isn't math.
 */
function show(block: Block): string {
  return block.boxes.map((b) => ' '.repeat(b.space) + showBox(b)).join('');
}

function showBox(b: Box): string {
  switch (b.kind) {
    case 'atom':
      if (b.role === 'err') return `‹${b.text}›`;
      return b.sub ? `${b.text}_{${show(b.sub)}}` : b.text;
    case 'slot':
      return '□';
    case 'frac':
      return `{${show(b.num)}/${show(b.den)}}`;
    case 'sup':
      return `^${b.atomic ? '!' : ''}{${show(b.body)}}`;
    case 'radical':
      return `${b.index === '3' ? '∛' : '√'}{${show(b.body)}}`;
    case 'fence': {
      const [open, close] = b.tall ? ['⟮', '⟯'] : b.bars ? ['|', '|'] : ['(', ')'];
      return `${open}${show(b.body)}${b.close ? close : ''}`;
    }
  }
}

function s(source: string, ctx?: NameContext): string {
  return show(plan(source, ctx).root);
}

/** Every atom of a plan, as role:text. */
function atoms(source: string, ctx?: NameContext): string[] {
  const out: string[] = [];
  forEachLeaf(plan(source, ctx).root, (leaf) => {
    if (leaf.kind === 'atom') out.push(`${leaf.role}:${leaf.text}`);
  });
  return out;
}

describe('renderPlan: structure', () => {
  it.each([
    ['y = 1/(x-1)', 'y   =   {1/x  −  1}'],
    ['y = (x+1)/(x^2+1)', 'y   =   {x  +  1/x^{2}  +  1}'],
    ['y = e^(-x^2)', 'y   =   e^{−x^{2}}'],
    ['y = sqrt(x)', 'y   =   √{x}'],
    ['y = √2x', 'y   =   √{2x}'],
    ['cbrt(x)', '∛{x}'],
    ['y = |x|', 'y   =   |x|'],
    ['(1, 2)', '(1, 2)'],
    ['(1,2),(3,4)', '(1, 2), (3, 4)'],
    ['y <= x^2', 'y   ≤   x^{2}'],
    ['(cos t, sin t)', '(cos t, sin t)'],
    ['r = 1 + cos θ', 'r   =   1  +  cos θ'],
    ['r = 1 + cos theta', 'r   =   1  +  cos θ'],
    ['f(x) = x^2', 'f(x)   =   x^{2}'],
    ['a = 2.5', 'a   =   2.5'],
    ['a_1 x', 'a_{1}x'],
    ['v_{max}', 'v_{max}'],
    ['1/2x', '{1/2} x'],
    ['2x/3', '{2x/3}'],
    ['sin x/2', '{sin x/2}'],
    ['x^2y', 'x^{2}y'],
    ['e^2x', 'e^{2}x'],
    ['x²+1', 'x^!{2}  +  1'],
    ['sin²x', 'sin^!{2} x'],
    ['sin^2 x', 'sin^{2} x'],
    ['2 sin x cos x', '2 sin x cos x'],
    ['sin(x)^2', 'sin(x)^{2}'],
    ['3!x', '3!x'],
    ['-x', '−x'],
    ['2*-3', '2  ·  −3'],
    ['2×3', '2  ×  3'],
    ['x**2', 'x^{2}'],
    ['6÷2', '{6/2}'],
    ['(1/2)^3', '⟮{1/2}⟯^{3}'],
    ['2(x+1)', '2(x  +  1)'],
    ['2/x + 1', '{2/x}  +  1'],
    ['x^(2y)', 'x^{2y}'],
    // Scripts have no medium, thick or comma spaces, as in TeX.
    ['x^(1, 2)', 'x^{(1,2)}'],
    ['max(1, 2)', 'max(1, 2)'],
    ['', ''],
    ['  ', ''],
  ])('%j → %j', (source, expected) => {
    expect(s(source)).toBe(expected);
  });

  it('keeps errors and missing parts visible', () => {
    expect(s('y = ')).toBe('y   =   □');
    expect(s('1/')).toBe('{1/□}');
    expect(s('x^')).toBe('x^{□}');
    expect(s('y = (x+1')).toBe('y   =   (x  +  1');
    // An unclosed group keeps its `(` where it would otherwise draw none.
    expect(s('y = 1/(x')).toBe('y   =   {1/(x}');
    expect(s('y = sqrt(x+1')).toBe('y   =   √{(x  +  1}');
    expect(s('x^(2')).toBe('x^{(2}');
    // Numbers side by side stay apart, as typed (the engine wants an operator between them).
    expect(s('2 3')).toBe('2   3');
    expect(s('1.5 2')).toBe('1.5   2');
    expect(s('y = 2 3x')).toBe('y   =   2   3x');
    expect(s('y == 2')).toBe('y   ‹==›   2');
    expect(s('y = 2$')).toBe('y   =   2‹$›');
    expect(s('x)')).toBe('x‹)›');
    expect(s('sqrt')).toBe('√{□}');
    expect(s('sqrt(x, y)')).toBe('sqrt(x, y)');
  });

  it('groups letters by the names in scope', () => {
    expect(atoms('pix')).toEqual(['var:π', 'var:x']);
    expect(atoms('asin(x)')).toEqual(['fn:asin', 'paren:(', 'var:x', 'paren:)']);
    expect(atoms('asin(x)', ctxOf(['a']))).toEqual([
      'var:a',
      'fn:sin',
      'paren:(',
      'var:x',
      'paren:)',
    ]);
    expect(s('y = asin(bx)', ctxOf(['a', 'b']))).toBe('y   =   a sin(bx)');
    expect(atoms('speedt', ctxOf(['speed']))).toEqual(['var:speed', 'var:t']);
    expect(atoms('y = f(x)', ctxOf([], { f: 1 }))).toEqual([
      'var:y',
      'rel:=',
      'var:f',
      'paren:(',
      'var:x',
      'paren:)',
    ]);
    expect(atoms('2πr')).toEqual(['num:2', 'var:π', 'var:r']);
    expect(atoms('log_2(x)')[0]).toBe('fn:log');
  });

  it('prettifies only what it draws', () => {
    expect(atoms('a<=b>=c*d-e')).toEqual([
      'var:a',
      'rel:≤',
      'var:b',
      'rel:≥',
      'var:c',
      'op:·',
      'var:d',
      'op:−',
      'var:e',
    ]);
    const leaves: AtomBox[] = [];
    forEachLeaf(plan('y<=pi').root, (l) => {
      if (l.kind === 'atom') leaves.push(l);
    });
    expect(leaves.map((l) => l.span)).toEqual([
      { start: 0, end: 1 },
      { start: 1, end: 3 },
      { start: 3, end: 5 },
    ]);
  });

  it('stretches delimiters only around something taller than a line', () => {
    const fences: boolean[] = [];
    const visit = (block: Block) => {
      for (const b of block.boxes) {
        if (b.kind === 'fence') {
          fences.push(b.tall);
          visit(b.body);
        }
      }
    };
    visit(plan('(x^2)(1/x)(sqrt(x))|x|').root);
    expect(fences).toEqual([false, true, true, false]);
  });
});

describe('errorLeaves', () => {
  function marked(source: string, span: Span): string[] {
    return errorLeaves(plan(source), span).map((l) => (l.kind === 'slot' ? '□' : l.text));
  }

  it('marks what the span covers', () => {
    expect(marked('y = (x', { start: 4, end: 5 })).toEqual(['(']);
    expect(marked('x2', { start: 1, end: 2 })).toEqual(['2']);
    expect(marked('y == 2', { start: 2, end: 4 })).toEqual(['==']);
    expect(marked('sin x 2', { start: 0, end: 3 })).toEqual(['sin']);
  });

  it('moves a mark on structure or nothing to the next leaf', () => {
    // "Expected an expression after '^'": the empty exponent.
    expect(marked('x^', { start: 1, end: 2 })).toEqual(['□']);
    // An invisible parenthesis.
    expect(marked('y = sqrt(x) + 1', { start: 10, end: 11 })).toEqual(['+']);
    // "Missing ')'": an unclosed group shows its `(`.
    expect(marked('y = sqrt(x', { start: 8, end: 9 })).toEqual(['(']);
    expect(marked('y = ', { start: 2, end: 3 })).toEqual(['=']);
    expect(marked('x + 1', { start: 9, end: 9 })).toEqual(['1']);
  });
});

describe('planShape', () => {
  it('is the same for plans that differ only in their texts', () => {
    expect(planShape(plan('a = 1.5'))).toBe(planShape(plan('a = 2.25')));
    expect(planShape(plan('a = 1'))).toBe(planShape(plan('a = 15')));
    expect(planShape(plan('a = 1.5'))).not.toBe(planShape(plan('a = -1.5')));
    expect(planShape(plan('y = 1/x'))).not.toBe(planShape(plan('y = 1x')));
    expect(planShape(plan('y = x'))).toBe(planShape(plan('y < x')));
  });
});

describe('createTypesetter', () => {
  it('returns the same plan for the same source and names', () => {
    const typeset = createTypesetter(2);
    const names = { ctx: EMPTY_CONTEXT, signature: '' };
    const a = typeset('y = x', names);
    expect(typeset('y = x', names)).toBe(a);
    expect(typeset('y = x', { ctx: ctxOf(['a']), signature: 'a:var' })).not.toBe(a);
    typeset('y = 2', names);
    typeset('y = 3', names);
    expect(typeset('y = x', names)).not.toBe(a);
  });
});

// ---- caret stops ----

/** Stops in ‸ notation: the source with ‸ at the offset, then :depth. */
function stops(source: string, ctx?: NameContext): string[] {
  return caretStops(plan(source, ctx)).list.map(
    (st) => `${source.slice(0, st.offset)}‸${source.slice(st.offset)}:${st.depth}`,
  );
}

describe('caretStops', () => {
  it.each([
    ['', ['‸:0']],
    ['x', ['‸x:0', 'x‸:0']],
    // Each typed space is a place of its own.
    ['y = x', ['‸y = x:0', 'y‸ = x:0', 'y ‸= x:0', 'y =‸ x:0', 'y = ‸x:0', 'y = x‸:0']],
    ['1/2', ['‸1/2:0', '‸1/2:1', '1‸/2:1', '1/‸2:1', '1/2‸:1', '1/2‸:0']],
    ['2x/3', ['‸2x/3:0', '‸2x/3:1', '2‸x/3:1', '2x‸/3:1', '2x/‸3:1', '2x/3‸:1', '2x/3‸:0']],
    ['x^2', ['‸x^2:0', 'x‸^2:0', 'x^‸2:1', 'x^2‸:1', 'x^2‸:0']],
    ['x²', ['‸x²:0', 'x‸²:0', 'x²‸:0']],
    ['123', ['‸123:0', '1‸23:0', '12‸3:0', '123‸:0']],
    ['sin x', ['‸sin x:0', 'sin‸ x:0', 'sin ‸x:0', 'sin x‸:0']],
    ['a_12', ['‸a_12:0', 'a‸_12:0', 'a_‸12:1', 'a_1‸2:1', 'a_12‸:1', 'a_12‸:0']],
    ['(x)', ['‸(x):0', '(‸x):1', '(x‸):1', '(x)‸:0']],
    [
      '(x+1)/2',
      [
        '‸(x+1)/2:0',
        '(‸x+1)/2:1',
        '(x‸+1)/2:1',
        '(x+‸1)/2:1',
        '(x+1‸)/2:1',
        '(x+1)/‸2:1',
        '(x+1)/2‸:1',
        '(x+1)/2‸:0',
      ],
    ],
    ['√2x', ['‸√2x:0', '√‸2x:1', '√2‸x:1', '√2x‸:1', '√2x‸:0']],
    ['sqrt(x', ['‸sqrt(x:0', 'sqrt‸(x:1', 'sqrt(‸x:2', 'sqrt(x‸:2']],
    ['(x', ['‸(x:0', '(‸x:1', '(x‸:1']],
    ['x^', ['‸x^:0', 'x‸^:0', 'x^‸:1', 'x^‸:0']],
    ['2+', ['‸2+:0', '2‸+:0', '2+‸:0']],
    ['y = ', ['‸y = :0', 'y‸ = :0', 'y ‸= :0', 'y =‸ :0', 'y = ‸:0']],
    ['(x ', ['‸(x :0', '(‸x :1', '(x‸ :1', '(x ‸:1']],
    ['a_', ['‸a_:0', 'a‸_:0', 'a_‸:1', 'a_‸:0']],
  ])('%j', (source, expected) => {
    expect(stops(source)).toEqual(expected);
  });

  it('tells the end of a denominator from the place after the fraction', () => {
    const { at } = caretStops(plan('2x/3'));
    expect(at(4, 1)?.block.depth).toBe(1);
    expect(at(4, 0)?.index).toBe(1);
    expect(at(4, 2)).toBeUndefined();
  });
});

// ---- properties ----

/** Spans of everything drawn from the source: leaves' own text and hidden structure. */
function pieces(p: Plan): Span[] {
  const out: Span[] = [];
  const visit = (block: Block) => {
    for (const b of block.boxes) {
      if (b.hidden) out.push(...b.hidden);
      switch (b.kind) {
        case 'atom':
          out.push(leafSpan(b));
          if (b.sub) visit(b.sub);
          break;
        case 'frac':
          visit(b.num);
          visit(b.den);
          break;
        case 'sup':
        case 'radical':
          visit(b.body);
          break;
        case 'fence':
          out.push(b.open.span);
          visit(b.body);
          if (b.close) out.push(b.close.span);
          break;
        default:
          break;
      }
    }
  };
  visit(p.root);
  return out.filter((sp) => sp.end > sp.start).sort((a, b) => a.start - b.start);
}

function within(inner: Span, outer: Span): boolean {
  return inner.start >= outer.start && inner.end <= outer.end;
}

function innerBlocks(b: Box): Block[] {
  if (b.kind === 'frac') return [b.num, b.den];
  if (b.kind === 'sup' || b.kind === 'radical' || b.kind === 'fence') return [b.body];
  return b.kind === 'atom' && b.sub ? [b.sub] : [];
}

/**
 * The blocks at `depth` whose text reaches `offset`, found by walking the plan (a block's last
 * stop may be past spaces after its last box, or its last box may run past its end). `x²` takes
 * no caret.
 */
function blocksAt(block: Block, offset: number, depth: number, out: Block[] = []): Block[] {
  if (block.depth === depth) {
    const last = block.boxes[block.boxes.length - 1];
    const end = Math.max(block.end, last?.span.end ?? 0);
    if (block.start <= offset && offset <= end) out.push(block);
    return out;
  }
  for (const b of block.boxes) {
    if (b.kind === 'sup' && b.atomic) continue;
    for (const c of innerBlocks(b)) blocksAt(c, offset, depth, out);
  }
  return out;
}

/** Boxes lie inside their block (as far as their own text goes) and children inside boxes. */
function nestingProblem(block: Block): string | null {
  for (const b of block.boxes) {
    for (const c of innerBlocks(b)) {
      if (!within({ start: c.start, end: c.end }, b.span)) return `${b.kind}: block outside`;
      if (c.depth !== block.depth + 1) return `${b.kind}: depth`;
      const p = nestingProblem(c);
      if (p) return p;
    }
    for (const h of b.hidden ?? []) if (!within(h, b.span)) return `${b.kind}: hidden outside`;
  }
  return null;
}

const CONTEXTS = [EMPTY_CONTEXT, ctxOf(['a', 'b', 'speed', 'a_1'], { f: 1, g: 2 })];
const JUNK = ['(', ')', '|', '$', '_', '{', '==', '😀', '^', '/', ',', '=', 'sqrt', '²', '⁻¹'];

function sources(seed: number, count: number): string[] {
  const rand = mulberry32(seed);
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    let source = randomSource(rand);
    for (let k = Math.floor(rand() * 3); k > 0; k--) {
      const at = Math.floor(rand() * (source.length + 1));
      source = source.slice(0, at) + JUNK[Math.floor(rand() * JUNK.length)] + source.slice(at);
    }
    out.push(source);
  }
  return out;
}

describe('long rows', () => {
  it('plans long flat rows without recursing down their sums', () => {
    const sum = Array.from({ length: 5000 }, (_, i) => `x^${i % 7}`).join(' + ');
    const p = plan(sum);
    expect(p.root.boxes.length).toBe(5000 * 2 + 4999);
    expect(caretStops(p).list.length).toBeGreaterThan(10_000);
    expect(() => plan('xy'.repeat(3000))).not.toThrow();
  });

  it('keeps long left chains (`1/x/x…`, `x!!…`) shallow', () => {
    const maxDepth = (block: Block): number => {
      let max = block.depth;
      const visit = (b: Block) => {
        max = Math.max(max, maxDepth(b));
      };
      for (const b of block.boxes) {
        if (b.kind === 'frac') [b.num, b.den].forEach(visit);
        else if (b.kind === 'sup' || b.kind === 'radical' || b.kind === 'fence') visit(b.body);
        else if (b.kind === 'atom' && b.sub) visit(b.sub);
      }
      return max;
    };
    for (const source of [
      `${'1/'.repeat(5000)}1`,
      `y = 1${'/x'.repeat(2000)}`,
      `y = ${'x/2 '.repeat(2000)}`,
      `x${')/2'.repeat(2000)}`,
      `x${'!'.repeat(5000)}`,
      `${'(x+1)!/'.repeat(1000)}2`,
    ]) {
      const p = plan(source);
      expect(maxDepth(p.root)).toBeLessThanOrEqual(MAX_PLAN_DEPTH + 1);
      expect(caretStops(p).list.length).toBeGreaterThan(0);
      let leaves = 0;
      forEachLeaf(p.root, () => leaves++);
      expect(leaves).toBeGreaterThan(0);
      expect(planShape(p).length).toBeGreaterThan(0);
      expect(errorLeaves(p, { start: source.length, end: source.length }).length).toBe(1);
    }
    // A chain of factorials stays one row of atoms.
    expect(plan(`x${'!'.repeat(5000)}`).root.boxes.length).toBe(5001);
    // Deep nesting is drawn as text, which still covers the source.
    expect(s(`1${'/x'.repeat(100)}`)).toMatch(/‹1\/x\/x\/x.*›/);
  });
});

describe('properties', () => {
  it('draws every character of the source exactly once, and nests every box', () => {
    const failures: string[] = [];
    sources(0x91a7, 10_000).forEach((source, i) => {
      let p: Plan;
      try {
        p = plan(source, CONTEXTS[i % CONTEXTS.length]);
      } catch (e) {
        failures.push(`${JSON.stringify(source)} threw ${String(e)}`);
        return;
      }
      const ps = pieces(p);
      for (let k = 1; k < ps.length; k++) {
        if ((ps[k] as Span).start < (ps[k - 1] as Span).end) {
          failures.push(`${JSON.stringify(source)}: overlap at ${(ps[k] as Span).start}`);
          return;
        }
      }
      for (let c = 0; c < source.length; c++) {
        if (/\s/.test(source[c] as string)) continue;
        if (!ps.some((sp) => sp.start <= c && c < sp.end)) {
          failures.push(`${JSON.stringify(source)}: offset ${c} not drawn`);
          return;
        }
      }
      const problem = nestingProblem(p.root);
      if (problem) failures.push(`${JSON.stringify(source)}: ${problem}`);
    });
    expect(failures.slice(0, 20)).toEqual([]);
  });

  it('caret stops run left to right, each one found again from {offset, depth} alone', () => {
    const failures: string[] = [];
    sources(0xca7e, 10_000).forEach((source, i) => {
      const p = plan(source, CONTEXTS[i % CONTEXTS.length]);
      const { list, at } = caretStops(p);
      if (list.length === 0) failures.push(`${JSON.stringify(source)}: no stops`);
      list.forEach((st, k) => {
        const fail = (why: string) =>
          failures.push(`${JSON.stringify(source)}: ${st.offset}:${st.depth} ${why}`);
        if (at(st.offset, st.depth) !== st) fail('lost');
        // The plan's only block at that depth around that offset is the stop's: {offset, depth}
        // names one place.
        const found = blocksAt(p.root, st.offset, st.depth);
        if (found.length !== 1 || found[0] !== st.block) fail(`in ${found.length} blocks`);
        if (st.offset < 0 || st.offset > source.length) fail('out of range');
        const { boxes } = st.block;
        if (st.inside) {
          const end = st.inside.subStart ?? st.inside.span.end;
          if (boxes[st.index] !== st.inside) fail('not at the box it is inside');
          if (st.offset <= st.inside.span.start || st.offset > end) fail('outside its atom');
        } else {
          const before = boxes[st.index - 1];
          const after = boxes[st.index];
          if (before && st.offset < before.span.end) fail('inside the box before it');
          if (after && st.offset > after.span.start) fail('inside the box after it');
        }
        const prev = list[k - 1];
        if (prev && prev.offset > st.offset) fail('goes back');
      });
    });
    expect(failures.slice(0, 20)).toEqual([]);
  });
});
