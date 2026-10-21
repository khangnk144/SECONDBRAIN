/**
 * Palette commands that act like their Settings buttons: export a backup, flip the theme, quit.
 * Each one says its outcome in a toast (the palette has closed by the time they finish).
 */
import { downloadBlob } from '../../features/settings/backup-export-row';
import { quitFromCommand } from '../../features/settings/quit-app';
import { exportBackupError, settingsSaveError } from '../../features/settings/settings-errors';
import { useSettingsStore } from '../../features/settings/settings-store';
import { i18n } from '../../i18n';
import { exportBackup } from '../api/backup-api';
import { resolveTheme } from '../apply-ui-prefs';
import { dismissToast, showToast } from '../toast-store';
import { useUiPrefsStore } from '../ui-prefs-store';

/** The "preparing" toast goes away once the backup is ready, so only the outcome stays. */
export async function exportBackupFromCommand(): Promise<void> {
  const busy = showToast({ message: i18n.t('commands.exportBackupBusy') });
  try {
    const backup = await exportBackup();
    downloadBlob(backup.blob, backup.fileName);
    const done = i18n.t('settings.vault.exportDone', { name: backup.fileName });
    dismissToast(busy);
    showToast({
      message:
        backup.unreadable > 0
          ? `${done} ${i18n.t('settings.vault.exportUnreadable', { count: backup.unreadable })}`
          : done,
    });
  } catch (error) {
    dismissToast(busy);
    showToast({ message: exportBackupError(error), tone: 'error' });
  }
}

/** Dark ↔ light from what is on screen ("Theo máy" becomes the opposite of the OS theme). */
export async function toggleThemeFromCommand(): Promise<void> {
  const shown = resolveTheme(useUiPrefsStore.getState().prefs.theme);
  try {
    await useSettingsStore.getState().save({ ui: { theme: shown === 'dark' ? 'light' : 'dark' } });
  } catch (error) {
    showToast({ message: settingsSaveError(error), tone: 'error' });
  }
}

export function quitAppFromCommand(): void {
  void quitFromCommand();
}
