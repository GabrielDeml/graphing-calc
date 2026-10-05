import { describe, expect, it } from 'vitest';
import type { Viewport } from '../plot/types';
import { drawGrid, labelStride, minorGridAlpha } from './drawGrid';
import type { Theme } from './theme';

const theme: Theme = {
  dark: false,
  background: '#fff',
  gridMinor: '#eee',
  gridMajor: '#ddd',
  axis: '#333',
  label: '#333',
  palette: ['#c74440'],
};

interface Label {
  text: string;
  x: number;
  y: number;
  width: number;
  align: string;
}

/** Just enough of a 2D context to record the labels drawGrid writes (7px per character). */
function recordingContext() {
  const labels: Label[] = [];
  const state = { textAlign: 'left' };
  const ctx = new Proxy(state, {
    get(target, prop) {
      if (prop === 'measureText') return (text: string) => ({ width: text.length * 7 });
      if (prop === 'fillText') {
        return (text: string, x: number, y: number) =>
          labels.push({ text, x, y, width: text.length * 7, align: target.textAlign });
      }
      if (prop in target) return target[prop as keyof typeof target];
      return () => {};
    },
    set(target, prop, value) {
      (target as Record<string | symbol, unknown>)[prop] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, labels };
}

function xLabels(view: Viewport): Label[] {
  const { ctx, labels } = recordingContext();
  drawGrid(ctx, view, theme, { x: 2, y: 2 });
  return labels.filter((l) => l.align === 'center');
}

function assertReadable(labels: Label[], width: number) {
  const sorted = [...labels].sort((a, b) => a.x - b.x);
  for (const l of sorted) {
    expect(l.x - l.width / 2).toBeGreaterThanOrEqual(0);
    expect(l.x + l.width / 2).toBeLessThanOrEqual(width);
  }
  for (let i = 1; i < sorted.length; i++) {
    const gap = sorted[i].x - sorted[i].width / 2 - (sorted[i - 1].x + sorted[i - 1].width / 2);
    expect(gap).toBeGreaterThan(0);
  }
}

describe('minorGridAlpha', () => {
  it('hides dense minor lines and shows sparse ones in full', () => {
    expect(minorGridAlpha(4)).toBe(0);
    expect(minorGridAlpha(8)).toBe(0);
    expect(minorGridAlpha(24)).toBe(1);
    expect(minorGridAlpha(60)).toBe(1);
  });

  it('fades in between, never decreasing as the lines spread', () => {
    let last = 0;
    for (let px = 8; px <= 24; px += 0.5) {
      const a = minorGridAlpha(px);
      expect(a).toBeGreaterThanOrEqual(last);
      expect(a).toBeLessThanOrEqual(1);
      last = a;
    }
    expect(minorGridAlpha(16)).toBeCloseTo(0.5);
  });

  it('draws nothing for unusable spacings', () => {
    expect(minorGridAlpha(Number.NaN)).toBe(0);
    expect(minorGridAlpha(-5)).toBe(0);
  });
});

describe('labelStride', () => {
  it('labels every tick when they fit', () => {
    expect(labelStride(1, 100, 20)).toBe(1);
  });
  it('skips to a coarser 1-2-5 step when labels are wider than the spacing', () => {
    expect(labelStride(1e-6, 64.5, 73)).toBe(2); // 2e-6
    expect(labelStride(2e-6, 64.5, 73)).toBe(5); // 1e-5, not 4e-6
    expect(labelStride(5e-6, 64.5, 73)).toBe(2); // 1e-5
    expect(labelStride(2, 63, 200)).toBe(5);
  });
});

describe('drawGrid x labels', () => {
  it('stay apart when zoomed in far from the origin', () => {
    // About 2.9e-6 wide around x = 13.6: labels like "13.5999980" outgrow the tick spacing.
    const width = 920;
    const view: Viewport = {
      cx: 13.6,
      cy: 0,
      ppuX: width / 2.9e-6,
      ppuY: width / 2.9e-6,
      width,
      height: 800,
    };
    const labels = xLabels(view);
    expect(labels.length).toBeGreaterThan(2);
    assertReadable(labels, width);
  });

  it('stay apart far from the origin at large magnitudes', () => {
    const width = 920;
    const ppu = width / 2.9e-4;
    const labels = xLabels({ cx: 123289.6, cy: 0, ppuX: ppu, ppuY: ppu, width, height: 800 });
    expect(labels.length).toBeGreaterThan(2);
    assertReadable(labels, width);
  });

  it('keep every tick labelled at the home view, without cutting any off at the edges', () => {
    const width = 920;
    const labels = xLabels({ cx: 0, cy: 0, ppuX: 40, ppuY: 40, width, height: 800 });
    // Major ticks every 2 units across ±11.5, minus 0 and the clipped ones.
    expect(labels.map((l) => l.text)).toEqual([
      '-10',
      '-8',
      '-6',
      '-4',
      '-2',
      '2',
      '4',
      '6',
      '8',
      '10',
    ]);
    assertReadable(labels, width);
  });
});
