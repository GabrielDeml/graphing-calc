import { Show } from 'solid-js';
import { toast } from '../state/toast';

/** One toast: a short message, maybe one action (Undo, Reload), and a close button. */
export function ToastCard(props: {
  message: string;
  actionLabel?: string;
  onAction?: () => void;
  onDismiss: () => void;
  testId: string;
}) {
  return (
    <div class="toast" role="status" data-testid={props.testId}>
      <span>{props.message}</span>
      <Show when={props.actionLabel}>
        {(label) => (
          <button type="button" class="toast-action" onClick={() => props.onAction?.()}>
            {label()}
          </button>
        )}
      </Show>
      <button
        type="button"
        class="toast-close"
        aria-label="Dismiss"
        onClick={() => props.onDismiss()}
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
          onAction={() => {
            // Read before dismissing: the toast is gone after that.
            const run = t().action?.run;
            toast.dismiss();
            run?.();
          }}
          onDismiss={toast.dismiss}
          testId="toast"
        />
      )}
    </Show>
  );
}
