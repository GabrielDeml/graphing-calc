import type { JSX } from 'solid-js';
import type { KeyIcon } from '../keypad/layouts';

/**
 * Inline line icons on a 24-unit grid. Presentation attributes only (no style attribute, which
 * the CSP forbids), hidden from assistive technology: the button around an icon carries the name.
 */
export type IconName =
  | KeyIcon
  | 'plus'
  | 'minus'
  | 'close'
  | 'home'
  | 'more'
  | 'sidebar-hide'
  | 'sidebar-show'
  | 'play'
  | 'pause'
  | 'chevron-down'
  | 'alert'
  | 'palette'
  | 'new-graph'
  | 'tangent'
  | 'add-point';

// Functions, not elements: Solid elements are real DOM nodes, and each icon needs its own.
const SHAPES: Record<IconName, () => JSX.Element> = {
  plus: () => <path d="M12 5v14M5 12h14" />,
  minus: () => <path d="M5 12h14" />,
  close: () => <path d="M7 7l10 10M17 7 7 17" />,
  home: () => <path d="M4.5 10.5 12 4.5l7.5 6V19a1 1 0 0 1-1 1h-4v-5.5h-5V20h-4a1 1 0 0 1-1-1z" />,
  more: () => (
    <>
      <circle cx="6" cy="12" r="1.25" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.25" fill="currentColor" stroke="none" />
      <circle cx="18" cy="12" r="1.25" fill="currentColor" stroke="none" />
    </>
  ),
  'sidebar-hide': () => (
    <>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" />
      <path d="M9.5 4.5v15M16 10l-2 2 2 2" />
    </>
  ),
  'sidebar-show': () => (
    <>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" />
      <path d="M9.5 4.5v15M14 10l2 2-2 2" />
    </>
  ),
  play: () => (
    <path d="M8 5.8v12.4a.8.8 0 0 0 1.2.7l9.9-6.2a.8.8 0 0 0 0-1.4L9.2 5.1a.8.8 0 0 0-1.2.7z" />
  ),
  pause: () => <path d="M9 6v12M15 6v12" />,
  'chevron-down': () => <path d="m6.5 9.5 5.5 5.5 5.5-5.5" />,
  alert: () => (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5v5.25" />
      <circle cx="12" cy="16.1" r="1" fill="currentColor" stroke="none" />
    </>
  ),
  palette: () => (
    <path d="M12 3.8c3.3 3.7 5.7 6.7 5.7 9.6a5.7 5.7 0 0 1-11.4 0c0-2.9 2.4-5.9 5.7-9.6z" />
  ),
  'new-graph': () => (
    <>
      <path d="M13.5 3.5H7A1.5 1.5 0 0 0 5.5 5v14A1.5 1.5 0 0 0 7 20.5h10a1.5 1.5 0 0 0 1.5-1.5V8.5z" />
      <path d="M13.5 3.5v5h5M12 11.5v6M9 14.5h6" />
    </>
  ),
  // A hump, the line touching its top, and the point of contact.
  tangent: () => (
    <>
      <path d="M4 19C7 9 15 9 20 19" />
      <path d="M3.5 11.5h17" />
      <circle cx="12" cy="11.5" r="1.6" fill="currentColor" stroke="none" />
    </>
  ),
  'add-point': () => (
    <>
      <circle cx="10" cy="14" r="2.6" fill="currentColor" stroke="none" />
      <path d="M17.5 4v6M14.5 7h6" />
    </>
  ),
  keyboard: () => (
    <>
      <rect x="2.75" y="6" width="18.5" height="12" rx="2.5" />
      <path d="M6.5 9.75h.01M9.5 9.75h.01M12.5 9.75h.01M15.5 9.75h.01M17.5 12h.01M6.5 12h.01M8.5 14.5h7" />
    </>
  ),
  backspace: () => (
    <>
      <path d="M8.6 5.5H19a1.5 1.5 0 0 1 1.5 1.5v10a1.5 1.5 0 0 1-1.5 1.5H8.6a1.5 1.5 0 0 1-1.1-.5L3 12l4.5-6a1.5 1.5 0 0 1 1.1-.5z" />
      <path d="m11.5 9.5 5 5M16.5 9.5l-5 5" />
    </>
  ),
  'arrow-left': () => <path d="M19 12H5M10.5 6.5 5 12l5.5 5.5" />,
  'arrow-right': () => <path d="M5 12h14M13.5 6.5 19 12l-5.5 5.5" />,
  enter: () => <path d="M19.5 5.5V12a3 3 0 0 1-3 3H5M9.5 10.5 5 15l4.5 4.5" />,
  shift: () => <path d="M12 4.5 4.5 12.5H9v6.5h6v-6.5h4.5z" />,
};

/** Filled shapes; the rest are drawn with a stroke. */
const FILLED: ReadonlySet<IconName> = new Set(['play']);

export function Icon(props: { name: IconName; size?: number; class?: string }) {
  const size = () => props.size ?? 18;
  return (
    <svg
      class={props.class ? `icon ${props.class}` : 'icon'}
      width={size()}
      height={size()}
      viewBox="0 0 24 24"
      fill={FILLED.has(props.name) ? 'currentColor' : 'none'}
      stroke="currentColor"
      // A 1.5px line at any size (the grid is 24 units, the icon `size` pixels).
      stroke-width={(1.5 * 24) / size()}
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      {SHAPES[props.name]()}
    </svg>
  );
}
