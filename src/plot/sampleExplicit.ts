// Adaptive sampler for y = f(x) (and x = f(y) with the axes swapped).
//
// Terminology: u is the input axis (x for axis 'x'), w the value axis. The visible u range (plus
// one initial interval of margin each side) is covered by a world-aligned grid of one interval
// per 2px (4px while interacting). The grid is offset by an irrational fraction of an interval,
// so a periodic function whose period divides the interval cannot alias with it (sin(30πx) at a
// round zoom level would otherwise sample only its zeros). Each interval is refined by recursive
// bisection:
//   - flat within 0.25px and a step under 16px → done (grid intervals also check an irrational
//     probe point, which catches two periods per interval), unless an end is a sharp corner
//     against the neighbouring sample: a log spike can hide there with the midpoint on the chord;
//   - entirely beyond the same visible edge → done (invisible);
//   - finite/non-finite mix → bisect toward the domain edge until the curve ends exactly there
//     or leaves the view (log x keeps going down to -∞ at 0);
//   - still steep or bent at the depth limit → chase: keep halving around the sharpest bend and
//     classify what remains as a break (1/x, tan x, floor x), a spike (ln|x - c|, which both
//     sides of the singularity follow off the screen) or a steep continuous stretch (x^(1/3)).
// An evaluation budget bounds pathological inputs (sin(1/x)). It is shared out over the grid so
// one busy region cannot starve the rest of the curve; an interval whose share is spent joins
// its samples directly, except across what is plainly a pole.
//
// Output is world (x, y) pairs with NaN pairs as pen-up. Values on the w axis are clipped to a
// band one viewport beyond each edge: a run of points beyond the band is replaced by the points
// where the chords enter and leave it, so the visible picture is unchanged while the output stays
// small, bounded and free of Infinity.

import type { Fn1 } from '../engine/types';
import type { Polyline, Quality, Viewport } from './types';

export interface ExplicitSampleOptions {
  quality?: Quality;
  /** The function ignores its argument: sample it once and draw a straight line. */
  constant?: boolean;
  /** Evaluation budget for the whole curve (default 40000). */
  maxEvals?: number;
}

const MAX_DEPTH = 8;
/** Bisections at a domain edge past MAX_DEPTH before its value may be taken as settled. */
const EDGE_STEPS = 30;
/** Cap on edge and chase bisections: enough to reach adjacent doubles anywhere, even near 0. */
const MAX_STEPS = 1100;
const FLAT_PX = 0.25;
const MAX_STEP_PX = 16;
const JUMP_PX = 1;
/** A chased jump that shrank to below this fraction of its size is a steep continuous curve. */
const CONTINUOUS_RATIO = 0.25;
/**
 * A sample that is a local extremum of the sample sequence with both neighbouring chords taller
 * than this is a corner no smooth curve passing the flatness test can make: a spike (ln|x - c|)
 * hides next to it even when the interval's own midpoint sits on its chord.
 */
const CORNER_PX = 0.5;
/** An edge value that moves less than this per bisection has converged (sqrt at 0). */
const SETTLED_PX = 0.05;
/** Refinement continues this far past the visible edges, so line caps are drawn right. */
const EDGE_MARGIN_PX = 4;
const DEFAULT_MAX_EVALS = 40000;
/** Most a grid interval may take of the remaining budget, as a multiple of an even split. */
const FAIR_SHARE = 16;
/** Evaluations kept back for every later grid interval, enough to draw a smooth stretch. */
const RESERVE = 12;
/** Largest grid index we trust to be an exact integer in floating point. */
const MAX_GRID_INDEX = 2 ** 52;
/** 2 - golden ratio: grid phase and probe position, irrational so periodic inputs cannot alias. */
const PHI = 0.3819660112501051;

const CONNECT = 1;
const BREAK = 2;
const EXTEND = 3;

/**
 * Growable interleaved (x, y) buffer that inserts NaN pairs between pieces. Never writes a
 * leading, trailing or doubled NaN pair, nor an exact repeat of the previous point.
 */
export class PolylineBuilder {
  private buf: Float64Array;
  private n = 0;
  private open = false;

  constructor(capacityPoints = 256) {
    this.buf = new Float64Array(Math.max(4, capacityPoints * 2));
  }

  point(x: number, y: number): void {
    const n = this.n;
    if (this.open && this.buf[n - 2] === x && this.buf[n - 1] === y) return;
    if (n + 2 > this.buf.length) this.grow();
    this.buf[n] = x;
    this.buf[n + 1] = y;
    this.n = n + 2;
    this.open = true;
  }

  penUp(): void {
    if (!this.open) return;
    if (this.n + 2 > this.buf.length) this.grow();
    this.buf[this.n] = Number.NaN;
    this.buf[this.n + 1] = Number.NaN;
    this.n += 2;
    this.open = false;
  }

  finish(): Polyline {
    const n = !this.open && this.n >= 2 ? this.n - 2 : this.n;
    return this.buf.slice(0, n);
  }

  private grow(): void {
    const next = new Float64Array(this.buf.length * 2);
    next.set(this.buf);
    this.buf = next;
  }
}

/**
 * Whether three samples taken 2^8, 2^16 and 2^24 steps away from a point still move toward it at
 * an undiminished rate: a logarithmic or power singularity changes at least as much over each
 * 256-fold step nearer, a converging value (sqrt, x^0.1) clearly less. Returns the direction in
 * which the value runs off (+1 or -1), or 0.
 */
function divergesToward(v1: number, v2: number, v3: number): number {
  const near = v1 - v2;
  const far = v2 - v3;
  const real = Math.abs(near) > 1e-9 * Math.max(1, Math.abs(v2));
  if (!(near * far > 0 && Math.abs(near) >= 0.97 * Math.abs(far) && real)) return 0;
  return near > 0 ? 1 : -1;
}

class ExplicitSampler {
  budget = 0;
  private down = false;
  /** Last point passed to emitPoint, and its zone (-1 below the band, 0 inside, 1 above). */
  private lu = 0;
  private lw = 0;
  private lz = 0;
  /** Change in w into the last emitted point (0 after a pen-up), for the over-budget guard. */
  private ld = 0;
  /** The depth-limit interval being resolved: room for the divergence probes. */
  private ra = 0;
  private rb = 0;

  constructor(
    private readonly f: Fn1,
    private readonly swap: boolean,
    private readonly wPpu: number,
    /** Clipping band. */
    private readonly wLo: number,
    private readonly wHi: number,
    /** Visible w range plus EDGE_MARGIN_PX. */
    private readonly vLo: number,
    private readonly vHi: number,
    /** Viewport size along w, px. */
    private readonly wPx: number,
    private readonly out: PolylineBuilder,
  ) {}

  ev(u: number): number {
    this.budget--;
    return this.f(u);
  }

  private write(u: number, w: number): void {
    if (this.swap) this.out.point(w, u);
    else this.out.point(u, w);
  }

  private margin(z: number): number {
    return z > 0 ? this.wHi : this.wLo;
  }

  /** u where the chord from the last point to (u, w) crosses the band edge on side z. */
  private cross(u: number, w: number, z: number): number {
    let t = (this.margin(z) - this.lw) / (w - this.lw);
    if (!(t >= 0)) t = 0;
    else if (t > 1) t = 1;
    return this.lu + (u - this.lu) * t;
  }

  emitPoint(u: number, w: number): void {
    const z = w > this.wHi ? 1 : w < this.wLo ? -1 : 0;
    if (!this.down) {
      this.down = true;
      this.write(u, z === 0 ? w : this.margin(z));
    } else if (z === 0) {
      if (this.lz !== 0) this.write(this.cross(u, w, this.lz), this.margin(this.lz));
      this.write(u, w);
    } else if (z !== this.lz) {
      if (this.lz !== 0) this.write(this.cross(u, w, this.lz), this.margin(this.lz));
      this.write(this.cross(u, w, z), this.margin(z));
    }
    this.ld = this.down ? w - this.lw : 0;
    this.lu = u;
    this.lw = w;
    this.lz = z;
  }

  penUp(): void {
    if (!this.down) return;
    if (this.lz !== 0) this.write(this.lu, this.margin(this.lz));
    this.out.penUp();
    this.down = false;
    this.ld = 0;
  }

  emit(u: number, w: number): void {
    if (Number.isFinite(w)) this.emitPoint(u, w);
    else this.penUp();
  }

  /** p and q lie beyond opposite visible edges. */
  private opposite(p: number, q: number): boolean {
    return (p > this.vHi && q < this.vLo) || (p < this.vLo && q > this.vHi);
  }

  /** A value just beyond the clipping band in direction s, which emitPoint clips to the band. */
  private beyond(s: number): number {
    const span = this.wHi - this.wLo;
    return s > 0 ? this.wHi + span : this.wLo - span;
  }

  /**
   * Emits everything in (a, b], ending with b (a point, or a pen-up when f(b) is not finite).
   * fl and fr are the nearest known samples left of a and right of b (NaN if none), which
   * reveal sharp corners at a and b.
   */
  seg(a: number, fa: number, b: number, fb: number, depth: number, fl: number, fr: number): void {
    if (this.budget <= 0) {
      this.raw(fa, b, fb);
      return;
    }
    const aOk = Number.isFinite(fa);
    const bOk = Number.isFinite(fb);
    const m = 0.5 * (a + b);

    if (!aOk && !bOk) {
      const fm = this.ev(m);
      if (!Number.isFinite(fm)) {
        this.penUp();
      } else if (depth >= MAX_DEPTH) {
        this.penUp();
        this.emitPoint(m, fm);
        this.penUp();
      } else {
        this.seg(a, fa, m, fm, depth + 1, fl, fb);
        this.seg(m, fm, b, fb, depth + 1, fa, fr);
      }
      return;
    }

    if (aOk !== bOk) {
      if (depth >= MAX_DEPTH) {
        this.ra = a;
        this.rb = b;
        this.edge(a, fa, b, fb, aOk);
      } else {
        const fm = this.ev(m);
        this.seg(a, fa, m, fm, depth + 1, fl, fb);
        this.seg(m, fm, b, fb, depth + 1, fa, fr);
      }
      return;
    }

    const fm = this.ev(m);
    if (!Number.isFinite(fm)) {
      if (depth >= MAX_DEPTH) {
        this.ra = a;
        this.rb = b;
        this.edge(a, fa, m, fm, true);
        this.edge(m, fm, b, fb, false);
      } else {
        this.seg(a, fa, m, fm, depth + 1, fl, fb);
        this.seg(m, fm, b, fb, depth + 1, fa, fr);
      }
      return;
    }

    const lo = this.vLo;
    const hi = this.vHi;
    if ((fa > hi && fm > hi && fb > hi) || (fa < lo && fm < lo && fb < lo)) {
      this.emitPoint(b, fb);
      return;
    }
    const ppu = this.wPpu;
    const step = Math.abs(fb - fa) * ppu;
    const dev = Math.abs(fm - (0.5 * fa + 0.5 * fb)) * ppu;
    const flat =
      dev <= FLAT_PX &&
      step < MAX_STEP_PX &&
      !corner(fl, fa, fm, ppu) &&
      !corner(fm, fb, fr, ppu) &&
      (depth > 0 || this.probeFlat(a, fa, b, fb));
    if (flat) {
      this.emitPoint(b, fb);
    } else if (depth < MAX_DEPTH) {
      this.seg(a, fa, m, fm, depth + 1, fl, fb);
      this.seg(m, fm, b, fb, depth + 1, fa, fr);
    } else {
      this.chase(a, fa, m, fm, b, fb, fl, fr);
    }
  }

  /**
   * Second flatness check on a grid interval, at an irrational position: two periods per grid
   * interval leave the midpoint on the chord.
   */
  private probeFlat(a: number, fa: number, b: number, fb: number): boolean {
    if (this.budget <= 0) return true;
    const fp = this.ev(a + PHI * (b - a));
    return Math.abs(fp - (fa + PHI * (fb - fa))) * this.wPpu <= FLAT_PX;
  }

  /**
   * Over budget: join the samples, but not across a pole, i.e. when the ends lie beyond opposite
   * visible edges, or when a jump of over an eighth of the screen reverses the curve's direction
   * (tan's branches, sampled 2px apart, can both be on screen).
   */
  private raw(fa: number, b: number, fb: number): void {
    if (Number.isFinite(fa) && Number.isFinite(fb)) {
      const d = fb - fa;
      if (this.opposite(fa, fb) || (Math.abs(d) * this.wPpu > this.wPx / 8 && d * this.ld < 0)) {
        this.penUp();
      }
    }
    this.emit(b, fb);
  }

  /**
   * Domain edge inside [a, b]: bisect toward the last finite point on the finite side, until the
   * value settles, leaves the view or the interval reaches adjacent doubles. A value still
   * running off at that point (log at its edge) is extended beyond the view.
   */
  private edge(a: number, fa: number, b: number, fb: number, leftFinite: boolean): void {
    const ppu = this.wPpu;
    let ok = leftFinite ? a : b;
    let fok = leftFinite ? fa : fb;
    let bad = leftFinite ? b : a;
    let moved = Number.POSITIVE_INFINITY;
    let s = 0;
    for (let k = 0; k < MAX_STEPS && this.budget > 0; k++) {
      const m = 0.5 * (ok + bad);
      if (m === ok || m === bad) {
        // Adjacent doubles, still on screen.
        s = this.diverges(ok, ok - bad);
        break;
      }
      const fm = this.ev(m);
      if (Number.isFinite(fm)) {
        moved = Math.abs(fm - fok) * ppu;
        ok = m;
        fok = fm;
        if (fok > this.vHi || fok < this.vLo) break;
      } else {
        bad = m;
      }
      if (k >= EDGE_STEPS && moved < SETTLED_PX) {
        // Converged (sqrt), or a log creeping down too slowly to see (zoomed far out).
        s = this.diverges(ok, ok - bad);
        break;
      }
    }
    if (leftFinite) {
      if (ok !== a) this.emitPoint(ok, fok);
      if (s !== 0) this.emitPoint(ok, this.beyond(s));
      this.penUp();
    } else {
      this.penUp();
      if (s !== 0) this.emitPoint(ok, this.beyond(s));
      if (ok !== b) this.emitPoint(ok, fok);
      this.emitPoint(b, fb);
    }
  }

  /** divergesToward for f near u, probing toward u + h·2^24 (which must stay in [ra, rb]). */
  private diverges(u: number, h: number): number {
    const u3 = u + h * 16777216;
    if (!(u3 >= this.ra && u3 <= this.rb) || this.budget < 3) return 0;
    const v1 = this.ev(u + h * 256);
    const v2 = this.ev(u + h * 65536);
    return divergesToward(v1, v2, this.ev(u3));
  }

  /**
   * Singular interval at the depth limit: a jump, a pole, a spike or a very steep stretch. Halve
   * it around the sample with the largest second difference, which is where the curve bends or
   * breaks hardest: that follows a jump, both sides of a pole and the tip of a spike alike (the
   * larger end-to-end difference does not: it leads away from a spike whose ends are level).
   * Then classify what remains:
   *   - all of it beyond one visible edge, or closed to a pixel → join it;
   *   - its two sides beyond opposite edges without shrinking (tan, 1/x) → break;
   *   - a monotone jump that shrinks (x^(1/3)) → join, one between flat sides (floor) → break;
   *   - anything else, notably a spike (ln|x - c|), is followed until it leaves the view or the
   *     interval reaches adjacent doubles, where a value still diverging is extended off screen.
   */
  private chase(
    a: number,
    fa: number,
    m: number,
    fm: number,
    b: number,
    fb: number,
    fl: number,
    fr: number,
  ): void {
    const ppu = this.wPpu;
    const vLo = this.vLo;
    const vHi = this.vHi;
    let lo = a;
    let flo = fa;
    let mid = m;
    let fmid = fm;
    let hi = b;
    let fhi = fb;
    const j0 = Math.max(Math.abs(fmid - flo), Math.abs(fhi - fmid)) * ppu;
    let j = j0;
    let verdict = 0;
    this.ra = a;
    this.rb = b;
    let exact = false;
    let shrunk = 0;
    for (let k = 0; k < MAX_STEPS; k++) {
      if (this.budget < 3) break;
      const q1 = 0.5 * (lo + mid);
      const q3 = 0.5 * (mid + hi);
      if (q1 === lo || q1 === mid || q3 === mid || q3 === hi) {
        exact = true;
        break;
      }
      const f1 = this.ev(q1);
      const f3 = this.ev(q3);
      if (!(Number.isFinite(f1) && Number.isFinite(f3))) {
        // A hole in the domain, or a pole hit exactly (ln 0): end each side there like a domain
        // edge, which also carries a diverging side off the screen.
        this.emitPoint(lo, flo);
        this.around(lo, flo, q1, f1, mid, fmid);
        this.around(mid, fmid, q3, f3, hi, fhi);
        this.emitPoint(b, fb);
        return;
      }
      // A corner at one end (against the sample beyond it) means a spike hides next to that
      // end, where second differences inside cannot see it; otherwise take the sharpest bend.
      const cl = corner(fl, flo, f1, ppu);
      const cr = corner(f3, fhi, fr, ppu);
      const d1 = Math.abs(flo - 2 * f1 + fmid);
      const d2 = Math.abs(f1 - 2 * fmid + f3);
      const d3 = Math.abs(fmid - 2 * f3 + fhi);
      if (cl !== cr ? cl : d1 > d2 && d1 >= d3) {
        fr = f3;
        hi = mid;
        fhi = fmid;
        mid = q1;
        fmid = f1;
      } else if (cl !== cr ? cr : d3 > d2 && d3 > d1) {
        fl = f1;
        lo = mid;
        flo = fmid;
        mid = q3;
        fmid = f3;
      } else {
        fl = flo;
        fr = fhi;
        lo = q1;
        flo = f1;
        hi = q3;
        fhi = f3;
      }

      if ((flo > vHi && fmid > vHi && fhi > vHi) || (flo < vLo && fmid < vLo && fhi < vLo)) {
        verdict = CONNECT;
        break;
      }
      const jl = Math.abs(fmid - flo) * ppu;
      const jr = Math.abs(fhi - fmid) * ppu;
      j = jl > jr ? jl : jr;
      if (j <= JUMP_PX) {
        verdict = CONNECT;
        break;
      }
      if (j >= j0 && (this.opposite(flo, fmid) || this.opposite(fmid, fhi))) {
        verdict = BREAK;
        break;
      }
      // A spike, or one still hiding next to an end corner: follow it, no early verdict.
      if (
        (fmid - flo) * (fmid - fhi) > 0 ||
        corner(fl, flo, fmid, ppu) ||
        corner(fmid, fhi, fr, ppu)
      ) {
        shrunk = 0;
        continue;
      }
      // Monotone. Two shrunken steps in a row: one alone can be a spike's flank seen from one
      // side, before a sample lands beyond its tip.
      if (j < CONTINUOUS_RATIO * j0) {
        if (++shrunk >= 2) {
          verdict = CONNECT;
          break;
        }
      } else {
        shrunk = 0;
      }
      if (k >= 6 && j >= j0 && this.plateau(lo, flo, mid, fmid, hi, fhi)) {
        verdict = BREAK;
        break;
      }
    }

    // Unresolved at adjacent doubles or out of budget: a spike still running off is extended.
    let ext = 0;
    let extU = mid;
    if (verdict === 0) {
      const opp = this.opposite(flo, fmid) || this.opposite(fmid, fhi);
      if (opp) verdict = BREAK;
      else if (exact) {
        // At adjacent doubles a monotone step is float granularity (a staircase), not a jump,
        // unless it is huge.
        verdict = j > this.wPx ? BREAK : CONNECT;
        // The most extreme sample, if well beyond the interval's ends and still on screen.
        const top = fmid >= flo && fmid >= fhi ? mid : flo >= fhi ? lo : hi;
        const bot = fmid <= flo && fmid <= fhi ? mid : flo <= fhi ? lo : hi;
        const fTop = top === mid ? fmid : top === lo ? flo : fhi;
        const fBot = bot === mid ? fmid : bot === lo ? flo : fhi;
        const lowEnd = fa < fb ? fa : fb;
        const highEnd = fa > fb ? fa : fb;
        if ((lowEnd - fBot) * ppu > JUMP_PX && fBot >= vLo) {
          extU = bot;
          ext = this.diverges(bot, bot === hi ? lo - hi : hi - bot) < 0 ? -1 : 0;
        } else if ((fTop - highEnd) * ppu > JUMP_PX && fTop <= vHi) {
          extU = top;
          ext = this.diverges(top, top === hi ? lo - hi : hi - top) > 0 ? 1 : 0;
        }
        if (ext !== 0) verdict = EXTEND;
      } else {
        verdict = j > this.wPx / 2 ? BREAK : CONNECT;
      }
    }

    if (verdict === BREAK) {
      const left = this.opposite(flo, fmid) || (!this.opposite(fmid, fhi) && jLeft(flo, fmid, fhi));
      this.emitPoint(lo, flo);
      if (left) this.penUp();
      this.emitPoint(mid, fmid);
      if (!left) this.penUp();
      this.emitPoint(hi, fhi);
    } else {
      const tip = verdict === EXTEND ? this.beyond(ext) : 0;
      this.emitPoint(lo, flo);
      if (verdict === EXTEND && extU === lo) this.emitPoint(lo, tip);
      this.emitPoint(mid, verdict === EXTEND && extU === mid ? tip : fmid);
      if (verdict === EXTEND && extU === hi) this.emitPoint(hi, tip);
      this.emitPoint(hi, fhi);
    }
    this.emitPoint(b, fb);
  }

  /** Emits (p, r] given q between them, treating a non-finite f(q) as a domain edge. */
  private around(p: number, fp: number, q: number, fq: number, r: number, fr: number): void {
    if (Number.isFinite(fq)) {
      this.emitPoint(q, fq);
      this.emitPoint(r, fr);
    } else {
      this.edge(p, fp, q, fq, true);
      this.edge(q, fq, r, fr, false);
    }
  }

  /**
   * A monotone triple with a persistent jump in one half: is that a step between flat sides
   * (floor), rather than the flank of a spike just beyond the outer sample (ln|x - c| with c
   * barely inside)? Probes right next to the outer sample of the jumping half: on a plateau it
   * reads about the same value, next to a spike it does not.
   */
  private plateau(
    lo: number,
    flo: number,
    mid: number,
    fmid: number,
    hi: number,
    fhi: number,
  ): boolean {
    const leftJump = jLeft(flo, fmid, fhi);
    const u = leftJump ? lo + (mid - lo) / 1024 : hi - (hi - mid) / 1024;
    // Too close to adjacent doubles to tell: let the chase run to its float-limit verdict.
    if (u === lo || u === hi) return false;
    const fu = this.ev(u);
    const smooth = leftJump ? Math.abs(fhi - fmid) : Math.abs(fmid - flo);
    return Math.abs(fu - (leftJump ? flo : fhi)) <= Math.max(FLAT_PX / this.wPpu, smooth / 256);
  }

  finish(): Polyline {
    this.penUp();
    return this.out.finish();
  }
}

/** q is a local extremum of the samples p, q, r with both chords taller than CORNER_PX. */
function corner(p: number, q: number, r: number, ppu: number): boolean {
  const dl = q - p;
  const dr = r - q;
  return dl * dr < 0 && Math.abs(dl) * ppu > CORNER_PX && Math.abs(dr) * ppu > CORNER_PX;
}

/** The jump of the triple lies in its left half. */
function jLeft(flo: number, fmid: number, fhi: number): boolean {
  return Math.abs(fmid - flo) >= Math.abs(fhi - fmid);
}

/**
 * Refinement budget for the next of `intervals` grid intervals, out of `remaining`: at most
 * FAIR_SHARE times an even split, and never cutting into RESERVE for each later interval (unless
 * even an even split cannot honour that).
 */
function shareOf(remaining: number, intervals: number): number {
  const even = Math.floor(remaining / intervals);
  const share = Math.floor((FAIR_SHARE * remaining) / intervals);
  const spare = remaining - RESERVE * (intervals - 1);
  const allow = Math.max(even, Math.min(share, spare));
  return allow < remaining ? (allow > 0 ? allow : 0) : remaining;
}

export function sampleExplicit(
  f: Fn1,
  view: Viewport,
  axis: 'x' | 'y',
  opts: ExplicitSampleOptions = {},
): Polyline {
  const swap = axis === 'y';
  const uPpu = swap ? view.ppuY : view.ppuX;
  const wPpu = swap ? view.ppuX : view.ppuY;
  const uPx = swap ? view.height : view.width;
  const wPx = swap ? view.width : view.height;
  const uC = swap ? view.cy : view.cx;
  const wC = swap ? view.cx : view.cy;
  if (!(uPpu > 0 && wPpu > 0 && uPx > 0 && wPx > 0)) return new Float64Array(0);
  const uHalf = uPx / 2 / uPpu;
  const wHalf = wPx / 2 / wPpu;
  const uMin = uC - uHalf;
  const uMax = uC + uHalf;
  if (!Number.isFinite(uMin) || !Number.isFinite(uMax) || !(uMax > uMin)) {
    return new Float64Array(0);
  }

  const pxPerInterval = opts.quality === 'interactive' ? 4 : 2;
  const n0 = Math.max(1, Math.ceil(uPx / pxPerInterval));
  const du = (uMax - uMin) / n0;
  // Align the grid to (k + PHI)·du so panning does not shift the samples under the curve.
  const k0 = Math.floor(uMin / du - PHI) - 1;
  const k1 = Math.ceil(uMax / du - PHI) + 1;
  const aligned = Math.abs(k0) < MAX_GRID_INDEX && Math.abs(k1) < MAX_GRID_INDEX;
  const count = aligned ? k1 - k0 : n0 + 2;
  const uAt = aligned
    ? (i: number) => (k0 + i + PHI) * du
    : (i: number) => (i === 0 ? uMin - du : uMin + (i - 1) * du);

  const out = new PolylineBuilder(count + 64);
  const vMargin = EDGE_MARGIN_PX / wPpu;
  const s = new ExplicitSampler(
    f,
    swap,
    wPpu,
    wC - 3 * wHalf,
    wC + 3 * wHalf,
    wC - wHalf - vMargin,
    wC + wHalf + vMargin,
    wPx,
    out,
  );

  if (opts.constant) {
    const c = f(uC);
    if (Number.isFinite(c)) {
      s.emitPoint(uAt(0), c);
      s.emitPoint(uAt(count), c);
    }
    return s.finish();
  }

  // The grid itself is always evaluated; refinement gets whatever budget is left, handed out
  // interval by interval so the right of the screen still gets its share.
  let remaining = (opts.maxEvals ?? DEFAULT_MAX_EVALS) - (count + 1);
  let fl = Number.NaN;
  let ua = uAt(0);
  let fa = f(ua);
  let ub = uAt(1);
  let fb = f(ub);
  s.emit(ua, fa);
  for (let i = 1; i <= count; i++) {
    // One grid sample ahead, for the corner test at b.
    const uc = i < count ? uAt(i + 1) : Number.NaN;
    const fc = i < count ? f(uc) : Number.NaN;
    const allow = shareOf(remaining, count - i + 1);
    s.budget = allow;
    s.seg(ua, fa, ub, fb, 0, fl, fc);
    remaining -= allow - s.budget;
    fl = fa;
    ua = ub;
    fa = fb;
    ub = uc;
    fb = fc;
  }
  return s.finish();
}
