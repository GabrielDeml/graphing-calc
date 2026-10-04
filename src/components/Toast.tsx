import { Show } from 'solid-js';
import { toast } from '../state/toast';

/** The app's toast: a short message and maybe one action, such as Undo. */
export function Toast() {
  return (
    <Show when={toast.current()}>
      {(t) => (
        <div class="toast" role="status" data-testid="toast">
          <span>{t().message}</span>
          <Show when={t().action}>
            {(action) => (
              <button
                type="button"
                class="toast-action"
                onClick={() => {
                  const { run } = action();
                  toast.dismiss();
                  run();
                }}
              >
                {action().label}
              </button>
            )}
          </Show>
          <button type="button" class="toast-close" aria-label="Dismiss" onClick={toast.dismiss}>
            ×
          </button>
        </div>
      )}
    </Show>
  );
}
