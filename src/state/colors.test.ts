import { describe, expect, it } from 'vitest';
import { PALETTE_NAMES, PALETTE_SIZE, pickColor } from './colors';

const [RED, BLUE, GREEN, PURPLE, ORANGE, BLACK] = [0, 1, 2, 3, 4, 5];

describe('pickColor', () => {
  it('curves typed one after another get red, blue, green…', () => {
    const used: number[] = [];
    for (let i = 0; i < PALETTE_SIZE; i++) used.push(pickColor(used));
    expect(used).toEqual([RED, BLUE, GREEN, PURPLE, ORANGE, BLACK]);
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
    expect(pickColor([RED, BLUE, GREEN, PURPLE, ORANGE, BLACK])).toBe(RED);
    // Two reds and one of everything else.
    expect(pickColor([RED, RED, BLUE, GREEN, PURPLE, ORANGE, BLACK])).toBe(BLUE);
    expect(pickColor([BLACK, BLACK, RED, BLUE, GREEN, PURPLE, ORANGE, RED])).toBe(BLUE);
  });

  it('ignores out-of-range entries (rows without a color)', () => {
    expect(pickColor([-1, -1, 99])).toBe(RED);
  });
});
