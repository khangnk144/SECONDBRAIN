/** Wires the reminder notifier to the browser and to the `reminder` event. */
import { i18n } from '../../i18n';
import type { ReminderEntry } from '../../lib/api/reminders-types';
import { useTabsStore } from '../../lib/tabs-store';
import { subscribeServerEvent } from '../../lib/ws/server-event-bus';
import { PAGE_WINDOW_ID } from '../drafts/draft-store';
import { readNotificationPermission } from './notification-permission';
import { reminderDaysLeft, reminderDueDate, reminderDueText } from './reminder-labels';
import {
  createReminderNotifier,
  REMINDERS_CHANNEL,
  type ChannelLike,
  type LocksLike,
} from './reminder-notifications';

function showBrowserNotification(entry: ReminderEntry, onClick: () => void): void {
  const t = i18n.t.bind(i18n);
  const due = reminderDueText(reminderDaysLeft(entry.due), t);
  const notification = new Notification(t('reminders.notification.title', { title: entry.title }), {
    body: t('reminders.notification.body', { due, date: reminderDueDate(entry.due) }),
    tag: entry.key,
    lang: i18n.language,
  });
  notification.onclick = () => {
    onClick();
    notification.close();
  };
}

function openReminderNote(entry: ReminderEntry): void {
  window.focus();
  useTabsStore.getState().openNote(entry.path);
}

export function startReminderNotifications(): () => void {
  const locks = (navigator as Navigator & { locks?: LocksLike }).locks ?? null;
  const notifier = createReminderNotifier({
    windowId: PAGE_WINDOW_ID,
    locks,
    createChannel:
      typeof BroadcastChannel === 'function'
        ? () => new BroadcastChannel(REMINDERS_CHANNEL) as ChannelLike
        : null,
    permission: () => readNotificationPermission(),
    show: showBrowserNotification,
    open: openReminderNote,
  });
  const stop = subscribeServerEvent('reminder', (event) => notifier.handle(event.reminder));
  return () => {
    stop();
    notifier.stop();
  };
}
