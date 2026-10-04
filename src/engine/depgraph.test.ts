import { describe, expect, it } from 'vitest';
import {
  cyclePath,
  cyclicComponents,
  type DepGraph,
  formatCycle,
  stronglyConnected,
  topologicalOrder,
} from './depgraph';

function graph(edges: Record<string, string[]>): DepGraph {
  return new Map(Object.entries(edges));
}

function sortedComponents(components: string[][]): string[][] {
  return components.map((c) => [...c].sort()).sort((a, b) => a.join().localeCompare(b.join()));
}

describe('stronglyConnected', () => {
  it('finds singletons in an acyclic graph, dependencies first', () => {
    const g = graph({ c: ['b'], b: ['a'], a: [] });
    expect(stronglyConnected(g)).toEqual([['a'], ['b'], ['c']]);
  });

  it('groups cycles', () => {
    const g = graph({ a: ['b'], b: ['c'], c: ['a'], d: ['a'], e: [] });
    expect(sortedComponents(stronglyConnected(g))).toEqual([['a', 'b', 'c'], ['d'], ['e']]);
  });

  it('finds several independent cycles', () => {
    const g = graph({ a: ['b'], b: ['a'], c: ['d'], d: ['c'], e: ['a', 'c'] });
    expect(sortedComponents(stronglyConnected(g))).toEqual([['a', 'b'], ['c', 'd'], ['e']]);
  });

  it('ignores edges to unknown nodes', () => {
    const g = graph({ a: ['zzz', 'b'], b: [] });
    expect(stronglyConnected(g)).toEqual([['b'], ['a']]);
  });

  it('handles very long chains without recursion', () => {
    const edges: Record<string, string[]> = {};
    for (let i = 0; i < 20000; i++) edges[`n${i}`] = i > 0 ? [`n${i - 1}`] : [];
    const components = stronglyConnected(graph(edges));
    expect(components).toHaveLength(20000);
    expect(components[0]).toEqual(['n0']);
  });
});

describe('cyclicComponents', () => {
  it('reports multi-node cycles and self-loops only', () => {
    const g = graph({ a: ['b'], b: ['a'], c: ['c'], d: ['a'], e: [] });
    expect(sortedComponents(cyclicComponents(g))).toEqual([['a', 'b'], ['c']]);
  });

  it('is empty for a DAG', () => {
    expect(cyclicComponents(graph({ a: ['b', 'c'], b: ['c'], c: [] }))).toEqual([]);
  });
});

describe('cyclePath', () => {
  it('returns the shortest loop back to the start', () => {
    const g = graph({ a: ['b'], b: ['c', 'a'], c: ['a'] });
    const members = new Set(['a', 'b', 'c']);
    expect(cyclePath(g, 'a', members)).toEqual(['a', 'b', 'a']);
    expect(cyclePath(g, 'c', members)).toEqual(['c', 'a', 'b', 'c']);
  });

  it('handles self-loops', () => {
    expect(cyclePath(graph({ f: ['f'] }), 'f', new Set(['f']))).toEqual(['f', 'f']);
  });

  it('stays inside the given component', () => {
    const g = graph({ a: ['x', 'b'], x: ['a'], b: ['a'] });
    expect(cyclePath(g, 'a', new Set(['a', 'b']))).toEqual(['a', 'b', 'a']);
  });

  it('is empty when there is no cycle', () => {
    expect(cyclePath(graph({ a: ['b'], b: [] }), 'a', new Set(['a', 'b']))).toEqual([]);
  });

  it('formats as an arrow chain', () => {
    expect(formatCycle(['a', 'b', 'a'])).toBe('a → b → a');
  });
});

describe('topologicalOrder', () => {
  it('puts dependencies first', () => {
    const g = graph({ y: ['f', 'a'], f: ['b'], a: ['b'], b: [] });
    const { order, blocked } = topologicalOrder(g);
    expect(blocked).toEqual([]);
    expect(order).toHaveLength(4);
    const pos = (n: string) => order.indexOf(n);
    expect(pos('b')).toBeLessThan(pos('f'));
    expect(pos('b')).toBeLessThan(pos('a'));
    expect(pos('f')).toBeLessThan(pos('y'));
    expect(pos('a')).toBeLessThan(pos('y'));
  });

  it('keeps insertion order among independent nodes', () => {
    expect(topologicalOrder(graph({ c: [], a: [], b: [] })).order).toEqual(['c', 'a', 'b']);
  });

  it('counts duplicate edges once', () => {
    expect(topologicalOrder(graph({ a: ['b', 'b'], b: [] })).order).toEqual(['b', 'a']);
  });

  it('blocks cycles and everything downstream of them', () => {
    const g = graph({ a: ['b'], b: ['a'], c: ['a'], d: ['c'], e: [], s: ['s'] });
    const { order, blocked } = topologicalOrder(g);
    expect(order).toEqual(['e']);
    expect(blocked).toEqual(['a', 'b', 'c', 'd', 's']);
  });

  it('ignores edges to unknown nodes', () => {
    expect(topologicalOrder(graph({ a: ['nope'] }))).toEqual({ order: ['a'], blocked: [] });
  });
});
