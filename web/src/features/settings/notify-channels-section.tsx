/**
 * Telegram and email reminders (SPEC F31.1): in Settings → Nhắc nhở after the notification
 * permission row. Each channel is off by default and can only be turned on once its fields are
 * set; the consent line names what is sent and to whom. Secrets are masked (…last4).
 */
import { useTranslation } from 'react-i18next';
import { NotifyEmailBlock } from './notify-email-block';
import { NotifyTelegramBlock } from './notify-telegram-block';
import { useNotifyStatus } from './notify-test-row';
import { useSettingsStore } from './settings-store';
import './settings-channels.css';

export function NotifyChannelsSection() {
  const { t } = useTranslation();
  const notify = useSettingsStore((state) => state.settings?.notify);
  const status = useNotifyStatus();
  if (!notify) return null;
  return (
    <div className="settings-subsection" role="group" aria-labelledby="settings-notify-channels">
      <h3 id="settings-notify-channels" className="settings-subsection__title">
        {t('notify.title')}
      </h3>
      <p className="settings-field__hint">{t('notify.intro')}</p>
      <NotifyTelegramBlock telegram={notify.telegram} status={status} />
      <NotifyEmailBlock email={notify.email} status={status} />
    </div>
  );
}
