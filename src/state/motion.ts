/**
 * The user asked for less motion (prefers-reduced-motion), read live: what moves by itself
 * (rows coming and going, the keypad sheet, the graph gliding) jumps to where it ends instead.
 * The CSS zeroes its durations the same way (global.css --dur-*).
 */
const query =
  typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;

export function reducedMotion(): boolean {
  return !!query?.matches;
}

/** The motion tokens of global.css, for animations run from script. */
export const DUR_2 = 160;
export const EASE_OUT = 'cubic-bezier(0.22, 1, 0.36, 1)';
