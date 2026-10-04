// Rows store a palette index, not a color, so the palette can be remapped for dark mode.
export const PALETTE_LIGHT = ['#c74440', '#2d70b3', '#388c46', '#6042a6', '#fa7e19', '#000000'];
export const PALETTE_DARK = ['#f0605b', '#5ea4f0', '#5cbd6c', '#a487f0', '#ffa04d', '#e6e8ec'];
export const PALETTE_SIZE = PALETTE_LIGHT.length;
export const PALETTE_NAMES = ['Red', 'Blue', 'Green', 'Purple', 'Orange', 'Black'];

/**
 * Color for a row that has just started to plot: the one least used by the rows that already
 * hold a color (`used`), ties going to the first in palette order. Curves typed one after another
 * get red, blue, green…, wherever they are in the list, and colors repeat only once all of them
 * are taken.
 */
export function pickColor(used: readonly number[]): number {
  const counts = new Array<number>(PALETTE_SIZE).fill(0);
  for (const c of used) if (c >= 0 && c < PALETTE_SIZE) counts[c]++;
  let best = 0;
  for (let i = 1; i < PALETTE_SIZE; i++) if (counts[i] < counts[best]) best = i;
  return best;
}
