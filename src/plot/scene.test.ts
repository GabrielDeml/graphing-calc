import { describe, expect, it } from 'vitest';
import type { PlotItem } from '../engine/types';
import { SceneCache } from './scene';
import type { Viewport } from './types';

const view: Viewport = { cx: 0, cy: 0, ppuX: 40, ppuY: 40, width: 400, height: 300 };

function counted(): { plot: PlotItem; calls: () => number } {
  let n = 0;
  const plot: PlotItem = {
    kind: 'points',
    points: [
      {
        x: () => {
          n++;
          return 1;
        },
        y: () => 2,
      },
    ],
  };
  return { plot, calls: () => n };
}

describe('SceneCache', () => {
  it('reuses geometry for the same view, quality and dependency values', () => {
    const cache = new SceneCache();
    const { plot, calls } = counted();
    const entry = { plot, deps: new Set(['a']) };
    const g = cache.geometry(entry, new Map([['a', 1]]), view, 'final');
    expect(cache.geometry(entry, new Map([['a', 1]]), view, 'final')).toBe(g);
    expect(calls()).toBe(1);
    cache.geometry(entry, new Map([['a', 2]]), view, 'final');
    expect(calls()).toBe(2);
    cache.geometry(entry, new Map([['a', 2]]), { ...view, cx: 1 }, 'final');
    expect(calls()).toBe(3);
  });

  it('answers an interactive request with final geometry for the same view and values', () => {
    const cache = new SceneCache();
    const { plot, calls } = counted();
    const entry = { plot, deps: new Set<string>() };
    const g = cache.geometry(entry, new Map(), view, 'final');
    // e.g. another row's slider is playing: this row keeps its full-quality geometry.
    expect(cache.geometry(entry, new Map(), view, 'interactive')).toBe(g);
    expect(calls()).toBe(1);
  });

  it('re-samples interactive geometry when final quality is asked for', () => {
    const cache = new SceneCache();
    const { plot, calls } = counted();
    const entry = { plot, deps: new Set<string>() };
    const g = cache.geometry(entry, new Map(), view, 'interactive');
    expect(cache.geometry(entry, new Map(), view, 'interactive')).toBe(g);
    expect(calls()).toBe(1);
    expect(cache.geometry(entry, new Map(), view, 'final')).not.toBe(g);
    expect(calls()).toBe(2);
  });
});
