import { createRoot, createSignal } from 'solid-js';
import { PALETTE_DARK, PALETTE_LIGHT } from './colors';

/** Reactive curve palette that follows the system light/dark preference. */
export const palette = createRoot(() => {
  const query =
    typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null;
  const [dark, setDark] = createSignal(query?.matches ?? false);
  query?.addEventListener('change', (e) => setDark(e.matches));
  return () => (dark() ? PALETTE_DARK : PALETTE_LIGHT);
});
