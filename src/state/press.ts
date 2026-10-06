// Whether a press (a mouse button, a finger, a pen) is under way, so that what a row does when it
// loses focus can wait for the click the press makes. Rows added on blur (sliders) would move the
// button under the pointer between its mousedown and its mouseup, and the click would be lost.

/** A press that ends without a click (a drag, a scroll) lets go this long after it ends. */
const NO_CLICK_MS = 400;

let pressing = false;
let waiting: (() => void)[] = [];
let releaseTimer: ReturnType<typeof setTimeout> | undefined;

function release(): void {
  clearTimeout(releaseTimer);
  pressing = false;
  const run = waiting;
  waiting = [];
  for (const fn of run) fn();
}

if (typeof document !== 'undefined') {
  document.addEventListener(
    'pointerdown',
    () => {
      clearTimeout(releaseTimer);
      pressing = true;
    },
    true,
  );
  // A finger's click comes a moment after it lifts (and its focus change with it).
  const ended = () => {
    clearTimeout(releaseTimer);
    releaseTimer = setTimeout(release, NO_CLICK_MS);
  };
  document.addEventListener('pointerup', ended, true);
  document.addEventListener('pointercancel', ended, true);
  // After the click's own handlers.
  document.addEventListener(
    'click',
    () => {
      if (!pressing) return;
      clearTimeout(releaseTimer);
      releaseTimer = setTimeout(release, 0);
    },
    true,
  );
}

/**
 * Run `fn` once the press under way has made its click (or ended without one), or now when there
 * is none. Returns a function that cancels it (for a component going away first).
 */
export function afterPress(fn: () => void): () => void {
  if (!pressing) {
    fn();
    return () => {};
  }
  waiting.push(fn);
  return () => {
    waiting = waiting.filter((f) => f !== fn);
  };
}
