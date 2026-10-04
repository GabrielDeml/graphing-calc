// Rows store a palette index, not a color, so the palette can be remapped for dark mode.
export const PALETTE_LIGHT = ['#c74440', '#2d70b3', '#388c46', '#6042a6', '#fa7e19', '#000000'];
export const PALETTE_DARK = ['#f0605b', '#5ea4f0', '#5cbd6c', '#a487f0', '#ffa04d', '#e6e8ec'];
export const PALETTE_SIZE = PALETTE_LIGHT.length;
export const PALETTE_NAMES = ['Red', 'Blue', 'Green', 'Purple', 'Orange', 'Black'];

let nextColor = 0;

export function takeNextColor(): number {
  const c = nextColor;
  nextColor = (nextColor + 1) % PALETTE_SIZE;
  return c;
}
