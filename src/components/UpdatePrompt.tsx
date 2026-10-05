import { useRegisterSW } from 'virtual:pwa-register/solid';
import { createEffect, onCleanup, Show } from 'solid-js';
import { isCoarsePointer } from '../state/keypad';
import { ToastCard } from './Toast';

const HOUR_MS = 60 * 60 * 1000;
/** How long "Ready to work offline" shows: briefly on a phone, where it sits over the graph. */
const OFFLINE_READY_MS = isCoarsePointer ? 2500 : 4000;

/** Toasts for "ready to work offline" and "new version available". */
export function UpdatePrompt() {
  const {
    offlineReady: [offlineReady, setOfflineReady],
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, registration) {
      if (registration) setInterval(() => registration.update(), HOUR_MS);
    },
  });

  // "Ready to work offline" is informational; let it go away by itself.
  createEffect(() => {
    if (!offlineReady() || needRefresh()) return;
    const timer = setTimeout(() => setOfflineReady(false), OFFLINE_READY_MS);
    onCleanup(() => clearTimeout(timer));
  });

  const close = () => {
    setOfflineReady(false);
    setNeedRefresh(false);
  };

  return (
    <Show when={offlineReady() || needRefresh()}>
      <ToastCard
        message={needRefresh() ? 'A new version is available.' : 'Ready to work offline.'}
        actionLabel={needRefresh() ? 'Reload' : undefined}
        onAction={() => updateServiceWorker(true)}
        onDismiss={close}
        // On a phone the note is small and lets taps through to the graph under it.
        quiet={isCoarsePointer && !needRefresh()}
        testId="sw-toast"
      />
    </Show>
  );
}
