import { describe, expect, it } from 'vitest';
import type { DeadlineItem } from '../../src/index/index-types.js';
import { isRelevant, planReminders, reminderKey } from '../../src/reminders/reminder-plan.js';
import {
  DEFAULT_REMINDER_TIME,
  fireInstant,
  parseReminderTime,
  reminderTimeOf,
} from '../../src/reminders/reminder-time.js';
import { at } from './helpers/reminder-test-host.js';

const VAULT = 'vault-1';
const EIGHT = { hour: 8, minute: 0 };

function item(date: string, id = 'note:1 Projects/Đồ án.md'): DeadlineItem {
  return {
    id,
    kind: id.startsWith('task:') ? 'task' : 'note',
    title: 'Đồ án',
    date,
    path: '1 Projects/Đồ án.md',
    noteTitle: 'Đồ án',
    line: null,
    lineText: null,
    revision: '0'.repeat(64),
    done: false,
    urgency: 'ok',
    daysLeft: 0,
    class: 'user',
  };
}

function plan(now: Date, recorded: string[] = [], date = '2026-10-24') {
  const keys = new Set(recorded);
  return planReminders({
    vaultId: VAULT,
    items: [item(date)],
    now,
    time: EIGHT,
    isRecorded: (key) => keys.has(key),
  });
}

const key = (t: number, due = '2026-10-24') =>
  reminderKey(VAULT, 'note:1 Projects/Đồ án.md', due, t);
const fired = (p: ReturnType<typeof plan>) => p.fire.map((f) => [f.threshold, f.missed, f.overdue]);

describe('reminder time and fire instants', () => {
  it('reads HH:mm from the settings, falling back to 08:00 for anything else', () => {
    expect(reminderTimeOf({ reminders: { time: '07:30' } })).toBe('07:30');
    for (const bad of [undefined, null, 7, '7:30', '24:00', '12:60', { time: 1 }])
      expect(reminderTimeOf({ reminders: bad === undefined ? undefined : { time: bad } })).toBe(
        DEFAULT_REMINDER_TIME,
      );
    expect(reminderTimeOf({})).toBe('08:00');
    expect(parseReminderTime('23:59')).toEqual({ hour: 23, minute: 59 });
  });

  it('fires 3, 1 and 0 calendar days before the due date at the local time', () => {
    expect(fireInstant('2026-11-01', 3, EIGHT)).toEqual(at(2026, 10, 29, 8));
    expect(fireInstant('2026-11-01', 1, { hour: 21, minute: 15 })).toEqual(
      at(2026, 10, 31, 21, 15),
    );
    expect(fireInstant('2026-03-01', 0, EIGHT)).toEqual(at(2026, 3, 1, 8));
  });
});

describe('reminder planning: thresholds, catch-up and superseded keys (F17.1, F17.2)', () => {
  it('nothing before the fire time; on time is not missed, more than 5 minutes late is', () => {
    expect(plan(at(2026, 10, 21, 7, 59)).fire).toEqual([]);
    expect(fired(plan(at(2026, 10, 21, 8, 0)))).toEqual([[3, false, false]]);
    expect(fired(plan(at(2026, 10, 21, 8, 5)))).toEqual([[3, false, false]]);
    expect(fired(plan(at(2026, 10, 21, 8, 6)))).toEqual([[3, true, false]]);
  });

  it('a recorded key never fires again', () => {
    expect(plan(at(2026, 10, 21, 9), [key(3)])).toEqual({ fire: [], superseded: [] });
  });

  it('only the latest due threshold fires; earlier unfired ones are superseded', () => {
    const p = plan(at(2026, 10, 23, 9));
    expect(fired(p)).toEqual([[1, true, false]]);
    expect(p.fire[0]?.key).toBe(key(1));
    expect(p.superseded.map((s) => s.key)).toEqual([key(3)]);
    // Already fired the 1-day one: the old 3-day key is set aside, never reminded out of order.
    const later = plan(at(2026, 10, 23, 10), [key(1)]);
    expect(later.fire).toEqual([]);
    expect(later.superseded.map((s) => s.key)).toEqual([key(3)]);
  });

  it('a caught-up 1-day reminder still fires on the due day before the reminder time', () => {
    expect(fired(plan(at(2026, 10, 24, 7)))).toEqual([[1, true, false]]);
    expect(fired(plan(at(2026, 10, 24, 8), [key(1), key(3)]))).toEqual([[0, false, false]]);
  });

  it('the due-day reminder catches up until the end of the next day, then marks it overdue', () => {
    expect(fired(plan(at(2026, 10, 24, 23, 59)))).toEqual([[0, true, false]]);
    expect(fired(plan(at(2026, 10, 25, 0, 1)))).toEqual([[0, true, true]]);
    expect(fired(plan(at(2026, 10, 25, 23, 59)))).toEqual([[0, true, true]]);
    expect(plan(at(2026, 10, 26, 0, 0))).toEqual({ fire: [], superseded: [] });
  });

  it('relevance: 3/1-day while the due date has not passed, due-day until the day after', () => {
    expect(isRelevant(3, '2026-10-24', '2026-10-24')).toBe(true);
    expect(isRelevant(1, '2026-10-24', '2026-10-25')).toBe(false);
    expect(isRelevant(0, '2026-10-24', '2026-10-25')).toBe(true);
    expect(isRelevant(0, '2026-10-24', '2026-10-26')).toBe(false);
  });

  it('every item is planned on its own, with its own key', () => {
    const items = [item('2026-10-24'), item('2026-10-22', 'task:1 Projects/Đồ án.md#7')];
    const p = planReminders({
      vaultId: VAULT,
      items,
      now: at(2026, 10, 21, 8),
      time: EIGHT,
      isRecorded: () => false,
    });
    expect(p.fire.map((f) => f.key)).toEqual([
      key(3),
      reminderKey(VAULT, 'task:1 Projects/Đồ án.md#7', '2026-10-22', 1),
    ]);
    expect(p.superseded.map((s) => s.key)).toEqual([
      reminderKey(VAULT, 'task:1 Projects/Đồ án.md#7', '2026-10-22', 3),
    ]);
  });
});
