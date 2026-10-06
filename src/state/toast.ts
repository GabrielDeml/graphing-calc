import { createEffect, createRoot, createSignal } from 'solid-js';

export interface ToastSpec {
  message: string;
  /**
   * One button next to the message, e.g. Undo. `hadFocus`: the button had focus, which goes away
   * with the toast, so the action should put it somewhere useful.
   */
  action?: { label: string; run: (hadFocus: boolean) => void };
  /** The toast goes away as soon as this turns true (it is tracked). */
  stale?: () => boolean;
}

const TOAST_MS = 6000;
/** Time left at least once the pointer or focus leaves a toast it held open. */
const LINGER_MS = 2000;

/** The app's toast (the service worker's prompts keep their own). A new one replaces the last. */
export const toast = createRoot(() => {
  const [current, setCurrent] = createSignal<ToastSpec | null>(null);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let deadline = 0;
  /** The pointer or focus is on the toast: it stays until they leave, with `left` ms to go. */
  let held = false;
  let left = 0;
  const start = (ms: number) => {
    clearTimeout(timer);
    deadline = Date.now() + ms;
    timer = setTimeout(dismiss, ms);
  };
  const dismiss = () => {
    clearTimeout(timer);
    held = false;
    setCurrent(null);
  };
  createEffect(() => {
    if (current()?.stale?.()) dismiss();
  });
  return {
    current,
    show(spec: ToastSpec, ms = TOAST_MS) {
      setCurrent(spec);
      if (held) left = ms;
      else start(ms);
    },
    dismiss,
    /** Keep the toast while the pointer is over it or it has focus (on), or let it go (off). */
    hold(on: boolean) {
      if (on === held || !current()) return;
      held = on;
      if (on) {
        clearTimeout(timer);
        left = deadline - Date.now();
      } else {
        start(Math.max(left, LINGER_MS));
      }
    },
  };
});
