// Rows store a palette index, not a color, so the palette can be remapped for dark mode. The
// sixth color is teal in both schemes (it was black, which read as an axis and turned white in
// the dark). Teal keeps its blue channel well apart from the blue and green curves.
export const PALETTE_LIGHT = ['#c74440', '#2d70b3', '#388c46', '#6042a6', '#fa7e19', '#0f8a7e'];
export const PALETTE_DARK = ['#f0605b', '#5ea4f0', '#5cbd6c', '#a487f0', '#ffa04d', '#2ec4b6'];
export const PALETTE_SIZE = PALETTE_LIGHT.length;
export const PALETTE_NAMES = ['Red', 'Blue', 'Green', 'Purple', 'Orange', 'Teal'];

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

/** How a row stands with colors: it draws, it is broken for now (mid-edit), or it draws nothing. */
export type ColorUse = 'plots' | 'broken' | 'none';

/**
 * The color changes rows need, as [row index, color] pairs. A row that has just started to plot
 * takes the least-used color among the rows holding one (pickColor). A broken curve keeps its
 * color reserved for when it is fixed, while a row that draws nothing (a slider, a value) gives
 * its color back: if it plots again it picks afresh, rather than keep one that another curve may
 * have taken since.
 */
export function colorChanges(
  rows: readonly { colorIndex: number; use: ColorUse }[],
): [number, number][] {
  const used: number[] = [];
  const waiting: number[] = [];
  const changes: [number, number][] = [];
  rows.forEach((row, i) => {
    if (row.colorIndex < 0) {
      if (row.use === 'plots') waiting.push(i);
    } else if (row.use === 'none') {
      changes.push([i, -1]);
    } else {
      used.push(row.colorIndex);
    }
  });
  for (const i of waiting) {
    const color = pickColor(used);
    changes.push([i, color]);
    used.push(color);
  }
  return changes;
}
