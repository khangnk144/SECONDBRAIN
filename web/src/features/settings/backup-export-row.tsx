import { useTranslation } from 'react-i18next';
import { exportBackup } from '../../lib/api/backup-api';
import { ActionMessage } from './action-message';
import { exportBackupError } from './settings-errors';
import { useActionStatus } from './use-action-status';

/** Hands the browser a blob to save under `fileName` (never a navigation to the API). */
export function downloadBlob(blob: Blob, fileName: string, doc: Document = document): void {
  const url = URL.createObjectURL(blob);
  const link = doc.createElement('a');
  link.href = url;
  link.download = fileName;
  link.rel = 'noopener';
  link.hidden = true;
  doc.body.append(link);
  try {
    link.click();
  } finally {
    link.remove();
    // The download has started from the click; give the browser a moment before revoking.
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  }
}

/** "Xuất bản sao lưu…" (SPEC F18.5): the whole vault as a zip, without the cache or secrets. */
export function BackupExportRow() {
  const { t } = useTranslation();
  const { state, run } = useActionStatus();
  const onExport = () =>
    void run(async () => {
      const backup = await exportBackup();
      downloadBlob(backup.blob, backup.fileName);
      const done = t('settings.vault.exportDone', { name: backup.fileName });
      return backup.unreadable > 0
        ? `${done} ${t('settings.vault.exportUnreadable', { count: backup.unreadable })}`
        : done;
    }, exportBackupError);
  return (
    <div className="settings-field">
      <div className="settings-field__control">
        <button
          type="button"
          className="button button--secondary"
          aria-disabled={state.kind === 'busy' || undefined}
          onClick={onExport}
        >
          {t('settings.vault.export')}
        </button>
      </div>
      <p className="settings-field__hint">{t('settings.vault.exportHint')}</p>
      <ActionMessage state={state} busyText={t('settings.vault.exportBusy')} />
    </div>
  );
}
