import { useTranslation } from 'react-i18next';
import type { NotifyStatus } from '../../lib/api/notify-api';
import type { NotifySettingsView } from '../../lib/api/settings-m5-types';
import { ChannelSecretField } from './channel-secret-field';
import { ChannelSwitch } from './channel-switch';
import { ChannelTextSetting } from './channel-text-setting';
import { NotifyTestRow } from './notify-test-row';

const AREA = 'notify';
const STEPS = ['one', 'two', 'three', 'four'] as const;

/** Telegram (SPEC F31.1): switch, bot token (masked), chat id, how-to, consent, "Gửi thử". */
export function NotifyTelegramBlock({
  telegram,
  status,
}: {
  telegram: NotifySettingsView['telegram'];
  status: NotifyStatus | null;
}) {
  const { t } = useTranslation();
  const ready = telegram.botToken.set && telegram.chatId !== null;
  return (
    <div className="settings-subsection" role="group" aria-labelledby="settings-notify-telegram">
      <h4 id="settings-notify-telegram" className="settings-subsection__title">
        {t('notify.telegram.title')}
      </h4>
      <ChannelSwitch
        id="settings-telegram-enabled"
        area={AREA}
        label={t('notify.telegram.enable')}
        checked={telegram.enabled}
        ready={ready}
        missing={t('notify.telegram.missing')}
        hint={
          <span className="settings-consent">
            {telegram.chatId
              ? t('notify.telegram.consent', { chatId: telegram.chatId })
              : t('notify.telegram.consentNoChat')}
          </span>
        }
        toPatch={(enabled) => ({ notify: { telegram: { enabled } } })}
      />
      <ChannelSecretField
        id="settings-telegram-token"
        area={AREA}
        label={t('notify.telegram.botToken')}
        name={t('notify.telegram.botTokenName')}
        status={telegram.botToken}
        toPatch={(botToken) => ({ notify: { telegram: { botToken } } })}
      />
      <ChannelTextSetting
        id="settings-telegram-chat"
        area={AREA}
        label={t('notify.telegram.chatId')}
        value={telegram.chatId}
        className="settings-input--name"
        hint={t('notify.telegram.chatIdHint')}
        toPatch={(chatId) => ({ notify: { telegram: { chatId: chatId || null } } })}
      />
      <details className="settings-howto">
        <summary>{t('notify.telegram.howTo')}</summary>
        <ol>
          {STEPS.map((step) => (
            <li key={step}>{t(`notify.telegram.howToSteps.${step}`)}</li>
          ))}
        </ol>
      </details>
      <NotifyTestRow
        channel="telegram"
        channelName={t('notify.telegram.title')}
        ready={ready}
        status={status}
      />
    </div>
  );
}
