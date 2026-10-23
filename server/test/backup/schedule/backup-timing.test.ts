import { describe, expect, it } from 'vitest';
import {
  CATCH_UP_AGE_MS,
  dueBackupKind,
  nextBackupAt,
  ON_TIME_MS,
  slotOn,
} from '../../../src/backup/schedule/backup-timing.js';

/** Local time; months are 1-based here. */
const at = (y: number, mo: number, d: number, h: number, mi = 0) => new Date(y, mo - 1, d, h, mi);
const iso = (date: Date) => date.toISOString();

const base = { time: '21:00', lastSuccessAt: null, lastAttemptAt: null, retryAt: null };

describe('when a scheduled backup is due (F27.1, F27.2)', () => {
  it('(F27.1) the configured local time starts it, once per day', () => {
    const yesterday = iso(at(2026, 10, 21, 21, 0));
    const input = { ...base, lastSuccessAt: yesterday, lastAttemptAt: yesterday };
    expect(dueBackupKind({ ...input, now: at(2026, 10, 22, 20, 59) })).toBeNull();
    expect(dueBackupKind({ ...input, now: at(2026, 10, 22, 21, 0) })).toBe('scheduled');
    expect(dueBackupKind({ ...input, now: at(2026, 10, 22, 21, 14) })).toBe('scheduled');
    // Tried at 21:00 today: never again today, whatever happened.
    const done = { ...input, lastAttemptAt: iso(at(2026, 10, 22, 21, 0)) };
    expect(dueBackupKind({ ...done, now: at(2026, 10, 22, 21, 1) })).toBeNull();
    expect(dueBackupKind({ ...done, now: at(2026, 10, 22, 23, 59) })).toBeNull();
  });

  it('(F27.2) asleep over the time: one catch-up on wake when the last success is > 24 h old', () => {
    const lastNight = iso(at(2026, 10, 21, 21, 0));
    const input = { ...base, lastSuccessAt: lastNight, lastAttemptAt: lastNight };
    // Woke at 21:20, 24 h 20 min after the last success.
    expect(dueBackupKind({ ...input, now: at(2026, 10, 22, 21, 20) })).toBe('catch-up');
    // A catch-up yesterday at 23:30 is less than 24 h old at 22:00 today: today's missed slot
    // is caught up once it is (23:30), not sooner.
    const lateCatchUp = iso(at(2026, 10, 21, 23, 30));
    const recent = { ...base, lastSuccessAt: lateCatchUp, lastAttemptAt: lateCatchUp };
    expect(dueBackupKind({ ...recent, now: at(2026, 10, 22, 22, 0) })).toBeNull();
    expect(nextBackupAt({ ...recent, now: at(2026, 10, 22, 22, 0) }).getTime()).toBe(
      at(2026, 10, 22, 23, 30).getTime() + 1,
    );
    expect(dueBackupKind({ ...recent, now: at(2026, 10, 22, 23, 31) })).toBe('catch-up');
    // Never backed up and the time has passed: catch up now.
    expect(dueBackupKind({ ...base, now: at(2026, 10, 22, 22, 0) })).toBe('catch-up');
    // Before today's time a week off is caught up too: yesterday's slot was missed.
    const weekAgo = iso(at(2026, 10, 15, 21, 0));
    expect(
      dueBackupKind({
        ...base,
        lastSuccessAt: weekAgo,
        lastAttemptAt: weekAgo,
        now: at(2026, 10, 22, 9, 0),
      }),
    ).toBe('catch-up');
  });

  it('(F27.2) a morning start after an evening off catches up at once, then 21:00 runs on time', () => {
    // Off at 20:00 every evening: the last success (Sunday 21:00) is 35 h old on Tuesday 08:00.
    const sunday = iso(at(2026, 10, 18, 21, 0));
    const input = { ...base, lastSuccessAt: sunday, lastAttemptAt: sunday };
    expect(dueBackupKind({ ...input, now: at(2026, 10, 20, 8, 0) })).toBe('catch-up');
    expect(nextBackupAt({ ...input, now: at(2026, 10, 20, 8, 0) })).toEqual(at(2026, 10, 20, 8, 0));
    // The catch-up at 08:00 stands for Monday's slot: nothing more until Tuesday 21:00.
    const morning = iso(at(2026, 10, 20, 8, 0));
    const caughtUp = { ...base, lastSuccessAt: morning, lastAttemptAt: morning };
    expect(dueBackupKind({ ...caughtUp, now: at(2026, 10, 20, 12, 0) })).toBeNull();
    expect(nextBackupAt({ ...caughtUp, now: at(2026, 10, 20, 12, 0) })).toEqual(
      at(2026, 10, 20, 21, 0),
    );
    expect(dueBackupKind({ ...caughtUp, now: at(2026, 10, 20, 21, 0) })).toBe('scheduled');
    // Off again at 20:00; Wednesday 07:50 the success is not yet 24 h old: it runs at 08:00.
    expect(dueBackupKind({ ...caughtUp, now: at(2026, 10, 21, 7, 50) })).toBeNull();
    const at0800 = nextBackupAt({ ...caughtUp, now: at(2026, 10, 21, 7, 50) });
    expect(at0800.getTime() - at(2026, 10, 21, 8, 0).getTime()).toBeLessThanOrEqual(1);
    expect(dueBackupKind({ ...caughtUp, now: at(2026, 10, 21, 8, 1) })).toBe('catch-up');
  });

  it('(F27.2) the very first backup is not held back until the evening', () => {
    // Turned on at 10:00 with no backup at all: it runs now, not at 21:00.
    expect(dueBackupKind({ ...base, now: at(2026, 10, 22, 10, 0) })).toBe('catch-up');
    expect(dueBackupKind({ ...base, now: at(2026, 10, 22, 0, 5) })).toBe('catch-up');
  });

  it('(F27.2) a start minutes before the time waits for it: one run, not two', () => {
    const old = iso(at(2026, 10, 18, 21, 0));
    const input = { ...base, lastSuccessAt: old, lastAttemptAt: old };
    expect(dueBackupKind({ ...input, now: at(2026, 10, 22, 20, 50) })).toBeNull();
    expect(nextBackupAt({ ...input, now: at(2026, 10, 22, 20, 50) })).toEqual(
      at(2026, 10, 22, 21, 0),
    );
    expect(dueBackupKind({ ...input, now: at(2026, 10, 22, 21, 0) })).toBe('scheduled');
    expect(dueBackupKind({ ...base, now: at(2026, 10, 22, 20, 46) })).toBeNull();
    // 16 minutes before is outside the on-time window: catch up now.
    expect(dueBackupKind({ ...input, now: at(2026, 10, 22, 20, 44) })).toBe('catch-up');
  });

  it('(F27.2) a failure waits for its retry 1 h later, nothing else runs meanwhile', () => {
    const failedAt = at(2026, 10, 22, 21, 0);
    const input = {
      ...base,
      lastSuccessAt: iso(at(2026, 10, 20, 21, 0)),
      lastAttemptAt: iso(failedAt),
      retryAt: iso(new Date(failedAt.getTime() + 3_600_000)),
    };
    expect(dueBackupKind({ ...input, now: at(2026, 10, 22, 21, 59) })).toBeNull();
    expect(dueBackupKind({ ...input, now: at(2026, 10, 22, 22, 0) })).toBe('retry');
    expect(nextBackupAt({ ...input, now: at(2026, 10, 22, 21, 30) })).toEqual(
      at(2026, 10, 22, 22, 0),
    );
  });

  it('slots follow the local calendar day and malformed times fall back to 21:00', () => {
    expect(slotOn(at(2026, 10, 22, 3, 0), '07:30')).toEqual(at(2026, 10, 22, 7, 30));
    expect(slotOn(at(2026, 10, 22, 3, 0), 'bad')).toEqual(at(2026, 10, 22, 21, 0));
    expect(ON_TIME_MS).toBeLessThan(CATCH_UP_AGE_MS);
    expect(
      nextBackupAt({ ...base, lastAttemptAt: iso(at(2026, 10, 22, 8)), now: at(2026, 10, 22, 8) }),
    ).toEqual(at(2026, 10, 22, 21, 0));
  });
});
