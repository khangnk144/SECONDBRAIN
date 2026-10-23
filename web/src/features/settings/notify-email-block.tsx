import { useTranslation } from 'react-i18next';
import type { NotifyStatus } from '../../lib/api/notify-api';
import {
  EMAIL_SECURITIES,
  type EmailSecurity,
  type NotifySettingsView,
} from '../../lib/api/settings-m5-types';
import { ChannelSecretField } from './channel-secret-field';
import { useChannelSettingSave } from './channel-setting-save';
import { ChannelSwitch } from './channel-switch';
import { ChannelTextSetting } from './channel-text-setting';
import { ChoiceGroup } from './choice-group';
import { NotifyTestRow } from './notify-test-row';
import { SaveStatus } from './save-status';

const AREA = 'notify';
type Email = NotifySettingsView['email'];
type TextField = 'host' | 'user' | 'from' | 'to';

/** Every field the email channel needs (a user name needs its password). */
export function emailReady(email: Email): boolean {
  if (!email.host || !email.from || !email.to) return false;
  return !email.user || email.password.set;
}

function SecurityChoice({ value }: { value: EmailSecurity }) {
  const { t } = useTranslation();
  const { state, save } = useChannelSettingSave(AREA);
  // "none" is refused for a server that is not on this machine (`tls-required`, review L7).
  return (
    <>
      <ChoiceGroup
        name="settings-email-security"
        legend={t('notify.email.security')}
        value={value}
        choices={EMAIL_SECURITIES.map((choice) => ({
          value: choice,
          label: t(`notify.email.securityChoices.${choice}`),
        }))}
        onChange={(security) => void save({ notify: { email: { security } } })}
        status={<SaveStatus state={state} />}
      />
      <p className="settings-field__hint">{t('notify.email.securityHint')}</p>
    </>
  );
}

/** Email (SPEC F31.1): SMTP server, port, security, login, password (masked), from, to. */
export function NotifyEmailBlock({ email, status }: { email: Email; status: NotifyStatus | null }) {
  const { t } = useTranslation();
  const ready = emailReady(email);
  const text = (field: TextField, extra: { placeholder?: string; hint?: string } = {}) => (
    <ChannelTextSetting
      id={`settings-email-${field}`}
      area={AREA}
      label={t(`notify.email.${field}`)}
      value={email[field]}
      className="settings-input--name"
      inputMode={field === 'from' || field === 'to' ? 'email' : undefined}
      toPatch={(value) => ({ notify: { email: { [field]: value || null } } })}
      {...extra}
    />
  );
  return (
    <div className="settings-subsection" role="group" aria-labelledby="settings-notify-email">
      <h4 id="settings-notify-email" className="settings-subsection__title">
        {t('notify.email.title')}
      </h4>
      <ChannelSwitch
        id="settings-email-enabled"
        area={AREA}
        label={t('notify.email.enable')}
        checked={email.enabled}
        ready={ready}
        missing={t('notify.email.missing')}
        hint={
          <span className="settings-consent">
            {email.to && email.host
              ? t('notify.email.consent', { to: email.to, host: email.host })
              : t('notify.email.consentIncomplete')}
          </span>
        }
        toPatch={(enabled) => ({ notify: { email: { enabled } } })}
      />
      {text('host', { placeholder: t('notify.email.hostPlaceholder') })}
      <ChannelTextSetting
        id="settings-email-port"
        area={AREA}
        label={t('notify.email.port')}
        value={String(email.port)}
        className="settings-input--port"
        inputMode="numeric"
        hint={t('notify.email.portHint')}
        parse={(value) => {
          const port = /^\d{1,5}$/.test(value) ? Number(value) : NaN;
          return port >= 1 && port <= 65_535
            ? { value: String(port) }
            : { error: t('notify.email.portInvalid') };
        }}
        toPatch={(port) => ({ notify: { email: { port: Number(port) } } })}
      />
      <SecurityChoice value={email.security} />
      {text('user', { hint: t('notify.email.userHint') })}
      <ChannelSecretField
        id="settings-email-password"
        area={AREA}
        label={t('notify.email.password')}
        name={t('notify.email.passwordName')}
        status={email.password}
        hint={t('notify.email.passwordHint')}
        toPatch={(password) => ({ notify: { email: { password } } })}
      />
      {text('from')}
      {text('to')}
      <NotifyTestRow
        channel="email"
        channelName={t('notify.email.title')}
        ready={ready}
        status={status}
      />
    </div>
  );
}
