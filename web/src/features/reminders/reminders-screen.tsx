import { useEffect, useLayoutEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import type { ReminderEntry } from '../../lib/api/reminders-types';
import { SETTINGS_ROUTE } from '../../lib/app-navigation';
import { confirmDialog } from '../../lib/dialogs/dialog-requests';
import { NotificationHint } from './notification-hint';
import { ReminderRow } from './reminder-row';
import { useRemindersStore } from './reminders-store';
import './reminders-screen.css';

const TITLE_ID = 'reminders-title';

/** Where focus goes once dismissed rows have left the list. */
type FocusAfterDismiss = { kind: 'row'; key: string } | { kind: 'heading' };

/**
 * "Nhắc nhở" (`#/reminders`, SPEC F17): what the server reminded her of in the last days (also
 * the ones caught up after sleep), newest first; "Bỏ qua" takes one off the list (focus moves to
 * the next row, or the heading when the list is empty); "Bỏ qua tất cả" asks first.
 */
export function RemindersScreen() {
  const { t } = useTranslation();
  const { status, available, time, reminders, load, dismiss } = useRemindersStore();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const focusAfter = useRef<FocusAfterDismiss | null>(null);

  useEffect(() => {
    void useRemindersStore.getState().load();
  }, []);

  // The dismissed row (and its focused button) is gone: keep the keyboard in the list.
  useLayoutEffect(() => {
    const target = focusAfter.current;
    if (!target) return;
    focusAfter.current = null;
    const rows = [...(listRef.current?.querySelectorAll<HTMLElement>('[data-reminder-key]') ?? [])];
    const row =
      target.kind === 'row' ? rows.find((el) => el.dataset.reminderKey === target.key) : undefined;
    (row?.querySelector<HTMLElement>('.reminder-row__dismiss') ?? headingRef.current)?.focus();
  }, [reminders]);

  const onDismiss = (entry: ReminderEntry) => {
    const index = reminders.findIndex((item) => item.key === entry.key);
    const next = reminders[index + 1] ?? reminders[index - 1];
    focusAfter.current = next ? { kind: 'row', key: next.key } : { kind: 'heading' };
    void dismiss([entry.key]);
  };

  const onDismissAll = async () => {
    const keys = reminders.map((entry) => entry.key);
    const confirmed = await confirmDialog({
      title: t('reminders.dismissAllTitle', { count: keys.length }),
      body: t('reminders.dismissAllBody'),
      confirmLabel: t('reminders.dismissAll'),
    });
    if (!confirmed) return;
    focusAfter.current = { kind: 'heading' };
    await dismiss(keys);
  };

  return (
    <section className="reminders-screen" aria-labelledby={TITLE_ID}>
      <div className="reminders-screen__head">
        <h1 id={TITLE_ID} ref={headingRef} className="text-display" tabIndex={-1}>
          {t('reminders.title')}
        </h1>
        {reminders.length > 1 ? (
          <button
            type="button"
            className="button button--secondary"
            onClick={() => void onDismissAll()}
          >
            {t('reminders.dismissAll')}
          </button>
        ) : null}
      </div>
      <p className="reminders-screen__note">
        {/* Offline before the first answer the time is unknown: no sentence rather than a guess. */}
        {time ? `${t('reminders.time', { time })} ` : null}
        <Link to={SETTINGS_ROUTE}>{t('reminders.changeTime')}</Link>
      </p>
      <NotificationHint />
      {!available ? <p className="reminders-screen__note">{t('reminders.unavailable')}</p> : null}
      {status === 'loading' ? (
        <p className="reminders-screen__note">{t('reminders.loading')}</p>
      ) : null}
      {status === 'error' ? (
        <div className="reminders-screen__note">
          <p role="alert">{t('reminders.loadError')}</p>
          <button type="button" className="button button--secondary" onClick={() => void load()}>
            {t('reminders.retry')}
          </button>
        </div>
      ) : null}
      {status === 'ready' && reminders.length === 0 ? (
        <p className="reminders-screen__empty">{t('reminders.empty')}</p>
      ) : null}
      {reminders.length > 0 ? (
        <ul ref={listRef} className="reminders-list" aria-label={t('reminders.listLabel')}>
          {reminders.map((entry) => (
            <ReminderRow key={entry.key} entry={entry} onDismiss={onDismiss} />
          ))}
        </ul>
      ) : null}
    </section>
  );
}
