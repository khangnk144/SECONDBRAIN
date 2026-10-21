/**
 * Fallback toast through `node-notifier`'s WindowsToaster (SnoreToast), used only when the
 * PowerShell path failed. The module is loaded lazily: it is a CommonJS dependency that only
 * Windows needs, and the server must start even if it is missing.
 */
import type { ToastContent } from './reminder-messages.js';
import { POWERSHELL_APP_ID } from './toast-script.js';

/** The part of WindowsToaster this module uses (tests pass a fake). */
export interface NotifierToaster {
  notify(
    notification: { title: string; message: string; appID: string; wait: boolean },
    callback: (
      error: Error | null,
      response?: string,
      metadata?: { activationType?: string },
    ) => void,
  ): unknown;
}

export type LoadToaster = () => Promise<NotifierToaster>;

export const loadNodeNotifierToaster: LoadToaster = async () => {
  const notifier = (await import('node-notifier')).default;
  return new notifier.WindowsToaster({ withFallback: false });
};

/**
 * SnoreToast keeps running while the toast is on screen and reports the user's action when it
 * closes; a toast it cannot show fails at once. So an error is `failed`, and no error within
 * `shownAfterMs` (or a normal answer) is `shown`. A click opens the deep link once.
 */
export function notifyWithToaster(
  toaster: NotifierToaster,
  toast: ToastContent,
  options: { openUrl: (url: string) => void; shownAfterMs: number },
): Promise<'shown' | 'failed'> {
  return new Promise((resolve) => {
    let settled = false;
    let opened = false;
    const finish = (outcome: 'shown' | 'failed') => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(outcome);
    };
    const timer = setTimeout(() => finish('shown'), options.shownAfterMs);
    timer.unref?.();
    try {
      toaster.notify(
        { title: toast.title, message: toast.body, appID: POWERSHELL_APP_ID, wait: true },
        (error, response, metadata) => {
          if (error) return finish('failed');
          finish('shown');
          const clicked = response === 'activate' || metadata?.activationType === 'clicked';
          if (clicked && !opened) {
            opened = true;
            options.openUrl(toast.link);
          }
        },
      );
    } catch {
      finish('failed');
    }
  });
}
