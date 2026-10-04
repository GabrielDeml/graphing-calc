import { PALETTE_DARK, PALETTE_LIGHT } from '../state/colors';

export interface Theme {
  dark: boolean;
  background: string;
  gridMinor: string;
  gridMajor: string;
  axis: string;
  label: string;
  palette: readonly string[];
}

const darkQuery =
  typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null;

/** Graph colors come from CSS custom properties so styling stays in global.css. */
export function readTheme(): Theme {
  const css = getComputedStyle(document.documentElement);
  const v = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
  const dark = darkQuery?.matches ?? false;
  return {
    dark,
    background: v('--graph-bg', dark ? '#16181d' : '#ffffff'),
    gridMinor: v('--grid-minor', dark ? '#24272e' : '#f0f1f3'),
    gridMajor: v('--grid-major', dark ? '#343842' : '#d9dce1'),
    axis: v('--axis', dark ? '#9aa0ab' : '#3a3d44'),
    label: v('--graph-label', dark ? '#c3c7cf' : '#3a3d44'),
    palette: dark ? PALETTE_DARK : PALETTE_LIGHT,
  };
}

export function onThemeChange(cb: () => void): () => void {
  darkQuery?.addEventListener('change', cb);
  return () => darkQuery?.removeEventListener('change', cb);
}
