/**
 * "Today" as a local calendar date `YYYY-MM-DD` (SPEC §4.7: never a UTC instant) and a single
 * watcher that tells every view when the day changes: a timer just after local midnight, plus a
 * check when the page becomes visible or the window regains focus (the machine may have slept
 * through midnight).
 */
import { useEffect, useState } from 'react';
import { scheduleDayChange } from '../editor/extensions/day-change-timer';
import { addDays, formatIsoDate, localDateString, parseIsoDate } from '../editor/local-dates';

export function todayIso(now: Date = new Date()): string {
  return localDateString(now);
}

/** `iso` plus `days` calendar days (negative goes back). Throws on a date that does not exist. */
export function isoAddDays(iso: string, days: number): string {
  const date = parseIsoDate(iso);
  if (!date) throw new RangeError(`not a calendar date: ${iso}`);
  return formatIsoDate(addDays(date, days));
}

/** `YYYY-MM` of a `YYYY-MM-DD` date (the calendar route's month). */
export function isoMonth(iso: string): string {
  return iso.slice(0, 7);
}

type DayListener = (day: string) => void;

const listeners = new Set<DayListener>();
let stopWatching: (() => void) | null = null;
let knownDay = '';

function notifyIfChanged(): void {
  const day = todayIso();
  if (day === knownDay) return;
  knownDay = day;
  for (const listener of [...listeners]) listener(day);
}

function startWatching(): () => void {
  knownDay = todayIso();
  const stopTimer = scheduleDayChange(notifyIfChanged);
  window.addEventListener('focus', notifyIfChanged);
  return () => {
    stopTimer();
    window.removeEventListener('focus', notifyIfChanged);
  };
}

/** Calls `listener` with the new date whenever the local day changes. Returns unsubscribe. */
export function subscribeLocalDay(listener: DayListener): () => void {
  listeners.add(listener);
  stopWatching ??= startWatching();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && stopWatching) {
      stopWatching();
      stopWatching = null;
    }
  };
}

/** Today's local date; the component re-renders when the day changes. */
export function useLocalDay(): string {
  const [day, setDay] = useState(todayIso);
  useEffect(() => {
    // The day may have changed between the first render and this effect.
    setDay(todayIso());
    return subscribeLocalDay(setDay);
  }, []);
  return day;
}
