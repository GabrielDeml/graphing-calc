import { describe, expect, it } from 'vitest';
import { DocumentEngine } from './document';
import type { DocAnalysis, Fn1, MathError, PlotItem, RowInput, RowResult } from './types';

/** Rows with ids r0, r1, … */
function rows(...sources: string[]): RowInput[] {
  return sources.map((source, i) => ({ id: `r${i}`, source }));
}

function row(a: DocAnalysis, id: string): RowResult {
  const r = a.byId.get(id);
  if (!r) throw new Error(`no row ${id}`);
  return r;
}

function ok(a: DocAnalysis, id: string): RowResult {
  const r = row(a, id);
  if (r.status !== 'ok') throw new Error(`${id}: ${r.status} ${r.error?.code} ${r.error?.message}`);
  return r;
}

function err(a: DocAnalysis, id: string): MathError {
  const r = row(a, id);
  if (r.status !== 'error' || !r.error) throw new Error(`${id} is ${r.status}, not an error`);
  return r.error;
}

function plot(a: DocAnalysis, id: string): PlotItem {
  const p = ok(a, id).plot;
  if (!p) throw new Error(`${id} has no plot`);
  return p;
}

function curve(a: DocAnalysis, id: string): Fn1 {
  const p = plot(a, id);
  if (p.kind !== 'explicitY' && p.kind !== 'explicitX') throw new Error(`${id} is ${p.kind}`);
  return p.f;
}

describe('end to end', () => {
  it('a = 2, f(x) = a x^2, y = f(x - 1): slider change reuses the same closure', () => {
    const engine = new DocumentEngine();
    const first = engine.update(rows('a = 2', 'f(x) = a x^2', 'y = f(x - 1)'));
    const f = curve(first, 'r2');
    expect(f(3)).toBe(8);

    const second = engine.update(rows('a = 3', 'f(x) = a x^2', 'y = f(x - 1)'));
    expect(second.changedGlobals).toEqual(new Set(['a']));
    expect(second.structureVersion).toBe(first.structureVersion);
    expect(curve(second, 'r2')).toBe(f);
    expect(f(3)).toBe(12);
  });
});

describe('definitions', () => {
  it('work in any order: definitions may come after their use', () => {
    const engine = new DocumentEngine();
    const a = engine.update(rows('y = f(x - 1)', 'f(x) = a x^2', 'a = 2'));
    expect(curve(a, 'r0')(3)).toBe(8);
    expect(ok(a, 'r1').kind).toBe('funcDef');
    expect(ok(a, 'r2').kind).toBe('slider');
    expect(a.values).toEqual(new Map([['a', 2]]));
  });

  it('reports slider, varDef and funcDef details', () => {
    const engine = new DocumentEngine();
    const a = engine.update(rows('a = -2.5', 'b = 2a + 1', 'g(u, v) = u v + b'));
    expect(ok(a, 'r0')).toMatchObject({
      kind: 'slider',
      value: -2.5,
      definedName: 'a',
      slider: { name: 'a', value: -2.5, valueSpan: { start: 4, end: 8 } },
    });
    expect(ok(a, 'r1')).toMatchObject({ kind: 'varDef', value: -4, definedName: 'b' });
    expect(ok(a, 'r1').slider).toBeUndefined();
    expect(ok(a, 'r2')).toMatchObject({ kind: 'funcDef', definedName: 'g', params: ['u', 'v'] });
    expect(ok(a, 'r2').value).toBeUndefined();
    expect(ok(a, 'r2').plot).toBeUndefined();
    expect(a.values).toEqual(
      new Map([
        ['a', -2.5],
        ['b', -4],
      ]),
    );
  });

  it('a variable that evaluates to NaN is still defined', () => {
    const engine = new DocumentEngine();
    const a = engine.update(rows('a = sqrt(-1)', 'y = a + x'));
    expect(ok(a, 'r0').value).toBeNaN();
    expect(a.values.get('a')).toBeNaN();
    expect(curve(a, 'r1')(1)).toBeNaN();
  });

  it('constants show their value', () => {
    const engine = new DocumentEngine();
    const a = engine.update(rows('1 + 2', '2/0', 'a = 4', 'a^2 + 1', 'f(x) = x!', 'f(5)'));
    expect(ok(a, 'r0')).toMatchObject({ kind: 'constant', value: 3 });
    expect(ok(a, 'r1').value).toBe(Number.POSITIVE_INFINITY);
    expect(ok(a, 'r3').value).toBe(17);
    expect(ok(a, 'r5').value).toBe(120);
    expect(ok(a, 'r3').plot).toBeUndefined();
  });

  it('marks every row defining the same name as a duplicate', () => {
    const engine = new DocumentEngine();
    const a = engine.update(rows('a = 1', 'y = a x', 'a = 2'));
    for (const id of ['r0', 'r2']) {
      expect(err(a, id)).toMatchObject({
        code: 'duplicate',
        message: "'a' is defined more than once",
      });
    }
    expect(err(a, 'r0').span).toEqual({ start: 0, end: 1 });
    expect(err(a, 'r1')).toMatchObject({
      code: 'dependency-error',
      message: "Depends on 'a', which has an error",
    });
    expect(row(a, 'r0').kind).toBe('slider');
    expect(a.values.has('a')).toBe(false);
  });

  it('a name defined as both a variable and a function is a duplicate', () => {
    const engine = new DocumentEngine();
    const a = engine.update(rows('a = 1', 'a(x) = x'));
    expect(err(a, 'r0').code).toBe('duplicate');
    expect(err(a, 'r1').code).toBe('duplicate');
  });

  it('reports a duplicate even when the row also has a syntax error', () => {
    const engine = new DocumentEngine();
    const a = engine.update(rows('a = 2$', 'a = 3'));
    expect(err(a, 'r0').code).toBe('duplicate');
    expect(err(a, 'r1').code).toBe('duplicate');
  });

  it('reports cycles with their path', () => {
    const engine = new DocumentEngine();
    const a = engine.update(rows('a = b + 1', 'b = a', 'c = a', 'y = c x', 'd = 1'));
    expect(err(a, 'r0')).toMatchObject({
      code: 'cycle',
      message: 'Circular definition: a → b → a',
    });
    expect(err(a, 'r1').message).toBe('Circular definition: b → a → b');
    expect(err(a, 'r2')).toMatchObject({
      code: 'dependency-error',
      message: "Depends on 'a', which has an error",
    });
    expect(err(a, 'r3').message).toBe("Depends on 'c', which has an error");
    expect(ok(a, 'r4').value).toBe(1);
  });

  it('reports self-references, including recursive functions', () => {
    const engine = new DocumentEngine();
    const a = engine.update(rows('a = a + 1', 'f(x) = f(x - 1) + 1', 'y = f(x)'));
    expect(err(a, 'r0').message).toBe('Circular definition: a → a');
    expect(err(a, 'r1').message).toBe('Circular definition: f → f');
    expect(err(a, 'r2').code).toBe('dependency-error');
  });

  it('reports cycles through functions', () => {
    const engine = new DocumentEngine();
    const a = engine.update(rows('f(x) = x + a', 'a = f(1)'));
    expect(err(a, 'r0').message).toBe('Circular definition: f → a → f');
    expect(err(a, 'r1').message).toBe('Circular definition: a → f → a');
  });

  it('offers sliders for unknown names, in order and deduplicated', () => {
    const engine = new DocumentEngine();
    const a = engine.update(rows('y = m x + b', 'k + k^2', 'f(x) = q x'));
    expect(err(a, 'r0')).toEqual({
      code: 'unknown-name',
      message: "'m' is not defined",
      span: { start: 4, end: 5 },
      quickFix: { kind: 'addSliders', names: ['m', 'b'] },
    });
    expect(err(a, 'r1').quickFix).toEqual({ kind: 'addSliders', names: ['k'] });
    expect(err(a, 'r2').quickFix).toEqual({ kind: 'addSliders', names: ['q'] });
    // The fix: once the sliders exist, the row works.
    const b = engine.update(rows('y = m x + b', 'm = 1', 'b = 1'));
    expect(curve(b, 'r0')(2)).toBe(3);
  });

  it('splits unknown letter runs into single-letter slider names', () => {
    const engine = new DocumentEngine();
    const a = engine.update(rows('y = abc x'));
    expect(err(a, 'r0').quickFix?.names).toEqual(['a', 'b', 'c']);
  });

  it('propagates dependency errors transitively', () => {
    const engine = new DocumentEngine();
    const a = engine.update(rows('a = 1 +', 'b = a', 'f(x) = b x', 'y = f(x)', 'c = 2'));
    expect(err(a, 'r0').code).toBe('expected-expr');
    expect(err(a, 'r1').message).toBe("Depends on 'a', which has an error");
    expect(err(a, 'r2').message).toBe("Depends on 'b', which has an error");
    expect(err(a, 'r3').message).toBe("Depends on 'f', which has an error");
    expect(ok(a, 'r4').value).toBe(2);
  });

  it('turns an error back off once the definition is fixed', () => {
    const engine = new DocumentEngine();
    engine.update(rows('a = 1 +', 'y = a x'));
    const fixed = engine.update(rows('a = 1 + 1', 'y = a x'));
    expect(curve(fixed, 'r1')(3)).toBe(6);
  });

  it('reports a function that is too complex, and rows that use it', () => {
    const sources = ['f_0(x) = x + 1'];
    for (let k = 1; k <= 20; k++) sources.push(`f_${k}(x) = f_${k - 1}(x) + f_${k - 1}(x)`);
    sources.push('y = f_20(x)', 'y = f_3(x)');
    const engine = new DocumentEngine();
    const a = engine.update(rows(...sources));
    // f_k's body expands to 8·2^k − 5 nodes, so f_13 is the first over the 50k budget.
    expect(ok(a, 'r12').kind).toBe('funcDef');
    expect(err(a, 'r13')).toMatchObject({ code: 'too-complex', message: 'Expression too complex' });
    expect(err(a, 'r14').message).toBe("Depends on 'f_13', which has an error");
    expect(err(a, 'r20').code).toBe('dependency-error');
    expect(err(a, 'r21').code).toBe('dependency-error');
    expect(curve(a, 'r22')(0)).toBe(8);
  });

  it('removing a definition makes its uses unknown again', () => {
    const engine = new DocumentEngine();
    engine.update(rows('a = 1', 'y = a x'));
    const a = engine.update([{ id: 'r1', source: 'y = a x' }]);
    expect(err(a, 'r1').code).toBe('unknown-name');
  });

  it('re-parses other rows when the defined names change', () => {
    const engine = new DocumentEngine();
    // Without a definition, `ab` reads as a·b.
    const a = engine.update(rows('y = ab x'));
    expect(err(a, 'r0').quickFix?.names).toEqual(['a', 'b']);
    // Defining `ab` later in the list changes how row 0 parses.
    const b = engine.update(rows('y = ab x', 'ab = 3'));
    expect(curve(b, 'r0')(2)).toBe(6);
    expect(ok(b, 'r0').deps).toEqual(new Set(['ab']));
    // Renaming the definition re-parses row 0 again.
    const c = engine.update(rows('y = ab x', 'ac = 3'));
    expect(err(c, 'r0').quickFix?.names).toEqual(['a', 'b']);
    expect(c.structureVersion).toBeGreaterThan(b.structureVersion);
  });

  it('a function parameter shadows a variable of the same name', () => {
    const engine = new DocumentEngine();
    const a = engine.update(rows('a = 100', 'f(a) = a + 1', 'f(2)', 'y = f(x) + a'));
    expect(ok(a, 'r2').value).toBe(3);
    expect(curve(a, 'r3')(0)).toBe(101);
  });

  it('exposes the names table, keeping the context while the signature holds', () => {
    const engine = new DocumentEngine();
    expect(engine.names().signature).toBe('');
    engine.update(rows('a = 1', 'f(x, y) = x y', 'y = a x'));
    const first = engine.names();
    expect([...first.ctx.vars]).toEqual(['a']);
    expect(first.ctx.fns.get('f')).toBe(2);
    expect(first.signature).toBe('a:var,f:fn:2');
    // A slider move keeps the context object; a new definition replaces it.
    engine.update(rows('a = 2', 'f(x, y) = x y', 'y = a x'));
    expect(engine.names().ctx).toBe(first.ctx);
    engine.update(rows('a = 2', 'f(x, y) = x y', 'b = 3'));
    expect(engine.names().ctx).not.toBe(first.ctx);
    expect(engine.names().signature).toBe('a:var,b:var,f:fn:2');
  });
});

describe('plot items', () => {
  const engine = new DocumentEngine();
  const a = engine.update(
    rows(
      'y > x',
      'x <= y^2',
      'x^2 + y^2 < 1',
      'x^2 + y^2 = 1',
      '(1, 2), (3, c)',
      '(c, 5)',
      'r = 1 + cos θ',
      '(cos t, sin t)',
      'c = 4',
      'x = 2',
      'y = 3',
      'sin(x)',
    ),
  );

  it('explicit inequalities carry their side', () => {
    expect(plot(a, 'r0')).toMatchObject({
      kind: 'explicitY',
      isConstant: false,
      ineq: { side: 'greater', strict: true },
    });
    expect(plot(a, 'r1')).toMatchObject({
      kind: 'explicitX',
      ineq: { side: 'less', strict: false },
    });
    expect(ok(a, 'r0').kind).toBe('ineqY');
    expect(ok(a, 'r1').kind).toBe('ineqX');
  });

  it('implicit regions are positive inside', () => {
    const p = plot(a, 'r2');
    if (p.kind !== 'implicit') throw new Error(p.kind);
    expect(p.ineq).toEqual({ strict: true });
    expect(p.F(0, 0)).toBeGreaterThan(0);
    expect(p.F(2, 0)).toBeLessThan(0);
    const q = plot(a, 'r3');
    if (q.kind !== 'implicit') throw new Error(q.kind);
    expect(q.ineq).toBeUndefined();
    expect(q.F(1, 0)).toBe(0);
    expect(ok(a, 'r2').kind).toBe('ineqImplicit');
  });

  it('points read variables', () => {
    const p = plot(a, 'r4');
    if (p.kind !== 'points') throw new Error(p.kind);
    expect(p.points.map((pt) => [pt.x(), pt.y()])).toEqual([
      [1, 2],
      [3, 4],
    ]);
    const single = plot(a, 'r5');
    expect(ok(a, 'r5').kind).toBe('point');
    if (single.kind !== 'points') throw new Error(single.kind);
    expect(single.points.map((pt) => [pt.x(), pt.y()])).toEqual([[4, 5]]);
  });

  it('polar and parametric rows get the default 0..2π domain', () => {
    const polar = plot(a, 'r6');
    if (polar.kind !== 'polar') throw new Error(polar.kind);
    expect(polar.r(0)).toBe(2);
    expect(polar.thetaMin()).toBe(0);
    expect(polar.thetaMax()).toBe(2 * Math.PI);
    const param = plot(a, 'r7');
    if (param.kind !== 'parametric') throw new Error(param.kind);
    expect(param.fx(0)).toBe(1);
    expect(param.fy(Math.PI / 2)).toBe(1);
    expect(param.tMax()).toBe(2 * Math.PI);
  });

  it('constant explicit curves are flagged', () => {
    expect(plot(a, 'r9')).toMatchObject({ kind: 'explicitX', isConstant: true });
    expect(plot(a, 'r10')).toMatchObject({ kind: 'explicitY', isConstant: true });
    expect(plot(a, 'r11')).toMatchObject({ kind: 'explicitY', isConstant: false });
  });

  it('empty rows are empty', () => {
    const b = new DocumentEngine().update(rows('', '  '));
    expect(row(b, 'r0')).toMatchObject({ status: 'empty', kind: 'empty' });
    expect(row(b, 'r1').deps.size).toBe(0);
  });
});

describe('parameter domains', () => {
  it('compiles domain strings against the variables', () => {
    const engine = new DocumentEngine();
    const input: RowInput[] = [
      { id: 'p', source: '(t, t^2)', domain: { min: '-a', max: 'tau + a' } },
      { id: 'q', source: 'r = θ', domain: { min: '0', max: '2π' } },
      { id: 's', source: 'a = 1' },
    ];
    const a = engine.update(input);
    const p = plot(a, 'p');
    if (p.kind !== 'parametric') throw new Error(p.kind);
    expect(p.tMin()).toBe(-1);
    expect(p.tMax()).toBe(2 * Math.PI + 1);
    expect(ok(a, 'p').deps).toEqual(new Set(['a']));
    const q = plot(a, 'q');
    if (q.kind !== 'polar') throw new Error(q.kind);
    expect(q.thetaMax()).toBe(2 * Math.PI);

    // Domains follow slider moves on the fast path.
    const b = engine.update([input[0], input[1], { id: 's', source: 'a = 3' }]);
    expect(plot(b, 'p')).toBe(p);
    expect(p.tMin()).toBe(-3);
  });

  it('treats blank domain fields as the defaults', () => {
    const engine = new DocumentEngine();
    const a = engine.update([{ id: 'p', source: '(t, 1)', domain: { min: ' ', max: '' } }]);
    const p = plot(a, 'p');
    if (p.kind !== 'parametric') throw new Error(p.kind);
    expect([p.tMin(), p.tMax()]).toEqual([0, 2 * Math.PI]);
  });

  it('reports domain problems as bad-domain', () => {
    const engine = new DocumentEngine();
    const a = engine.update([
      { id: 'p', source: '(t, 1)', domain: { min: '0', max: '2pi +' } },
      { id: 'q', source: 'r = θ', domain: { min: 'x', max: '1' } },
      { id: 'u', source: '(t, 1)', domain: { min: 'k', max: '1' } },
      { id: 'v', source: '(t, 1)', domain: { min: 'b', max: '1' } },
      { id: 'w', source: 'b = 1 +' },
    ]);
    expect(err(a, 'p')).toMatchObject({ code: 'bad-domain' });
    expect(err(a, 'p').message).toMatch(/^t range: /);
    expect(err(a, 'p').span).toBeUndefined();
    expect(err(a, 'q').message).toBe("θ range: Can't use x here");
    expect(err(a, 'u').message).toBe("t range: 'k' is not defined");
    expect(err(a, 'u').quickFix).toEqual({ kind: 'addSliders', names: ['k'] });
    expect(err(a, 'v').message).toBe("t range: Depends on 'b', which has an error");
    expect(row(a, 'p').kind).toBe('parametric');
  });

  it('changing a domain rebuilds only that row', () => {
    const engine = new DocumentEngine();
    const a = engine.update([
      { id: 'p', source: '(t, 1)', domain: { min: '0', max: '1' } },
      { id: 'y', source: 'y = x' },
    ]);
    const b = engine.update([
      { id: 'p', source: '(t, 1)', domain: { min: '0', max: '2' } },
      { id: 'y', source: 'y = x' },
    ]);
    expect(b.structureVersion).toBe(a.structureVersion + 1);
    expect(row(b, 'p')).not.toBe(row(a, 'p'));
    expect(row(b, 'y')).toBe(row(a, 'y'));
  });
});

describe('deps', () => {
  it('collects transitive variable dependencies through variables, functions and domains', () => {
    const engine = new DocumentEngine();
    const a = engine.update([
      { id: 'a', source: 'a = 1' },
      { id: 'b', source: 'b = 2' },
      { id: 'c', source: 'c = a + 1' },
      { id: 'f', source: 'f(x) = c x' },
      { id: 'g', source: 'g(x) = f(x) + 1' },
      { id: 'y', source: 'y = g(x)' },
      { id: 'p', source: '(t, b t)', domain: { min: '0', max: 'c' } },
      { id: 'z', source: 'y = x' },
      { id: 'k', source: 'b + 1' },
    ]);
    expect(ok(a, 'a').deps).toEqual(new Set(['a']));
    expect(ok(a, 'c').deps).toEqual(new Set(['c', 'a']));
    expect(ok(a, 'f').deps).toEqual(new Set(['c', 'a']));
    expect(ok(a, 'y').deps).toEqual(new Set(['c', 'a']));
    expect(ok(a, 'p').deps).toEqual(new Set(['b', 'c', 'a']));
    expect(ok(a, 'z').deps.size).toBe(0);
    expect(ok(a, 'k').deps).toEqual(new Set(['b']));
  });
});

describe('fast path', () => {
  const base = ['a = 1', 'b = 2a', 'y = b x', 'c = 5', 'a + c', 'y = c x', ''];

  it('only rewrites values when only slider literals change', () => {
    const engine = new DocumentEngine();
    const first = engine.update(rows(...base));
    const second = engine.update(rows('a = 3', ...base.slice(1)));

    expect(second.structureVersion).toBe(first.structureVersion);
    expect(second.valuesVersion).toBe(first.valuesVersion + 1);
    expect(second.changedGlobals).toEqual(new Set(['a', 'b']));
    expect(second).not.toBe(first);
    expect(second.byId).not.toBe(first.byId);

    // PlotItems keep their identity; their closures see the new values.
    expect(plot(second, 'r2')).toBe(plot(first, 'r2'));
    expect(curve(second, 'r2')(1)).toBe(6);
    // Rows whose output didn't change keep their RowResult object.
    for (const id of ['r2', 'r3', 'r5', 'r6']) expect(row(second, id)).toBe(row(first, id));
    // Rows whose value changed get a new object.
    expect(row(second, 'r0')).not.toBe(row(first, 'r0'));
    expect(ok(second, 'r0')).toMatchObject({
      value: 3,
      slider: { name: 'a', value: 3, valueSpan: { start: 4, end: 5 } },
    });
    expect(ok(second, 'r1').value).toBe(6);
    expect(ok(second, 'r4').value).toBe(8);
    expect(second.values).toEqual(
      new Map([
        ['a', 3],
        ['b', 6],
        ['c', 5],
      ]),
    );
  });

  it('reports only the variables that actually changed', () => {
    const engine = new DocumentEngine();
    engine.update(rows(...base));
    const b = engine.update(rows(...base.slice(0, 3), 'c = 7', ...base.slice(4)));
    expect(b.changedGlobals).toEqual(new Set(['c']));
    expect(ok(b, 'r4').value).toBe(8);
  });

  it('does not bump valuesVersion when no value changed', () => {
    const engine = new DocumentEngine();
    const a = engine.update(rows(...base));
    const b = engine.update(rows('a = 1.0', ...base.slice(1)));
    expect(b.changedGlobals).toEqual(new Set());
    expect(b.valuesVersion).toBe(a.valuesVersion);
    expect(b.structureVersion).toBe(a.structureVersion);
    // The literal's span changed, so the slider row is new; nothing else is.
    expect(row(b, 'r0')).not.toBe(row(a, 'r0'));
    expect(ok(b, 'r0').slider?.valueSpan).toEqual({ start: 4, end: 7 });
    expect(row(b, 'r1')).toBe(row(a, 'r1'));
  });

  it('returns identical RowResults when called again with the same rows', () => {
    const engine = new DocumentEngine();
    const a = engine.update(rows(...base));
    const b = engine.update(rows(...base));
    expect(b).not.toBe(a);
    a.rows.forEach((r, i) => {
      expect(b.rows[i]).toBe(r);
    });
    expect(b.changedGlobals).toEqual(new Set());
  });

  it('handles negative literals and whitespace', () => {
    const engine = new DocumentEngine();
    const a = engine.update(rows('a = 1', 'y = a'));
    const b = engine.update(rows('a = -2.5', 'y = a'));
    expect(b.structureVersion).toBe(a.structureVersion);
    expect(curve(b, 'r1')(0)).toBe(-2.5);
  });

  it('keeps duplicate sliders in error', () => {
    const engine = new DocumentEngine();
    const a = engine.update(rows('a = 1', 'a = 2'));
    const b = engine.update(rows('a = 5', 'a = 2'));
    expect(b.structureVersion).toBe(a.structureVersion);
    expect(err(b, 'r0').code).toBe('duplicate');
    expect(b.values.size).toBe(0);
  });

  it('rebuilds when anything structural changes', () => {
    const engine = new DocumentEngine();
    const a = engine.update(rows(...base));
    // A slider turning into a derived variable.
    const b = engine.update(rows('a = 1 + 1', ...base.slice(1)));
    expect(b.structureVersion).toBe(a.structureVersion + 1);
    expect(b.valuesVersion).toBe(a.valuesVersion + 1);
    expect(b.changedGlobals).toBeNull();
    // Reordering rows.
    const reordered = rows(...base);
    const c = engine.update([reordered[1], reordered[0], ...reordered.slice(2)]);
    expect(c.structureVersion).toBe(b.structureVersion + 1);
    // A different row id.
    const d = engine.update([{ id: 'other', source: 'a = 1' }, ...reordered.slice(1)]);
    expect(d.structureVersion).toBe(c.structureVersion + 1);
  });
});

describe('identity across rebuilds', () => {
  it('editing one row leaves the other rows and their PlotItems alone', () => {
    const engine = new DocumentEngine();
    const a = engine.update(rows('a = 2', 'f(x) = a x', 'y = f(x)', 'y = x^2', 'a + 1', ''));
    const b = engine.update(rows('a = 2', 'f(x) = a x', 'y = f(x)', 'y = x^3', 'a + 1', ''));
    expect(b.structureVersion).toBe(a.structureVersion + 1);
    expect(row(b, 'r3')).not.toBe(row(a, 'r3'));
    expect(curve(b, 'r3')(2)).toBe(8);
    for (const id of ['r0', 'r1', 'r2', 'r4', 'r5']) expect(row(b, id)).toBe(row(a, id));
  });

  it('editing a function recompiles the rows that call it, and only those', () => {
    const engine = new DocumentEngine();
    const a = engine.update(rows('f(x) = x^2', 'y = f(x)', 'y = x + 1'));
    const b = engine.update(rows('f(x) = x^3', 'y = f(x)', 'y = x + 1'));
    expect(row(b, 'r1')).not.toBe(row(a, 'r1'));
    expect(curve(b, 'r1')(2)).toBe(8);
    expect(row(b, 'r2')).toBe(row(a, 'r2'));
  });

  it('rows depending on a definition that breaks and is fixed get fresh closures', () => {
    const engine = new DocumentEngine();
    engine.update(rows('a = 2', 'y = a x'));
    const broken = engine.update(rows('a = 2 +', 'y = a x'));
    expect(err(broken, 'r1').code).toBe('dependency-error');
    const fixed = engine.update(rows('a = 5', 'y = a x'));
    expect(curve(fixed, 'r1')(1)).toBe(5);
  });

  it('stays correct when the globals array grows', () => {
    const engine = new DocumentEngine();
    const a = engine.update(rows('a = 2', 'y = a x'));
    const f = curve(a, 'r1');
    const many = Array.from({ length: 40 }, (_, i) => `v_${i} = ${i}`);
    const b = engine.update(rows('a = 2', 'y = a x', ...many, 'v_39 + a'));
    expect(curve(b, 'r1')(3)).toBe(6);
    expect(ok(b, 'r42').value).toBe(41);
    expect(f).toBeTypeOf('function');
    const c = engine.update(rows('a = 3', 'y = a x', ...many, 'v_39 + a'));
    expect(c.structureVersion).toBe(b.structureVersion);
    expect(curve(c, 'r1')(3)).toBe(9);
    expect(ok(c, 'r42').value).toBe(42);
  });
});

describe('robustness', () => {
  it('handles very long flat expressions without throwing', () => {
    const engine = new DocumentEngine();
    for (const n of [5000, 15000]) {
      const a = engine.update(
        rows(
          `y = ${Array(n).fill('x').join(' + ')}`,
          Array(n).fill('1').join('+'),
          `c = ${Array(n).fill('b').join('+')}`,
          'b = 1',
          `x^2 + y^2 = ${Array(n).fill('1').join('+')}`,
        ),
      );
      expect(curve(a, 'r0')(1)).toBe(n);
      expect(ok(a, 'r1').value).toBe(n);
      expect(ok(a, 'r2').value).toBe(n);
      expect(ok(a, 'r4').kind).toBe('implicit');
    }
  });

  it('reports a too-complex row instead of throwing when the budget runs out', () => {
    const engine = new DocumentEngine();
    const a = engine.update(rows(`y = ${Array(30000).fill('x').join('+')}`));
    expect(err(a, 'r0').code).toBe('too-complex');
  });
});

describe('evalConstant', () => {
  it('evaluates against the current variables and functions', () => {
    const engine = new DocumentEngine();
    expect(engine.evalConstant('2pi')).toEqual({ ok: true, value: 2 * Math.PI });
    engine.update(rows('a = 2', 'f(x) = x + 1', 'b = 1 +'));
    expect(engine.evalConstant('a + 1')).toEqual({ ok: true, value: 3 });
    expect(engine.evalConstant('f(a) * 2')).toEqual({ ok: true, value: 6 });
    expect(engine.evalConstant('-10')).toEqual({ ok: true, value: -10 });

    engine.update(rows('a = 5', 'f(x) = x + 1', 'b = 1 +'));
    expect(engine.evalConstant('a + 1')).toEqual({ ok: true, value: 6 });
  });

  it('rejects plot variables, unknown names and non-numbers', () => {
    const engine = new DocumentEngine();
    engine.update(rows('a = 2', 'b = 1 +'));
    const code = (source: string) => {
      const r = engine.evalConstant(source);
      return r.ok ? 'ok' : r.error.code;
    };
    const x = engine.evalConstant('x + 1');
    expect(x.ok ? '' : x.error.message).toBe("Can't use x here");
    expect(code('t')).toBe('plot-var-not-allowed');
    expect(code('k')).toBe('unknown-name');
    expect(code('b')).toBe('dependency-error');
    expect(code('')).toBe('expected-expr');
    expect(code('y = 1')).toBe('not-a-number');
    expect(code('(1, 2)')).toBe('not-a-number');
    expect(code('1, 2')).toBe('not-a-number');
    expect(code('1 +')).toBe('expected-expr');
  });
});

describe('caches', () => {
  interface Internals {
    heads: Map<string, unknown>;
    analyses: Map<string, unknown>;
    compiled: Map<string, unknown>;
    constants: Map<string, unknown>;
  }

  it('drop entries for sources that are gone', () => {
    const engine = new DocumentEngine();
    for (let i = 0; i < 200; i++) {
      engine.update([
        { id: 's', source: `a = ${i}` },
        { id: 'y', source: `y = x^${i % 7} + a` },
        { id: 'p', source: '(t, a)', domain: { min: '0', max: `${i}` } },
      ]);
    }
    const internals = engine as unknown as Internals;
    expect(internals.heads.size).toBeLessThanOrEqual(3);
    expect(internals.analyses.size).toBeLessThanOrEqual(3);
    expect(internals.compiled.size).toBeLessThanOrEqual(3);
    expect(internals.constants.size).toBeLessThanOrEqual(2);
  });
});

describe('performance', () => {
  it('re-analyses a 30-row document after a one-character edit in well under 2 ms', () => {
    const sources = [
      'a = 1',
      'b = 2',
      'c = a + b',
      'f(x) = a x^2 + b x + c',
      'g(x) = sin(f(x)) + cos(x)',
      'y = f(x)',
      'y = g(x)',
      'x^2 + y^2 = c',
      'y < a x + 1',
      '(cos t, sin(b t))',
      'r = 1 + a cos θ',
      '(1, 2), (a, b)',
      'c^2 + 1',
    ];
    while (sources.length < 29) sources.push(`y = ${sources.length} sin(x) + a`);
    const engine = new DocumentEngine();
    const edit = (k: number) =>
      engine.update(rows(...sources, `y = x^2 + ${k % 10}${k % 3 === 0 ? '' : 'x'}`));
    for (let k = 0; k < 50; k++) edit(k);
    const n = 200;
    const start = performance.now();
    for (let k = 0; k < n; k++) edit(k);
    const perUpdate = (performance.now() - start) / n;
    expect(perUpdate).toBeLessThan(2);
  });

  it('takes the fast path for slider drags', () => {
    const sources = ['a = 1', 'f(x) = a x^2', 'y = f(x)', 'b = a^2', 'y = b x', 'a + b'];
    const engine = new DocumentEngine();
    const first = engine.update(rows(...sources));
    const n = 500;
    const start = performance.now();
    let last = first;
    for (let k = 0; k < n; k++) last = engine.update(rows(`a = ${k / 100}`, ...sources.slice(1)));
    const perUpdate = (performance.now() - start) / n;
    expect(last.structureVersion).toBe(first.structureVersion);
    expect(perUpdate).toBeLessThan(0.5);
  });
});

describe('review regressions', () => {
  function polarR(a: DocAnalysis, id: string): Fn1 {
    const p = plot(a, id);
    if (p.kind !== 'polar') throw new Error(`${id} is ${p.kind}`);
    return p.r;
  }

  it('y(x) = x^2 draws the parabola, not the lines x = 0 and y = x', () => {
    const a = new DocumentEngine().update(rows('y(x) = x^2', 'y(x) = 2x + 1', 'r(θ) = 2'));
    expect(ok(a, 'r0').kind).toBe('explicitY');
    expect(curve(a, 'r0')(3)).toBe(9);
    expect(curve(a, 'r1')(2)).toBe(5);
    expect(ok(a, 'r2').kind).toBe('polar');
    expect(err(new DocumentEngine().update(rows('y(x) = x + y')), 'r0').code).toBe('plot-var-call');
  });

  it('asin(bx) with a slider a is a·sin(bx), and the a slider moves it', () => {
    const engine = new DocumentEngine();
    const first = engine.update(rows('a = 2', 'b = 1', 'c = 0', 'y = asin(bx) + c'));
    const f = curve(first, 'r3');
    expect(f(0.5)).toBeCloseTo(2 * Math.sin(0.5), 12);
    expect(f(2)).toBeCloseTo(2 * Math.sin(2), 12);
    expect(ok(first, 'r3').deps).toEqual(new Set(['a', 'b', 'c']));
    engine.update(rows('a = 3', 'b = 1', 'c = 0', 'y = asin(bx) + c'));
    expect(f(2)).toBeCloseTo(3 * Math.sin(2), 12);
    // Without a user `a` it is still the inverse sine.
    expect(curve(new DocumentEngine().update(rows('y = asin(x)')), 'r0')(0.5)).toBeCloseTo(
      Math.asin(0.5),
      12,
    );
  });

  it('a = asin(0.5) still defines a as the inverse sine, not a cycle', () => {
    const a = new DocumentEngine().update(rows('a = asin(0.5)', 'b = atan(1)', 'y = asin(x)'));
    expect(ok(a, 'r0').value).toBeCloseTo(Math.PI / 6, 12);
    // Other rows read asin as a·sin once a is defined.
    expect(ok(a, 'r1').value).toBeCloseTo((Math.PI / 6) * Math.tan(1), 12);
    expect(curve(a, 'r2')(1)).toBeCloseTo((Math.PI / 6) * Math.sin(1), 12);
  });

  it('theta inside a letter run is θ', () => {
    const a = new DocumentEngine().update(
      rows('a = 2', 'r = atheta', 'r = 2costheta', 'r = 1 + sintheta', 'n = 3', 'r = cos(ntheta)'),
    );
    expect(polarR(a, 'r1')(1.5)).toBe(3);
    expect(polarR(a, 'r2')(1)).toBeCloseTo(2 * Math.cos(1), 12);
    expect(polarR(a, 'r3')(1)).toBeCloseTo(1 + Math.sin(1), 12);
    expect(polarR(a, 'r5')(1)).toBeCloseTo(Math.cos(3), 12);
  });

  it('subscripted names with a builtin base can be defined', () => {
    const a = new DocumentEngine().update(rows('e_1 = 2', 'y = e_1 x', 'pi_2 = 3', 'tau_0 = 1'));
    expect(ok(a, 'r0')).toMatchObject({ kind: 'slider', definedName: 'e_1', value: 2 });
    expect(curve(a, 'r1')(3)).toBe(6);
    expect(ok(a, 'r2')).toMatchObject({ kind: 'slider', definedName: 'pi_2' });
    expect(ok(a, 'r3')).toMatchObject({ kind: 'slider', definedName: 'tau_0' });
  });

  it('an unknown e_1 offers a slider for it', () => {
    const e = err(new DocumentEngine().update(rows('y = e_1 x')), 'r0');
    expect(e).toMatchObject({ code: 'unknown-name', quickFix: { names: ['e_1'] } });
  });

  it('log_2(x) gets a hint instead of a nonsense add-slider fix', () => {
    const engine = new DocumentEngine();
    for (const [source, base] of [
      ['y = log_2(x)', '2'],
      ['y = log_{10} x', '10'],
      ['y = log_b(x)', 'b'],
    ]) {
      const e = err(engine.update(rows(source)), 'r0');
      expect(e.code).toBe('unknown-name');
      expect(e.hint).toBe(`Logs with a base aren't supported yet; write log(x)/log(${base})`);
      expect(e.quickFix).toBeUndefined();
    }
    // Defining it makes it an ordinary variable.
    expect(curve(engine.update(rows('log_2 = 3', 'y = log_2 x')), 'r1')(2)).toBe(6);
  });

  it('a digit subscript ends before the next letter: a_1x is a_1·x', () => {
    const a = new DocumentEngine().update(
      rows('a_1 = 2', 'y = a_1x', 'm_1 = 2', 'b = 1', 'y = m_1x + b'),
    );
    expect(curve(a, 'r1')(3)).toBe(6);
    expect(curve(a, 'r4')(3)).toBe(7);
  });

  it('1e-3 is a bad-number error, not a silent (e − 3)·x', () => {
    const a = new DocumentEngine().update(rows('y = 1e-3x', 'y = 2.5e-1x'));
    expect(err(a, 'r0')).toMatchObject({
      code: 'bad-number',
      hint: expect.stringContaining('1*10^-3'),
    });
    expect(err(a, 'r1').code).toBe('bad-number');
  });

  it('letter runs with a builtin after other letters are equations, not definitions', () => {
    const a = new DocumentEngine().update(rows('b = 2', 'bcos(x) = 1', 'rcosθ = 1', 'rcos(θ) = 1'));
    expect(ok(a, 'r1')).toMatchObject({ kind: 'implicit' });
    expect(ok(a, 'r1').definedName).toBeUndefined();
    expect(err(a, 'r2').code).toBe('misplaced-plot-var');
    expect(err(a, 'r3').code).toBe('misplaced-plot-var');
    // Words that start with a builtin name are still names.
    expect(ok(new DocumentEngine().update(rows('cost = 5')), 'r0')).toMatchObject({
      kind: 'slider',
      definedName: 'cost',
    });
  });

  it('braces and superscripts get useful feedback', () => {
    const a = new DocumentEngine().update(
      rows('y = x^{2}', 'y = e^{-x^2}', 'y = x²', 'x² + y² = 1'),
    );
    expect(err(a, 'r0')).toMatchObject({ code: 'unsupported', message: 'Use ( ) instead of { }' });
    expect(err(a, 'r1').message).toBe('Use ( ) instead of { }');
    expect(curve(a, 'r2')(3)).toBe(9);
    expect(ok(a, 'r3').kind).toBe('implicit');
  });
});

describe('function definitions draw their graph', () => {
  it('f(x) = x^2 is plotted as y = f(x), keeping its definition details', () => {
    const a = new DocumentEngine().update(rows('f(x) = x^2', 'y = f(x - 1)'));
    expect(ok(a, 'r0')).toMatchObject({ kind: 'funcDef', definedName: 'f', params: ['x'] });
    const p = plot(a, 'r0');
    expect(p).toMatchObject({ kind: 'explicitY', isConstant: false });
    expect(curve(a, 'r0')(3)).toBe(9);
    expect(curve(a, 'r1')(3)).toBe(4);
  });

  it('any single parameter works; y draws sideways; constants are flagged', () => {
    const a = new DocumentEngine().update(
      rows('g(u) = sin(u)/u', 'h(y) = y^2', 'k(x) = 3', 's(a) = a + 1'),
    );
    expect(curve(a, 'r0')(1)).toBeCloseTo(Math.sin(1), 12);
    expect(plot(a, 'r1').kind).toBe('explicitX');
    expect(curve(a, 'r1')(2)).toBe(4);
    expect(plot(a, 'r2')).toMatchObject({ kind: 'explicitY', isConstant: true });
    expect(curve(a, 'r3')(2)).toBe(3);
  });

  it('functions of t, θ, r or of several parameters draw nothing', () => {
    const a = new DocumentEngine().update(
      rows('g(t) = sin t', 'p(θ) = cos θ', 'q(r) = r', 'm(x, y) = x + y'),
    );
    for (const id of ['r0', 'r1', 'r2', 'r3']) {
      expect(ok(a, id).kind).toBe('funcDef');
      expect(ok(a, id).plot).toBeUndefined();
    }
  });

  it('the graph follows sliders without recompiling, and keeps its identity across rebuilds', () => {
    const engine = new DocumentEngine();
    const first = engine.update(rows('a = 2', 'f(x) = a x^2', ''));
    const f = curve(first, 'r1');
    expect(f(3)).toBe(18);
    expect(ok(first, 'r1').deps).toEqual(new Set(['a']));

    const second = engine.update(rows('a = 3', 'f(x) = a x^2', ''));
    expect(second.structureVersion).toBe(first.structureVersion);
    expect(curve(second, 'r1')).toBe(f);
    expect(f(3)).toBe(27);

    const third = engine.update(rows('a = 3', 'f(x) = a x^2', 'y = x'));
    expect(third.structureVersion).toBe(first.structureVersion + 1);
    expect(row(third, 'r1')).toBe(row(second, 'r1'));
  });

  it('a function definition with an error draws nothing', () => {
    const a = new DocumentEngine().update(rows('f(x) = x + q', 'f(x) = 1'));
    expect(row(a, 'r0').plot).toBeUndefined();
    expect(row(a, 'r1').plot).toBeUndefined();
  });
});
