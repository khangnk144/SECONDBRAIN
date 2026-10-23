import { useTranslation } from 'react-i18next';
import type { BackupScheduleStatus } from '../../lib/api/backup-schedule-api';
import { formatFileDate, formatFileSize } from '../resources/format-file-facts';

/** "21:00 22/10/2026" in the UI language. */
export function useWhen(area: 'backup-schedule' | 'notify'): (iso: string) => string {
  const { t, i18n } = useTranslation();
  return (iso) => formatFileDate(Date.parse(iso), i18n.language, t(`${area}.dateFormat`));
}

/**
 * The status lines under "Sao lưu tự động" (SPEC F27.4): the last backup (time, size, file
 * name), the last error with the retry time, the next run. Errors are announced politely: they
 * concern a background job, not what she just typed.
 */
export function BackupScheduleStatusLines({ status }: { status: BackupScheduleStatus }) {
  const { t, i18n } = useTranslation();
  const when = useWhen('backup-schedule');
  const { lastRun, lastSuccess } = status;
  const failed = lastRun && !lastRun.ok ? lastRun : null;
  return (
    <div className="settings-field__hint" role="status">
      {status.folderProblem ? (
        <span className="settings-field__notice">
          {t(`backup-schedule.folderProblem.${status.folderProblem}`)}
        </span>
      ) : null}
      {status.running ? <span>{t('backup-schedule.status.running')}</span> : null}
      {lastSuccess ? (
        <span>
          {t('backup-schedule.status.last', {
            when: when(lastSuccess.at),
            size: formatFileSize(lastSuccess.bytes, i18n.language),
            name: lastSuccess.fileName ?? '',
          })}
        </span>
      ) : (
        <span>{t('backup-schedule.status.none')}</span>
      )}
      {failed ? (
        <span className="settings-status--error">
          {t('backup-schedule.status.failed', {
            reason: t(`backup-schedule.failure.${failed.error ?? 'failed'}`),
          })}
          {status.retryAt
            ? ` ${t('backup-schedule.status.retry', { when: when(status.retryAt) })}`
            : ''}
        </span>
      ) : null}
      {status.enabled && status.nextRunAt && !failed ? (
        <span>{t('backup-schedule.status.next', { when: when(status.nextRunAt) })}</span>
      ) : null}
    </div>
  );
}
