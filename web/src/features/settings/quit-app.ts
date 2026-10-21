/**
 * "Thoát Second Brain" (SPEC F21): asks first, then stops the server. The window stays open and
 * shows the backend banner once the connection drops (design.md §7 tells her how to start it).
 */
import { i18n } from '../../i18n';
import { shutdownServer } from '../../lib/api/settings-api';
import { confirmDialog } from '../../lib/dialogs/dialog-requests';
import { showToast } from '../../lib/toast-store';
import { settingsSaveError } from './settings-errors';
import { flushOpenNotes } from './vault-reload';

export type QuitOutcome = 'cancelled' | 'stopped';

/** "Thoát Second Brain?" – true when she confirmed. */
export function confirmQuit(): Promise<boolean> {
  return confirmDialog({
    title: i18n.t('settings.app.quitConfirmTitle'),
    body: i18n.t('settings.app.quitConfirmBody'),
    confirmLabel: i18n.t('settings.app.quitConfirm'),
    danger: true,
  });
}

/** After the confirmation: saves what she typed, then stops the server (rejects if refused). */
export async function stopSecondBrain(): Promise<void> {
  await flushOpenNotes({ save: true });
  await shutdownServer();
}

/** Rejects with the server's error when the stop was refused. */
export async function quitSecondBrain(): Promise<QuitOutcome> {
  if (!(await confirmQuit())) return 'cancelled';
  await stopSecondBrain();
  return 'stopped';
}

/** The palette's way: the outcome as a toast. */
export async function quitFromCommand(): Promise<void> {
  try {
    if ((await quitSecondBrain()) === 'stopped') {
      showToast({ message: i18n.t('settings.app.quitDone') });
    }
  } catch (error) {
    showToast({ message: settingsSaveError(error), tone: 'error' });
  }
}
