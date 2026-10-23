/**
 * When a scheduled backup is due (SPEC F27.1, F27.2), as a pure function of the clock, the
 * configured time and what the records say. The slot that matters is the most recent `HH:mm`
 * (local) at or before now: today's once it has come, else yesterday's.
 * - on time: today's slot has come, nothing was tried since, and the check runs within
 *   `ON_TIME_MS` of the slot (the 60 s tick);
 * - catch-up (machine off or asleep at the slot, or no backup ever): nothing was tried since that
 *   slot and the last success is more than 24 h old (or there is none). A morning start after an
 *   evening off therefore catches up at once; the catch-up counts as the attempt for yesterday's
 *   slot, so today's slot runs on time again (one run per slot). When today's slot is less than
 *   `ON_TIME_MS` away the catch-up waits for it, so a start at 20:50 runs once at 21:00, not twice;
 * - retry: a failed run asked for another try at `retryAt` (1 h later); until then nothing else.
 */
import type { BackupRun, BackupRunKind, VaultBackupRecord } from './schedule-types.js';

export const ON_TIME_MS = 15 * 60_000;
export const CATCH_UP_AGE_MS = 24 * 60 * 60_000;
export const RETRY_AFTER_MS = 60 * 60_000;

const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;

export interface TimingInput {
  now: Date;
  /** `HH:mm`; anything else falls back to 21:00. */
  time: string;
  lastSuccessAt: string | null;
  lastAttemptAt: string | null;
  retryAt: string | null;
}

/** The local instant of `time` on the calendar day of `day` (DST-safe: setHours on that day). */
export function slotOn(day: Date, time: string): Date {
  const match = TIME.exec(time);
  const slot = new Date(day.getFullYear(), day.getMonth(), day.getDate());
  slot.setHours(match ? Number(match[1]) : 21, match ? Number(match[2]) : 0, 0, 0);
  return slot;
}

const instant = (iso: string | null): number | null => {
  const ms = iso === null ? NaN : Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
};

const dayBefore = (day: Date) => new Date(day.getFullYear(), day.getMonth(), day.getDate() - 1);
const dayAfter = (day: Date) => new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1);

/** The most recent slot at or before `now`: today's once it has come, else yesterday's. */
export function recentSlot(now: Date, time: string): Date {
  const today = slotOn(now, time);
  return now.getTime() >= today.getTime() ? today : slotOn(dayBefore(now), time);
}

/** The kind of run due right now, or null. */
export function dueBackupKind(input: TimingInput): BackupRunKind | null {
  const now = input.now.getTime();
  const retryAt = instant(input.retryAt);
  if (retryAt !== null) return now >= retryAt ? 'retry' : null;
  const today = slotOn(input.now, input.time).getTime();
  const slot = recentSlot(input.now, input.time).getTime();
  const attempt = instant(input.lastAttemptAt);
  if (attempt !== null && attempt >= slot) return null;
  if (slot === today && now - slot <= ON_TIME_MS) return 'scheduled';
  if (now < today && today - now <= ON_TIME_MS) return null; // the on-time run is minutes away
  const success = instant(input.lastSuccessAt);
  return success === null || now - success > CATCH_UP_AGE_MS ? 'catch-up' : null;
}

/** When the next run will start (now when one is due), for the status line. */
export function nextBackupAt(input: TimingInput): Date {
  if (dueBackupKind(input) !== null) return input.now;
  const retryAt = instant(input.retryAt);
  if (retryAt !== null) return new Date(retryAt);
  const now = input.now.getTime();
  const today = slotOn(input.now, input.time);
  const attempt = instant(input.lastAttemptAt);
  const triedToday = attempt !== null && attempt >= today.getTime();
  const next =
    now < today.getTime() && !triedToday ? today : slotOn(dayAfter(input.now), input.time);
  // The recent slot is still open: a catch-up starts once the last success turns 24 h old,
  // unless that falls within the on-time window of the next slot.
  const slot = recentSlot(input.now, input.time).getTime();
  const success = instant(input.lastSuccessAt);
  if (success !== null && !(attempt !== null && attempt >= slot)) {
    const catchUpAt = success + CATCH_UP_AGE_MS + 1;
    if (catchUpAt > now && catchUpAt < next.getTime() - ON_TIME_MS) return new Date(catchUpAt);
  }
  return next;
}

/** When a run that failed at `failedAt` is tried again. */
export const retryAfter = (failedAt: Date): string =>
  new Date(failedAt.getTime() + RETRY_AFTER_MS).toISOString();

export type Timing = Pick<VaultBackupRecord, 'lastSuccessAt' | 'lastAttemptAt' | 'retryAt'>;

/** The timing fields a run leaves behind (kept in memory when `backups.json` cannot be written). */
export function timingAfter(run: BackupRun, previousSuccess: string | null = null): Timing {
  return {
    lastAttemptAt: run.at,
    lastSuccessAt: run.ok ? run.at : previousSuccess,
    retryAt: run.ok ? null : retryAfter(new Date(run.at)),
  };
}
