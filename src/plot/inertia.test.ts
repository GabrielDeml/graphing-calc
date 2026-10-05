import { describe, expect, it } from 'vitest';
import {
  DECAY_MS,
  flingVelocity,
  glideDuration,
  glideOffset,
  MAX_FLING_SPEED,
  MIN_FLING_SPEED,
  recordSample,
  releaseVelocity,
  type Sample,
  STILL_MS,
  STOP_SPEED,
  VELOCITY_WINDOW_MS,
} from './inertia';

/** A drag moving at (vx, vy) px/s, sampled every `every` ms for `ms` ms, starting at t0. */
function drag(vx: number, vy: number, ms: number, every = 16, t0 = 1000): Sample[] {
  const samples: Sample[] = [];
  for (let t = 0; t <= ms; t += every) {
    recordSample(samples, { x: (vx * t) / 1000, y: (vy * t) / 1000, t: t0 + t });
  }
  return samples;
}

describe('recordSample', () => {
  it('keeps only what lies within the velocity window of the newest sample', () => {
    const samples = drag(500, 0, 400);
    const last = samples[samples.length - 1];
    expect(samples.length).toBeGreaterThan(2);
    for (const s of samples) expect(last.t - s.t).toBeLessThanOrEqual(VELOCITY_WINDOW_MS);
  });

  it('keeps the newest sample however old the rest are', () => {
    const samples: Sample[] = [{ x: 0, y: 0, t: 0 }];
    recordSample(samples, { x: 5, y: 5, t: 10_000 });
    expect(samples).toEqual([{ x: 5, y: 5, t: 10_000 }]);
  });
});

describe('releaseVelocity', () => {
  it('measures a steady drag', () => {
    const samples = drag(800, -300, 200);
    const v = releaseVelocity(samples, samples[samples.length - 1].t + 5);
    expect(v.vx).toBeCloseTo(800, 6);
    expect(v.vy).toBeCloseTo(-300, 6);
  });

  it('evens out jitter in single moves', () => {
    const samples: Sample[] = [];
    for (let i = 0; i <= 10; i++) {
      const wobble = i % 2 === 0 ? 2 : -2;
      recordSample(samples, { x: i * 10 + wobble, y: 0, t: i * 10 });
    }
    // 10 px every 10 ms: 1000 px/s, give or take the wobble.
    expect(releaseVelocity(samples, 100).vx).toBeGreaterThan(900);
    expect(releaseVelocity(samples, 100).vx).toBeLessThan(1100);
  });

  it('reads the end of a drag that sped up, not its slow start', () => {
    const samples = drag(100, 0, 400);
    const end = samples[samples.length - 1];
    for (let i = 1; i <= 6; i++) {
      recordSample(samples, { x: end.x + i * 16, y: 0, t: end.t + i * 16 });
    }
    const t = samples[samples.length - 1].t;
    expect(releaseVelocity(samples, t).vx).toBeGreaterThan(800);
  });

  it('is zero when the pointer stopped before it lifted', () => {
    const samples = drag(1000, 0, 200);
    const last = samples[samples.length - 1].t;
    expect(releaseVelocity(samples, last + STILL_MS + 1)).toEqual({ vx: 0, vy: 0 });
    expect(releaseVelocity(samples, last + STILL_MS).vx).toBeCloseTo(1000, 6);
  });

  it('is zero with too little to tell', () => {
    expect(releaseVelocity([], 0)).toEqual({ vx: 0, vy: 0 });
    expect(releaseVelocity([{ x: 1, y: 1, t: 5 }], 5)).toEqual({ vx: 0, vy: 0 });
    // Two moves at one instant.
    const same = [
      { x: 0, y: 0, t: 5 },
      { x: 30, y: 0, t: 5 },
    ];
    expect(releaseVelocity(same, 5)).toEqual({ vx: 0, vy: 0 });
  });

  it('is zero for non-finite samples', () => {
    const samples = [
      { x: 0, y: 0, t: 0 },
      { x: Number.NaN, y: 0, t: 10 },
    ];
    expect(releaseVelocity(samples, 10)).toEqual({ vx: 0, vy: 0 });
  });
});

describe('flingVelocity', () => {
  it('flings a quick release', () => {
    const samples = drag(0, 1200, 120);
    const v = flingVelocity(samples, samples[samples.length - 1].t);
    expect(v?.vy).toBeCloseTo(1200, 6);
  });

  it('puts the view down after a slow drag or a pause', () => {
    const slow = drag(MIN_FLING_SPEED / 2, 0, 200);
    expect(flingVelocity(slow, slow[slow.length - 1].t)).toBeNull();
    const paused = drag(2000, 0, 200);
    expect(flingVelocity(paused, paused[paused.length - 1].t + 100)).toBeNull();
  });

  it('caps a flick, keeping its direction', () => {
    const samples = drag(30_000, 40_000, 64, 8);
    const v = flingVelocity(samples, samples[samples.length - 1].t);
    if (!v) throw new Error('no fling');
    expect(Math.hypot(v.vx, v.vy)).toBeCloseTo(MAX_FLING_SPEED, 6);
    expect(v.vy / v.vx).toBeCloseTo(4 / 3, 6);
  });
});

describe('the glide', () => {
  it('slows down exponentially and stops once slower than STOP_SPEED', () => {
    const v = { vx: 1000, vy: 0 };
    const ms = glideDuration(v);
    expect(ms).toBeCloseTo(DECAY_MS * Math.log(1000 / STOP_SPEED), 6);
    // Its speed at the end (the offset's slope) is STOP_SPEED.
    const step = 0.01;
    const speed = ((glideOffset(v, ms + step).x - glideOffset(v, ms).x) / step) * 1000;
    expect(speed).toBeCloseTo(STOP_SPEED, 2);
  });

  it('starts at the release velocity and moves monotonically, slowing down', () => {
    const v = { vx: -600, vy: 800 };
    expect(glideOffset(v, 0)).toEqual({ x: -0, y: 0 });
    const early = glideOffset(v, 1);
    expect(early.x * 1000).toBeCloseTo(-600, -1);
    expect(early.y * 1000).toBeCloseTo(800, -1);
    let last = glideOffset(v, 0);
    let lastStep = Number.POSITIVE_INFINITY;
    for (let t = 16; t <= glideDuration(v); t += 16) {
      const at = glideOffset(v, t);
      const step = Math.hypot(at.x - last.x, at.y - last.y);
      expect(step).toBeGreaterThan(0);
      expect(step).toBeLessThan(lastStep);
      // Always along the release direction.
      expect(at.y / at.x).toBeCloseTo(-4 / 3, 9);
      lastStep = step;
      last = at;
    }
  });

  it('carries the view about velocity × decay time in all', () => {
    const v = { vx: 2000, vy: 0 };
    const total = glideOffset(v, glideDuration(v)).x;
    expect(total).toBeLessThan((2000 * DECAY_MS) / 1000);
    expect(total).toBeGreaterThan((2000 * DECAY_MS) / 1000 - (STOP_SPEED * DECAY_MS) / 1000 - 1);
  });

  it('does not glide when too slow, nor go back in time', () => {
    expect(glideDuration({ vx: STOP_SPEED / 2, vy: 0 })).toBe(0);
    expect(glideDuration({ vx: 0, vy: 0 })).toBe(0);
    expect(glideOffset({ vx: 500, vy: 0 }, -50)).toEqual({ x: 0, y: 0 });
  });
});
