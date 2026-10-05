import { describe, expect, it } from 'vitest';
import { DocumentEngine } from '../engine/document';
import type { Fn1, PlotItem } from '../engine/types';
import { conicFit } from './fit';
import {
  describeConic,
  type Insight,
  type InsightInput,
  type InViewFacts,
  insightText,
  lineText,
  num,
  piText,
  polarInsight,
  polesIn,
  rowInsight,
} from './insights';

/**
 * The insight of the last of `sources` (rows r0, r1, …, the others its context), as the row shows
 * it, other rows named by their text. `extra` adds what the UI adds for the selected row.
 */
function said(
  sources: string[],
  extra: (engine: DocumentEngine) => Partial<InsightInput> = () => ({}),
): string | null {
  const insight = insightOf(sources, extra);
  return insight ? insightText(insight, (id) => sources[Number(id.slice(1))] ?? id) : null;
}

function insightOf(
  sources: string[],
  extra: (engine: DocumentEngine) => Partial<InsightInput> = () => ({}),
): Insight | null {
  const engine = new DocumentEngine();
  const a = engine.update(sources.map((source, i) => ({ id: `r${i}`, source })));
  const id = `r${sources.length - 1}`;
  const res = a.byId.get(id);
  if (res?.status !== 'ok' || !res.kind) throw new Error(`${id}: ${res?.error?.message}`);
  const name = res.definedName;
  const usedBy = name
    ? a.rows.filter((r) => r.id !== id && engine.refsOf(r.id).includes(name)).map((r) => r.id)
    : [];
  return rowInsight({
    kind: res.kind,
    plot: res.plot,
    trigArgs: res.plot ? engine.trigArguments(id, res.plot) : null,
    usedBy,
    ...extra(engine),
  });
}

/** The selected row's extras: the other curves, and what the graph found in view. */
function selected(sources: string[], inView: InViewFacts | null = null) {
  return (engine: DocumentEngine): Partial<InsightInput> => {
    const a = engine.update(sources.map((source, i) => ({ id: `r${i}`, source })));
    const last = `r${sources.length - 1}`;
    const others = a.rows.flatMap((r) =>
      r.id !== last && r.plot ? [{ id: r.id, plot: r.plot as PlotItem }] : [],
    );
    return { others, inView };
  };
}

/** The chips that fly somewhere and pin the trace there: [name, x, y]. */
function chips(insight: Insight | null): [string, number, number][] {
  return (insight?.facts ?? []).flatMap((f) =>
    (f.values ?? []).flatMap((v) =>
      v.at && !v.offCurve ? [[v.name, v.at.x, v.at.y] as [string, number, number]] : [],
    ),
  );
}

describe('numbers', () => {
  it('four significant digits, a true minus', () => {
    expect(num(Math.SQRT2)).toBe('1.414');
    expect(num(-0.41421356)).toBe('−0.4142');
    expect(num(12345.67)).toBe('12346');
    expect(num(-0)).toBe('0');
    expect(num(1e-17)).toBe('0');
    expect(num(3e12)).toBe('3×10¹²');
  });

  it('multiples of π', () => {
    expect(piText(2 * Math.PI)).toBe('2π');
    expect(piText(Math.PI)).toBe('π');
    expect(piText(Math.PI / 2)).toBe('π/2');
    expect(piText((2 * Math.PI) / 3)).toBe('2π/3');
    expect(piText(-Math.PI)).toBe('−π');
    expect(piText(4)).toBe('4');
  });

  it('lines', () => {
    expect(lineText('y', 'x', 2, -1)).toBe('y = 2x − 1');
    expect(lineText('y', 'x', -1, 0)).toBe('y = −x');
    expect(lineText('y', 'x', 0, 3)).toBe('y = 3');
    expect(lineText('y', 'x', 1, 0.5)).toBe('y = x + 0.5');
    expect(lineText('y', 'x', 0, 0)).toBe('y = 0');
  });
});

describe('y = f(x)', () => {
  it.each([
    ['y = 3', 'Horizontal line · y = 3'],
    ['y = 2^10', 'Horizontal line · y = 1024'],
    ['x = 2', 'Vertical line · x = 2'],
    ['y = 2x + 1', 'Line · slope 2 · y-intercept 1 · x-intercept −0.5'],
    ['y = x/3', 'Line · slope 0.3333 · through (0, 0)'],
    ['x = 2y + 4', 'Line · slope 0.5 · y-intercept −2 · x-intercept 4'],
    ['y = x^2 - 2', 'Parabola · vertex (0, −2) · roots −1.414, 1.414 · axis x = 0'],
    ['y = (x - 1)^2 + 3', 'Parabola · vertex (1, 3) · axis x = 1'],
    ['y = x^2', 'Parabola · vertex (0, 0) · root 0 · axis x = 0'],
    ['x = y^2 - 1', 'Parabola · vertex (−1, 0) · y-intercepts −1, 1 · axis y = 0'],
    ['y = x^3 - x', 'Cubic · roots −1, 0, 1 · turning points (−0.5774, 0.3849), (0.5774, −0.3849)'],
    ['y = x^3 + x', 'Cubic · root 0 · inflection point (0, 0)'],
    [
      'y = (x^2 - 1)(x^2 - 4)',
      'Quartic · roots −2, −1, 1, 2 · turning points (−1.581, −2.25), (0, 4), (1.581, −2.25)',
    ],
  ])('%s', (source, text) => {
    expect(said([source])).toBe(text);
  });

  it('a polynomial through sliders reads their values', () => {
    expect(said(['a = 2', 'b = -4', 'y = a x^2 + b'])).toBe(
      'Parabola · vertex (0, −4) · roots −1.414, 1.414 · axis x = 0',
    );
  });

  it.each([
    ['y = 2^x', 'Exponential growth · base 2 · asymptote y = 0 · y-intercept 1'],
    ['y = e^x', 'Exponential growth · base e · asymptote y = 0 · y-intercept 1'],
    ['y = 3(0.5)^x + 1', 'Exponential decay · base 0.5 · asymptote y = 1 · y-intercept 4'],
  ])('%s', (source, text) => {
    expect(said([source])).toBe(text);
  });

  it.each([
    ['y = sin(x)', 'Sine wave · period 2π · amplitude 1 · midline y = 0'],
    ['y = 3cos(2x) + 1', 'Sine wave · period π · amplitude 3 · midline y = 1'],
    ['y = sin(x) + sin(2x)', 'Periodic · period 2π · amplitude 1.76 · midline y = 0'],
    ['y = sin(x)^2', 'Sine wave · period π · amplitude 0.5 · midline y = 0.5'],
    ['y = tan(x)', 'Periodic · period π'],
    ['k = 2', 'y = sin(k x)'],
  ])('%s', (source, text) => {
    if (source === 'k = 2') {
      expect(said([source, text])).toBe('Sine wave · period π · amplitude 1 · midline y = 0');
      return;
    }
    expect(said([source])).toBe(text);
  });

  it('flies to a point on the curve from each chip', () => {
    expect(chips(insightOf(['y = x^2 - 2']))).toEqual([
      ['Vertex', 0, -2],
      ['Root', -Math.SQRT2, 0],
      ['Root', Math.SQRT2, 0],
    ]);
    // The amplitude's chip flies to a maximum.
    const [[name, x, y]] = chips(insightOf(['y = sin(x)']));
    expect(name).toBe('Amplitude');
    expect(x).toBeCloseTo(Math.PI / 2, 3);
    expect(y).toBeCloseTo(1, 9);
  });

  it('claims nothing it cannot check', () => {
    // No model fits, and nothing was counted in view (not the selected row).
    for (const source of [
      'y = x sin(x)',
      'y = sin(x^2)',
      'y = x^5 - x',
      'y = 1/x',
      'y = sqrt(x)',
    ]) {
      expect(said([source])).toBeNull();
    }
    // sin x + x repeats nothing; x sin x has no amplitude.
    expect(said(['y = sin(x) + x'])).toBeNull();
  });

  it('counts what the graph found in view for the selected row', () => {
    const bounds = { xmin: -10, xmax: 10, ymin: -10, ymax: 10 };
    const inView: InViewFacts = { bounds, counts: { root: 3, max: 1, min: 1 }, meets: new Map() };
    expect(said(['y = x^5 - 5x'], selected(['y = x^5 - 5x'], inView))).toBe(
      // A quintic: no model, but the counts.
      'In view: 3 roots, 2 turning points',
    );
    const poles: InViewFacts = { bounds, counts: {}, meets: new Map() };
    expect(said(['y = 1/x'], selected(['y = 1/x'], poles))).toBe('Vertical asymptote x = 0');
    expect(said(['y = 1/(x^2 - 1)'], selected(['y = 1/(x^2 - 1)'], poles))).toBe(
      'Vertical asymptotes x = −1, x = 1',
    );
    expect(said(['x = 1/y'], selected(['x = 1/y'], poles))).toBe('Horizontal asymptote y = 0');
  });
});

describe('polesIn', () => {
  it.each([
    ['1/x', (x: number) => 1 / x, [0]],
    ['1/x²', (x: number) => 1 / (x * x), [0]],
    [
      'tan x',
      Math.tan,
      [-2.5 * Math.PI, -1.5 * Math.PI, -Math.PI / 2, Math.PI / 2, 1.5 * Math.PI, 2.5 * Math.PI],
    ],
    ['1/(x - 0.3) + 1/(x + 2)', (x: number) => 1 / (x - 0.3) + 1 / (x + 2), [-2, 0.3]],
    ['e^(1/x)', (x: number) => Math.exp(1 / x), [0]],
  ])('%s', (_, f, poles) => {
    const found = polesIn(f as Fn1, -10, 10);
    expect(found?.length).toBe(poles.length);
    poles.forEach((p, i) => {
      expect(found?.[i]).toBeCloseTo(p, 6);
    });
  });

  it.each([
    ['floor x', Math.floor],
    ['ln|x|', (x: number) => Math.log(Math.abs(x))],
    ['x²', (x: number) => x * x],
    ['sin x', Math.sin],
    ['sign x', Math.sign],
  ])('%s has none', (_, f) => {
    expect(polesIn(f as Fn1, -10, 10)).toEqual([]);
  });

  it('gives up past `max`', () => {
    expect(polesIn((x) => 1 / Math.sin(10 * x), -10, 10, 8)).toBeNull();
  });
});

describe('implicit curves', () => {
  it.each([
    ['x^2 + y^2 = 9', 'Circle · centre (0, 0) · radius 3'],
    ['(x - 1)^2 + (y + 2)^2 = 4', 'Circle · centre (1, −2) · radius 2'],
    ['x^2/9 + y^2/4 = 1', 'Ellipse · centre (0, 0) · semi-axes 3, 2'],
    ['x^2/4 + y^2/9 = 1', 'Ellipse · centre (0, 0) · semi-axes 3, 2'],
    [
      'x^2 - y^2 = 1',
      'Hyperbola · centre (0, 0) · vertices (1, 0), (−1, 0) · asymptotes y = x, y = −x',
    ],
    ['xy = 1', 'Hyperbola · centre (0, 0) · vertices (1, 1), (−1, −1) · asymptotes x = 0, y = 0'],
    ['x^2 = y + 1', 'Parabola · vertex (0, −1) · axis x = 0'],
    ['(x - y)^2 = x + y', 'Parabola · vertex (0, 0) · axis y = x'],
    ['x + y = 1', 'Line · slope −1 · y-intercept 1'],
    ['x^2 = 4', 'Two parallel lines · x = −2, x = 2'],
    ['x^2 = y^2', 'Two lines · meeting at (0, 0) · y = x, y = −x'],
  ])('%s', (source, text) => {
    expect(said([source])).toBe(text);
  });

  it('a tilted ellipse says how far it is tilted', () => {
    expect(said(['x^2 + x y + y^2 = 3'])).toBe(
      'Ellipse · centre (0, 0) · semi-axes 2.449, 1.414 · tilted −45°',
    );
  });

  it('every point named is on the curve', () => {
    for (const source of [
      'x^2 + x y + y^2 = 3',
      'xy = 1',
      '(x - y)^2 = x + y',
      'x^2/9 + y^2/4 = 1',
    ]) {
      const engine = new DocumentEngine();
      const a = engine.update([{ id: 'r0', source }]);
      const plot = a.byId.get('r0')?.plot;
      if (plot?.kind !== 'implicit') throw new Error(source);
      const insight = rowInsight({ kind: 'implicit', plot });
      expect(insight, source).not.toBeNull();
      for (const [name, x, y] of chips(insight)) {
        expect(Math.abs(plot.F(x, y)), `${source}: ${name}`).toBeLessThan(1e-9);
      }
    }
  });

  it('nothing for no curve, a point, or a curve no conic fits', () => {
    expect(said(['x^2 + y^2 = -1'])).toBeNull();
    expect(said(['x^2 + y^2 = 0'])).toBeNull();
    expect(said(['x^4 + y^4 = 1'])).toBeNull();
    expect(said(['sin(x) = y^2'])).toBeNull();
    // Never an unchecked conic: a description that does not hold is dropped.
    const fit = conicFit((x, y) => x * x + y * y - 9);
    if (!fit) throw new Error('no fit');
    expect(describeConic({ ...fit, F: Number.NaN })).toBeNull();
  });

  it('inequalities say nothing (yet)', () => {
    expect(said(['x^2 + y^2 < 4'])).toBeNull();
    expect(said(['y > x^2'])).toBeNull();
  });
});

describe('polar curves', () => {
  it.each([
    ['r = 2', 'Circle · centre (0, 0) · radius 2'],
    ['r = 2cos(θ)', 'Circle · centre (1, 0) · radius 1'],
    ['r = 1 + cos(θ)', 'Cardioid · cusp (0, 0) · farthest point (2, 0)'],
    ['r = 1 + 2cos(θ)', 'Limaçon with an inner loop · farthest point (3, 0)'],
    ['r = 3 + 2sin(θ)', 'Dimpled limaçon · farthest point (0, 5)'],
    ['r = cos(3θ)', 'Rose with 3 petals · petal length 1'],
    ['r = 2sin(2θ)', 'Rose with 4 petals · petal length 2'],
    ['r = θ', 'Archimedean spiral · 1 turn · gap between turns 2π'],
  ])('%s', (source, text) => {
    expect(said([source])).toBe(text);
  });

  it('only a whole curve is named', () => {
    // Half a turn of r = 2 is half a circle; a quarter turn of a 3-petal rose is not all of it.
    expect(polarInsight(() => 2, 0, Math.PI)).toBeNull();
    expect(polarInsight((t) => Math.cos(3 * t), 0, Math.PI / 2, [(t) => 3 * t])).toBeNull();
    expect(insightText(polarInsight((t) => 2 * Math.cos(t), 0, Math.PI) as Insight, String)).toBe(
      'Circle · centre (1, 0) · radius 1',
    );
  });

  it('the petal tip is on the curve', () => {
    const [[name, x, y]] = chips(insightOf(['r = 2sin(2θ)']));
    expect(name).toBe('Petal length');
    expect(Math.hypot(x, y)).toBeCloseTo(2, 9);
    expect(Math.atan2(y, x)).toBeCloseTo(Math.PI / 4, 9);
  });

  it('nothing for curves it cannot name', () => {
    expect(said(['r = θ^2'])).toBeNull();
    expect(said(['r = 1 + cos(θ)^3'])).toBeNull();
  });
});

describe('parametric curves', () => {
  it.each([
    ['(cos t, sin t)', 'Circle · centre (0, 0) · radius 1'],
    ['(2cos t + 1, 2sin t)', 'Circle · centre (1, 0) · radius 2'],
    ['(3cos t, 2sin t)', 'Ellipse · centre (0, 0) · semi-axes 3, 2'],
    ['(t, 2t + 1)', 'Line segment · from (0, 1) · to (6.283, 13.57)'],
    ['(cos t, sin(2t))', 'Closed curve · through (1, 0)'],
    ['(t cos t, t sin t)', 'Open curve · from (0, 0) · to (6.283, 0)'],
  ])('%s', (source, text) => {
    expect(said([source])).toBe(text);
  });
});

describe('names and curves together', () => {
  it('a slider, a variable or a function: the rows that use it', () => {
    expect(said(['y = a x + 1', 'k = 2a', 'a = 2'])).toBe('Used by y = a x + 1, k = 2a');
    expect(said(['y = f(x - 1)', 'f(x) = x^2'])).toBe('Used by y = f(x - 1)');
    expect(said(['y = a', 'y = 2a', 'y = 3a', 'y = 4a', 'y = 5a', 'a = 1'])).toBe(
      'Used by y = a, y = 2a, y = 3a +2 more',
    );
    expect(said(['a = 2'])).toBeNull();
  });

  it('the selected curve: where it meets the others, exactly for polynomials', () => {
    const sources = ['y = x/3', 'y = x^2', 'y = -1', 'y = x^2 + 0'];
    expect(said(sources, selected(sources))).toBe(
      'Parabola · vertex (0, 0) · root 0 · axis x = 0 · meets y = x/3 at 2 points · same curve as y = x^2',
    );
    const cubic = ['y = x', 'y = x^3'];
    expect(said(cubic, selected(cubic))).toContain('meets y = x at 3 points');
  });

  it('and in view, for the others', () => {
    const sources = ['x^2 + y^2 = 9', 'y = sin(x)'];
    const inView: InViewFacts = {
      bounds: { xmin: -10, xmax: 10, ymin: -10, ymax: 10 },
      counts: {},
      meets: new Map([['r0', 2]]),
    };
    expect(said(sources, selected(sources, inView))).toBe(
      'Sine wave · period 2π · amplitude 1 · midline y = 0 · meets x^2 + y^2 = 9 at 2 points in view',
    );
  });
});
