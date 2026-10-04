// Adaptive sampler for parametric curves (x(t), y(t)) and polar curves r(θ).
//
// Same scheme as the explicit sampler, measured in 2-D screen distance: a grid in t (with
// irrational spacing so periodic curves cannot alias with it), bisected while the midpoint
// strays more than 0.25px from the chord, the chord is longer than 16px or the curve doubles back
// sharply at an end; domain edges are bisected until the curve ends or leaves the view; at the
// depth limit a chase classifies breaks, spikes (r = ln|θ - c|) and steep continuous stretches.
// Once the evaluation budget is spent the remaining samples are joined directly, except for
// chords too long to trust.
// Points are emitted as sampled (world coordinates, finite or NaN pen-up pairs), plus, where a
// spike or an edge keeps diverging at the limit of floating point, one point far off screen in
// its direction.

import type { Fn1 } from '../engine/types';
import { PolylineBuilder } from './sampleExplicit';
import type { Polyline, Quality, Viewport } from './types';

export interface ParametricSampleOptions {
  quality?: Quality;
  /** Evaluation budget for the whole curve (default 60000); one evaluation is one point. */
  maxEvals?: number;
}

/**
 * Longest parameter range sampled. A longer range is cut to a window of this length, centred on
 * the parameter value nearest 0 (so [-1e7, 1e7] keeps [-5e5, 5e5]); the UI may warn about it.
 */
export const MAX_PARAMETER_RANGE = 1e6;

const MAX_DEPTH = 10;
const EDGE_STEPS = 30;
const MAX_STEPS = 1100;
const FLAT_PX = 0.25;
const FLAT_PX2 = FLAT_PX * FLAT_PX;
const MAX_SEG_PX = 16;
const MAX_SEG_PX2 = MAX_SEG_PX * MAX_SEG_PX;
const JUMP_PX = 1;
const CONTINUOUS_RATIO = 0.25;
/**
 * A chased jump at least this fraction of its initial size has not shrunk: in 2-D its chord
 * keeps a vanishing component along the curve (floor's step loses its width), unlike a value jump.
 */
const PERSIST_RATIO = 0.9;
const CORNER_PX = 0.5;
const SETTLED_PX = 0.05;
/** Largest offset of the middle sample from the chord's midpoint (squared px); see even(). */
const SPACING_PX2 = 1;
/** Overshoot beyond a chord end that counts as the curve doubling back (squared px). */
const OVERSHOOT_PX2 = 0.01 * 0.01;
const EDGE_MARGIN_PX = 4;
const DEFAULT_MAX_EVALS = 60000;
const MIN_N = 256;
const TAU = 2 * Math.PI;
/** 2 - golden ratio: grid offset and probe position. */
const PHI = 0.3819660112501051;

const CONNECT = 1;
const BREAK = 2;
const EXTEND = 3;

/**
 * Point q (screen offsets from p and to r given as d1 = q - p and d2 = r - q) is a sharp
 * reversal of the sample sequence with both chords longer than CORNER_PX: no smooth curve that
 * passed the flatness test turns like that, so a spike hides next to q.
 */
function reverses(d1x: number, d1y: number, d2x: number, d2y: number): boolean {
  const c2 = CORNER_PX * CORNER_PX;
  return d1x * d2x + d1y * d2y < 0 && d1x * d1x + d1y * d1y > c2 && d2x * d2x + d2y * d2y > c2;
}

class CurveSampler {
  budget = 0;
  /** Result of the last eval(). */
  x = 0;
  y = 0;
  private readonly xLo: number;
  private readonly xHi: number;
  private readonly yLo: number;
  private readonly yHi: number;
  private readonly kx: number;
  private readonly ky: number;
  /** Screen size, px. */
  private readonly span: number;
  /** Last emitted point (for the over-budget guard). */
  private open = false;
  private lx = 0;
  private ly = 0;
  /** The depth-limit interval being resolved: room for the divergence probes. */
  private ra = 0;
  private rb = 0;
  /** Far point set by a successful diverges(). */
  private farX = 0;
  private farY = 0;
  /** Squared deviation (px) of the last chordDev2 call. */
  private dev2 = 0;
  /**
   * The last chordDev2's middle point lies beyond an end of the chord: the curve doubles back
   * within the interval. A smooth curve cannot do that in zero width, but a spike whose samples
   * straddle its tip at equal heights (r = ln|θ - c|) looks exactly like that.
   */
  private overshoot = false;

  constructor(
    private readonly fa: Fn1,
    private readonly fb: Fn1 | null,
    view: Viewport,
    private readonly out: PolylineBuilder,
  ) {
    // The visible window plus a few pixels for line caps.
    const hw = (view.width / 2 + EDGE_MARGIN_PX) / view.ppuX;
    const hh = (view.height / 2 + EDGE_MARGIN_PX) / view.ppuY;
    this.xLo = view.cx - hw;
    this.xHi = view.cx + hw;
    this.yLo = view.cy - hh;
    this.yHi = view.cy + hh;
    this.kx = view.ppuX;
    this.ky = view.ppuY;
    this.span = Math.max(view.width, view.height);
  }

  /** Evaluates the point at t into this.x / this.y (fb null means polar: fa is r(θ)). */
  point(t: number): void {
    if (this.fb) {
      this.x = this.fa(t);
      this.y = this.fb(t);
    } else {
      const r = this.fa(t);
      this.x = r * Math.cos(t);
      this.y = r * Math.sin(t);
    }
  }

  private ev(t: number): void {
    this.budget--;
    this.point(t);
  }

  private put(x: number, y: number): void {
    this.out.point(x, y);
    this.open = true;
    this.lx = x;
    this.ly = y;
  }

  private lift(): void {
    this.out.penUp();
    this.open = false;
  }

  emit(x: number, y: number): void {
    if (Number.isFinite(x) && Number.isFinite(y)) this.put(x, y);
    else this.lift();
  }

  private dist(x0: number, y0: number, x1: number, y1: number): number {
    const dx = (x1 - x0) * this.kx;
    const dy = (y1 - y0) * this.ky;
    return Math.sqrt(dx * dx + dy * dy);
  }

  /** Outside the visible window (plus margin). */
  private off(x: number, y: number): boolean {
    return x < this.xLo || x > this.xHi || y < this.yLo || y > this.yHi;
  }

  /** The three points all lie beyond the same visible edge. */
  private beyondOne(x0: number, y0: number, x1: number, y1: number, x2: number, y2: number) {
    return (
      (x0 > this.xHi && x1 > this.xHi && x2 > this.xHi) ||
      (x0 < this.xLo && x1 < this.xLo && x2 < this.xLo) ||
      (y0 > this.yHi && y1 > this.yHi && y2 > this.yHi) ||
      (y0 < this.yLo && y1 < this.yLo && y2 < this.yLo)
    );
  }

  /** p and q lie beyond opposite visible edges. */
  private opposite(px: number, py: number, qx: number, qy: number): boolean {
    return (
      (px > this.xHi && qx < this.xLo) ||
      (px < this.xLo && qx > this.xHi) ||
      (py > this.yHi && qy < this.yLo) ||
      (py < this.yLo && qy > this.yHi)
    );
  }

  /** The sample sequence p, q, r doubles back sharply at q (see reverses). */
  private corner(px: number, py: number, qx: number, qy: number, rx: number, ry: number) {
    const kx = this.kx;
    const ky = this.ky;
    return reverses((qx - px) * kx, (qy - py) * ky, (rx - qx) * kx, (ry - qy) * ky);
  }

  /**
   * Emits everything in (t0, t1], ending with p1 (a point, or a pen-up when it is not finite).
   * (xl, yl) and (xr, yr) are the nearest known samples before t0 and after t1 (NaN if none).
   */
  seg(
    t0: number,
    x0: number,
    y0: number,
    t1: number,
    x1: number,
    y1: number,
    depth: number,
    xl: number,
    yl: number,
    xr: number,
    yr: number,
  ): void {
    if (this.budget <= 0) {
      this.raw(x1, y1);
      return;
    }
    const ok0 = Number.isFinite(x0) && Number.isFinite(y0);
    const ok1 = Number.isFinite(x1) && Number.isFinite(y1);
    const tm = 0.5 * (t0 + t1);

    if (!ok0 && !ok1) {
      this.ev(tm);
      const xm = this.x;
      const ym = this.y;
      if (!(Number.isFinite(xm) && Number.isFinite(ym))) {
        this.lift();
      } else if (depth >= MAX_DEPTH) {
        this.lift();
        this.put(xm, ym);
        this.lift();
      } else {
        this.seg(t0, x0, y0, tm, xm, ym, depth + 1, xl, yl, x1, y1);
        this.seg(tm, xm, ym, t1, x1, y1, depth + 1, x0, y0, xr, yr);
      }
      return;
    }

    if (ok0 !== ok1) {
      if (depth >= MAX_DEPTH) {
        this.ra = t0;
        this.rb = t1;
        this.edge(t0, x0, y0, t1, x1, y1, ok0);
      } else {
        this.ev(tm);
        const xm = this.x;
        const ym = this.y;
        this.seg(t0, x0, y0, tm, xm, ym, depth + 1, xl, yl, x1, y1);
        this.seg(tm, xm, ym, t1, x1, y1, depth + 1, x0, y0, xr, yr);
      }
      return;
    }

    this.ev(tm);
    const xm = this.x;
    const ym = this.y;
    if (!(Number.isFinite(xm) && Number.isFinite(ym))) {
      if (depth >= MAX_DEPTH) {
        this.ra = t0;
        this.rb = t1;
        this.edge(t0, x0, y0, tm, xm, ym, true);
        this.edge(tm, xm, ym, t1, x1, y1, false);
      } else {
        this.seg(t0, x0, y0, tm, xm, ym, depth + 1, xl, yl, x1, y1);
        this.seg(tm, xm, ym, t1, x1, y1, depth + 1, x0, y0, xr, yr);
      }
      return;
    }

    if (this.beyondOne(x0, y0, xm, ym, x1, y1)) {
      this.put(x1, y1);
      return;
    }

    const len2 = this.chordDev2(x0, y0, xm, ym, x1, y1);
    const dev2 = this.dev2;
    const flat =
      dev2 <= FLAT_PX2 &&
      !this.overshoot &&
      this.even(x0, y0, xm, ym, x1, y1) &&
      len2 <= MAX_SEG_PX2 &&
      !this.corner(xl, yl, x0, y0, xm, ym) &&
      !this.corner(xm, ym, x1, y1, xr, yr) &&
      (depth > 0 || this.probeFlat(t0, x0, y0, t1, x1, y1));
    if (flat) {
      this.put(x1, y1);
    } else if (depth < MAX_DEPTH) {
      this.seg(t0, x0, y0, tm, xm, ym, depth + 1, xl, yl, x1, y1);
      this.seg(tm, xm, ym, t1, x1, y1, depth + 1, x0, y0, xr, yr);
    } else {
      this.chase(t0, x0, y0, tm, xm, ym, t1, x1, y1, xl, yl, xr, yr);
    }
  }

  /** Squared chord length p0 → p1 in px; sets dev2 to the squared distance of pm from it. */
  private chordDev2(x0: number, y0: number, xm: number, ym: number, x1: number, y1: number) {
    const dx = (x1 - x0) * this.kx;
    const dy = (y1 - y0) * this.ky;
    const mx = (xm - x0) * this.kx;
    const my = (ym - y0) * this.ky;
    const len2 = dx * dx + dy * dy;
    let s = len2 > 0 ? (mx * dx + my * dy) / len2 : 0;
    this.overshoot = s < 0 || s > 1;
    s = s < 0 ? 0 : s > 1 ? 1 : s;
    const ex = mx - s * dx;
    const ey = my - s * dy;
    this.dev2 = ex * ex + ey * ey;
    this.overshoot = this.overshoot && this.dev2 > OVERSHOOT_PX2;
    return len2;
  }

  /**
   * The middle sample lies within SPACING_PX of the chord's midpoint. Near a spike along a ray
   * every sample lies on one line, so only their spacing along it shows the spike (this is the
   * explicit sampler's flatness test, per coordinate, with a looser tolerance so that a merely
   * uneven parametrisation costs little).
   */
  private even(x0: number, y0: number, xm: number, ym: number, x1: number, y1: number): boolean {
    const ex = (xm - 0.5 * (x0 + x1)) * this.kx;
    const ey = (ym - 0.5 * (y0 + y1)) * this.ky;
    return ex * ex + ey * ey <= SPACING_PX2;
  }

  /** Grid intervals also check an irrational point (two periods per interval fool the midpoint). */
  private probeFlat(t0: number, x0: number, y0: number, t1: number, x1: number, y1: number) {
    if (this.budget <= 0) return true;
    this.ev(t0 + PHI * (t1 - t0));
    const ex = (this.x - (x0 + PHI * (x1 - x0))) * this.kx;
    const ey = (this.y - (y0 + PHI * (y1 - y0))) * this.ky;
    return ex * ex + ey * ey <= FLAT_PX2;
  }

  /** Over budget: join the samples, but drop chords too long to trust (they cut across). */
  private raw(x1: number, y1: number): void {
    if (!(Number.isFinite(x1) && Number.isFinite(y1))) {
      this.lift();
      return;
    }
    if (this.open && this.dist(this.lx, this.ly, x1, y1) > MAX_SEG_PX) this.lift();
    this.put(x1, y1);
  }

  /**
   * Domain edge inside [t0, t1]: bisect toward the last finite point on the finite side until it
   * settles, leaves the view or reaches adjacent doubles; a point still running off then gets a
   * final point far off screen in its direction.
   */
  private edge(
    t0: number,
    x0: number,
    y0: number,
    t1: number,
    x1: number,
    y1: number,
    leftFinite: boolean,
  ): void {
    let ok = leftFinite ? t0 : t1;
    let xo = leftFinite ? x0 : x1;
    let yo = leftFinite ? y0 : y1;
    let bad = leftFinite ? t1 : t0;
    let moved = Number.POSITIVE_INFINITY;
    let away = false;
    for (let k = 0; k < MAX_STEPS && this.budget > 0; k++) {
      const m = 0.5 * (ok + bad);
      if (m === ok || m === bad) {
        away = this.diverges(ok, ok - bad);
        break;
      }
      this.ev(m);
      if (Number.isFinite(this.x) && Number.isFinite(this.y)) {
        moved = this.dist(xo, yo, this.x, this.y);
        ok = m;
        xo = this.x;
        yo = this.y;
        if (this.off(xo, yo)) break;
      } else {
        bad = m;
      }
      if (k >= EDGE_STEPS && moved < SETTLED_PX) {
        away = this.diverges(ok, ok - bad);
        break;
      }
    }
    const fx = this.farX;
    const fy = this.farY;
    if (leftFinite) {
      if (ok !== t0) this.put(xo, yo);
      if (away) this.put(fx, fy);
      this.lift();
    } else {
      this.lift();
      if (away) this.put(fx, fy);
      if (ok !== t1) this.put(xo, yo);
      this.put(x1, y1);
    }
  }

  /**
   * Whether the curve still runs off toward the point at u, judged from points 2^8, 2^16 and
   * 2^24 steps of h away (inside [ra, rb]): a diverging curve moves at least as far, in about the
   * same direction, over each 256-fold step nearer u, a converging one clearly less. If so, sets
   * farX/farY to a point well off screen in that direction.
   */
  private diverges(u: number, h: number): boolean {
    const u3 = u + h * 16777216;
    if (!(u3 >= this.ra && u3 <= this.rb) || this.budget < 3) return false;
    this.ev(u + h * 256);
    const x1 = this.x;
    const y1 = this.y;
    this.ev(u + h * 65536);
    const x2 = this.x;
    const y2 = this.y;
    this.ev(u3);
    const nx = (x1 - x2) * this.kx;
    const ny = (y1 - y2) * this.ky;
    const fx = (x2 - this.x) * this.kx;
    const fy = (y2 - this.y) * this.ky;
    const near = Math.sqrt(nx * nx + ny * ny);
    const far = Math.sqrt(fx * fx + fy * fy);
    const scale = Math.abs(x2 * this.kx) + Math.abs(y2 * this.ky) + 1;
    if (!(near > 1e-9 * scale && near >= 0.97 * far && nx * fx + ny * fy > 0.9 * near * far)) {
      return false;
    }
    const reach = (2 * this.span) / near;
    this.farX = x1 + (nx / this.kx) * reach;
    this.farY = y1 + (ny / this.ky) * reach;
    return true;
  }

  /** The chase at the depth limit; see sampleExplicit's chase for the reasoning. */
  private chase(
    a: number,
    xa: number,
    ya: number,
    m: number,
    xm0: number,
    ym0: number,
    b: number,
    xb: number,
    yb: number,
    xl: number,
    yl: number,
    xr: number,
    yr: number,
  ): void {
    let lo = a;
    let xlo = xa;
    let ylo = ya;
    let mid = m;
    let xmd = xm0;
    let ymd = ym0;
    let hi = b;
    let xhi = xb;
    let yhi = yb;
    const j0 = Math.max(this.dist(xlo, ylo, xmd, ymd), this.dist(xmd, ymd, xhi, yhi));
    let j = j0;
    let verdict = 0;
    let exact = false;
    let shrunk = 0;
    this.ra = a;
    this.rb = b;
    for (let k = 0; k < MAX_STEPS; k++) {
      if (this.budget < 3) break;
      const q1 = 0.5 * (lo + mid);
      const q3 = 0.5 * (mid + hi);
      if (q1 === lo || q1 === mid || q3 === mid || q3 === hi) {
        exact = true;
        break;
      }
      this.ev(q1);
      const x1 = this.x;
      const y1 = this.y;
      this.ev(q3);
      const x3 = this.x;
      const y3 = this.y;
      if (
        !(Number.isFinite(x1) && Number.isFinite(y1) && Number.isFinite(x3) && Number.isFinite(y3))
      ) {
        this.put(xlo, ylo);
        this.around(lo, xlo, ylo, q1, x1, y1, mid, xmd, ymd);
        this.around(mid, xmd, ymd, q3, x3, y3, hi, xhi, yhi);
        this.put(xb, yb);
        return;
      }
      const cl = this.corner(xl, yl, xlo, ylo, x1, y1);
      const cr = this.corner(x3, y3, xhi, yhi, xr, yr);
      const d1 = Math.hypot((xlo - 2 * x1 + xmd) * this.kx, (ylo - 2 * y1 + ymd) * this.ky);
      const d2 = Math.hypot((x1 - 2 * xmd + x3) * this.kx, (y1 - 2 * ymd + y3) * this.ky);
      const d3 = Math.hypot((xmd - 2 * x3 + xhi) * this.kx, (ymd - 2 * y3 + yhi) * this.ky);
      if (cl !== cr ? cl : d1 > d2 && d1 >= d3) {
        xr = x3;
        yr = y3;
        hi = mid;
        xhi = xmd;
        yhi = ymd;
        mid = q1;
        xmd = x1;
        ymd = y1;
      } else if (cl !== cr ? cr : d3 > d2 && d3 > d1) {
        xl = x1;
        yl = y1;
        lo = mid;
        xlo = xmd;
        ylo = ymd;
        mid = q3;
        xmd = x3;
        ymd = y3;
      } else {
        xl = xlo;
        yl = ylo;
        xr = xhi;
        yr = yhi;
        lo = q1;
        xlo = x1;
        ylo = y1;
        hi = q3;
        xhi = x3;
        yhi = y3;
      }

      if (this.beyondOne(xlo, ylo, xmd, ymd, xhi, yhi)) {
        verdict = CONNECT;
        break;
      }
      const jl = this.dist(xlo, ylo, xmd, ymd);
      const jr = this.dist(xmd, ymd, xhi, yhi);
      j = jl > jr ? jl : jr;
      if (j <= JUMP_PX) {
        verdict = CONNECT;
        break;
      }
      if (
        j >= PERSIST_RATIO * j0 &&
        (this.opposite(xlo, ylo, xmd, ymd) || this.opposite(xmd, ymd, xhi, yhi))
      ) {
        verdict = BREAK;
        break;
      }
      const spike =
        (xmd - xlo) * (xmd - xhi) * this.kx * this.kx +
          (ymd - ylo) * (ymd - yhi) * this.ky * this.ky >
        0;
      if (
        spike ||
        this.corner(xl, yl, xlo, ylo, xmd, ymd) ||
        this.corner(xmd, ymd, xhi, yhi, xr, yr)
      ) {
        shrunk = 0;
        continue;
      }
      if (j < CONTINUOUS_RATIO * j0) {
        if (++shrunk >= 2) {
          verdict = CONNECT;
          break;
        }
      } else {
        shrunk = 0;
      }
      if (
        k >= 6 &&
        j >= PERSIST_RATIO * j0 &&
        this.plateau(lo, xlo, ylo, mid, xmd, ymd, hi, xhi, yhi, jl >= jr)
      ) {
        verdict = BREAK;
        break;
      }
    }

    let extAt = 0;
    if (verdict === 0) {
      const opp = this.opposite(xlo, ylo, xmd, ymd) || this.opposite(xmd, ymd, xhi, yhi);
      if (opp) verdict = BREAK;
      else if (exact) {
        verdict = j > this.span ? BREAK : CONNECT;
        // The sample farthest from the interval's chord, if far and still on screen.
        const dLo = this.offChord(xa, ya, xb, yb, xlo, ylo);
        const dMid = this.offChord(xa, ya, xb, yb, xmd, ymd);
        const dHi = this.offChord(xa, ya, xb, yb, xhi, yhi);
        const at = dMid >= dLo && dMid >= dHi ? 2 : dLo >= dHi ? 1 : 3;
        const u = at === 1 ? lo : at === 2 ? mid : hi;
        const dMax = at === 1 ? dLo : at === 2 ? dMid : dHi;
        const ux = at === 1 ? xlo : at === 2 ? xmd : xhi;
        const uy = at === 1 ? ylo : at === 2 ? ymd : yhi;
        if (dMax > JUMP_PX && !this.off(ux, uy)) {
          const h = at === 3 ? lo - hi : hi - u;
          if (this.diverges(u, h)) {
            verdict = EXTEND;
            extAt = at;
          }
        }
      } else {
        verdict = j > this.span / 2 ? BREAK : CONNECT;
      }
    }

    if (verdict === BREAK) {
      const left =
        this.opposite(xlo, ylo, xmd, ymd) ||
        (!this.opposite(xmd, ymd, xhi, yhi) &&
          this.dist(xlo, ylo, xmd, ymd) >= this.dist(xmd, ymd, xhi, yhi));
      this.put(xlo, ylo);
      if (left) this.lift();
      this.put(xmd, ymd);
      if (!left) this.lift();
      this.put(xhi, yhi);
    } else {
      this.put(xlo, ylo);
      if (extAt === 1) this.put(this.farX, this.farY);
      if (extAt === 1) this.put(xlo, ylo);
      this.put(xmd, ymd);
      if (extAt === 2) this.put(this.farX, this.farY);
      if (extAt === 2) this.put(xmd, ymd);
      this.put(xhi, yhi);
      if (extAt === 3) this.put(this.farX, this.farY);
      if (extAt === 3) this.put(xhi, yhi);
    }
    this.put(xb, yb);
  }

  /** Distance (px) of q from the segment p0 → p1. */
  private offChord(x0: number, y0: number, x1: number, y1: number, qx: number, qy: number) {
    this.chordDev2(x0, y0, qx, qy, x1, y1);
    return Math.sqrt(this.dev2);
  }

  /** Emits (p, r] given q between them, treating a non-finite q as a domain edge. */
  private around(
    p: number,
    xp: number,
    yp: number,
    q: number,
    xq: number,
    yq: number,
    r: number,
    xr: number,
    yr: number,
  ): void {
    if (Number.isFinite(xq) && Number.isFinite(yq)) {
      this.put(xq, yq);
      this.put(xr, yr);
    } else {
      this.edge(p, xp, yp, q, xq, yq, true);
      this.edge(q, xq, yq, r, xr, yr, false);
    }
  }

  /** A persistent jump between flat sides (see sampleExplicit's plateau). */
  private plateau(
    lo: number,
    xlo: number,
    ylo: number,
    mid: number,
    xmd: number,
    ymd: number,
    hi: number,
    xhi: number,
    yhi: number,
    leftJump: boolean,
  ): boolean {
    const u = leftJump ? lo + (mid - lo) / 1024 : hi - (hi - mid) / 1024;
    if (u === lo || u === hi) return false;
    this.ev(u);
    const d = leftJump ? this.dist(xlo, ylo, this.x, this.y) : this.dist(xhi, yhi, this.x, this.y);
    const smooth = leftJump ? this.dist(xmd, ymd, xhi, yhi) : this.dist(xlo, ylo, xmd, ymd);
    return d <= Math.max(FLAT_PX, smooth / 256);
  }
}

function sampleCurve(
  fa: Fn1,
  fb: Fn1 | null,
  tMin: number,
  tMax: number,
  view: Viewport,
  opts: ParametricSampleOptions,
): Polyline {
  if (!Number.isFinite(tMin) || !Number.isFinite(tMax) || !(tMax > tMin)) {
    return new Float64Array(0);
  }
  if (!(view.ppuX > 0 && view.ppuY > 0 && view.width > 0 && view.height > 0)) {
    return new Float64Array(0);
  }
  let loT = tMin;
  let hiT = tMax;
  if (!(hiT - loT <= MAX_PARAMETER_RANGE)) {
    // A window around the parameter value nearest 0, kept inside the range.
    const near0 = loT > 0 ? loT : hiT < 0 ? hiT : 0;
    loT = Math.max(tMin, near0 - MAX_PARAMETER_RANGE / 2);
    hiT = loT + MAX_PARAMETER_RANGE;
    if (hiT > tMax) {
      hiT = tMax;
      loT = hiT - MAX_PARAMETER_RANGE;
    }
    if (!(hiT > loT)) return new Float64Array(0);
  }
  const range = hiT - loT;
  const maxEvals = opts.maxEvals ?? DEFAULT_MAX_EVALS;
  // About 64 intervals per turn, up to a quarter of the budget, so that a long range starts from
  // grid chords short enough to keep once the budget runs out.
  const maxN = Math.max(MIN_N, Math.floor(maxEvals / 4));
  let n = Math.ceil((64 * range) / TAU);
  n = n < MIN_N ? MIN_N : n > maxN ? maxN : n;
  if (opts.quality === 'interactive') n = Math.ceil(n / 2);
  // Interior grid points at (i - 1 + PHI) · h, so the spacing is an irrational fraction of the
  // range and periodic curves cannot alias with it; the ends stay exactly at loT and hiT.
  const h = range / (n - 2 + 2 * PHI);
  const tAt = (i: number) => (i <= 0 ? loT : i >= n ? hiT : loT + h * (i - 1 + PHI));

  const out = new PolylineBuilder(n + 64);
  const s = new CurveSampler(fa, fb, view, out);
  // Spent in order along t, unlike the explicit sampler's shares: t does not map to a screen
  // region, and a curve over a huge range (a circle traced 10^4 times) is best shown by its
  // first, fully refined part rather than by thin coverage of all of it.
  s.budget = maxEvals - (n + 1);

  let t0 = tAt(0);
  s.point(t0);
  let x0 = s.x;
  let y0 = s.y;
  let t1 = tAt(1);
  s.point(t1);
  let x1 = s.x;
  let y1 = s.y;
  let xl = Number.NaN;
  let yl = Number.NaN;
  s.emit(x0, y0);
  for (let i = 1; i <= n; i++) {
    let t2 = Number.NaN;
    let x2 = Number.NaN;
    let y2 = Number.NaN;
    if (i < n) {
      t2 = tAt(i + 1);
      s.point(t2);
      x2 = s.x;
      y2 = s.y;
    }
    s.seg(t0, x0, y0, t1, x1, y1, 0, xl, yl, x2, y2);
    xl = x0;
    yl = y0;
    t0 = t1;
    x0 = x1;
    y0 = y1;
    t1 = t2;
    x1 = x2;
    y1 = y2;
  }
  return out.finish();
}

export function sampleParametric(
  fx: Fn1,
  fy: Fn1,
  tMin: number,
  tMax: number,
  view: Viewport,
  opts: ParametricSampleOptions = {},
): Polyline {
  return sampleCurve(fx, fy, tMin, tMax, view, opts);
}

/** r(θ) as (r cos θ, r sin θ); negative r is drawn through the origin as usual. */
export function samplePolar(
  r: Fn1,
  thetaMin: number,
  thetaMax: number,
  view: Viewport,
  opts: ParametricSampleOptions = {},
): Polyline {
  return sampleCurve(r, null, thetaMin, thetaMax, view, opts);
}
