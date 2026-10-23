import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  getNotifyStatus,
  sendTestMessage,
  type ChannelStatus,
  type NotifyChannelName,
  type NotifyStatus,
} from '../../lib/api/notify-api';
import { ActionMessage } from './action-message';
import { useWhen } from './backup-schedule-status';
import { useActionStatus } from './use-action-status';

/** The outbox state per channel (`GET /api/notify/status`); null while unknown. */
export function useNotifyStatus(): NotifyStatus | null {
  const [status, setStatus] = useState<NotifyStatus | null>(null);
  const mounted = useRef(true);
  const load = useCallback(() => {
    void getNotifyStatus()
      .then((answer) => mounted.current && setStatus(answer))
      .catch(() => mounted.current && setStatus(null));
  }, []);
  useEffect(() => {
    mounted.current = true;
    load();
    return () => {
      mounted.current = false;
    };
  }, [load]);
  return status;
}

/** A failed send in words (`notify.failure.<code>`). */
function failureText(t: (key: string) => string, code: string): string {
  return t(`notify.failure.${code}`);
}

/** A send that answered `ok: false`. */
class SendFailed extends Error {}

function ChannelStatusLine({ status }: { status: ChannelStatus | undefined }) {
  const { t } = useTranslation();
  const when = useWhen('notify');
  if (!status) return null;
  return (
    <>
      {status.lastSentAt ? (
        <span>{t('notify.lastSent', { when: when(status.lastSentAt) })}</span>
      ) : null}
      {status.lastError ? (
        <span className="settings-field__notice">
          {t('notify.lastError', { reason: failureText(t, status.lastError) })}
        </span>
      ) : null}
      {status.pending > 0 ? <span>{t('notify.pending', { count: status.pending })}</span> : null}
    </>
  );
}

/**
 * "Gửi thử" (SPEC F31.1): one test message with the saved settings, also before the channel is
 * on; then what happened in words. Below it, what the outbox says about real reminders.
 */
export function NotifyTestRow({
  channel,
  channelName,
  ready,
  status,
}: {
  channel: NotifyChannelName;
  /** "Telegram" / "email", for the sentences. */
  channelName: string;
  ready: boolean;
  status: NotifyStatus | null;
}) {
  const { t } = useTranslation();
  const test = useActionStatus();
  const onTest = () =>
    void test.run(
      async () => {
        const result = await sendTestMessage(channel);
        if (result.ok) return t('notify.testDone', { channel: channelName });
        throw new SendFailed(failureText(t, result.error));
      },
      (error) =>
        t('notify.testFailed', {
          reason: error instanceof SendFailed ? error.message : t('notify.failure.network'),
        }),
    );
  return (
    <div className="settings-field">
      <div className="settings-field__control">
        <button
          type="button"
          className="button button--secondary"
          aria-label={t('notify.testNamed', { channel: channelName })}
          aria-disabled={test.state.kind === 'busy' || !ready || undefined}
          onClick={() => {
            if (ready) onTest();
          }}
        >
          {t('notify.test')}
        </button>
      </div>
      <ActionMessage state={test.state} busyText={t('notify.testBusy')} />
      <div className="settings-field__hint">
        <ChannelStatusLine status={status?.available ? status[channel] : undefined} />
      </div>
    </div>
  );
}
