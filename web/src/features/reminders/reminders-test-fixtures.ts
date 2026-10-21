import type { ReminderEntry } from '../../lib/api/reminders-types';

/** A reminder fired today at 08:00 local time for `due`. */
export function reminderEntry(overrides: Partial<ReminderEntry> = {}): ReminderEntry {
  const path = overrides.path ?? '1 Projects/Đồ án Xác suất.md';
  const due = overrides.due ?? '2026-10-24';
  const threshold = overrides.threshold ?? 3;
  return {
    key: `vault-a|note:${path}|${due}|${threshold}`,
    itemId: `note:${path}`,
    path,
    title: 'Đồ án Xác suất',
    due,
    threshold,
    firedAt: new Date(2026, 9, 21, 8, 0).toISOString(),
    missed: false,
    toast: 'failed',
    dismissed: false,
    ...overrides,
  };
}
