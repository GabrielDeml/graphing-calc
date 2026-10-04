import { createRoot, createSignal } from 'solid-js';
import type { PageId } from '../keypad/layouts';

/**
 * Anything the on-screen keypad can type into: expression rows, slider bounds, domain fields.
 * Implemented by MathField.
 */
export interface EditTarget {
  el: HTMLInputElement;
  /** Write new text through to the store. */
  commit(text: string): void;
  /** What ↵ does (expression rows: next/new row; small fields: blur). */
  enter(): void;
  /** ⌫ on an empty field (expression rows delete themselves, like the hardware key). */
  deleteEmpty?(): void;
}

const coarsePointer = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;

export const keypad = createRoot(() => {
  /** Keypad mode: math fields suppress the native keyboard (inputmode="none"). */
  const [enabled, setEnabled] = createSignal(coarsePointer);
  /** Whether the keypad is currently shown (only meaningful while enabled). */
  const [open, setOpen] = createSignal(false);
  const [page, setPage] = createSignal<PageId>('123');
  const [shift, setShift] = createSignal(false);
  const [target, setTarget] = createSignal<EditTarget | null>(null, { equals: false });
  /** The field that temporarily uses the device keyboard (⌨ key), until it blurs. */
  const [nativeEl, setNativeEl] = createSignal<HTMLInputElement | null>(null);

  return {
    enabled,
    setEnabled,
    open,
    setOpen,
    page,
    setPage,
    shift,
    setShift,
    target,
    setTarget,
    nativeEl,
    setNativeEl,
    /** Whether the device keyboard should be suppressed for this field. */
    suppressNative(el: HTMLInputElement | undefined): boolean {
      return enabled() && nativeEl() !== el;
    },
  };
});

export const isCoarsePointer = coarsePointer;
