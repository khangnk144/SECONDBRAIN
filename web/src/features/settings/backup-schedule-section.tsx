/**
 * Scheduled backups and the GitHub push (SPEC F27): in Settings → Kho ghi chú right after the
 * backup export and restore rows. Every field saves on its own (blur/Enter, switches at once);
 * the status comes from `GET /api/backup/schedule` and follows every change.
 */
import { useTranslation } from 'react-i18next';
import { isApiError } from '../../lib/api-client';
import {
  openBackupFolder,
  runBackupNow,
  type BackupScheduleStatus,
} from '../../lib/api/backup-schedule-api';
import { BACKUP_KEEP_MAX, BACKUP_KEEP_MIN } from '../../lib/api/settings-m5-types';
import { i18n } from '../../i18n';
import { ActionMessage } from './action-message';
import { BackupGithubBlock } from './backup-github-block';
import { BackupScheduleStatusLines } from './backup-schedule-status';
import { ChannelSwitch } from './channel-switch';
import { ChannelTextSetting } from './channel-text-setting';
import { normalizeReminderTime } from './reminders-settings-section';
import { useSettingsStore } from './settings-store';
import { useActionStatus } from './use-action-status';
import { useBackupSchedule } from './use-backup-schedule';
import './settings-channels.css';

const AREA = 'backup-schedule';

/** A run that answered `ok: false`: the sentence is already in words. */
class RunFailed extends Error {}

function runError(error: unknown): string {
  if (error instanceof RunFailed) return error.message;
  if (isApiError(error, 'VALIDATION') && typeof error.details.reason === 'string') {
    const key = `backup-schedule.folderProblem.${error.details.reason}`;
    if (i18n.exists(key)) return i18n.t(key);
  }
  return i18n.t('backup-schedule.runFailed', { reason: i18n.t('backup-schedule.failure.failed') });
}

function BackupActions({
  status,
  reload,
}: {
  status: BackupScheduleStatus | null;
  reload: () => void;
}) {
  const { t } = useTranslation();
  const run = useActionStatus();
  const open = useActionStatus();
  const onRun = () =>
    void run.run(async () => {
      const result = await runBackupNow();
      reload();
      if (result.ok) return t('backup-schedule.runDone', { name: result.run.fileName ?? '' });
      const reason = t(`backup-schedule.failure.${result.error}`);
      throw new RunFailed(t('backup-schedule.runFailed', { reason }));
    }, runError);
  const onOpen = () =>
    void open.run(
      async () => {
        await openBackupFolder();
        return null;
      },
      () => t('backup-schedule.openFolderFailed'),
    );
  return (
    <div className="settings-field">
      <div className="settings-field__control">
        <button
          type="button"
          className="button button--secondary"
          aria-disabled={run.state.kind === 'busy' || status?.running || undefined}
          onClick={onRun}
        >
          {t('backup-schedule.runNow')}
        </button>
        <button type="button" className="button button--secondary" onClick={onOpen}>
          {t('backup-schedule.openFolder')}
        </button>
      </div>
      <ActionMessage state={run.state} busyText={t('backup-schedule.runBusy')} />
      <ActionMessage state={open.state} />
    </div>
  );
}

export function BackupScheduleSection() {
  const { t } = useTranslation();
  const backup = useSettingsStore((state) => state.settings?.backup);
  const { status, reload } = useBackupSchedule();
  if (!backup) return null;
  const { schedule } = backup;
  const range = { min: BACKUP_KEEP_MIN, max: BACKUP_KEEP_MAX };
  return (
    <div className="settings-subsection" role="group" aria-labelledby="settings-backup-schedule">
      <h3 id="settings-backup-schedule" className="settings-subsection__title">
        {t('backup-schedule.title')}
      </h3>
      <p className="settings-field__hint">{t('backup-schedule.intro')}</p>
      <ChannelSwitch
        id="settings-backup-enabled"
        area={AREA}
        label={t('backup-schedule.enable')}
        checked={schedule.enabled}
        ready
        missing=""
        hint={<span>{t('backup-schedule.enableHint')}</span>}
        toPatch={(enabled) => ({ backup: { schedule: { enabled } } })}
      />
      <ChannelTextSetting
        id="settings-backup-folder"
        area={AREA}
        label={t('backup-schedule.folder')}
        value={schedule.folder}
        placeholder={schedule.defaultFolder ?? undefined}
        hint={
          schedule.defaultFolder
            ? t('backup-schedule.folderHint', { folder: schedule.defaultFolder })
            : t('backup-schedule.folderHintNoDefault')
        }
        toPatch={(folder) => ({ backup: { schedule: { folder: folder === '' ? null : folder } } })}
      />
      <ChannelTextSetting
        id="settings-backup-time"
        area={AREA}
        label={t('backup-schedule.time')}
        value={schedule.time}
        className="settings-input--time"
        inputMode="numeric"
        hint={t('backup-schedule.timeHint')}
        parse={(text) => {
          const time = normalizeReminderTime(text);
          return time ? { value: time } : { error: t('backup-schedule.timeInvalid') };
        }}
        toPatch={(time) => ({ backup: { schedule: { time } } })}
      />
      <ChannelTextSetting
        id="settings-backup-keep"
        area={AREA}
        label={t('backup-schedule.keep')}
        value={String(schedule.keep)}
        className="settings-input--port"
        inputMode="numeric"
        hint={t('backup-schedule.keepHint', range)}
        parse={(text) => {
          const keep = /^\d{1,2}$/.test(text) ? Number(text) : NaN;
          return keep >= range.min && keep <= range.max
            ? { value: String(keep) }
            : { error: t('backup-schedule.keepInvalid', range) };
        }}
        toPatch={(keep) => ({ backup: { schedule: { keep: Number(keep) } } })}
      />
      {status ? <BackupScheduleStatusLines status={status} /> : null}
      <BackupActions status={status} reload={reload} />
      <BackupGithubBlock github={backup.github} status={status} reload={reload} />
    </div>
  );
}
