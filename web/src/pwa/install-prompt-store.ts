import { create } from 'zustand';

/** Chromium's `BeforeInstallPromptEvent` (not in the DOM typings). */
export interface BeforeInstallPromptEventLike extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform?: string }>;
}

export type InstallOutcome = 'accepted' | 'dismissed' | 'unavailable';

interface InstallPromptState {
  /** The browser's install prompt, kept until "Cài đặt app" uses it (it works only once). */
  deferred: BeforeInstallPromptEventLike | null;
  /** Running as the installed app, or installed during this visit. */
  installed: boolean;
  /** The browser has an install prompt at all (Chrome, Edge); others need the hint. */
  promptSupported: boolean;
}

export const useInstallPromptStore = create<InstallPromptState>(() => ({
  deferred: null,
  installed: false,
  promptSupported: false,
}));

const STANDALONE_QUERY = '(display-mode: standalone)';

/**
 * Starts listening for the install events. Called before React renders (start-pwa.ts), because
 * Chrome fires `beforeinstallprompt` shortly after load and does not repeat it. Returns a stop
 * function.
 */
export function startInstallPromptCapture(win: Window = window): () => void {
  const standalone = typeof win.matchMedia === 'function' ? win.matchMedia(STANDALONE_QUERY) : null;
  useInstallPromptStore.setState({
    promptSupported: 'onbeforeinstallprompt' in win,
    installed: standalone?.matches ?? false,
  });
  const onPrompt = (event: Event) => {
    // Keeps the event for our own button instead of the browser's mini-infobar.
    event.preventDefault();
    useInstallPromptStore.setState({
      deferred: event as BeforeInstallPromptEventLike,
      promptSupported: true,
    });
  };
  const onInstalled = () => useInstallPromptStore.setState({ deferred: null, installed: true });
  const onDisplayMode = (event: MediaQueryListEvent) => {
    if (event.matches) useInstallPromptStore.setState({ installed: true });
  };
  win.addEventListener('beforeinstallprompt', onPrompt);
  win.addEventListener('appinstalled', onInstalled);
  standalone?.addEventListener?.('change', onDisplayMode);
  return () => {
    win.removeEventListener('beforeinstallprompt', onPrompt);
    win.removeEventListener('appinstalled', onInstalled);
    standalone?.removeEventListener?.('change', onDisplayMode);
  };
}

/** Shows the browser's install dialog; resolves with what the user chose. */
export async function promptInstall(): Promise<InstallOutcome> {
  const { deferred } = useInstallPromptStore.getState();
  if (!deferred) return 'unavailable';
  useInstallPromptStore.setState({ deferred: null });
  await deferred.prompt();
  const { outcome } = await deferred.userChoice;
  if (outcome === 'accepted') useInstallPromptStore.setState({ installed: true });
  return outcome;
}

export interface InstallPrompt {
  canInstall: boolean;
  installed: boolean;
  promptSupported: boolean;
  promptInstall: () => Promise<InstallOutcome>;
}

export function useInstallPrompt(): InstallPrompt {
  const installed = useInstallPromptStore((s) => s.installed);
  const hasPrompt = useInstallPromptStore((s) => s.deferred !== null);
  const promptSupported = useInstallPromptStore((s) => s.promptSupported);
  return { canInstall: hasPrompt && !installed, installed, promptSupported, promptInstall };
}
