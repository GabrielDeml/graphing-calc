// Desktop sidebar width (the expression list beside the graph). Pure, so the saved value and a
// drag share the same bounds.

/** Width of a new sidebar, in CSS px. */
export const SIDEBAR_DEFAULT = 400;
export const SIDEBAR_MIN = 300;
export const SIDEBAR_MAX = 640;
/** Width the graph keeps beside a widened sidebar. */
export const GRAPH_MIN = 360;

/** The widest the sidebar gets in a `windowWidth`-wide window, leaving the graph GRAPH_MIN. */
export function sidebarMaxWidth(windowWidth = Number.POSITIVE_INFINITY): number {
  return Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, windowWidth - GRAPH_MIN));
}

/**
 * A sidebar width within bounds, in whole pixels: never narrower than SIDEBAR_MIN, and never so
 * wide that the graph beside it gets less than GRAPH_MIN of a `windowWidth`-wide window.
 */
export function clampSidebarWidth(width: number, windowWidth = Number.POSITIVE_INFINITY): number {
  const max = sidebarMaxWidth(windowWidth);
  const w = Number.isFinite(width) ? width : SIDEBAR_DEFAULT;
  return Math.round(Math.min(max, Math.max(SIDEBAR_MIN, w)));
}
