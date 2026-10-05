import { describe, expect, it } from 'vitest';
import { EMPTY_CONTEXT, type NameContext } from '../engine/names';
import { caretAt, runCommand } from './commands';
import { completionAt } from './complete';
import { layoutParse } from './layout';
import { renderPlan } from './plan';

function ctxOf(vars: string[] = [], fns: Record<string, number> = {}): NameContext {
  return { vars: new Set(vars), fns: new Map(Object.entries(fns)) };
}

/** What is offered at ‸ (the end without one), as the text it would type, or null. */
function offered(marked: string, ctx: NameContext = EMPTY_CONTEXT): string | null {
  const at = marked.indexOf('‸');
  const text = marked.replace('‸', '');
  const plan = renderPlan(layoutParse(text, ctx));
  const caret = caretAt(text, at < 0 ? text.length : at, { names: ctx });
  return completionAt(plan, caret, ctx)?.text ?? null;
}

describe('completionAt', () => {
  it.each([
    ['y = si', 'n('],
    ['y = co', 's('],
    ['y = ta', 'n('],
    ['y = sq', 'rt('],
    ['y = ab', 's('],
    ['y = lo', 'g('],
    ['y = as', 'in('],
    ['y = arcc', 'os('],
    ['y = sig', 'n('],
    ['y = fl', 'oor('],
    ['y = ma', 'x('],
    ['y = 2si', 'n('],
    // The longest run that fits: `xsi` reads as x·si.
    ['y = xsi', 'n('],
    ['y = (si', 'n('],
    ['y = (si‸)', 'n('],
    ['y = 1/si', 'n('],
    ['y = sqrt(si‸)', 'n('],
    ['y = x^si', 'n('],
    ['y = max(1, si‸)', 'n('],
    // Something after it in its part of the math, which the ghost would cover.
    ['y = max(si‸, 1)', null],
    ['y = si‸ + 1', null],
    ['y = si‸/2', null],
  ])('%s offers %s', (marked, expected) => {
    expect(offered(marked)).toBe(expected);
  });

  it.each([
    // One letter is mostly a variable.
    'y = s',
    // Whole names already.
    'y = sin',
    'y = cos',
    'y = sec',
    'y = ln',
    'y = pi',
    // Names the engine knows: e·x.
    'y = ex',
    // In the middle of a run, or of the row.
    'y = s‸i',
    'y = si‸x',
    // A subscript.
    'y = a_si',
    'y = v_{ma',
    // Nothing starts that way.
    'y = qq',
    'y = xy',
    '',
  ])('%s offers nothing', (marked) => {
    expect(offered(marked)).toBeNull();
  });

  it('reads letters the way the document does', () => {
    // Sliders a and b: `ab` is a·b, not on the way to abs.
    expect(offered('y = ab', ctxOf(['a', 'b']))).toBeNull();
    expect(offered('y = ab', ctxOf(['a']))).toBe('s(');
    // A slider named like the start of a builtin is that slider.
    expect(offered('y = co', ctxOf(['co']))).toBeNull();
  });

  it("offers the document's own functions, first", () => {
    const ctx = ctxOf([], { area: 1, sinc: 1, f: 1 });
    expect(offered('y = ar', ctx)).toBe('ea(');
    expect(offered('y = sin', ctx)).toBeNull();
    expect(offered('y = sinc', ctx)).toBeNull();
    expect(offered('y = si', ctx)).toBe('nc(');
    const plan = renderPlan(layoutParse('y = ar', ctx));
    expect(completionAt(plan, caretAt('y = ar', 6, { names: ctx }), ctx)).toEqual({
      name: 'area',
      from: 4,
      text: 'ea(',
      builtin: false,
    });
  });

  it('taken by typing it, it leaves the caret in the parentheses', () => {
    const opts = { names: EMPTY_CONTEXT };
    for (const [from, expected] of [
      ['y = si', 'y = sin('],
      ['y = sq', 'y = sqrt()'],
      ['y = (si)', 'y = (sin()'],
    ] as const) {
      const at = from.endsWith(')') ? from.length - 1 : from.length;
      const caret = caretAt(from, at, opts);
      const plan = renderPlan(layoutParse(from, EMPTY_CONTEXT));
      const c = completionAt(plan, caret, EMPTY_CONTEXT);
      if (!c) throw new Error(`nothing offered for ${from}`);
      const r = runCommand(
        { text: from, anchor: caret, focus: caret },
        { type: 'type', text: c.text },
        opts,
      );
      expect(r?.state.text).toBe(expected);
      const f = r?.state.focus.offset ?? -1;
      expect(r?.state.text.slice(0, f).endsWith('(')).toBe(true);
    }
  });
});
