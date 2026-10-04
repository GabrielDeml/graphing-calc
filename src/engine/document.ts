// DocumentEngine: analyses all rows of the expression list together. Definitions on any row are
// visible to every other row (order doesn't matter), so the engine:
//
//  1. reads every row's definition head (`a = …`, `f(x) = …`) to build the names table;
//  2. parses and classifies each row against that table (cached by source + names signature);
//  3. if only slider literals changed since the last update, takes the fast path: writes the new
//     values into the shared globals array and recomputes derived variables, keeping every
//     compiled closure and PlotItem;
//  4. otherwise rebuilds: duplicate and cycle checks, dependency-error propagation, variable
//     evaluation in topological order, and compiling. Compiled rows are cached by a fingerprint
//     of everything their code depends on, so editing one row only recompiles that row and the
//     rows that use it.
//
// RowResults that didn't change keep their object identity across updates.

import type { NameNode, Node, Statement } from './ast';
import {
  type Classified,
  type ClassifyResult,
  classify,
  findNode,
  findTuple,
  forEachNode,
  freePlotVars,
} from './classify';
import {
  type CompileEnv,
  CompileError,
  compile0,
  compile1,
  compile2,
  compileExpr,
  type UserFunction,
} from './compile';
import { type DefinitionHead, detectDefinition } from './definition';
import { cyclePath, cyclicComponents, formatCycle, topologicalOrder } from './depgraph';
import { mathError } from './errors';
import { EMPTY_CONTEXT, isDefinableName, type NameContext } from './names';
import { type ParseResult, parse } from './parser';
import type {
  DocAnalysis,
  Fn0,
  MathError,
  PlotItem,
  QuickFix,
  RowInput,
  RowKind,
  RowResult,
  Span,
} from './types';

const DEFAULT_DOMAIN_MIN = '0';
const DEFAULT_DOMAIN_MAX = '2pi';
const EMPTY_DEPS: ReadonlySet<string> = new Set<string>();
const CONSTANT_CACHE_LIMIT = 256;
const INITIAL_GLOBALS = 16;

/** Per-source analysis, independent of other rows except through the names signature. */
interface RowAnalysis {
  /** source + '\0' + names signature. */
  readonly key: string;
  readonly head: DefinitionHead | null;
  readonly parsed: ParseResult;
  /** null when parsing failed. */
  readonly cls: ClassifyResult | null;
  /** User variables and functions the row's output uses (a definition's right side only). */
  readonly refs: readonly string[];
  /** 'unknown-name' error when the row uses names nothing defines. */
  readonly unknown: MathError | null;
}

/** A standalone constant expression (domain bound, slider field). */
type ConstantAnalysis =
  | { readonly ok: true; readonly node: Node; readonly refs: readonly string[] }
  | { readonly ok: false; readonly error: MathError };

/** Compiled code for one row, reused while its fingerprint is unchanged. */
interface CompiledRow {
  readonly fp: string;
  readonly plot?: PlotItem;
  readonly fn?: Fn0;
  readonly error?: MathError;
}

interface SliderSlot {
  readonly row: number;
  readonly name: string;
  readonly slot: number;
}

interface DerivedSlot extends SliderSlot {
  readonly fn: Fn0;
}

/** What the fast path needs from the last full build. */
interface Build {
  readonly ids: readonly string[];
  readonly keys: readonly string[];
  readonly results: readonly RowResult[];
  readonly values: ReadonlyMap<string, number>;
  readonly sliders: readonly SliderSlot[];
  /** Derived variables in dependency order. */
  readonly derived: readonly DerivedSlot[];
  readonly constants: readonly { readonly row: number; readonly fn: Fn0 }[];
}

type ConstantEntry = { readonly fn: Fn0 } | { readonly error: MathError };

function isDefinitionKind(kind: RowKind): kind is 'slider' | 'varDef' | 'funcDef' {
  return kind === 'slider' || kind === 'varDef' || kind === 'funcDef';
}

function statementNodes(s: Statement): readonly Node[] {
  if (s.type === 'exprs') return s.items;
  if (s.type === 'relation') return [s.left, s.right];
  return [];
}

/** User variable and function names used in `nodes`, deduped, in first-use order. */
function userNames(nodes: readonly Node[]): string[] {
  const names = new Set<string>();
  for (const node of nodes) {
    forEachNode(node, (n) => {
      if (n.type === 'name' && n.kind === 'userVar') names.add(n.name);
      else if (n.type === 'call' && n.calleeKind === 'userFn') names.add(n.callee);
    });
  }
  return [...names];
}

/** 'unknown-name' error for `nodes`, offering sliders for every unknown name, in source order. */
function unknownNames(nodes: readonly Node[]): MathError | null {
  const unknown: NameNode[] = [];
  for (const node of nodes) {
    forEachNode(node, (n) => {
      if (n.type === 'name' && n.kind === 'unknown') unknown.push(n);
    });
  }
  if (unknown.length === 0) return null;
  unknown.sort((a, b) => a.span.start - b.span.start);
  const first = unknown[0];
  // `log_2(x)` is a log base, not a variable: a slider named log_2 would be no fix at all.
  const names = [...new Set(unknown.map((n) => n.name))].filter(
    (name) => isDefinableName(name) && !name.startsWith('log_'),
  );
  const extra: { hint?: string; quickFix?: QuickFix } = {};
  if (names.length > 0) extra.quickFix = { kind: 'addSliders', names };
  if (first.name.startsWith('log_')) {
    const base = first.name.slice(4);
    extra.hint = `Logs with a base aren't supported yet; write log(x)/log(${base})`;
  }
  return mathError('unknown-name', `'${first.name}' is not defined`, first.span, extra);
}

function analyzeRow(
  key: string,
  source: string,
  head: DefinitionHead | null,
  ctx: NameContext,
): RowAnalysis {
  try {
    return analyzeRowUnsafe(key, source, head, ctx);
  } catch (e) {
    // Nothing here should throw; a bug must not take down the whole document.
    const parsed: ParseResult = { ok: false, error: internalError(e) };
    return { key, head, parsed, cls: null, refs: [], unknown: null };
  }
}

function analyzeRowUnsafe(
  key: string,
  source: string,
  head: DefinitionHead | null,
  ctx: NameContext,
): RowAnalysis {
  let rowCtx = ctx;
  if (head?.kind === 'fn') rowCtx = { vars: ctx.vars, fns: ctx.fns, params: head.params };
  else if (head?.kind === 'var') rowCtx = { vars: ctx.vars, fns: ctx.fns, self: head.name };
  const parsed = parse(source, rowCtx);
  if (!parsed.ok) return { key, head, parsed, cls: null, refs: [], unknown: null };
  const nodes = statementNodes(parsed.statement);
  const cls = classify(parsed.statement, head);
  let refNodes = nodes;
  if (cls.ok) {
    const row = cls.row;
    if (row.kind === 'varDef') refNodes = [row.expr];
    else if (row.kind === 'funcDef') refNodes = [row.body];
    else if (row.kind === 'slider') refNodes = [];
  }
  return { key, head, parsed, cls, refs: userNames(refNodes), unknown: unknownNames(nodes) };
}

function analyzeConstant(source: string, ctx: NameContext): ConstantAnalysis {
  const parsed = parse(source, ctx);
  if (!parsed.ok) return parsed;
  const s = parsed.statement;
  if (s.type === 'empty')
    return { ok: false, error: mathError('expected-expr', 'Expected a number') };
  if (s.type === 'relation') {
    return {
      ok: false,
      error: mathError('not-a-number', 'Expected a number, not an equation', s.opSpan),
    };
  }
  const [node] = s.items;
  if (s.items.length !== 1 || node === undefined || node.type === 'tuple') {
    return { ok: false, error: mathError('not-a-number', 'Expected a single number') };
  }
  const tuple = findTuple(node);
  if (tuple !== null) {
    return { ok: false, error: mathError('bad-tuple', "A point can't be used here", tuple.span) };
  }
  const [plotVar] = freePlotVars(node);
  if (plotVar !== undefined) {
    const [v, span] = plotVar;
    return { ok: false, error: mathError('plot-var-not-allowed', `Can't use ${v} here`, span) };
  }
  const unknown = unknownNames([node]);
  if (unknown) return { ok: false, error: unknown };
  return { ok: true, node, refs: userNames([node]) };
}

function dependencyError(name: string): MathError {
  return mathError('dependency-error', `Depends on '${name}', which has an error`);
}

function sameNumber(a: number | undefined, b: number | undefined): boolean {
  return a === b || (a !== undefined && b !== undefined && Number.isNaN(a) && Number.isNaN(b));
}

function sameSpan(a: Span | undefined, b: Span | undefined): boolean {
  return a === b || (a !== undefined && b !== undefined && a.start === b.start && a.end === b.end);
}

function sameList(a: readonly string[] | undefined, b: readonly string[] | undefined): boolean {
  if (a === b) return true;
  if (a === undefined || b === undefined || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function sameSet(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a === b) return true;
  if (a.size !== b.size) return false;
  for (const v of a) if (!b.has(v)) return false;
  return true;
}

function sameError(a: MathError | undefined, b: MathError | undefined): boolean {
  if (a === b) return true;
  if (a === undefined || b === undefined) return false;
  return (
    a.code === b.code &&
    a.message === b.message &&
    a.hint === b.hint &&
    sameSpan(a.span, b.span) &&
    a.quickFix?.kind === b.quickFix?.kind &&
    sameList(a.quickFix?.names, b.quickFix?.names)
  );
}

function sameResult(a: RowResult, b: RowResult): boolean {
  return (
    a.id === b.id &&
    a.status === b.status &&
    a.kind === b.kind &&
    a.plot === b.plot &&
    sameNumber(a.value, b.value) &&
    a.definedName === b.definedName &&
    sameList(a.params, b.params) &&
    sameError(a.error, b.error) &&
    a.slider?.name === b.slider?.name &&
    sameNumber(a.slider?.value, b.slider?.value) &&
    sameSpan(a.slider?.valueSpan, b.slider?.valueSpan) &&
    sameSet(a.deps, b.deps)
  );
}

/** Keeps the previous object when nothing observable changed, so UI memos stay quiet. */
function stable(prev: RowResult | undefined, next: RowResult): RowResult {
  if (prev === undefined) return next;
  if (sameResult(prev, next)) return prev;
  if (next.deps !== prev.deps && sameSet(next.deps, prev.deps)) next.deps = prev.deps;
  return next;
}

function sameStrings(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function sliderOf(a: RowAnalysis): Extract<Classified, { kind: 'slider' }> | null {
  return a.cls?.ok && a.cls.row.kind === 'slider' ? a.cls.row : null;
}

/**
 * What the row's structure is, for the fast-path check. A slider row's literal is not part of
 * it: changing only literals leaves every key unchanged.
 */
function structuralKey(a: RowAnalysis, row: RowInput): string {
  const cls = a.cls?.ok ? a.cls.row : null;
  if (cls?.kind === 'slider') return `\u0001${cls.name}\u0000${a.head?.nameSpan.start ?? 0}`;
  if (cls?.kind === 'parametric' || cls?.kind === 'polar') {
    return `${a.key}\u0000${row.domain?.min ?? ''}\u0000${row.domain?.max ?? ''}`;
  }
  return a.key;
}

export class DocumentEngine {
  private structureVersion = 0;
  private valuesVersion = 0;

  private heads = new Map<string, DefinitionHead | null>();
  private analyses = new Map<string, RowAnalysis>();
  private constants = new Map<string, ConstantAnalysis>();
  private compiled = new Map<string, CompiledRow>();
  private constantCache = new Map<string, ConstantEntry>();

  private ctx: NameContext = EMPTY_CONTEXT;
  private signature = '';

  /** Shared variable values. Slots stay with their name while it is defined. */
  private globals = new Float64Array(INITIAL_GLOBALS);
  /** Bumped when `globals` is reallocated, which invalidates every compiled closure. */
  private generation = 0;
  private slotOf = new Map<string, number>();
  private freeSlots: number[] = [];
  private slotCount = 0;

  private env: CompileEnv = {
    globals: this.globals,
    globalSlots: new Map(),
    functions: new Map(),
  };
  private last: Build | null = null;

  /** Analyse all rows. Cheap enough to call on every keystroke. */
  update(rows: readonly RowInput[]): DocAnalysis {
    const n = rows.length;

    // 1. Definition heads and the names table.
    const heads: (DefinitionHead | null)[] = new Array(n);
    const nextHeads = new Map<string, DefinitionHead | null>();
    const defRows = new Map<string, number[]>();
    for (let i = 0; i < n; i++) {
      const source = rows[i].source;
      let head = nextHeads.has(source) ? nextHeads.get(source) : this.heads.get(source);
      if (head === undefined) {
        head = detectDefinition(source);
      }
      nextHeads.set(source, head);
      heads[i] = head;
      if (head === null) continue;
      const list = defRows.get(head.name);
      if (list) list.push(i);
      else defRows.set(head.name, [i]);
    }
    this.heads = nextHeads;
    this.setContext(heads);

    // 2. Parse and classify (cached by source + signature).
    const analyses: RowAnalysis[] = new Array(n);
    const nextAnalyses = new Map<string, RowAnalysis>();
    const keys: string[] = new Array(n);
    const ids: string[] = new Array(n);
    for (let i = 0; i < n; i++) {
      const source = rows[i].source;
      const key = `${source}\u0000${this.signature}`;
      let a = nextAnalyses.get(key) ?? this.analyses.get(key);
      if (a === undefined) a = analyzeRow(key, source, heads[i], this.ctx);
      nextAnalyses.set(key, a);
      analyses[i] = a;
      keys[i] = structuralKey(a, rows[i]);
      ids[i] = rows[i].id;
    }
    this.analyses = nextAnalyses;

    const last = this.last;
    if (last && sameStrings(last.ids, ids) && sameStrings(last.keys, keys)) {
      return this.fastPath(analyses, last);
    }
    return this.rebuild(rows, analyses, defRows, ids, keys);
  }

  /**
   * The names table from the last update() and its signature. The context object is kept while
   * the signature is unchanged, so either one can key a cache of name-dependent work (the
   * editor groups letter runs into names the same way the parser does).
   */
  names(): { ctx: NameContext; signature: string } {
    return { ctx: this.ctx, signature: this.signature };
  }

  /**
   * Evaluate a constant expression (slider min/max/step fields, domain fields) against the
   * current variable values from the last update(). Plot variables are not allowed.
   */
  evalConstant(source: string): { ok: true; value: number } | { ok: false; error: MathError } {
    let entry = this.constantCache.get(source);
    if (entry === undefined) {
      entry = this.compileConstant(source);
      if (this.constantCache.size >= CONSTANT_CACHE_LIMIT) this.constantCache.clear();
      this.constantCache.set(source, entry);
    }
    if ('error' in entry) return { ok: false, error: entry.error };
    return { ok: true, value: entry.fn() };
  }

  private compileConstant(source: string): ConstantEntry {
    const a = analyzeConstant(source, this.ctx);
    if (!a.ok) return { error: a.error };
    for (const name of a.refs) {
      if (!this.env.globalSlots.has(name) && !this.env.functions.has(name)) {
        return { error: dependencyError(name) };
      }
    }
    try {
      return { fn: compile0(a.node, this.env) };
    } catch (e) {
      return { error: compileFailure(e) };
    }
  }

  /** Sets the NameContext and signature from the heads, keeping the old ones when unchanged. */
  private setContext(heads: readonly (DefinitionHead | null)[]): void {
    const vars = new Set<string>();
    const fns = new Map<string, number>();
    for (const h of heads) {
      if (h === null) continue;
      if (h.kind === 'var') vars.add(h.name);
      else if (!fns.has(h.name)) fns.set(h.name, h.params.length);
    }
    const parts = [...vars].map((v) => `${v}:var`);
    for (const [f, arity] of fns) parts.push(`${f}:fn:${arity}`);
    parts.sort();
    const signature = parts.join(',');
    if (signature === this.signature) return;
    this.signature = signature;
    this.ctx = { vars, fns };
  }

  private constantAnalysis(source: string, next: Map<string, ConstantAnalysis>): ConstantAnalysis {
    const key = `${source}\u0000${this.signature}`;
    let a = next.get(key) ?? this.constants.get(key);
    if (a === undefined) a = analyzeConstant(source, this.ctx);
    next.set(key, a);
    return a;
  }

  /** Assigns every defined variable a slot, keeping existing slots; may grow `globals`. */
  private allocateSlots(names: readonly string[]): void {
    const wanted = new Set(names);
    for (const [name, slot] of this.slotOf) {
      if (!wanted.has(name)) {
        this.slotOf.delete(name);
        this.freeSlots.push(slot);
      }
    }
    for (const name of names) {
      if (!this.slotOf.has(name)) this.slotOf.set(name, this.freeSlots.pop() ?? this.slotCount++);
    }
    if (this.slotCount > this.globals.length) {
      const grown = new Float64Array(Math.max(this.slotCount, this.globals.length * 2));
      grown.set(this.globals);
      this.globals = grown;
      this.generation++;
    }
  }

  private fastPath(analyses: readonly RowAnalysis[], last: Build): DocAnalysis {
    const g = this.globals;
    const results = last.results.slice();

    for (const s of last.sliders) {
      const slider = sliderOf(analyses[s.row]);
      if (slider === null) continue;
      g[s.slot] = slider.value;
      const prev = results[s.row];
      const valueSpan = slider.valueSpan;
      if (
        !sameNumber(prev.value, slider.value) ||
        !sameNumber(prev.slider?.value, slider.value) ||
        !sameSpan(prev.slider?.valueSpan, valueSpan)
      ) {
        results[s.row] = {
          ...prev,
          value: slider.value,
          slider: { name: slider.name, value: slider.value, valueSpan },
        };
      }
    }
    for (const d of last.derived) {
      const v = d.fn();
      g[d.slot] = v;
      const prev = results[d.row];
      if (!sameNumber(prev.value, v)) results[d.row] = { ...prev, value: v };
    }
    for (const c of last.constants) {
      const v = c.fn();
      const prev = results[c.row];
      if (!sameNumber(prev.value, v)) results[c.row] = { ...prev, value: v };
    }

    const values = new Map<string, number>();
    const changed = new Set<string>();
    for (const s of [...last.sliders, ...last.derived]) {
      const v = g[s.slot];
      values.set(s.name, v);
      if (!sameNumber(v, last.values.get(s.name))) changed.add(s.name);
    }
    if (changed.size > 0) this.valuesVersion++;
    this.last = { ...last, results, values };
    return this.analysis(results, values, changed);
  }

  private rebuild(
    rows: readonly RowInput[],
    analyses: readonly RowAnalysis[],
    defRows: ReadonlyMap<string, readonly number[]>,
    ids: readonly string[],
    keys: readonly string[],
  ): DocAnalysis {
    const n = rows.length;
    const errors: (MathError | null)[] = new Array(n).fill(null);

    for (let i = 0; i < n; i++) {
      const a = analyses[i];
      const head = a.head;
      if (head !== null && (defRows.get(head.name)?.length ?? 0) > 1) {
        errors[i] = mathError(
          'duplicate',
          `'${head.name}' is defined more than once`,
          head.nameSpan,
        );
      } else if (!a.parsed.ok) {
        errors[i] = a.parsed.error;
      } else if (a.unknown !== null) {
        errors[i] = a.unknown;
      } else if (a.cls !== null && !a.cls.ok) {
        errors[i] = a.cls.error;
      }
    }

    // Definition graph over names defined exactly once (duplicates are errors already).
    const nameRow = new Map<string, number>();
    const graph = new Map<string, readonly string[]>();
    const bad = new Set<string>();
    const varNames: string[] = [];
    for (const [name, list] of defRows) {
      const i = list[0];
      if (list.length > 1 || i === undefined) {
        bad.add(name);
        continue;
      }
      nameRow.set(name, i);
      graph.set(name, analyses[i].refs);
      if (analyses[i].head?.kind === 'var') varNames.push(name);
    }

    for (const component of cyclicComponents(graph)) {
      const members = new Set(component);
      for (const name of component) {
        const i = nameRow.get(name) ?? -1;
        if (i < 0 || errors[i] !== null) continue;
        const path = formatCycle(cyclePath(graph, name, members));
        errors[i] = mathError('cycle', `Circular definition: ${path}`, analyses[i].head?.nameSpan);
      }
    }

    const { order, blocked } = topologicalOrder(graph);
    const blockedSet = new Set(blocked);
    for (const name of blocked) {
      const i = nameRow.get(name) ?? -1;
      if (i >= 0 && errors[i] === null) {
        const via = analyses[i].refs.find((r) => bad.has(r) || blockedSet.has(r));
        errors[i] = dependencyError(via ?? name);
      }
      bad.add(name);
    }

    this.allocateSlots(varNames);
    const globals = this.globals;
    const globalSlots = new Map<string, number>();
    const functions = new Map<string, UserFunction>();
    const env: CompileEnv = { globals, globalSlots, functions };
    const nextCompiled = new Map<string, CompiledRow>();
    const nextConstants = new Map<string, ConstantAnalysis>();
    /** What compiled code that uses a definition depends on (slot, or inlined body). */
    const prints = new Map<string, string>();
    const varDeps = new Map<string, ReadonlySet<string>>();
    const sliders: SliderSlot[] = [];
    const derived: DerivedSlot[] = [];
    const constantRows: { row: number; fn: Fn0 }[] = [];
    const values = new Map<string, number>();
    const plots: (PlotItem | undefined)[] = new Array(n);

    const printOf = (refs: readonly string[]): string =>
      refs.map((r) => prints.get(r) ?? r).join(',');
    const depsOf = (refs: readonly string[], into: Set<string>): Set<string> => {
      for (const r of refs) for (const d of varDeps.get(r) ?? EMPTY_DEPS) into.add(d);
      return into;
    };
    const compiled = (i: number, fp: string, build: () => Omit<CompiledRow, 'fp'>) =>
      this.compiledRow(ids[i], `${this.generation}\u0000${fp}`, nextCompiled, build);

    // Definitions, dependencies first.
    for (const name of order) {
      const i = nameRow.get(name) ?? -1;
      if (i < 0) continue;
      const a = analyses[i];
      if (errors[i] === null) {
        const via = a.refs.find((r) => bad.has(r));
        if (via !== undefined) errors[i] = dependencyError(via);
      }
      const row = a.cls?.ok ? a.cls.row : null;
      if (errors[i] !== null || row === null || !isDefinitionKind(row.kind)) {
        bad.add(name);
        continue;
      }
      const fp = `${a.key}\u0000${printOf(a.refs)}`;
      if (row.kind === 'funcDef') {
        const c = compiled(i, fp, () => compileFunctionDef(row, env));
        if (c.error) {
          errors[i] = c.error;
          bad.add(name);
          continue;
        }
        plots[i] = c.plot;
        functions.set(name, { params: row.params, body: row.body });
        prints.set(name, `${name}{${rows[i].source}|${printOf(a.refs)}}`);
        varDeps.set(name, depsOf(a.refs, new Set()));
        continue;
      }

      const slot = this.slotOf.get(name) ?? -1;
      if (slot < 0) {
        bad.add(name);
        continue;
      }
      if (row.kind === 'slider') {
        globals[slot] = row.value;
        sliders.push({ row: i, name, slot });
      } else if (row.kind === 'varDef') {
        const expr = row.expr;
        const c = compiled(i, fp, () => ({ fn: compile0(expr, env) }));
        if (c.error || c.fn === undefined) {
          errors[i] = c.error ?? internalError(null);
          bad.add(name);
          continue;
        }
        globals[slot] = c.fn();
        derived.push({ row: i, name, slot, fn: c.fn });
      }
      globalSlots.set(name, slot);
      values.set(name, globals[slot]);
      prints.set(name, `${name}@${slot}`);
      varDeps.set(name, depsOf(a.refs, new Set([name])));
    }

    // Everything else: plots and constants.
    const rowValues: (number | undefined)[] = new Array(n);
    const rowDeps: ReadonlySet<string>[] = new Array(n).fill(EMPTY_DEPS);
    for (let i = 0; i < n; i++) {
      const a = analyses[i];
      const row = a.cls?.ok ? a.cls.row : null;
      if (row === null) continue;
      if (isDefinitionKind(row.kind)) {
        const name = a.head?.name;
        if (errors[i] === null && name !== undefined) {
          rowDeps[i] = varDeps.get(name) ?? EMPTY_DEPS;
          if (row.kind !== 'funcDef') rowValues[i] = values.get(name);
        }
        continue;
      }
      if (row.kind === 'empty' || errors[i] !== null) continue;
      const via = a.refs.find((r) => bad.has(r));
      if (via !== undefined) {
        errors[i] = dependencyError(via);
        continue;
      }

      let fp = `${keys[i]}\u0000${printOf(a.refs)}`;
      let refs = a.refs;
      let domain: { min: Node; max: Node } | null = null;
      if (row.kind === 'parametric' || row.kind === 'polar') {
        const d = this.domainOf(rows[i], row.kind === 'polar' ? 'θ' : 't', bad, nextConstants);
        if ('error' in d) {
          errors[i] = d.error;
          continue;
        }
        domain = d;
        refs = [...refs, ...d.refs];
        fp += `\u0000${printOf(d.refs)}`;
      }
      const c = compiled(i, fp, () => compileRow(row, domain, env));
      if (c.error) {
        errors[i] = c.error;
        continue;
      }
      rowDeps[i] = refs.length === 0 ? EMPTY_DEPS : depsOf(refs, new Set());
      if (row.kind === 'constant' && c.fn) {
        rowValues[i] = c.fn();
        constantRows.push({ row: i, fn: c.fn });
      } else {
        plots[i] = c.plot;
      }
    }

    // Results, reusing unchanged objects.
    const prevById = new Map<string, RowResult>();
    if (this.last) {
      const prevIds = this.last.ids;
      this.last.results.forEach((r, k) => {
        prevById.set(prevIds[k], r);
      });
    }
    const results: RowResult[] = new Array(n);
    for (let i = 0; i < n; i++) {
      const fresh = makeResult(ids[i], analyses[i], errors[i], plots[i], rowValues[i], rowDeps[i]);
      results[i] = stable(prevById.get(ids[i]), fresh);
    }

    this.compiled = nextCompiled;
    this.constants = nextConstants;
    this.constantCache.clear();
    this.env = env;
    this.structureVersion++;
    this.valuesVersion++;
    this.last = {
      ids,
      keys,
      results,
      values,
      sliders,
      derived,
      constants: constantRows,
    };
    return this.analysis(results, values, null);
  }

  private domainOf(
    row: RowInput,
    variable: 't' | 'θ',
    bad: ReadonlySet<string>,
    next: Map<string, ConstantAnalysis>,
  ): { min: Node; max: Node; refs: readonly string[] } | { error: MathError } {
    const minSource = row.domain?.min.trim() ? row.domain.min : DEFAULT_DOMAIN_MIN;
    const maxSource = row.domain?.max.trim() ? row.domain.max : DEFAULT_DOMAIN_MAX;
    const min = this.constantAnalysis(minSource, next);
    if (!min.ok) return { error: domainError(variable, min.error) };
    const max = this.constantAnalysis(maxSource, next);
    if (!max.ok) return { error: domainError(variable, max.error) };
    const refs = [...min.refs, ...max.refs];
    const via = refs.find((r) => bad.has(r));
    if (via !== undefined) return { error: domainError(variable, dependencyError(via)) };
    return { min: min.node, max: max.node, refs };
  }

  private compiledRow(
    id: string,
    fp: string,
    next: Map<string, CompiledRow>,
    build: () => Omit<CompiledRow, 'fp'>,
  ): CompiledRow {
    const prev = this.compiled.get(id) ?? next.get(id);
    let c: CompiledRow;
    if (prev !== undefined && prev.fp === fp) {
      c = prev;
    } else {
      try {
        c = { fp, ...build() };
        probe(c);
      } catch (e) {
        c = { fp, error: compileFailure(e) };
      }
    }
    next.set(id, c);
    return c;
  }

  private analysis(
    rows: readonly RowResult[],
    values: ReadonlyMap<string, number>,
    changedGlobals: ReadonlySet<string> | null,
  ): DocAnalysis {
    const byId = new Map<string, RowResult>();
    for (const r of rows) byId.set(r.id, r);
    return {
      structureVersion: this.structureVersion,
      valuesVersion: this.valuesVersion,
      rows,
      byId,
      values,
      changedGlobals,
    };
  }
}

function internalError(e: unknown): MathError {
  const detail = e instanceof Error ? e.message : undefined;
  return mathError(
    'internal',
    'Something went wrong evaluating this expression',
    undefined,
    detail === undefined ? undefined : { hint: detail },
  );
}

function compileFailure(e: unknown): MathError {
  if (e instanceof CompileError) return e.error;
  // Call-stack overflow while compiling or evaluating a very deep expression.
  if (e instanceof RangeError) return mathError('too-complex', 'Expression too complex');
  return internalError(e);
}

/**
 * Calls every closure once, so code too deep to evaluate fails here, as a row error, instead of
 * later inside the renderer.
 */
function probe(c: Omit<CompiledRow, 'fp'>): void {
  c.fn?.();
  const p = c.plot;
  switch (p?.kind) {
    case 'explicitY':
    case 'explicitX':
      p.f(0);
      break;
    case 'parametric':
      p.fx(p.tMin());
      p.fy(p.tMax());
      break;
    case 'polar':
      p.r(p.thetaMin() + p.thetaMax());
      break;
    case 'points':
      for (const q of p.points) {
        q.x();
        q.y();
      }
      break;
    case 'implicit':
      p.F(0, 0);
      break;
    default:
      break;
  }
}

function domainError(variable: string, inner: MathError): MathError {
  return mathError(
    'bad-domain',
    `${variable} range: ${inner.message}`,
    undefined,
    inner.quickFix ? { quickFix: inner.quickFix } : undefined,
  );
}

/**
 * A one-parameter function definition also draws its graph, as in Desmos: `f(x) = x^2` and
 * `g(u) = sin u` as y = …, `h(y) = y^2` as x = …. Parameters named t, θ or r are meant for
 * parametric and polar rows, so those (and functions of several parameters) only get checked.
 */
function compileFunctionDef(
  row: Extract<Classified, { kind: 'funcDef' }>,
  env: CompileEnv,
): Omit<CompiledRow, 'fp'> {
  const [param] = row.params;
  if (
    row.params.length !== 1 ||
    param === undefined ||
    param === 't' ||
    param === 'θ' ||
    param === 'r'
  ) {
    compileExpr(row.body, row.params, env);
    return {};
  }
  const f = compile1(row.body, param, env);
  const isConstant =
    findNode(row.body, (n) => n.type === 'name' && n.kind === 'param' && n.name === param) === null;
  return { plot: { kind: param === 'y' ? 'explicitX' : 'explicitY', f, isConstant } };
}

function compileRow(
  row: Classified,
  domain: { min: Node; max: Node } | null,
  env: CompileEnv,
): Omit<CompiledRow, 'fp'> {
  const bounds = (): { min: Fn0; max: Fn0 } => {
    if (domain === null) throw new CompileError(internalError(null));
    return { min: compile0(domain.min, env), max: compile0(domain.max, env) };
  };
  switch (row.kind) {
    case 'constant':
      return { fn: compile0(row.expr, env) };
    case 'explicitY':
      return {
        plot: { kind: 'explicitY', f: compile1(row.expr, 'x', env), isConstant: row.isConstant },
      };
    case 'explicitX':
      return {
        plot: { kind: 'explicitX', f: compile1(row.expr, 'y', env), isConstant: row.isConstant },
      };
    case 'ineqY':
      return {
        plot: {
          kind: 'explicitY',
          f: compile1(row.expr, 'x', env),
          isConstant: row.isConstant,
          ineq: row.ineq,
        },
      };
    case 'ineqX':
      return {
        plot: {
          kind: 'explicitX',
          f: compile1(row.expr, 'y', env),
          isConstant: row.isConstant,
          ineq: row.ineq,
        },
      };
    case 'polar': {
      const r = compile1(row.expr, 'θ', env);
      const b = bounds();
      return { plot: { kind: 'polar', r, thetaMin: b.min, thetaMax: b.max } };
    }
    case 'parametric': {
      const fx = compile1(row.x, 't', env);
      const fy = compile1(row.y, 't', env);
      const b = bounds();
      return { plot: { kind: 'parametric', fx, fy, tMin: b.min, tMax: b.max } };
    }
    case 'point':
    case 'points':
      return {
        plot: {
          kind: 'points',
          points: row.points.map((p) => ({ x: compile0(p.x, env), y: compile0(p.y, env) })),
        },
      };
    case 'implicit':
      return { plot: { kind: 'implicit', F: compile2(row.expr, 'x', 'y', env) } };
    case 'ineqImplicit':
      return {
        plot: {
          kind: 'implicit',
          F: compile2(row.expr, 'x', 'y', env),
          ineq: { strict: row.strict },
        },
      };
    default:
      throw new CompileError(internalError(null));
  }
}

function makeResult(
  id: string,
  a: RowAnalysis,
  error: MathError | null,
  plot: PlotItem | undefined,
  value: number | undefined,
  deps: ReadonlySet<string>,
): RowResult {
  const row = a.cls?.ok ? a.cls.row : null;
  const result: RowResult = { id, status: 'ok', deps };
  if (row !== null) {
    result.kind = row.kind;
    if (row.kind === 'slider' || row.kind === 'varDef' || row.kind === 'funcDef') {
      result.definedName = row.name;
    }
    if (row.kind === 'funcDef') result.params = row.params;
  }
  if (error !== null) {
    result.status = 'error';
    result.error = error;
    result.deps = EMPTY_DEPS;
    return result;
  }
  if (row === null || row.kind === 'empty') {
    result.status = 'empty';
    result.kind = 'empty';
    return result;
  }
  if (plot !== undefined) result.plot = plot;
  if (value !== undefined) result.value = value;
  if (row.kind === 'slider') {
    result.slider = { name: row.name, value: row.value, valueSpan: row.valueSpan };
  }
  return result;
}
