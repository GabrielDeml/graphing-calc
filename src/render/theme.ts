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
    gridMinor: v('--grid-minor', dark ? '#1c1f25' : '#eff1f4'),
    gridMajor: v('--grid-major', dark ? '#262a31' : '#e2e5ea'),
    axis: v('--axis', dark ? '#80868f' : '#484c55'),
    label: v('--graph-label', dark ? '#7d838e' : '#7b818c'),
    palette: dark ? PALETTE_DARK : PALETTE_LIGHT,
  };
}

export function onThemeChange(cb: () => void): () => void {
  darkQuery?.addEventListener('change', cb);
  return () => darkQuery?.removeEventListener('change', cb);
}
