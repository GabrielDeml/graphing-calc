// Fling inertia for panning the graph with a finger or a pen: the velocity a drag is released
// with, and the glide after it, which slows down exponentially (like a scrolled page) and stops
// once it is barely moving. Times are ms, positions CSS px, velocities px per second.

/** Where the pointer was, and when. */
export interface Sample {
  x: number;
  y: number;
  t: number;
}

export interface Velocity {
  vx: number;
  vy: number;
}

/** Only the last this-many ms of a drag count towards the velocity it is released with. */
export const VELOCITY_WINDOW_MS = 100;
/** A pointer that hasn't moved for this long before it lifts had stopped there: no fling. */
export const STILL_MS = 40;
/** The glide's speed falls to 1/e every this many ms. */
export const DECAY_MS = 325;
/** The glide stops once it is slower than this. */
export const STOP_SPEED = 20;
/** A release slower than this puts the view down where it is (a slow, careful drag). */
export const MIN_FLING_SPEED = 100;
/** A flick faster than this glides as if it were this fast (a few screens at most). */
export const MAX_FLING_SPEED = 6000;

/** An event stamped further than this from now is on some other clock. */
const STAMP_RANGE_MS = 10_000;

/**
 * When an input happened, on performance.now()'s clock: the event's own time stamp, so a fling
 * reads how the finger moved, not how late a slow frame (a heavy curve drawing) let the page
 * handle its events. `now` where the stamp is missing or on some other clock.
 */
export function inputTime(stamp: number, now: number): number {
  return stamp > 0 && Math.abs(now - stamp) < STAMP_RANGE_MS ? stamp : now;
}

/** Add a sample, dropping those too old to count towards the velocity. */
export function recordSample(samples: Sample[], sample: Sample): void {
  samples.push(sample);
  let old = 0;
  while (old < samples.length - 1 && samples[old].t < sample.t - VELOCITY_WINDOW_MS) old++;
  if (old > 0) samples.splice(0, old);
}

/**
 * The velocity of a drag released at `now`: the least-squares slope of its last samples (within
 * VELOCITY_WINDOW_MS of the last one), which evens out the jitter of single moves. Zero when the
 * pointer had stopped (no move in the last STILL_MS) or there is too little to tell.
 */
export function releaseVelocity(samples: readonly Sample[], now: number): Velocity {
  const none = { vx: 0, vy: 0 };
  const last = samples[samples.length - 1];
  if (!last || now - last.t > STILL_MS) return none;
  const recent = samples.filter((s) => s.t >= last.t - VELOCITY_WINDOW_MS);
  if (recent.length < 2) return none;
  const n = recent.length;
  let mt = 0;
  let mx = 0;
  let my = 0;
  for (const s of recent) {
    mt += s.t / n;
    mx += s.x / n;
    my += s.y / n;
  }
  let stt = 0;
  let stx = 0;
  let sty = 0;
  for (const s of recent) {
    const dt = s.t - mt;
    stt += dt * dt;
    stx += dt * (s.x - mx);
    sty += dt * (s.y - my);
  }
  // All at one instant: no telling how fast.
  if (!(stt > 1e-9)) return none;
  const vx = (stx / stt) * 1000;
  const vy = (sty / stt) * 1000;
  return Number.isFinite(vx) && Number.isFinite(vy) ? { vx, vy } : none;
}

/**
 * The velocity to glide with after a drag released at `now`, or null when it should stop where
 * it is (released slowly, or after a pause). Capped at MAX_FLING_SPEED.
 */
export function flingVelocity(samples: readonly Sample[], now: number): Velocity | null {
  const v = releaseVelocity(samples, now);
  const speed = Math.hypot(v.vx, v.vy);
  if (!(speed >= MIN_FLING_SPEED)) return null;
  const k = speed > MAX_FLING_SPEED ? MAX_FLING_SPEED / speed : 1;
  return { vx: v.vx * k, vy: v.vy * k };
}

/** How long a glide at this velocity lasts until it is slower than STOP_SPEED (ms). */
export function glideDuration(v: Velocity): number {
  const speed = Math.hypot(v.vx, v.vy);
  return speed > STOP_SPEED ? DECAY_MS * Math.log(speed / STOP_SPEED) : 0;
}

/** How far (px) a glide at this velocity has carried the view `ms` after it started. */
export function glideOffset(v: Velocity, ms: number): { x: number; y: number } {
  const t = ms > 0 ? ms : 0;
  const k = (DECAY_MS / 1000) * (1 - Math.exp(-t / DECAY_MS));
  return { x: v.vx * k, y: v.vy * k };
}
