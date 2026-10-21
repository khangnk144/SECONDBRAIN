/**
 * Which reminders are due right now (SPEC F17), as a pure function of the open deadline items,
 * the clock, the configured time and what was already recorded. The scheduler records the result
 * before any toast is shown.
 */
import type { DeadlineItem } from '../index/index-types.js';
import { addDays, toLocalDate } from '../lib/local-date.js';
import { fireInstant, REMINDER_THRESHOLDS, type ClockTime } from './reminder-time.js';
import type { ReminderThreshold } from './reminder-types.js';

/** A fire time passed by more than this is a catch-up (`missed: true`). */
export const MISSED_AFTER_MS = 5 * 60_000;

export interface PlannedReminder {
  key: string;
  item: DeadlineItem;
  threshold: ReminderThreshold;
  missed: boolean;
  /** The due-day reminder caught up after its day ended ("Đã quá hạn"). */
  overdue: boolean;
}

export interface ReminderPlan {
  fire: PlannedReminder[];
  /** Earlier thresholds that never fired and never will: a later one is due (or done) already. */
  superseded: { key: string; item: DeadlineItem; threshold: ReminderThreshold }[];
}

export interface PlanInput {
  vaultId: string;
  /** Open deadline items of classes that are reminded. */
  items: readonly DeadlineItem[];
  now: Date;
  time: ClockTime;
  /** True when this item's threshold already fired or was superseded (key or same task text). */
  isRecorded: (key: string, item: DeadlineItem, threshold: ReminderThreshold) => boolean;
}

export function reminderKey(vaultId: string, itemId: string, due: string, t: number): string {
  return `${vaultId}|${itemId}|${due}|${t}`;
}

/**
 * A caught-up threshold is still worth a toast: the 3- and 1-day ones while the due date has not
 * passed, the due-day one until the end of the following day. Anything older is on Today anyway.
 */
export function isRelevant(threshold: ReminderThreshold, due: string, today: string): boolean {
  return threshold > 0 ? due >= today : today <= addDays(due, 1);
}

/**
 * Per item: of the thresholds whose fire time has come, only the latest may fire (never an
 * earlier one after a later one); earlier ones that never fired are recorded as superseded.
 */
export function planReminders(input: PlanInput): ReminderPlan {
  const { now, time, vaultId } = input;
  const today = toLocalDate(now);
  const plan: ReminderPlan = { fire: [], superseded: [] };
  for (const item of input.items) {
    // Thresholds run 3 → 1 → 0, so fire times grow: the last one that has come is the latest.
    const due = REMINDER_THRESHOLDS.map((threshold) => ({
      threshold,
      at: fireInstant(item.date, threshold, time),
    })).filter((c) => c.at.getTime() <= now.getTime());
    const latest = due.at(-1);
    if (!latest || !isRelevant(latest.threshold, item.date, today)) continue;
    for (const { threshold } of due.slice(0, -1)) {
      const key = reminderKey(vaultId, item.id, item.date, threshold);
      if (!input.isRecorded(key, item, threshold)) plan.superseded.push({ key, item, threshold });
    }
    const key = reminderKey(vaultId, item.id, item.date, latest.threshold);
    if (input.isRecorded(key, item, latest.threshold)) continue;
    plan.fire.push({
      key,
      item,
      threshold: latest.threshold,
      missed: now.getTime() - latest.at.getTime() > MISSED_AFTER_MS,
      overdue: latest.threshold === 0 && today > item.date,
    });
  }
  return plan;
}
