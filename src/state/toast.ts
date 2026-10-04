import { createEffect, createRoot, createSignal } from 'solid-js';

export interface ToastSpec {
  message: string;
  /** One button next to the message, e.g. Undo. */
  action?: { label: string; run: () => void };
  /** The toast goes away as soon as this turns true (it is tracked). */
  stale?: () => boolean;
}

const TOAST_MS = 6000;

/** The app's toast (the service worker's prompts keep their own). A new one replaces the last. */
export const toast = createRoot(() => {
  const [current, setCurrent] = createSignal<ToastSpec | null>(null);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const dismiss = () => {
    clearTimeout(timer);
    setCurrent(null);
  };
  createEffect(() => {
    if (current()?.stale?.()) dismiss();
  });
  return {
    current,
    show(spec: ToastSpec, ms = TOAST_MS) {
      clearTimeout(timer);
      setCurrent(spec);
      timer = setTimeout(dismiss, ms);
    },
    dismiss,
  };
});
