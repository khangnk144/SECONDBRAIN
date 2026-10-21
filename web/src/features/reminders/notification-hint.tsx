import { Bell } from '@phosphor-icons/react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { vaultStorage } from '../../lib/vault-storage';
import { useNotificationPermission } from './notification-permission';

export const NOTIFICATION_HINT_KEY = 'reminders.notificationHintDismissed';

/**
 * SPEC F17: when the browser does not show notifications, the list still has every reminder and
 * a one-time hint (per vault, until "Đã hiểu") says how to turn them on.
 */
export function NotificationHint() {
  const { t } = useTranslation();
  const permission = useNotificationPermission((state) => state.permission);
  const [dismissed, setDismissed] = useState(() =>
    vaultStorage.get<boolean>(NOTIFICATION_HINT_KEY, false),
  );
  if (permission === 'granted' || dismissed) return null;
  const text =
    permission === 'denied'
      ? t('reminders.hint.denied')
      : permission === 'unsupported'
        ? t('reminders.hint.unsupported')
        : t('reminders.hint.notAsked');
  return (
    <div className="reminders-hint" role="note">
      <Bell size={18} aria-hidden="true" focusable="false" />
      <p>{text}</p>
      <button
        type="button"
        className="button button--secondary"
        onClick={() => {
          vaultStorage.set(NOTIFICATION_HINT_KEY, true);
          setDismissed(true);
        }}
      >
        {t('reminders.hint.dismiss')}
      </button>
    </div>
  );
}
