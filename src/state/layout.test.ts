import { describe, expect, it } from 'vitest';
import {
  clampSidebarWidth,
  GRAPH_MIN,
  SIDEBAR_DEFAULT,
  SIDEBAR_MAX,
  SIDEBAR_MIN,
  sidebarMaxWidth,
} from './layout';

describe('clampSidebarWidth', () => {
  it('keeps a width within bounds, in whole pixels', () => {
    expect(clampSidebarWidth(420.6)).toBe(421);
    expect(clampSidebarWidth(10)).toBe(SIDEBAR_MIN);
    expect(clampSidebarWidth(5000)).toBe(SIDEBAR_MAX);
  });

  it('leaves the graph room in a narrow window', () => {
    expect(clampSidebarWidth(600, 900)).toBe(900 - GRAPH_MIN);
    // Too narrow for both: the sidebar keeps its minimum (the layout is the phone one there).
    expect(clampSidebarWidth(600, 500)).toBe(SIDEBAR_MIN);
  });

  it('has a maximum that follows the window', () => {
    expect(sidebarMaxWidth()).toBe(SIDEBAR_MAX);
    expect(sidebarMaxWidth(1000)).toBe(1000 - GRAPH_MIN);
    expect(sidebarMaxWidth(400)).toBe(SIDEBAR_MIN);
  });

  it('falls back to the default for nonsense', () => {
    expect(clampSidebarWidth(Number.NaN)).toBe(SIDEBAR_DEFAULT);
    expect(clampSidebarWidth(Number.POSITIVE_INFINITY)).toBe(SIDEBAR_DEFAULT);
  });
});
