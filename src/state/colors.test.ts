import { describe, expect, it } from 'vitest';
import {
  type ColorUse,
  colorChanges,
  PALETTE_DARK,
  PALETTE_LIGHT,
  PALETTE_NAMES,
  PALETTE_SIZE,
  pickColor,
} from './colors';

const [RED, BLUE, GREEN, PURPLE, ORANGE, TEAL] = [0, 1, 2, 3, 4, 5];

describe('pickColor', () => {
  it('curves typed one after another get red, blue, green…', () => {
    const used: number[] = [];
    for (let i = 0; i < PALETTE_SIZE; i++) used.push(pickColor(used));
    expect(used).toEqual([RED, BLUE, GREEN, PURPLE, ORANGE, TEAL]);
    expect(PALETTE_NAMES[used[0]]).toBe('Red');
  });

  it('the first curve is red, whatever rows come before it', () => {
    // `a = 1` above `y = a x`: the slider holds no color, so nothing is used yet.
    expect(pickColor([])).toBe(RED);
  });

  it('takes the least-used color, ties going to the first in palette order', () => {
    // The first curve was recolored blue: red is free again.
    expect(pickColor([BLUE])).toBe(RED);
    // Red, blue, green, then the red curve deleted.
    expect(pickColor([BLUE, GREEN])).toBe(RED);
    expect(pickColor([RED, BLUE, GREEN])).toBe(PURPLE);
    // Every color taken once: round again from red.
    expect(pickColor([RED, BLUE, GREEN, PURPLE, ORANGE, TEAL])).toBe(RED);
    // Two reds and one of everything else.
    expect(pickColor([RED, RED, BLUE, GREEN, PURPLE, ORANGE, TEAL])).toBe(BLUE);
    expect(pickColor([TEAL, TEAL, RED, BLUE, GREEN, PURPLE, ORANGE, RED])).toBe(BLUE);
  });

  it('ignores out-of-range entries (rows without a color)', () => {
    expect(pickColor([-1, -1, 99])).toBe(RED);
  });
});

describe('colorChanges', () => {
  /** Rows as `[colorIndex, use]`, with the changes applied, as the colors they end up with. */
  const settle = (rows: [number, ColorUse][]) => {
    const colors = rows.map(([c]) => c);
    for (const [i, c] of colorChanges(rows.map(([colorIndex, use]) => ({ colorIndex, use })))) {
      colors[i] = c;
    }
    return colors;
  };

  it('colors curves as they start to plot, red first, skipping rows that draw nothing', () => {
    // `a = 1`, then `y = a x`, `y = x`, `y = 2`, typed in order.
    expect(
      settle([
        [-1, 'none'],
        [-1, 'plots'],
      ]),
    ).toEqual([-1, RED]);
    expect(
      settle([
        [-1, 'none'],
        [RED, 'plots'],
        [-1, 'plots'],
        [-1, 'plots'],
      ]),
    ).toEqual([-1, RED, BLUE, GREEN]);
  });

  it('keeps the color of a curve that is broken for now', () => {
    expect(
      settle([
        [RED, 'broken'],
        [-1, 'plots'],
      ]),
    ).toEqual([RED, BLUE]);
  });

  it('takes the color back from a row that stops drawing (a curve turned slider)', () => {
    // `y = x` (red) becomes `b = 2`: red is free for the next curve…
    expect(
      settle([
        [RED, 'none'],
        [-1, 'plots'],
      ]),
    ).toEqual([-1, RED]);
    // …and when the row is a curve again, it picks a color nobody uses.
    expect(
      settle([
        [-1, 'plots'],
        [RED, 'plots'],
      ]),
    ).toEqual([BLUE, RED]);
  });

  it('changes nothing once every row is settled', () => {
    expect(
      colorChanges([
        { colorIndex: RED, use: 'plots' },
        { colorIndex: -1, use: 'none' },
        { colorIndex: BLUE, use: 'broken' },
      ]),
    ).toEqual([]);
  });
});

describe('palettes', () => {
  it('pair every light color with a dark one and its own name', () => {
    expect(PALETTE_DARK).toHaveLength(PALETTE_SIZE);
    expect(PALETTE_NAMES).toHaveLength(PALETTE_SIZE);
    expect(new Set(PALETTE_NAMES).size).toBe(PALETTE_SIZE);
    expect(PALETTE_NAMES[TEAL]).toBe('Teal');
  });

  const rgb = (hex: string) => [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16));

  // Curves are told apart by color, on screen and in the e2e suite, which counts pixels within
  // 40 per channel of a color.
  it.each([
    ['light', PALETTE_LIGHT],
    ['dark', PALETTE_DARK],
  ])('keeps the %s colors more than 40 apart in some channel', (_, palette) => {
    for (let i = 0; i < palette.length; i++) {
      for (let j = i + 1; j < palette.length; j++) {
        const [a, b] = [rgb(palette[i]), rgb(palette[j])];
        const apart = Math.max(...a.map((v, k) => Math.abs(v - b[k])));
        expect(apart, `${PALETTE_NAMES[i]} / ${PALETTE_NAMES[j]}`).toBeGreaterThan(40);
      }
    }
  });
});
