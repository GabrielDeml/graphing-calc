import { describe, expect, it } from 'vitest';
import { DocumentEngine } from '../engine/document';
import { EMPTY_STEADY, type Steady, type SteadyState, steady } from './steady';

/**
 * A document typed into row by row: each step sets the sources (ids r0, r1, …) and which row is
 * being edited, and returns the steady view of it.
 */
function session() {
  const engine = new DocumentEngine();
  let state: SteadyState = EMPTY_STEADY;
  return {
    engine,
    step(sources: string[], editing: string | null, generation?: number): Steady {
      const rows = sources.map((source, i) => ({ id: `r${i}`, source }));
      const a = engine.update(rows);
      const next = steady(state, rows, a.byId, editing, generation ?? engine.globalsGeneration);
      state = next.state;
      return next;
    },
  };
}

describe('steady', () => {
  it('holds the edited row while it is broken, without quieting its own error', () => {
    const s = session();
    const good = s.step(['y = x^2'], 'r0');
    expect(good.held.size).toBe(0);
    const broken = s.step(['y = x^'], 'r0');
    expect(broken.held.get('r0')?.plot?.kind).toBe('explicitY');
    expect(broken.quiet.size).toBe(0);
    // Still the last good result a keystroke later.
    expect(s.step(['y = x^('], 'r0').held.get('r0')).toBe(broken.held.get('r0'));
    expect(s.step(['y = x^3'], 'r0').held.size).toBe(0);
  });

  it('lets go once the row is left', () => {
    const s = session();
    s.step(['y = x^2'], 'r0');
    s.step(['y = x^'], 'r0');
    const left = s.step(['y = x^'], null);
    expect(left.held.size).toBe(0);
    // Coming back to a row that is still broken has nothing good to hold on to.
    expect(s.step(['y = x^'], 'r0').held.size).toBe(0);
  });

  it('holds and quiets the curves a slider being retyped breaks', () => {
    const s = session();
    s.step(['a = 1', 'y = a x', '(a, 1)', 'y = 2'], 'r0');
    const broken = s.step(['a = ', 'y = a x', '(a, 1)', 'y = 2'], 'r0');
    expect([...broken.quiet].sort()).toEqual(['r1', 'r2']);
    expect([...broken.held.keys()].sort()).toEqual(['r0', 'r1', 'r2']);
    // The slider row holds its slider.
    expect(broken.held.get('r0')?.slider?.value).toBe(1);
  });

  it('follows a chain of broken definitions back to the edited row', () => {
    const s = session();
    s.step(['a = 1', 'b = 2a', 'y = b x'], 'r0');
    const broken = s.step(['a = 1 +', 'b = 2a', 'y = b x'], 'r0');
    expect([...broken.quiet].sort()).toEqual(['r1', 'r2']);
    expect(broken.held.get('r2')?.plot).toBeDefined();
  });

  it('holds the uses of a function being edited', () => {
    const s = session();
    s.step(['f(x) = x^2', 'y = f(x - 1)'], 'r0');
    const broken = s.step(['f(x) = x^', 'y = f(x - 1)'], 'r0');
    expect([...broken.quiet]).toEqual(['r1']);
    expect(broken.held.get('r1')?.plot?.kind).toBe('explicitY');
  });

  it('holds the uses of a name while it is being renamed', () => {
    const s = session();
    s.step(['a = 1', 'y = a x'], 'r0');
    expect([...s.step(['ab = 1', 'y = a x'], 'r0').quiet]).toEqual(['r1']);
    expect([...s.step(['abc = 1', 'y = a x'], 'r0').quiet]).toEqual(['r1']);
    // Done renaming: the use of the old name is an error to see.
    expect(s.step(['abc = 1', 'y = a x'], null).quiet.size).toBe(0);
  });

  it('holds a curve whose t range uses a name being renamed', () => {
    const engine = new DocumentEngine();
    let state = EMPTY_STEADY;
    const step = (k: string, editing: string | null) => {
      const rows = [
        { id: 'r0', source: k },
        { id: 'r1', source: '(cos t, sin t)', domain: { min: '0', max: 'k' } },
      ];
      const next = steady(state, rows, engine.update(rows).byId, editing, 0);
      state = next.state;
      return next;
    };
    step('k = 3', 'r0');
    const renamed = step('kk = 3', 'r0');
    expect([...renamed.quiet]).toEqual(['r1']);
    expect(renamed.held.get('r1')?.plot?.kind).toBe('parametric');
  });

  it('holds the other definition while a duplicate is being typed', () => {
    const s = session();
    s.step(['a = 1', 'y = a x', ''], 'r2');
    const dup = s.step(['a = 1', 'y = a x', 'a = 2'], 'r2');
    expect([...dup.quiet].sort()).toEqual(['r0', 'r1']);
    expect(dup.held.get('r0')?.slider?.value).toBe(1);
  });

  it('leaves errors that come from elsewhere alone', () => {
    const s = session();
    s.step(['b = (', 'y = b x', 'a = 1', 'y = a'], 'r2');
    const broken = s.step(['b = (', 'y = b x', 'a = 1 +', 'y = a'], 'r2');
    expect(broken.quiet.has('r1')).toBe(false);
    expect(broken.held.has('r1')).toBe(false);
    expect(broken.quiet.has('r3')).toBe(true);
  });

  it('does not hold closures across a reallocation of the globals', () => {
    const s = session();
    s.step(['y = x^2'], 'r0', 0);
    const broken = s.step(['y = x^'], 'r0', 1);
    expect(broken.held.size).toBe(0);
  });

  it('does not hold an emptied row', () => {
    const s = session();
    s.step(['y = x^2'], 'r0');
    expect(s.step([''], 'r0').held.size).toBe(0);
  });

  it('forgets what the previous row defined when another one is edited', () => {
    const s = session();
    s.step(['a = 1', 'y = a x', 'c = 2'], 'r0');
    s.step(['a = 1', 'y = a x', 'c = 2'], 'r2');
    // Renaming c to a duplicate of nothing: `a` was the other row's name, not this one's.
    const other = s.step(['b = 1', 'y = a x', 'c = 2'], 'r2');
    expect(other.quiet.size).toBe(0);
  });
});
