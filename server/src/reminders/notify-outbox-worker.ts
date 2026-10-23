/**
 * Fills and drains the Telegram/email outbox (SPEC F31.2). The reminder scheduler's own firing
 * decision (on time or caught up) enqueues one entry per channel that is on and set up; the
 * worker runs after each scheduler pass (every 60 s) and sends what is due. Each attempt is
 * claimed in the file first (`sending`), so a crash during a send never sends it again after
 * the restart (at most once, like the toasts). Failures retry after 1 min, 5 min, 30 min, 2 h,
 * then every 2 h until 24 h after the reminder fired; then the entry is `failed`. A channel
 * switched off drops its pending entries, and so does an item that was done, rescheduled or
 * deleted since (checked before every attempt, `stillDue`). Closing the plugin aborts a send in
 * flight (`signal`): it counts as interrupted and is not repeated. Logs carry codes and counts
 * only.
 */
import { errorCodeOf } from '../app-context/app-context-errors.js';
import type { NotifySettings } from '../config/settings-sections-m5.js';
import type { AppLogger } from '../logging/rotating-file-logger.js';
import { toLocalDate } from '../lib/local-date.js';
import type { ChannelDeps, ChannelResult, NotifyChannelName } from './channels/channel-types.js';
import { NOTIFY_CHANNELS } from './channels/channel-types.js';
import { buildChannel, isChannelConfigured, isChannelOn } from './channels/notify-channels.js';
import { reminderMessage } from './channels/notify-messages.js';
import type { NotifyOutbox, OutboxEntry } from './notify-outbox.js';
import type { ReminderLanguage } from './reminder-messages.js';
import type { ReminderEntry } from './reminder-types.js';

export const BACKOFF_MS = [60_000, 5 * 60_000, 30 * 60_000, 2 * 60 * 60_000] as const;
export const REPEAT_MS = 2 * 60 * 60_000;
export const GIVE_UP_AFTER_MS = 24 * 60 * 60_000;

/** Delay after the n-th failed attempt (n ≥ 1). */
export function retryDelay(failures: number): number {
  return BACKOFF_MS[failures - 1] ?? REPEAT_MS;
}

/** Channels a firing goes to now: on and set up. */
export function activeChannels(notify: NotifySettings): NotifyChannelName[] {
  return NOTIFY_CHANNELS.filter(
    (name) => isChannelOn(name, notify) && isChannelConfigured(name, notify),
  );
}

/** One entry per reminder and active channel; keys already in the outbox are skipped. */
export async function enqueueFired(
  outbox: NotifyOutbox,
  fired: readonly ReminderEntry[],
  channels: readonly NotifyChannelName[],
  now: Date,
): Promise<number> {
  const fresh: OutboxEntry[] = [];
  for (const reminder of fired) {
    for (const channel of channels) {
      const key = `${reminder.key}|${channel}`;
      if (outbox.has(key)) continue;
      fresh.push({
        key,
        reminderKey: reminder.key,
        channel,
        path: reminder.path,
        title: reminder.title,
        due: reminder.due,
        threshold: reminder.threshold,
        createdAt: now.toISOString(),
        status: 'pending',
        attempts: 0,
        nextAttemptAt: now.toISOString(),
      });
    }
  }
  if (fresh.length > 0) await outbox.update((entries) => entries.push(...fresh));
  return fresh.length;
}

export interface DrainDeps {
  outbox: NotifyOutbox;
  notify: () => NotifySettings;
  language: () => ReminderLanguage;
  port: number;
  now: () => Date;
  logger: AppLogger;
  channels?: ChannelDeps;
  /** False once the plugin is closing: nothing new is started. */
  isOpen: () => boolean;
  /**
   * A check of this moment, made once per drain: does the entry's item still exist, open, with
   * that due date? An entry that fails it is dropped (`not-relevant`). Default: always.
   */
  stillDue?: () => Promise<(entry: OutboxEntry) => boolean>;
  /** Aborted when the plugin closes: a send in flight stops and counts as interrupted. */
  signal?: AbortSignal;
}

function settle(entry: OutboxEntry, result: ChannelResult, at: Date): void {
  if (result.ok) {
    entry.status = 'sent';
    entry.sentAt = at.toISOString();
    entry.nextAttemptAt = null;
    delete entry.lastError;
    return;
  }
  entry.lastError = result.error;
  const next = at.getTime() + retryDelay(entry.attempts);
  // Interrupted by a shutdown: it may have gone out, so never again (at most once).
  if (result.error === 'interrupted' || next > Date.parse(entry.createdAt) + GIVE_UP_AFTER_MS) {
    entry.status = 'failed';
    entry.nextAttemptAt = null;
  } else {
    entry.status = 'pending';
    entry.nextAttemptAt = new Date(next).toISOString();
  }
}

/** Marks the pending entries of channels switched off as `dropped` (never sent later). */
async function dropSwitchedOff(deps: DrainDeps): Promise<void> {
  const notify = deps.notify();
  const off = (e: OutboxEntry) => e.status === 'pending' && !isChannelOn(e.channel, notify);
  if (!deps.outbox.entries().some(off)) return;
  await deps.outbox.update((entries) => {
    for (const entry of entries.filter(off)) {
      entry.status = 'dropped';
      entry.lastError = 'channel-off';
      entry.nextAttemptAt = null;
    }
  });
}

/**
 * Marks the pending entries whose item is done, rescheduled or deleted as `dropped` (all of them,
 * so the "đang chờ gửi" count in Settings is right too).
 */
async function dropIrrelevant(deps: DrainDeps): Promise<Set<string>> {
  if (!deps.stillDue) return new Set();
  const stillDue = await deps.stillDue();
  const gone = (e: OutboxEntry) => e.status === 'pending' && !stillDue(e);
  const dropped = new Set(
    deps.outbox
      .entries()
      .filter(gone)
      .map((e) => e.key),
  );
  if (dropped.size === 0) return dropped;
  await deps.outbox.update((entries) => {
    for (const entry of entries) {
      if (!dropped.has(entry.key) || entry.status !== 'pending') continue;
      entry.status = 'dropped';
      entry.lastError = 'not-relevant';
      entry.nextAttemptAt = null;
    }
  });
  deps.logger.info(`Reminders: ${dropped.size} messages dropped (item done, moved or deleted).`);
  return dropped;
}

/** Sends every entry that is due; never throws. Resolves with the number sent. */
export async function drainOutbox(deps: DrainDeps): Promise<number> {
  const { outbox, logger } = deps;
  if (!outbox.entries().some((e) => e.status === 'pending')) return 0; // the usual case: no IO
  let sent = 0;
  try {
    await dropSwitchedOff(deps);
    const dropped = await dropIrrelevant(deps);
    const due = outbox
      .entries()
      .filter(
        (e) => e.status === 'pending' && Date.parse(e.nextAttemptAt ?? '') <= deps.now().getTime(),
      )
      .map((e) => e.key);
    for (const key of due) {
      if (!deps.isOpen()) break;
      if (dropped.has(key)) continue;
      const current = outbox.entries().find((e) => e.key === key);
      if (!current || current.status !== 'pending') continue;
      // Claimed before the send: a crash in between never repeats it.
      await outbox.update((entries) => {
        const entry = entries.find((e) => e.key === key);
        if (!entry) return;
        entry.status = 'sending';
        entry.attempts += 1;
      });
      const notify = deps.notify();
      const channel = buildChannel(current.channel, notify, deps.channels);
      const at = deps.now();
      const message = reminderMessage(
        { ...current, today: toLocalDate(at), port: deps.port },
        deps.language(),
      );
      const result: ChannelResult = channel
        ? await channel.send(message, deps.signal)
        : { ok: false, error: 'not-configured' };
      if (result.ok) sent += 1;
      else logger.warn(`Reminder via ${current.channel} failed (${result.error}).`);
      await outbox.update((entries) => {
        const entry = entries.find((e) => e.key === key);
        if (entry) settle(entry, result, deps.now());
      });
    }
  } catch (error) {
    logger.warn(`Reminder outbox could not be written (${errorCodeOf(error)}); sending later.`);
  }
  if (sent > 0) logger.info(`Reminders: ${sent} sent via Telegram/email.`);
  return sent;
}
