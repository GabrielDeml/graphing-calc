// Dependency graph over string ids (definition names): strongly connected components (Tarjan),
// cycle paths for error messages, and a dependencies-first topological order (Kahn).
//
// `graph.get(n)` lists the ids n depends on. Edges to ids that aren't keys of the graph are
// ignored, so callers can pass raw reference lists. Everything is iterative, so long definition
// chains can't overflow the call stack.

export type DepGraph = ReadonlyMap<string, readonly string[]>;

/**
 * Strongly connected components. Each component is emitted after every component it depends
 * on, so the list is in dependencies-first order.
 */
export function stronglyConnected(graph: DepGraph): string[][] {
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const components: string[][] = [];
  let counter = 0;

  const visit = (node: string): void => {
    index.set(node, counter);
    low.set(node, counter);
    counter++;
    stack.push(node);
    onStack.add(node);
  };

  for (const root of graph.keys()) {
    if (index.has(root)) continue;
    visit(root);
    const work: { node: string; edge: number }[] = [{ node: root, edge: 0 }];
    while (work.length > 0) {
      const frame = work[work.length - 1];
      const edges = graph.get(frame.node) ?? [];
      if (frame.edge < edges.length) {
        const next = edges[frame.edge++];
        if (!graph.has(next)) continue;
        if (!index.has(next)) {
          visit(next);
          work.push({ node: next, edge: 0 });
        } else if (onStack.has(next)) {
          low.set(frame.node, Math.min(low.get(frame.node) ?? 0, index.get(next) ?? 0));
        }
        continue;
      }
      work.pop();
      const nodeLow = low.get(frame.node) ?? 0;
      const parent = work[work.length - 1];
      if (parent) low.set(parent.node, Math.min(low.get(parent.node) ?? 0, nodeLow));
      if (nodeLow === index.get(frame.node)) {
        const component: string[] = [];
        let member: string | undefined;
        do {
          member = stack.pop();
          if (member === undefined) break;
          onStack.delete(member);
          component.push(member);
        } while (member !== frame.node);
        components.push(component.reverse());
      }
    }
  }
  return components;
}

/** Components that contain a cycle: more than one node, or one node that depends on itself. */
export function cyclicComponents(graph: DepGraph): string[][] {
  return stronglyConnected(graph).filter((c) => {
    if (c.length > 1) return true;
    const only = c[0];
    return only !== undefined && (graph.get(only) ?? []).includes(only);
  });
}

/**
 * A shortest cycle from `start` back to itself using only nodes in `within` (normally start's
 * strongly connected component), e.g. ['a', 'b', 'a']. Empty when there is no such cycle.
 */
export function cyclePath(graph: DepGraph, start: string, within: ReadonlySet<string>): string[] {
  const previous = new Map<string, string>();
  const queue = [start];
  for (let head = 0; head < queue.length; head++) {
    const node = queue[head];
    for (const next of graph.get(node) ?? []) {
      if (!within.has(next)) continue;
      if (next === start) {
        const back: string[] = [];
        for (let n = node; n !== start; n = previous.get(n) ?? start) back.push(n);
        return [start, ...back.reverse(), start];
      }
      if (!previous.has(next)) {
        previous.set(next, node);
        queue.push(next);
      }
    }
  }
  return [];
}

/** "a → b → a". */
export function formatCycle(path: readonly string[]): string {
  return path.join(' → ');
}

/**
 * Kahn's algorithm, dependencies first: a node comes after every node it depends on. Nodes that
 * are on a cycle, or depend on one, can't be ordered and are returned in `blocked` (in graph
 * order). Ties keep graph insertion order, so the result is deterministic.
 */
export function topologicalOrder(graph: DepGraph): { order: string[]; blocked: string[] } {
  const pending = new Map<string, number>();
  const dependents = new Map<string, string[]>();
  for (const [node, deps] of graph) {
    const unique = new Set(deps.filter((d) => graph.has(d)));
    pending.set(node, unique.size);
    for (const d of unique) {
      const list = dependents.get(d);
      if (list) list.push(node);
      else dependents.set(d, [node]);
    }
  }
  const order: string[] = [];
  for (const [node, count] of pending) if (count === 0) order.push(node);
  for (let head = 0; head < order.length; head++) {
    for (const dependent of dependents.get(order[head]) ?? []) {
      const left = (pending.get(dependent) ?? 0) - 1;
      pending.set(dependent, left);
      if (left === 0) order.push(dependent);
    }
  }
  const blocked: string[] = [];
  for (const [node, count] of pending) if (count > 0) blocked.push(node);
  return { order, blocked };
}
