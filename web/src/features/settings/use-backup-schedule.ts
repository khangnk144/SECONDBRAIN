import { useCallback, useEffect, useRef, useState } from 'react';
import { getBackupSchedule, type BackupScheduleStatus } from '../../lib/api/backup-schedule-api';
import { useSettingsStore } from './settings-store';

/** While a backup or push runs in the background, the status is asked again this often. */
export const BUSY_POLL_MS = 2_000;
/** Once a run is due, the server's scheduler starts it within its 60 s tick: ask this often… */
export const DUE_POLL_MS = 10_000;
/** …for this long after the due time (then the next visit or change asks again). */
export const DUE_WINDOW_MS = 3 * 60_000;
/** Just after the due time, so the first look already finds the run started or done. */
const DUE_MARGIN_MS = 2_000;
/** `setTimeout` cannot wait longer than this (about 24.8 days). */
const MAX_TIMEOUT_MS = 2 ** 31 - 1;

/**
 * When to ask for the status again on its own (E2E D3: a scheduled run between two reads was
 * never seen, so Settings kept "Lần tới: 20:07" after 20:07 had passed): just after the next run
 * or retry is due, then every `DUE_POLL_MS` until the scheduler has taken it (the status then
 * names a later time or shows the run). Null: nothing is due (off, or a run is being polled).
 */
export function nextStatusCheckMs(status: BackupScheduleStatus | null, now: number): number | null {
  if (!status || status.running || status.github.pushing) return null;
  const due = [status.nextRunAt, status.retryAt]
    .map((at) => (at === null ? Number.NaN : Date.parse(at)))
    .filter((at) => Number.isFinite(at));
  if (due.length === 0) return null;
  const soonest = Math.min(...due);
  if (now < soonest) return Math.min(soonest - now + DUE_MARGIN_MS, MAX_TIMEOUT_MS);
  return now - soonest <= DUE_WINDOW_MS ? DUE_POLL_MS : null;
}

const visible = () => typeof document === 'undefined' || document.visibilityState !== 'hidden';

/**
 * The status of the scheduled backups (`GET /api/backup/schedule`): read on mount, after each
 * change of the backup settings, on `reload()`, when the window becomes visible again, and on its
 * own while Settings is open and visible: every 2 s while a run or push is busy, and around the
 * time the next run is due (`nextStatusCheckMs`). Null while unknown or when the server has no
 * schedule for this vault (the section then shows the settings only).
 */
export function useBackupSchedule(): { status: BackupScheduleStatus | null; reload: () => void } {
  const backup = useSettingsStore((state) => state.settings?.backup);
  const [status, setStatus] = useState<BackupScheduleStatus | null>(null);
  const mounted = useRef(true);
  useEffect(
    () => () => {
      mounted.current = false;
    },
    [],
  );
  const reload = useCallback(() => {
    void getBackupSchedule()
      .then((answer) => mounted.current && setStatus(answer.available ? answer : null))
      .catch(() => mounted.current && setStatus(null));
  }, []);
  const settingsKey = JSON.stringify(backup ?? null);
  useEffect(() => reload(), [reload, settingsKey]);
  const busy = status?.running || status?.github.pushing;
  useEffect(() => {
    if (!busy) return;
    const timer = setTimeout(reload, BUSY_POLL_MS);
    return () => clearTimeout(timer);
  }, [busy, reload, status]);
  useEffect(() => {
    const delay = nextStatusCheckMs(status, Date.now());
    if (delay === null) return;
    // A hidden window is not polled; it asks again as soon as it is shown.
    const timer = setTimeout(() => {
      if (visible()) reload();
    }, delay);
    return () => clearTimeout(timer);
  }, [reload, status]);
  useEffect(() => {
    const onVisible = () => {
      if (visible()) reload();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [reload]);
  return { status, reload };
}
