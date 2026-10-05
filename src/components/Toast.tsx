import { onCleanup, Show } from 'solid-js';
import { toast } from '../state/toast';

/**
 * One toast: a short message, maybe one action (Undo, Reload), and a close button. It is
 * announced by the `.toasts` live region it appears in (see App).
 */
export function ToastCard(props: {
  message: string;
  actionLabel?: string;
  /** `hadFocus`: the button had focus, which goes away with the toast. */
  onAction?: (hadFocus: boolean) => void;
  onDismiss: () => void;
  /** Called with true while the pointer is over the toast or focus is in it, false after. */
  onHold?: (held: boolean) => void;
  testId: string;
}) {
  let card!: HTMLDivElement;
  let hovered = false;
  let focused = false;
  /** Where focus was before it came to the toast. */
  let cameFrom: HTMLElement | null = null;
  const hold = () => props.onHold?.(hovered || focused);
  onCleanup(() => {
    if (hovered || focused) props.onHold?.(false);
  });

  /** Run a button's handler; if that removes the toast with focus in it, focus goes back. */
  const run = (handler: (hadFocus: boolean) => void) => {
    const hadFocus = card.contains(document.activeElement);
    handler(hadFocus);
    const lost = !card.isConnected && document.activeElement === document.body;
    if (hadFocus && lost && cameFrom?.isConnected) cameFrom.focus({ preventScroll: true });
  };

  return (
    <div
      class="toast"
      data-testid={props.testId}
      ref={card}
      onPointerEnter={() => {
        hovered = true;
        hold();
      }}
      onPointerLeave={() => {
        hovered = false;
        hold();
      }}
      onFocusIn={(e) => {
        const from = e.relatedTarget;
        if (from instanceof HTMLElement && !card.contains(from)) cameFrom = from;
        focused = true;
        hold();
      }}
      onFocusOut={(e) => {
        if (e.relatedTarget instanceof Node && card.contains(e.relatedTarget)) return;
        focused = false;
        hold();
      }}
    >
      <span>{props.message}</span>
      <Show when={props.actionLabel}>
        {(label) => (
          <button
            type="button"
            class="toast-action"
            onClick={() => run((hadFocus) => props.onAction?.(hadFocus))}
          >
            {label()}
          </button>
        )}
      </Show>
      <button
        type="button"
        class="toast-close"
        aria-label="Dismiss"
        onClick={() => run(() => props.onDismiss())}
      >
        ×
      </button>
    </div>
  );
}

/** The app's toast (see state/toast), such as "Graph cleared · Undo". */
export function Toast() {
  return (
    <Show when={toast.current()}>
      {(t) => (
        <ToastCard
          message={t().message}
          actionLabel={t().action?.label}
          onAction={(hadFocus) => {
            // Read before running: the action can make the toast stale, and it is gone after.
            const spec = t();
            spec.action?.run(hadFocus);
            if (toast.current() === spec) toast.dismiss();
          }}
          onDismiss={toast.dismiss}
          onHold={toast.hold}
          testId="toast"
        />
      )}
    </Show>
  );
}
