/**
 * Finding out which vault this window shows (`GET /health`) before anything per vault is read.
 * When the app starts before the server (the installed app opened at login, a cached shell
 * offline), the check is retried every time the WebSocket opens and every few seconds while it
 * stays open, until the vault is known; then the per-vault state is read and everything the
 * failed boot left in error is fetched again (a `resync`), without a page reload.
 */
import { useVaultStore } from './vault-store';
import { useConnectionStore } from './ws/connection-store';

/** Delay between health checks while the socket is open but the check still fails. */
export const VAULT_RETRY_MS = 3_000;

export interface VaultBootHandlers {
  /** After the first check; `known` is false when the server did not answer. */
  onFirstCheck: (known: boolean) => void;
  /** The vault became known after failed checks (the first fetches failed as well). */
  onRecovered: () => void;
}

let retryActive: (() => void) | null = null;

/** "Thử lại" while the vault is unknown: checks again now. */
export function retryVaultBoot(): void {
  retryActive?.();
}

/** Starts the check; returns the stop function. */
export function startVaultBoot(handlers: VaultBootHandlers): () => void {
  let stopped = false;
  let known = false;
  let inFlight = false;
  /** The socket opened while a check was on its way: check again at once if that one failed. */
  let openedMeanwhile = false;
  let failures = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const clearTimer = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };

  const attempt = async () => {
    if (stopped || known || inFlight) return;
    inFlight = true;
    openedMeanwhile = false;
    clearTimer();
    await useVaultStore.getState().load();
    inFlight = false;
    if (stopped) return;
    if (!useVaultStore.getState().failed) {
      known = true;
      stop();
      if (failures === 0) handlers.onFirstCheck(true);
      else handlers.onRecovered();
      return;
    }
    failures += 1;
    if (failures === 1) handlers.onFirstCheck(false);
    // The socket is open, so the server is up: try again soon. Otherwise wait for the socket.
    if (openedMeanwhile) void attempt();
    else if (useConnectionStore.getState().state === 'open') {
      timer = setTimeout(() => void attempt(), VAULT_RETRY_MS);
    }
  };

  const unsubscribe = useConnectionStore.subscribe((state, previous) => {
    if (state.state !== 'open' || previous.state === 'open') return;
    if (inFlight) openedMeanwhile = true;
    else void attempt();
  });
  const retry = () => void attempt();
  retryActive = retry;

  function stop() {
    clearTimer();
    unsubscribe();
    if (retryActive === retry) retryActive = null;
  }

  void attempt();
  return () => {
    stopped = true;
    stop();
  };
}
