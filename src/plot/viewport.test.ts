import { describe, expect, it } from 'vitest';
import { computeTicks } from './ticks';
import type { Viewport } from './types';
import {
  clampViewport,
  homeViewport,
  lerpViewport,
  MAX_CENTER,
  MAX_PPU,
  MAX_PRECISION,
  MIN_PPU,
  panBy,
  pinchViewport,
  resizeViewport,
  toScreenX,
  toScreenY,
  toWorldX,
  toWorldY,
  viewBounds,
  viewKey,
  wheelZoomFactor,
  zoomAt,
} from './viewport';

const base: Viewport = { cx: 1, cy: -2, ppuX: 50, ppuY: 50, width: 800, height: 600 };

describe('homeViewport', () => {
  it('centers on the origin with 20 units across the short side', () => {
    expect(homeViewport(800, 600)).toEqual({
      cx: 0,
      cy: 0,
      ppuX: 30,
      ppuY: 30,
      width: 800,
      height: 600,
    });
    const v = homeViewport(400, 1000);
    expect(v.ppuX).toBe(20);
    const b = viewBounds(v);
    expect(b.xmin).toBe(-10);
    expect(b.xmax).toBe(10);
  });

  it('falls back to 40 px per unit when there is no size', () => {
    expect(homeViewport(0, 0).ppuX).toBe(40);
    expect(homeViewport(0, 500).ppuY).toBe(40);
  });
});

describe('transforms', () => {
  it('maps the center to the middle of the screen with y up', () => {
    expect(toScreenX(base, 1)).toBe(400);
    expect(toScreenY(base, -2)).toBe(300);
    expect(toScreenX(base, 2)).toBe(450);
    expect(toScreenY(base, -1)).toBe(250);
  });

  it('round-trips screen and world coordinates', () => {
    for (const s of [0, 123.25, 800]) {
      expect(toScreenX(base, toWorldX(base, s))).toBeCloseTo(s, 9);
      expect(toScreenY(base, toWorldY(base, s))).toBeCloseTo(s, 9);
    }
  });

  it('computes the visible bounds', () => {
    expect(viewBounds(base)).toEqual({ xmin: -7, xmax: 9, ymin: -8, ymax: 4 });
  });
});

describe('zoomAt', () => {
  it('keeps the world point under the cursor fixed', () => {
    const sx = 123;
    const sy = 456;
    const wx = toWorldX(base, sx);
    const wy = toWorldY(base, sy);
    for (const factor of [2, 0.5, 1.37]) {
      const v = zoomAt(base, sx, sy, factor);
      expect(v.ppuX).toBeCloseTo(50 * factor, 9);
      expect(toWorldX(v, sx)).toBeCloseTo(wx, 9);
      expect(toWorldY(v, sy)).toBeCloseTo(wy, 9);
    }
  });

  it('clamps ppu and keeps the cursor point fixed at the clamp', () => {
    const v = zoomAt(base, 100, 100, 1e20);
    expect(v.ppuX).toBe(MAX_PPU);
    expect(toWorldX(v, 100)).toBeCloseTo(toWorldX(base, 100), 9);
    expect(zoomAt(base, 0, 0, 1e-20).ppuX).toBe(MIN_PPU);
  });

  it('ignores invalid factors', () => {
    expect(zoomAt(base, 0, 0, 0)).toBe(base);
    expect(zoomAt(base, 0, 0, Number.NaN)).toBe(base);
    expect(zoomAt(base, 0, 0, -2)).toBe(base);
  });

  it('returns the same view for a no-op zoom (factor 1, or already at the limit)', () => {
    const v: Viewport = { cx: 0.1, cy: -0.3, ppuX: 37.3, ppuY: 37.3, width: 813, height: 611 };
    for (let sx = 0; sx <= 813; sx += 7) {
      const z = zoomAt(v, sx, 123.4, 1);
      expect(z).toBe(v);
      expect(viewKey(z)).toBe(viewKey(v));
    }
    expect(zoomAt(v, 10, 10, wheelZoomFactor(0, 0, false, 800))).toBe(v);
    const maxed = { ...base, cx: 0, cy: 0, ppuX: MAX_PPU, ppuY: MAX_PPU };
    expect(zoomAt(maxed, 17, 33, 2)).toBe(maxed);
    const mined = { ...base, ppuX: MIN_PPU, ppuY: MIN_PPU };
    expect(zoomAt(mined, 17, 33, 0.5)).toBe(mined);
  });
});

describe('precision limit', () => {
  it('limits ppu so one ulp of the center stays well below a pixel', () => {
    const v = clampViewport({ cx: 1e6, cy: 0, ppuX: 1e12, ppuY: 1e12, width: 800, height: 600 });
    expect(v.ppuX).toBe(MAX_PRECISION / 1e6);
    expect(v.ppuY).toBe(v.ppuX);
    const w = clampViewport({ cx: 3, cy: -1e9, ppuX: 1e9, ppuY: 1e9, width: 800, height: 600 });
    expect(w.ppuX).toBe(MAX_PRECISION / 1e9);
    expect(w.ppuY).toBe(w.ppuX);
    // Near the origin the absolute limit still applies.
    expect(clampViewport({ ...base, cx: 0.5, ppuX: 1e13, ppuY: 1e13 }).ppuX).toBe(MAX_PPU);
  });

  it('keeps zooming in at x = 1e6 from producing views that hang the tick code', () => {
    // The reported gesture: zoom far out, then wheel-zoom in with the cursor over x = 1e6.
    let v = homeViewport(800, 600);
    for (let i = 0; i < 19; i++) v = zoomAt(v, 400, 300, 0.5);
    for (let i = 0; i < 200; i++) {
      const sx = Math.min(800, Math.max(0, 400 + (1e6 - v.cx) * v.ppuX));
      v = zoomAt(v, sx, 300, 2);
    }
    expect(Math.abs(v.cx) * v.ppuX).toBeLessThanOrEqual(MAX_PRECISION * (1 + 1e-12));
    const b = viewBounds(v);
    const t0 = performance.now();
    const t = computeTicks(b.xmin, b.xmax, v.ppuX);
    expect(performance.now() - t0).toBeLessThan(50);
    expect(t.major.length).toBeGreaterThan(2);
  });

  it('pans by the requested distance far from the origin', () => {
    for (const cx of [1, 1e3, 1e5, 1e9, -1e12]) {
      let v = clampViewport({ cx, cy: 0, ppuX: 1e12, ppuY: 1e12, width: 800, height: 600 });
      const start = v.cx;
      for (let i = 0; i < 100; i++) v = panBy(v, -1, 0);
      const moved = (v.cx - start) * v.ppuX;
      expect(moved).toBeGreaterThan(90);
      expect(moved).toBeLessThan(110);
    }
  });
});

describe('panBy', () => {
  it('moves the content with the pointer', () => {
    const v = panBy(base, 50, -100);
    // The world point that was at screen (400, 300) is now at (450, 200).
    expect(toScreenX(v, 1)).toBeCloseTo(450, 9);
    expect(toScreenY(v, -2)).toBeCloseTo(200, 9);
    expect(v.ppuX).toBe(base.ppuX);
  });

  it('clamps the center', () => {
    const far = panBy({ ...base, ppuX: MIN_PPU, ppuY: MIN_PPU }, -1e9, -1e9);
    expect(far.cx).toBe(MAX_CENTER);
    expect(far.cy).toBe(-MAX_CENTER);
  });
});

describe('resizeViewport and clampViewport', () => {
  it('keeps center and scale on resize', () => {
    const v = resizeViewport(base, 1000, 200);
    expect(v).toEqual({ ...base, width: 1000, height: 200 });
  });

  it('repairs invalid values and returns valid views unchanged', () => {
    expect(clampViewport(base)).toBe(base);
    const v = clampViewport({
      cx: Number.NaN,
      cy: 1e20,
      ppuX: Number.NaN,
      ppuY: 0,
      width: -5,
      height: Number.NaN,
    });
    expect(v).toEqual({ cx: 0, cy: MAX_CENTER, ppuX: 40, ppuY: MIN_PPU, width: 0, height: 0 });
  });
});

describe('pinchViewport', () => {
  it('zooms about the centroid when fingers spread symmetrically', () => {
    const c = { x: 300, y: 200 };
    const w = { x: toWorldX(base, c.x), y: toWorldY(base, c.y) };
    const v = pinchViewport(
      base,
      { x: 250, y: 200 },
      { x: 350, y: 200 },
      { x: 200, y: 200 },
      { x: 400, y: 200 },
    );
    expect(v.ppuX).toBeCloseTo(100, 9);
    expect(toWorldX(v, c.x)).toBeCloseTo(w.x, 9);
    expect(toWorldY(v, c.y)).toBeCloseTo(w.y, 9);
  });

  it('pans with the centroid and keeps the grabbed point under the fingers', () => {
    const a0 = { x: 100, y: 100 };
    const b0 = { x: 200, y: 300 };
    const a1 = { x: 140, y: 80 };
    const b1 = { x: 320, y: 440 };
    const grabbed = { x: toWorldX(base, 150), y: toWorldY(base, 200) };
    const v = pinchViewport(base, a0, b0, a1, b1);
    const ratio = Math.hypot(180, 360) / Math.hypot(100, 200);
    expect(v.ppuX).toBeCloseTo(50 * ratio, 9);
    expect(toScreenX(v, grabbed.x)).toBeCloseTo(230, 9);
    expect(toScreenY(v, grabbed.y)).toBeCloseTo(260, 9);
  });

  it('only pans when a distance is zero', () => {
    const p = { x: 100, y: 100 };
    const v = pinchViewport(base, p, p, { x: 110, y: 90 }, { x: 110, y: 90 });
    expect(v.ppuX).toBe(base.ppuX);
    expect(v).toEqual(panBy(base, 10, -10));
  });
});

describe('wheelZoomFactor', () => {
  it('zooms in on negative deltas and out on positive ones', () => {
    expect(wheelZoomFactor(-100, 0, false, 800)).toBeCloseTo(Math.exp(0.15), 12);
    expect(wheelZoomFactor(100, 0, false, 800)).toBeCloseTo(Math.exp(-0.15), 12);
    expect(wheelZoomFactor(0, 0, false, 800)).toBe(1);
  });

  it('normalizes line and page delta modes', () => {
    expect(wheelZoomFactor(3, 1, false, 800)).toBeCloseTo(Math.exp(-48 * 0.0015), 12);
    expect(wheelZoomFactor(0.25, 2, false, 800)).toBeCloseTo(Math.exp(-200 * 0.0015), 12);
  });

  it('responds more strongly to ctrl+wheel (trackpad pinch)', () => {
    expect(wheelZoomFactor(-10, 0, true, 800)).toBeCloseTo(Math.exp(0.1), 12);
  });

  it('clamps to [0.5, 2] per event', () => {
    expect(wheelZoomFactor(-10000, 0, false, 800)).toBe(2);
    expect(wheelZoomFactor(10000, 0, false, 800)).toBe(0.5);
    expect(wheelZoomFactor(Number.NaN, 0, false, 800)).toBe(1);
  });
});

describe('lerpViewport', () => {
  it('interpolates ppu geometrically and returns the end views', () => {
    const a = { ...base, cx: 0, cy: 0, ppuX: 10, ppuY: 10 };
    const b = { ...base, cx: 4, cy: -2, ppuX: 1000, ppuY: 1000 };
    expect(lerpViewport(a, b, 0)).toBe(a);
    expect(lerpViewport(a, b, 1)).toBe(b);
    const mid = lerpViewport(a, b, 0.5);
    expect(mid.ppuX).toBeCloseTo(100, 9);
    expect(mid.width).toBe(base.width);
  });

  it('keeps the double-click zoom point under the cursor throughout', () => {
    const v = homeViewport(1600, 900);
    for (const sx of [800, 900, 1100, 1300, 1500, 0]) {
      for (const factor of [2, 0.5]) {
        const target = zoomAt(v, sx, 450, factor);
        const wx = toWorldX(v, sx);
        for (let k = 0; k <= 20; k++) {
          const m = lerpViewport(v, target, k / 20);
          expect(Math.abs(toScreenX(m, wx) - sx)).toBeLessThan(1e-6);
        }
      }
    }
  });

  it('moves centers linearly when the scale does not change', () => {
    const a = { ...base, cx: 0, cy: 0 };
    const b = { ...base, cx: 4, cy: -2 };
    const mid = lerpViewport(a, b, 0.5);
    expect(mid.cx).toBeCloseTo(2, 12);
    expect(mid.cy).toBeCloseTo(-1, 12);
    expect(mid.ppuX).toBeCloseTo(base.ppuX, 12);
  });

  it('does not animate the size, and keeps a resize made during the animation', () => {
    const from = homeViewport(800, 600);
    const target = zoomAt(from, 400, 300, 2);
    let view = lerpViewport(from, target, 0.3);
    view = resizeViewport(view, 800, 900);
    for (const t of [0.6, 1]) {
      view = lerpViewport(from, target, t, view);
      expect(view.width).toBe(800);
      expect(view.height).toBe(900);
    }
    expect(view.ppuX).toBe(target.ppuX);
    expect(view.cx).toBe(target.cx);
    // Without a size the target's size is used, never an interpolated one.
    const wide = { ...target, width: 1000 };
    expect(lerpViewport(from, wide, 0.5).width).toBe(1000);
  });
});

describe('viewKey', () => {
  it('distinguishes views and is stable', () => {
    expect(viewKey(base)).toBe(viewKey({ ...base }));
    expect(viewKey(base)).not.toBe(viewKey({ ...base, cx: 1.0000001 }));
    expect(viewKey(base)).not.toBe(viewKey({ ...base, width: 801 }));
  });
});
