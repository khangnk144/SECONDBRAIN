import { useTranslation } from 'react-i18next';
import type { ReminderEntry } from '../../lib/api/reminders-types';
import { useTabsStore } from '../../lib/tabs-store';
import {
  reminderDaysLeft,
  reminderDueText,
  reminderFiredText,
  reminderUrgency,
} from './reminder-labels';

/** One reminder: the title opens the note; due text in the urgency text colour; "Bỏ qua". */
export function ReminderRow({
  entry,
  onDismiss,
}: {
  entry: ReminderEntry;
  onDismiss: (entry: ReminderEntry) => void;
}) {
  const { t } = useTranslation();
  const daysLeft = reminderDaysLeft(entry.due);
  const urgency = reminderUrgency(daysLeft);
  return (
    <li className="reminder-row" data-reminder-key={entry.key}>
      <span className={`reminder-row__dot reminder-row__dot--${urgency}`} aria-hidden="true" />
      <div className="reminder-row__body">
        <button
          type="button"
          className="reminder-row__title"
          onClick={(event) =>
            useTabsStore.getState().openNote(entry.path, { newTab: event.ctrlKey || event.metaKey })
          }
        >
          {entry.title}
        </button>
        <p className="reminder-row__meta">
          <span className={`reminder-row__due reminder-row__due--${urgency}`}>
            {reminderDueText(daysLeft, t)}
          </span>
          <span>{reminderFiredText(entry, t)}</span>
        </p>
      </div>
      <button
        type="button"
        className="button button--secondary reminder-row__dismiss"
        aria-label={t('reminders.dismissNamed', { title: entry.title })}
        onClick={() => onDismiss(entry)}
      >
        {t('reminders.dismiss')}
      </button>
    </li>
  );
}
