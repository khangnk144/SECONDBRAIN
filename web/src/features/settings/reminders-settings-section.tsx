import { useLayoutEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { REMINDERS_ROUTE } from '../../lib/app-navigation';
import {
  requestNotificationPermission,
  useNotificationPermission,
} from '../reminders/notification-permission';
import { useRemindersStore } from '../reminders/reminders-store';
import { SaveStatus } from './save-status';
import { SettingsField, SettingsSection } from './settings-section';
import { useSettingSave } from './use-setting-save';

const TIME_PATTERN = /^([01]?\d|2[0-3]):([0-5]\d)$/;

/** `7:30` → `07:30` (24-hour clock); null when the text is not a time of day. */
export function normalizeReminderTime(text: string): string | null {
  const match = TIME_PATTERN.exec(text.trim());
  if (!match) return null;
  return `${(match[1] ?? '').padStart(2, '0')}:${match[2] ?? ''}`;
}

/**
 * A plain text field with `HH:mm`: the browser's time input follows the browser's locale and
 * shows "08:00 AM" in the Vietnamese UI, while the app writes times on the 24-hour clock.
 */
function ReminderTimeField({ time }: { time: string }) {
  const { t } = useTranslation();
  const { state, save, fail, clear } = useSettingSave();
  const [draft, setDraft] = useState(time);
  useLayoutEffect(() => setDraft(time), [time]);

  // Saving waits until she leaves the field or presses Enter.
  const commit = () => {
    if (draft === time) return;
    const next = normalizeReminderTime(draft);
    if (next === null) {
      fail(t('settings.reminders.timeInvalid'));
      return;
    }
    setDraft(next);
    if (next === time) return;
    void save({ reminders: { time: next } }).then((settings) => {
      if (settings) void useRemindersStore.getState().load();
    });
  };

  return (
    <SettingsField
      label={t('settings.reminders.time')}
      htmlFor="settings-reminder-time"
      hint={t('settings.reminders.timeHint')}
      status={<SaveStatus state={state} id="settings-reminder-time-status" />}
    >
      <input
        id="settings-reminder-time"
        type="text"
        inputMode="numeric"
        className="text-input settings-input--time"
        value={draft}
        maxLength={5}
        autoComplete="off"
        spellCheck={false}
        required
        aria-invalid={state.kind === 'error'}
        aria-describedby="settings-reminder-time-status"
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') commit();
          if (event.key === 'Escape') {
            setDraft(time);
            clear();
          }
        }}
      />
    </SettingsField>
  );
}

/** Browser notifications: asked for only when she clicks (never on its own). */
function NotificationPermissionRow() {
  const { t } = useTranslation();
  const permission = useNotificationPermission((state) => state.permission);
  const [asking, setAsking] = useState(false);
  return (
    <div className="settings-field">
      <p className="settings-field__label">{t('settings.reminders.notifications')}</p>
      <p className="settings-field__value">{t(`settings.reminders.permission.${permission}`)}</p>
      {permission === 'default' ? (
        <div className="settings-field__control">
          <button
            type="button"
            className="button button--secondary"
            disabled={asking}
            onClick={() => {
              setAsking(true);
              void requestNotificationPermission().finally(() => setAsking(false));
            }}
          >
            {t('settings.reminders.allow')}
          </button>
        </div>
      ) : null}
      {permission === 'denied' ? (
        <p className="settings-field__hint">{t('settings.reminders.deniedHint')}</p>
      ) : null}
    </div>
  );
}

/** "Nhắc nhở": the reminder time, browser notifications, the way to the list. */
export function RemindersSettingsSection({ time }: { time: string }) {
  const { t } = useTranslation();
  return (
    <SettingsSection id="reminders" title={t('settings.reminders.title')}>
      <ReminderTimeField time={time} />
      <NotificationPermissionRow />
      <p className="settings-section__link">
        <Link to={REMINDERS_ROUTE}>{t('settings.reminders.openList')}</Link>
      </p>
    </SettingsSection>
  );
}
