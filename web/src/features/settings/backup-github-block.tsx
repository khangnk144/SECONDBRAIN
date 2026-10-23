import { useTranslation } from 'react-i18next';
import {
  pushToGithubNow,
  type BackupScheduleStatus,
  type PushRecord,
} from '../../lib/api/backup-schedule-api';
import type { BackupSettingsView } from '../../lib/api/settings-m5-types';
import { ActionMessage } from './action-message';
import { useWhen } from './backup-schedule-status';
import { ChannelSecretField } from './channel-secret-field';
import { ChannelSwitch } from './channel-switch';
import { ChannelTextSetting } from './channel-text-setting';
import { useActionStatus } from './use-action-status';

const AREA = 'backup-schedule';

/** A push that answered `ok: false`: `message` is the reason in words. */
class PushFailed extends Error {}

function LastPush({ push }: { push: PushRecord | null }) {
  const { t } = useTranslation();
  const when = useWhen(AREA);
  if (!push) return null;
  return push.ok ? (
    <span>{t('backup-schedule.github.last', { when: when(push.at) })}</span>
  ) : (
    <span className="settings-status--error">
      {t('backup-schedule.github.lastFailed', {
        when: when(push.at),
        reason: t(`backup-schedule.github.failure.${push.error ?? 'failed'}`),
      })}
    </span>
  );
}

/**
 * "Đẩy lên GitHub" (SPEC F27.5): optional push of the version history to a private repository
 * after each automatic backup, and "Đẩy ngay". The token is masked like an API key; without git
 * the switch stays off with a hint.
 */
export function BackupGithubBlock({
  github,
  status,
  reload,
}: {
  github: BackupSettingsView['github'];
  status: BackupScheduleStatus | null;
  reload: () => void;
}) {
  const { t } = useTranslation();
  const push = useActionStatus();
  const git = status?.github.git ?? 'ok';
  const ready = git === 'ok' && github.remoteUrl !== null && github.token.set;
  const missing =
    git === 'missing'
      ? t('backup-schedule.github.noGit')
      : git === 'no-history'
        ? t('backup-schedule.github.noHistory')
        : t('backup-schedule.github.missing');
  const onPush = () =>
    void push.run(
      async () => {
        const result = await pushToGithubNow();
        reload();
        if (result.ok) return t('backup-schedule.github.pushDone');
        throw new PushFailed(t(`backup-schedule.github.failure.${result.error ?? 'failed'}`));
      },
      (error) =>
        t('backup-schedule.github.pushFailed', {
          reason:
            error instanceof PushFailed
              ? error.message
              : t('backup-schedule.github.failure.failed'),
        }),
    );
  return (
    <div className="settings-subsection" role="group" aria-labelledby="settings-backup-github">
      <h4 id="settings-backup-github" className="settings-subsection__title">
        {t('backup-schedule.github.title')}
      </h4>
      <p className="settings-field__hint">{t('backup-schedule.github.intro')}</p>
      <ChannelSwitch
        id="settings-github-enabled"
        area={AREA}
        label={t('backup-schedule.github.enable')}
        checked={github.enabled}
        ready={ready}
        missing={missing}
        toPatch={(enabled) => ({ backup: { github: { enabled } } })}
      />
      <ChannelTextSetting
        id="settings-github-remote"
        area={AREA}
        label={t('backup-schedule.github.remote')}
        value={github.remoteUrl}
        placeholder={t('backup-schedule.github.remotePlaceholder')}
        hint={t('backup-schedule.github.remoteHint')}
        inputMode="url"
        toPatch={(remoteUrl) => ({ backup: { github: { remoteUrl: remoteUrl || null } } })}
      />
      <ChannelSecretField
        id="settings-github-token"
        area={AREA}
        label={t('backup-schedule.github.token')}
        name={t('backup-schedule.github.tokenName')}
        status={github.token}
        hint={t('backup-schedule.github.tokenHint')}
        toPatch={(token) => ({ backup: { github: { token } } })}
      />
      <ChannelTextSetting
        id="settings-github-branch"
        area={AREA}
        label={t('backup-schedule.github.branch')}
        value={github.branch}
        className="settings-input--name"
        parse={(text) => ({ value: text === '' ? 'main' : text })}
        toPatch={(branch) => ({ backup: { github: { branch } } })}
      />
      <div className="settings-field">
        <div className="settings-field__control">
          <button
            type="button"
            className="button button--secondary"
            aria-disabled={push.state.kind === 'busy' || !ready || undefined}
            onClick={() => {
              if (ready) onPush();
            }}
          >
            {t('backup-schedule.github.push')}
          </button>
        </div>
        <div className="settings-field__hint" role="status">
          <LastPush push={status?.github.lastPush ?? null} />
        </div>
        <ActionMessage state={push.state} busyText={t('backup-schedule.github.pushBusy')} />
      </div>
    </div>
  );
}
