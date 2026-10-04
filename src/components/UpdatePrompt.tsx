import { useRegisterSW } from 'virtual:pwa-register/solid';
import { createEffect, onCleanup, Show } from 'solid-js';
import { ToastCard } from './Toast';

const HOUR_MS = 60 * 60 * 1000;

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
    const timer = setTimeout(() => setOfflineReady(false), 4000);
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
        testId="sw-toast"
      />
    </Show>
  );
}
