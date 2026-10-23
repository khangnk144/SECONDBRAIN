/**
 * Whether a Telegram/email message waiting in the outbox should still go out (F31.2 with F17):
 * an entry is retried for up to 24 h, and meanwhile she may tick the task, mark the project done,
 * move its deadline (a new key, so the old entry still carries the old date) or delete the note.
 * Before every attempt the entry is checked with the same rule as the in-app list and the toasts
 * (`stillOpenMatcher`): the item still exists, is open and still has that due date.
 */
import type { DeadlineItem } from '../index/index-types.js';
import type { OutboxEntry } from './notify-outbox.js';
import { stillOpenMatcher } from './reminder-items.js';

/**
 * The deadline item id inside the entry's reminder key `vaultId|itemId|due|threshold` (the vault
 * id never holds `|`; the item id may, since it carries a path). Null when the key has another
 * shape.
 */
export function outboxItemId(entry: Pick<OutboxEntry, 'reminderKey' | 'due' | 'threshold'>) {
  const start = entry.reminderKey.indexOf('|');
  const tail = `|${entry.due}|${entry.threshold}`;
  if (start === -1 || !entry.reminderKey.endsWith(tail)) return null;
  const id = entry.reminderKey.slice(start + 1, entry.reminderKey.length - tail.length);
  return id === '' ? null : id;
}

/** A check for outbox entries against the open, remindable items of this moment. */
export function stillDueMatcher(open: readonly DeadlineItem[]): (entry: OutboxEntry) => boolean {
  const stillOpen = stillOpenMatcher(open);
  return (entry) => {
    const itemId = outboxItemId(entry);
    // Keys are always written by `reminderKey`; one of another shape is never sent.
    return itemId !== null && stillOpen({ ...entry, itemId });
  };
}
