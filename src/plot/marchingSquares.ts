// Implicit curves F(x, y) = 0 and implicit inequality regions (F > 0 / F >= 0) by marching
// squares.
//
// 1. A world-aligned coarse grid (8px cells, 12px while interacting; grid lines at integer
//    multiples of the cell size, so contours do not swim while panning) covering the view plus a
//    one-cell margin is evaluated once.
// 2. Coarse cells whose finite corners change sign (curve), or whose corners are not all on the
//    same side (region, NaN counting as outside), are candidates. The set is dilated by one cell
//    to catch thin features that cross between coarse vertices.
// 3. Candidates are refined on a 4×4 fine subgrid (2×2 when the budget is short) addressed by
//    global fine indices. Values and edge crossings are cached in a band covering the fine rows
//    of the current coarse row, so neighbouring cells share vertex values and crossing points
//    exactly.
// 4. Each fine cell uses the 16-case table; saddles (cases 5 and 10) are resolved with the value
//    at the cell centre.
// 5. Root check: every sign change on an edge is searched for a root (parabola steps through the
//    bracket ends and the end last replaced, a one-sided secant opposite a flat end, bisection
//    when an end stalls). It is a root once a sample gets well below the bracket's end values;
//    poles (tan x - y, 1/(x - y)) and jumps (floor(x) - y, floor(x) + x - y) never get there and
//    their crossings and segments are dropped. Where F first moves away from zero along the edge
//    (beside a saddle, at a kink, near a tangency) the search still converges, so X-crossings,
//    corners and tangent points stay connected.
// 6. A crossing is one point per grid edge, shared by the two cells on either side, so segments
//    chain into long polylines through a per-point adjacency list.
// 7. Region: runs of fully-inside non-candidate coarse cells become one rectangle per run; in
//    candidate cells each fine cell contributes the inside polygon of its case (corners plus
//    crossings). At a pole or jump the boundary is bisected inside the root search's bracket.
//    Polygons never overlap and are all counter-clockwise.
//
// Known limitations: zeros without a sign change, such as (x^2 + y^2 - 1)^2 = 0, are not drawn,
// and features smaller than a coarse cell away from any sign change are missed. Interval
// arithmetic would fix both later. Where a curve ends at a jump, a stub of at most a third of a
// fine cell (more if F is much steeper across the edge than along the curve) may cross the jump.
//
// Budget: the coarse grid is coarsened if it alone would use more than a third of maxEvals.
// Refinement then uses the finest fine-cell size that fits (2px, else 4px; estimated up front,
// and abandoned early once its cost so far projects past the budget), and the coarse grid is
// contoured directly only if neither does.

import type { Fn2 } from '../engine/types';
import type { Polygons, Polyline, Quality, Viewport } from './types';

export interface ImplicitOptions {
  quality?: Quality;
  /** Trace the curve F = 0 (default true). */
  curve?: boolean;
  /** Also build the region where F > 0 (strict) or F >= 0 (default false). */
  region?: boolean;
  /** The region excludes F = 0 (default false). */
  strict?: boolean;
  /** Evaluation budget for the whole call (default 400000, or 120000 at interactive quality). */
  maxEvals?: number;
}

export interface ImplicitResult {
  curve: Polyline;
  region: Polygons | null;
}

const FINAL_CELL_PX = 8;
const INTERACTIVE_CELL_PX = 12;
/** Fine cells per coarse cell side. A power of two keeps fine and coarse coordinates identical. */
const SUB = 4;
const DEFAULT_MAX_EVALS = 400_000;
/** While panning every frame is a cache miss, so heavy rows get a smaller budget. */
const DEFAULT_MAX_EVALS_INTERACTIVE = 120_000;
/** Root-search samples per edge before a sign change counts as a pole or jump. */
const ROOT_SAMPLES = 10;
/** Samples after which a search that never got closer to zero stops as a pole or flat step. */
const POLE_SAMPLES = 3;
/** A sample this far below the bracket reference confirms a root (see rootT). */
const ROOT_ACCEPT = 0.25;
/** An end value this small relative to the other end is zero up to rounding. */
const ROOT_NOISE = 2 ** -30;
/** Bisection steps placing a region boundary at a domain edge, pole or jump. */
const EDGE_BISECT_STEPS = 5;
/**
 * Fine-cell sizes tried in order (in fine-index units; SUB is the coarse grid itself), with the
 * estimated evaluations to refine one candidate coarse cell at that size (shared vertices,
 * crossings and saddle centres).
 */
const LEVELS = [1, 2] as const;
const EVALS_PER_CANDIDATE = [0, 17, 4] as const;
/** Root-search evaluations per coarse crossing reserved for the coarse fallback. */
const COARSE_ROOT_EVALS = 3;
/** Fraction of the candidates a refinement run finishes before projecting its total cost. */
const PROJECT_AFTER = 1 / 8;
/**
 * Most evaluations one fine row of a coarse cell can use while refining: 10 vertices, 4 centres
 * and 13 edges, each with a full root search plus bisection.
 */
const CELL_EVALS_MAX = 10 + 4 + 13 * (ROOT_SAMPLES + EDGE_BISECT_STEPS);
/** Beyond this, grid indices times the cell size are no longer exact; use an unaligned grid. */
const MAX_GRID_INDEX = 2 ** 50;

// Curve segments of each marching-squares case as pairs of cell edges (0 bottom, 1 right, 2 top,
// 3 left; -1 none). Corner bits: 1 bottom-left, 2 bottom-right, 4 top-right, 8 top-left.
// The saddles 5 and 10 are resolved separately.
// biome-ignore format: table
const SEGMENTS = new Int8Array([
  -1, -1,  3, 0,  0, 1,  3, 1,
   1, 2, -1, -1,  0, 2,  2, 3,
   2, 3,  0, 2, -1, -1,  1, 2,
   1, 3,  0, 1,  3, 0, -1, -1,
]);

const EMPTY = new Float64Array(0);

/**
 * Contour F(x, y) = 0 over the viewport; optionally also the region where F > 0 (strict) or
 * F >= 0. Returns the curve as polylines (NaN-pair separated) and the region as non-overlapping
 * counter-clockwise polygons, or null when no region was requested.
 */
export function contourImplicit(
  F: Fn2,
  view: Viewport,
  opts: ImplicitOptions = {},
): ImplicitResult {
  const wantCurve = opts.curve ?? true;
  const wantRegion = opts.region ?? false;
  if ((!wantCurve && !wantRegion) || !usableView(view)) {
    return { curve: EMPTY.slice(), region: wantRegion ? EMPTY.slice() : null };
  }
  return new Contourer(F, view, opts, wantCurve, wantRegion).solve();
}

function usableView(v: Viewport): boolean {
  return (
    v.width > 0 &&
    v.height > 0 &&
    v.ppuX > 0 &&
    v.ppuY > 0 &&
    Number.isFinite(v.width + v.height + v.ppuX + v.ppuY + v.cx + v.cy)
  );
}

/** Growable interleaved (x, y) output with NaN-pair separators between pieces. */
class Buf {
  private data: Float64Array;
  private n = 0;
  private pieceStart = 0;
  private first = 0;

  constructor(capacityFloats: number) {
    this.data = new Float64Array(Math.max(16, capacityFloats));
  }

  begin(): void {
    this.pieceStart = this.n;
    if (this.n > 0) this.push(Number.NaN, Number.NaN);
    this.first = this.n;
  }

  /** Appends a point, skipping an exact repeat of the previous point of the same piece. */
  point(x: number, y: number): void {
    const n = this.n;
    if (n > this.first && this.data[n - 2] === x && this.data[n - 1] === y) return;
    this.push(x, y);
  }

  /** Closes the piece, dropping it if it has fewer than minPoints points. */
  end(minPoints: number): void {
    if (this.n - this.first < 2 * minPoints) this.n = this.pieceStart;
  }

  finish(): Float64Array {
    return this.data.slice(0, this.n);
  }

  private push(x: number, y: number): void {
    if (this.n + 2 > this.data.length) {
      const next = new Float64Array(this.data.length * 2);
      next.set(this.data);
      this.data = next;
    }
    this.data[this.n] = x;
    this.data[this.n + 1] = y;
    this.n += 2;
  }
}

class Contourer {
  evals = 0;

  private readonly strict: boolean;
  private readonly maxEvals: number;
  /** Coarse cells per row / column. */
  private readonly nx: number;
  private readonly ny: number;
  /** Fine vertices per row (SUB * nx + 1). */
  private readonly fw: number;
  /** World coordinates of fine grid columns / rows. Coarse vertex i sits at fine index SUB*i. */
  private readonly fx: Float64Array;
  private readonly fy: Float64Array;
  /** Coarse vertex values, row-major, (nx + 1) per row. */
  private readonly cv: Float64Array;
  /** Coarse vertex flags: bit 0 inside, bit 1 finite. */
  private readonly cls: Uint8Array;
  /** Dilated candidate coarse cells, row-major, nx per row; and how many each row has. */
  private readonly cand: Uint8Array;
  private readonly rowCand: Int32Array;

  /** Evaluation count at which refinement gives up (checked per fine row of a coarse cell). */
  private cap = Number.POSITIVE_INFINITY;
  /** Sign bracket (edge parameters) of the last crossing rootT rejected. */
  private bracketLo = 0;
  private bracketHi = 1;
  /** Fine cell size in fine-index units: 1 when refining, SUB when contouring the coarse grid. */
  private k = 1;
  /** First fine row of the current coarse row; the band holds fine rows rowBase..rowBase+SUB. */
  private rowBase = 0;
  private readonly bandVal: Float64Array;
  private readonly bandHas: Uint8Array;
  /** Point ids of crossings on horizontal edges (band rows 0..SUB) and vertical edges. */
  private readonly hEdge: Int32Array;
  private readonly vEdge: Int32Array;

  /** Crossing points: coordinates, up to two curve neighbours, curve validity. */
  private pts = new Float64Array(2048);
  private nbr = new Int32Array(2048).fill(-1);
  private ok = new Uint8Array(1024);
  private np = 0;

  private region: Buf | null = null;
  /** Current run of fully-inside fine cells in one fine row: row, first and end column. */
  private runR = 0;
  private runC0 = -1;
  private runC1 = 0;
  private readonly pe = new Int32Array(4);

  constructor(
    private readonly F: Fn2,
    view: Viewport,
    opts: ImplicitOptions,
    private readonly wantCurve: boolean,
    private readonly wantRegion: boolean,
  ) {
    this.strict = opts.strict ?? false;
    const interactive = opts.quality === 'interactive';
    const maxEvals = opts.maxEvals;
    this.maxEvals =
      maxEvals !== undefined && maxEvals >= 1
        ? maxEvals
        : interactive
          ? DEFAULT_MAX_EVALS_INTERACTIVE
          : DEFAULT_MAX_EVALS;

    let cellPx = interactive ? INTERACTIVE_CELL_PX : FINAL_CELL_PX;
    const maxDim = Math.max(view.width, view.height);
    let nx = 0;
    let ny = 0;
    for (;;) {
      nx = Math.ceil(view.width / cellPx) + 3;
      ny = Math.ceil(view.height / cellPx) + 3;
      if ((nx + 1) * (ny + 1) * 3 <= this.maxEvals || cellPx >= maxDim) break;
      cellPx *= 2;
    }
    this.nx = nx;
    this.ny = ny;

    const cw = cellPx / view.ppuX;
    const ch = cellPx / view.ppuY;
    const xmin = view.cx - view.width / 2 / view.ppuX;
    const ymin = view.cy - view.height / 2 / view.ppuY;
    this.fw = SUB * nx + 1;
    this.fx = gridCoords(xmin, cw, this.fw);
    this.fy = gridCoords(ymin, ch, SUB * ny + 1);

    const nv = (nx + 1) * (ny + 1);
    this.cv = new Float64Array(nv);
    this.cls = new Uint8Array(nv);
    this.cand = new Uint8Array(nx * ny);
    this.rowCand = new Int32Array(ny);

    this.bandVal = new Float64Array((SUB + 1) * this.fw);
    this.bandHas = new Uint8Array((SUB + 1) * this.fw);
    this.hEdge = new Int32Array((SUB + 1) * this.fw);
    this.vEdge = new Int32Array(SUB * this.fw);
  }

  solve(): ImplicitResult {
    this.evalCoarse();
    const candidates = this.findCandidates();
    const reserve = COARSE_ROOT_EVALS * this.countCoarseCrossings();
    this.cap = this.maxEvals - reserve - CELL_EVALS_MAX;
    // Finest level that fits; one that overruns its estimate gives way to the next.
    let done = false;
    for (const k of LEVELS) {
      if (this.evals + candidates * EVALS_PER_CANDIDATE[k] > this.cap) continue;
      done = this.run(k, candidates);
      if (done) break;
    }
    if (!done) {
      this.cap = Number.POSITIVE_INFINITY;
      this.run(SUB, candidates);
    }
    return {
      curve: this.wantCurve ? this.chain() : EMPTY.slice(),
      region: this.region ? this.region.finish() : null,
    };
  }

  private inside(v: number): boolean {
    return v > 0 || (v === 0 && !this.strict);
  }

  private evalCoarse(): void {
    const { F, fx, fy, cv, cls, nx, ny } = this;
    let o = 0;
    for (let j = 0; j <= ny; j++) {
      const y = fy[j * SUB];
      for (let i = 0; i <= nx; i++, o++) {
        const v = F(fx[i * SUB], y);
        cv[o] = v;
        cls[o] = (this.inside(v) ? 1 : 0) | (Number.isFinite(v) ? 2 : 0);
      }
    }
    this.evals += o;
  }

  /** Marks dilated candidate cells and returns how many there are. */
  private findCandidates(): number {
    const { cls, cand, rowCand, nx, ny } = this;
    const w = nx + 1;
    const raw = new Uint8Array(nx * ny);
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const o = j * w + i;
        const a = cls[o];
        const b = cls[o + 1];
        const c = cls[o + w + 1];
        const d = cls[o + w];
        // Curve: both signs among the finite corners (bits 0b11 = finite inside, 0b10 = finite
        // outside). Region: both inside and outside corners, NaN counting as outside.
        const finIn = a === 3 || b === 3 || c === 3 || d === 3;
        const finOut = a === 2 || b === 2 || c === 2 || d === 2;
        const anyIn = (a | b | c | d) & 1;
        const allIn = a & b & c & d & 1;
        if ((this.wantCurve && finIn && finOut) || (this.wantRegion && anyIn !== allIn)) {
          raw[j * nx + i] = 1;
        }
      }
    }
    let count = 0;
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        if (raw[j * nx + i] === 0) continue;
        for (let dj = j > 0 ? -1 : 0; dj <= 1 && j + dj < ny; dj++) {
          for (let di = i > 0 ? -1 : 0; di <= 1 && i + di < nx; di++) {
            const o = (j + dj) * nx + i + di;
            if (cand[o] === 0) {
              cand[o] = 1;
              rowCand[j + dj]++;
              count++;
            }
          }
        }
      }
    }
    return count;
  }

  /** Coarse edges with a finite sign change: the root checks contouring the coarse grid needs. */
  private countCoarseCrossings(): number {
    const { cls, nx, ny } = this;
    const w = nx + 1;
    let n = 0;
    for (let j = 0; j <= ny; j++) {
      for (let i = 0; i <= nx; i++) {
        const a = cls[j * w + i];
        if ((a & 2) === 0) continue;
        if (i < nx && (cls[j * w + i + 1] ^ a) === 1) n++;
        if (j < ny && (cls[(j + 1) * w + i] ^ a) === 1) n++;
      }
    }
    return n;
  }

  /**
   * Contours every candidate cell with fine cells of k fine-index units. False if over budget,
   * which is decided as soon as the cost so far projects past the cap, so that an estimate that
   * was too low wastes little of what the coarser levels need.
   */
  private run(k: number, candidates: number): boolean {
    this.k = k;
    this.np = 0;
    this.nbr.fill(-1);
    this.region = this.wantRegion ? new Buf(4096) : null;
    this.runC0 = -1;
    this.bandHas.fill(0);
    this.hEdge.fill(-1);
    this.vEdge.fill(-1);
    const { nx, ny, cand, rowCand } = this;
    let bandUsed = false;
    let prevCand = false;
    const e0 = this.evals;
    let finished = 0;
    for (let j = 0; j < ny; j++) {
      this.rowBase = j * SUB;
      if (bandUsed) {
        this.shiftBand();
        // Only the shared fine row moved down; it holds data only if the previous row was used.
        bandUsed = prevCand;
      }
      if (this.region) this.coarseRuns(j);
      prevCand = rowCand[j] > 0;
      if (!prevCand) continue;
      if (
        finished >= candidates * PROJECT_AFTER &&
        e0 + ((this.evals - e0) * candidates) / finished > this.cap
      ) {
        return false;
      }
      finished += rowCand[j];
      bandUsed = true;
      for (let sr = 0; sr < SUB; sr += k) {
        const r = this.rowBase + sr;
        for (let i = 0; i < nx; i++) {
          if (cand[j * nx + i] === 0) {
            this.flushRun();
            continue;
          }
          if (this.evals > this.cap) return false;
          const c0 = i * SUB;
          for (let sc = 0; sc < SUB; sc += k) this.cell(r, c0 + sc);
        }
        this.flushRun();
      }
    }
    return true;
  }

  /** Moves the band down one coarse row: its last fine row becomes the first. */
  private shiftBand(): void {
    const fw = this.fw;
    const last = SUB * fw;
    this.bandVal.copyWithin(0, last, last + fw);
    this.bandHas.copyWithin(0, last, last + fw);
    this.bandHas.fill(0, fw);
    this.hEdge.copyWithin(0, last, last + fw);
    this.hEdge.fill(-1, fw);
    this.vEdge.fill(-1);
  }

  /** One rectangle per run of fully-inside, non-candidate coarse cells in coarse row j. */
  private coarseRuns(j: number): void {
    const { cls, cand, nx, fx, fy } = this;
    const w = nx + 1;
    let start = -1;
    for (let i = 0; i <= nx; i++) {
      const o = j * w + i;
      const full =
        i < nx &&
        cand[j * nx + i] === 0 &&
        (cls[o] & cls[o + 1] & cls[o + w] & cls[o + w + 1] & 1) === 1;
      if (full) {
        if (start < 0) start = i;
      } else if (start >= 0) {
        this.rect(fx[start * SUB], fy[j * SUB], fx[i * SUB], fy[(j + 1) * SUB]);
        start = -1;
      }
    }
  }

  private rect(x0: number, y0: number, x1: number, y1: number): void {
    const out = this.region as Buf;
    out.begin();
    out.point(x0, y0);
    out.point(x1, y0);
    out.point(x1, y1);
    out.point(x0, y1);
    out.end(3);
  }

  private flushRun(): void {
    if (this.runC0 < 0) return;
    const r = this.runR;
    this.rect(this.fx[this.runC0], this.fy[r], this.fx[this.runC1], this.fy[r + this.k]);
    this.runC0 = -1;
  }

  private value(r: number, c: number): number {
    if ((r & (SUB - 1)) === 0 && (c & (SUB - 1)) === 0) {
      return this.cv[(r / SUB) * (this.nx + 1) + c / SUB];
    }
    const o = (r - this.rowBase) * this.fw + c;
    if (this.bandHas[o] === 1) return this.bandVal[o];
    const v = this.F(this.fx[c], this.fy[r]);
    this.evals++;
    this.bandVal[o] = v;
    this.bandHas[o] = 1;
    return v;
  }

  /** Fine cell with bottom-left fine vertex (r, c). */
  private cell(r: number, c: number): void {
    const k = this.k;
    const vBL = this.value(r, c);
    const vBR = this.value(r, c + k);
    const vTR = this.value(r + k, c + k);
    const vTL = this.value(r + k, c);
    const iBL = this.inside(vBL);
    const iBR = this.inside(vBR);
    const iTR = this.inside(vTR);
    const iTL = this.inside(vTL);
    const code = (iBL ? 1 : 0) | (iBR ? 2 : 0) | (iTR ? 4 : 0) | (iTL ? 8 : 0);
    if (code === 15) {
      if (this.region) this.extendRun(r, c);
      return;
    }
    this.flushRun();
    if (code === 0) return;

    const p = this.pe;
    p[0] = iBL !== iBR ? this.hPoint(r, c, vBL, vBR) : -1;
    p[1] = iBR !== iTR ? this.vPoint(r, c + k, vBR, vTR) : -1;
    p[2] = iTL !== iTR ? this.hPoint(r + k, c, vTL, vTR) : -1;
    p[3] = iBL !== iTL ? this.vPoint(r, c, vBL, vTL) : -1;

    const saddle = code === 5 || code === 10;
    let joined = false;
    if (saddle) {
      const xm = 0.5 * (this.fx[c] + this.fx[c + k]);
      const ym = 0.5 * (this.fy[r] + this.fy[r + k]);
      // On a spent budget (coarse fallback only) the corner average decides instead.
      if (this.evals < this.maxEvals) {
        joined = this.inside(this.F(xm, ym));
        this.evals++;
      } else {
        joined = this.inside(0.25 * (vBL + vBR + vTR + vTL));
      }
    }

    if (this.wantCurve) {
      if (code === 5) {
        // Bottom-left and top-right inside: joined through the centre cuts off the other two.
        this.link(p[joined ? 2 : 3], p[joined ? 3 : 0]);
        this.link(p[joined ? 0 : 1], p[joined ? 1 : 2]);
      } else if (code === 10) {
        this.link(p[joined ? 3 : 0], p[joined ? 0 : 1]);
        this.link(p[joined ? 1 : 2], p[joined ? 2 : 3]);
      } else {
        this.link(p[SEGMENTS[2 * code]], p[SEGMENTS[2 * code + 1]]);
      }
    }

    if (this.region) this.cellPolygon(r, c, code, saddle && !joined);
  }

  private extendRun(r: number, c: number): void {
    if (this.runC0 >= 0 && this.runC1 === c) {
      this.runC1 = c + this.k;
      return;
    }
    this.flushRun();
    this.runR = r;
    this.runC0 = c;
    this.runC1 = c + this.k;
  }

  /** Inside part of a fine cell, walked counter-clockwise from the bottom-left corner. */
  private cellPolygon(r: number, c: number, code: number, split: boolean): void {
    const out = this.region as Buf;
    const p = this.pe;
    const pts = this.pts;
    const x0 = this.fx[c];
    const x1 = this.fx[c + this.k];
    const y0 = this.fy[r];
    const y1 = this.fy[r + this.k];
    if (split) {
      // Separated saddle: two corner triangles.
      if (code === 5) {
        this.triangle(x0, y0, p[0], p[3], true);
        this.triangle(x1, y1, p[1], p[2], false);
      } else {
        this.triangle(x1, y0, p[0], p[1], false);
        this.triangle(x0, y1, p[2], p[3], false);
      }
      return;
    }
    out.begin();
    if (code & 1) out.point(x0, y0);
    if (p[0] >= 0) out.point(pts[2 * p[0]], pts[2 * p[0] + 1]);
    if (code & 2) out.point(x1, y0);
    if (p[1] >= 0) out.point(pts[2 * p[1]], pts[2 * p[1] + 1]);
    if (code & 4) out.point(x1, y1);
    if (p[2] >= 0) out.point(pts[2 * p[2]], pts[2 * p[2] + 1]);
    if (code & 8) out.point(x0, y1);
    if (p[3] >= 0) out.point(pts[2 * p[3]], pts[2 * p[3] + 1]);
    out.end(3);
  }

  /**
   * Triangle of a corner and the crossings on its two edges, counter-clockwise. cornerFirst puts
   * the corner before crossings a then b; otherwise the order is a, corner, b.
   */
  private triangle(x: number, y: number, a: number, b: number, cornerFirst: boolean): void {
    const out = this.region as Buf;
    const pts = this.pts;
    out.begin();
    if (cornerFirst) out.point(x, y);
    out.point(pts[2 * a], pts[2 * a + 1]);
    if (!cornerFirst) out.point(x, y);
    out.point(pts[2 * b], pts[2 * b + 1]);
    out.end(3);
  }

  /** Crossing on the horizontal edge from fine vertex (r, c) to (r, c + k). */
  private hPoint(r: number, c: number, va: number, vb: number): number {
    const o = (r - this.rowBase) * this.fw + c;
    const cached = this.hEdge[o];
    if (cached >= 0) return cached;
    const y = this.fy[r];
    const id = this.crossing(this.fx[c], y, this.fx[c + this.k], y, va, vb);
    this.hEdge[o] = id;
    return id;
  }

  /** Crossing on the vertical edge from fine vertex (r, c) to (r + k, c). */
  private vPoint(r: number, c: number, va: number, vb: number): number {
    const o = (r - this.rowBase) * this.fw + c;
    const cached = this.vEdge[o];
    if (cached >= 0) return cached;
    const x = this.fx[c];
    const id = this.crossing(x, this.fy[r], x, this.fy[r + this.k], va, vb);
    this.vEdge[o] = id;
    return id;
  }

  /** Creates the crossing point of an edge whose ends are on opposite sides. */
  private crossing(xa: number, ya: number, xb: number, yb: number, va: number, vb: number): number {
    let t = 0.5;
    let valid = false;
    if (Number.isFinite(va) && Number.isFinite(vb)) {
      t = va / (va - vb);
      if (!(t >= 0)) t = 0;
      else if (t > 1) t = 1;
      const root = this.rootT(xa, ya, xb, yb, va, vb, t);
      if (root >= 0) {
        t = root;
        valid = true;
      } else if (this.region) {
        // A pole or jump still bounds the region, but interpolating towards it lands at the
        // mirror image of a pole; bisect the sign bracket the root search left behind instead.
        t = this.bisectEdge(xa, ya, xb, yb, va > 0, this.bracketLo, this.bracketHi);
      }
    } else if (this.region) {
      t = this.bisectEdge(xa, ya, xb, yb, this.inside(va), 0, 1);
    }
    // Exact ends keep crossings on grid vertices bit-identical across the edges that meet there.
    const x = t === 0 ? xa : t === 1 ? xb : xa + t * (xb - xa);
    const y = t === 0 ? ya : t === 1 ? yb : ya + t * (yb - ya);
    return this.addPoint(x, y, valid);
  }

  /**
   * Parameter of the root on an edge with finite values va, vb of opposite sign (t0 is their
   * linear interpolation), or -1 if the sign change is a pole or jump; the sign bracket is then
   * left in bracketLo / bracketHi.
   *
   * The bracket is narrowed from t0 by the root of the parabola through the bracket ends and the
   * end the last sample replaced, which is exact where F is quadratic along the edge (beside
   * saddles and tangencies); by the moving side's own secant opposite a flat end; and by
   * bisection when the same end moves twice in a row (kinks, steep roots).
   *
   * A root is confirmed by a sample with |F| at most ROOT_ACCEPT times the reference, the largest
   * value the smaller bracket end has had. Near a continuous root the samples go to zero, even
   * where F first moves away from it along the edge, since such a dip only raises the reference.
   * Towards a pole |F| grows, so no sample falls below a bracket end. Across a jump the samples
   * tend to the one-sided limits, which stay near the reference unless the curve itself ends
   * within a fraction of a cell, so a stub is at most that fraction.
   */
  private rootT(
    xa: number,
    ya: number,
    xb: number,
    yb: number,
    va: number,
    vb: number,
    t0: number,
  ): number {
    if (va === 0 || vb === 0) return t0;
    const aa = Math.abs(va);
    const ab = Math.abs(vb);
    // An end within rounding noise of zero is the root; sampling beside it would only see noise.
    if (Math.min(aa, ab) <= ROOT_NOISE * Math.max(aa, ab)) return t0;
    let lo = 0;
    let hi = 1;
    let fLo = va;
    let fHi = vb;
    let tOld = 0;
    let fOld = 0;
    // Which end the last sample replaced (1 lo, 2 hi), how often in a row, and which were seen.
    let side = 0;
    let repeats = 0;
    let sides = 0;
    let shrank = false;
    // The end's last replacement kept its exact value: F is constant there.
    let flatLo = false;
    let flatHi = false;
    let ref = Math.min(aa, ab);
    let t = t0;
    for (let s = 0; s < ROOT_SAMPLES; s++) {
      // Only reachable when contouring the coarse grid on a spent budget; draw unchecked.
      if (this.evals >= this.maxEvals) return t;
      const f = this.F(xa + t * (xb - xa), ya + t * (yb - ya));
      this.evals++;
      if (f === 0) return t;
      // Non-finite inside the edge: a pole or a hole in the domain, not a root.
      if (!(Math.abs(f) < Number.POSITIVE_INFINITY)) break;
      const prev = side;
      if (f > 0 === fLo > 0) {
        tOld = lo;
        fOld = fLo;
        lo = t;
        fLo = f;
        side = 1;
        flatLo = f === fOld;
      } else {
        tOld = hi;
        fOld = fHi;
        hi = t;
        fHi = f;
        side = 2;
        flatHi = f === fOld;
      }
      if (Math.abs(f) <= ROOT_ACCEPT * ref) return lo + (hi - lo) * (fLo / (fLo - fHi));
      // Poles and flat steps never bring a sample closer to zero than the end it replaced; stop
      // early once both sides have shown it.
      if (Math.abs(f) < Math.abs(fOld)) shrank = true;
      sides |= side;
      if (!shrank && sides === 3 && s + 1 >= POLE_SAMPLES) break;
      repeats = side === prev ? repeats + 1 : 0;
      const m = Math.min(Math.abs(fLo), Math.abs(fHi));
      if (m > ref) ref = m;
      // Opposite a flat end (a corner of max(|x|, |y|) = 1 just off the edge) only the moving
      // side has slope, so its own secant through the old and new end is the model.
      let q = Number.NaN;
      if (side === 1 ? flatHi : flatLo) q = t - (f * (t - tOld)) / (f - fOld);
      if (!(q > lo && q < hi) && repeats === 0) q = parabolaRoot(lo, fLo, hi, fHi, tOld, fOld);
      t = q > lo && q < hi ? q : 0.5 * (lo + hi);
    }
    this.bracketLo = lo;
    this.bracketHi = hi;
    return -1;
  }

  /**
   * Region boundary between edge parameters t0 and t1 that are on opposite sides (a domain edge,
   * a pole or a jump): bisects on inside/outside a few steps. aInside is the side at t0.
   */
  private bisectEdge(
    xa: number,
    ya: number,
    xb: number,
    yb: number,
    aInside: boolean,
    t0: number,
    t1: number,
  ): number {
    let tIn = aInside ? t0 : t1;
    let tOut = aInside ? t1 : t0;
    for (let s = 0; s < EDGE_BISECT_STEPS && this.evals < this.maxEvals; s++) {
      const tm = 0.5 * (tIn + tOut);
      const v = this.F(xa + tm * (xb - xa), ya + tm * (yb - ya));
      this.evals++;
      if (this.inside(v)) tIn = tm;
      else tOut = tm;
    }
    return 0.5 * (tIn + tOut);
  }

  private addPoint(x: number, y: number, valid: boolean): number {
    const id = this.np;
    if (2 * id + 2 > this.pts.length) {
      const pts = new Float64Array(this.pts.length * 2);
      pts.set(this.pts);
      this.pts = pts;
      const nbr = new Int32Array(this.nbr.length * 2).fill(-1);
      nbr.set(this.nbr);
      this.nbr = nbr;
      const ok = new Uint8Array(this.ok.length * 2);
      ok.set(this.ok);
      this.ok = ok;
    }
    this.pts[2 * id] = x;
    this.pts[2 * id + 1] = y;
    this.ok[id] = valid ? 1 : 0;
    this.np = id + 1;
    return id;
  }

  /** Joins two crossings by a curve segment, if both are genuine roots. */
  private link(a: number, b: number): void {
    if (a < 0 || b < 0 || this.ok[a] === 0 || this.ok[b] === 0) return;
    const nbr = this.nbr;
    nbr[nbr[2 * a] < 0 ? 2 * a : 2 * a + 1] = b;
    nbr[nbr[2 * b] < 0 ? 2 * b : 2 * b + 1] = a;
  }

  /** Walks the crossing graph into polylines: open chains from their ends, then closed loops. */
  private chain(): Polyline {
    const { np, nbr, pts } = this;
    const out = new Buf(2 * np + 64);
    const seen = new Uint8Array(np);
    for (let pass = 0; pass < 2; pass++) {
      for (let start = 0; start < np; start++) {
        if (seen[start] === 1 || nbr[2 * start] < 0) continue;
        if (pass === 0 && nbr[2 * start + 1] >= 0) continue;
        out.begin();
        let cur = start;
        let last = start;
        while (cur >= 0) {
          seen[cur] = 1;
          out.point(pts[2 * cur], pts[2 * cur + 1]);
          last = cur;
          const a = nbr[2 * cur];
          const b = nbr[2 * cur + 1];
          cur = a >= 0 && seen[a] === 0 ? a : b >= 0 && seen[b] === 0 ? b : -1;
        }
        if (
          pass === 1 &&
          last !== start &&
          (nbr[2 * last] === start || nbr[2 * last + 1] === start)
        ) {
          out.point(pts[2 * start], pts[2 * start + 1]);
        }
        out.end(2);
      }
    }
    return out.finish();
  }
}

/**
 * Root strictly inside (lo, hi) of the parabola through (lo, fLo), (hi, fHi) and (tm, fm), where
 * fLo and fHi have opposite signs, or NaN when rounding leaves none there.
 */
function parabolaRoot(
  lo: number,
  fLo: number,
  hi: number,
  fHi: number,
  tm: number,
  fm: number,
): number {
  const w = hi - lo;
  const d1 = (fHi - fLo) / w;
  const d2 = ((fm - fHi) / (tm - hi) - d1) / (tm - lo);
  // p(lo + u) = d2 u^2 + b u + fLo, solved without cancellation; d2 = 0 gives the secant root.
  const b = d1 - d2 * w;
  const disc = b * b - 4 * d2 * fLo;
  if (!(disc >= 0)) return Number.NaN;
  const q = -0.5 * (b >= 0 ? b + Math.sqrt(disc) : b - Math.sqrt(disc));
  const u = fLo / q;
  if (u > 0 && u < w) return lo + u;
  const u2 = q / d2;
  return u2 > 0 && u2 < w ? lo + u2 : Number.NaN;
}

/**
 * Coordinates of n grid lines spaced `step` apart, starting one cell (SUB lines) below `min`
 * at an integer multiple of the cell size, so the same world point always gets the same line.
 */
function gridCoords(min: number, cell: number, n: number): Float64Array {
  const out = new Float64Array(n);
  const step = cell / SUB;
  const i0 = Math.floor(min / cell) - 1;
  if (Math.abs(i0) * SUB < MAX_GRID_INDEX) {
    const g0 = i0 * SUB;
    for (let i = 0; i < n; i++) out[i] = (g0 + i) * step;
  } else {
    const o = min - cell;
    for (let i = 0; i < n; i++) out[i] = o + i * step;
  }
  return out;
}
