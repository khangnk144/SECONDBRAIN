/**
 * Pure helpers of the month calendar (SPEC F11): the Monday-first weeks of a month, the URL
 * state (`month=YYYY-MM&day=YYYY-MM-DD`), keyboard moves on ISO dates, the "3 then +n" rule
 * and the optimistic move of a rescheduled item. Dates are local calendar dates `YYYY-MM-DD`.
 */
import { moveByKey, monthWeeks } from '../../editor/popups/calendar-model';
import {
  addMonths,
  daysBetween,
  formatIsoDate,
  parseIsoDate,
  urgencyOf,
} from '../../editor/local-dates';
import type { CalendarView, DeadlineItem } from '../../lib/api/deadlines-types';
import { isoMonth } from '../../lib/local-day';

/** Items listed in a day cell before "+n". */
export const MAX_CELL_ITEMS = 3;

const MONTH = /^(\d{4})-(\d{2})$/;

/** `YYYY-MM` when the text is a real month, else null. */
export function parseMonth(text: string | null | undefined): string | null {
  const match = MONTH.exec(text ?? '');
  if (!match) return null;
  const month = Number(match[2]);
  return month >= 1 && month <= 12 ? `${match[1]}-${match[2]}` : null;
}

/** `YYYY-MM-DD` when the text is a real date (`2026-02-30` is not), else null. */
export function parseDay(text: string | null | undefined): string | null {
  return text && parseIsoDate(text) ? text : null;
}

export interface CalendarRouteState {
  /** Month on screen, `YYYY-MM`. */
  month: string;
  /** Day opened in the right pane, or null. */
  day: string | null;
}

/**
 * Reads the calendar's URL state. A missing or broken month falls back to the opened day's
 * month, else today's; a broken day is ignored.
 */
export function readCalendarParams(params: URLSearchParams, today: string): CalendarRouteState {
  const day = parseDay(params.get('day'));
  const month = parseMonth(params.get('month')) ?? isoMonth(day ?? today);
  return { month, day };
}

/** The search part of `/calendar` for a state (the day is left out when none is open). */
export function calendarSearchParams(state: CalendarRouteState): URLSearchParams {
  const params = new URLSearchParams({ month: state.month });
  if (state.day !== null) params.set('day', state.day);
  return params;
}

function firstDay(month: string) {
  const date = parseIsoDate(`${month}-01`);
  if (!date) throw new RangeError(`not a month: ${month}`);
  return date;
}

/** Weeks of `month` (Monday first) as ISO dates, with the neighbouring months' days. */
export function monthGridDates(month: string): string[][] {
  return monthWeeks(firstDay(month)).map((week) => week.map(formatIsoDate));
}

/** First and last date drawn for `month` (Monday on/before the 1st, Sunday on/after the end). */
export function monthGridRange(month: string): { start: string; end: string } {
  const weeks = monthGridDates(month);
  return { start: weeks[0]![0]!, end: weeks[weeks.length - 1]![6]! };
}

export function inRange(date: string, range: { start: string; end: string }): boolean {
  return date >= range.start && date <= range.end;
}

/** `month` moved by `months` (negative goes back). */
export function shiftMonth(month: string, months: number): string {
  return isoMonth(formatIsoDate(addMonths(firstDay(month), months)));
}

/** The same day number in `month`, clamped to its length (31 → 30 in November). */
export function sameDayInMonth(iso: string, month: string): string {
  const date = parseIsoDate(iso);
  const target = firstDay(month);
  if (!date) return formatIsoDate(target);
  return formatIsoDate(addMonths(date, monthsBetween(date, target)));
}

function monthsBetween(from: { year: number; month: number }, to: { year: number; month: number }) {
  return (to.year - from.year) * 12 + (to.month - from.month);
}

/**
 * Where a key moves the focused day: arrows by day/week, Home/End to the week's Monday/Sunday,
 * PageUp/PageDown by a month (same day number, clamped). Null for other keys.
 */
export function moveDayByKey(iso: string, key: string): string | null {
  const date = parseIsoDate(iso);
  const next = date ? moveByKey(date, key) : null;
  return next ? formatIsoDate(next) : null;
}

/**
 * The day that holds the grid's tab stop when nothing was focused yet in this month: the opened
 * day when it is drawn, else today when it is in the month, else the 1st.
 */
export function defaultActiveDay(month: string, day: string | null, today: string): string {
  if (day !== null && inRange(day, monthGridRange(month))) return day;
  if (isoMonth(today) === month) return today;
  return `${month}-01`;
}

/** Items of each date of a view (dates absent from the view have none). */
export function itemsByDate(view: CalendarView | undefined): Map<string, DeadlineItem[]> {
  return new Map((view?.days ?? []).map((day) => [day.date, day.items]));
}

/** The first three items of a cell and how many more there are ("+n"). */
export function visibleItems(items: readonly DeadlineItem[]): {
  shown: DeadlineItem[];
  more: number;
} {
  return {
    shown: items.slice(0, MAX_CELL_ITEMS),
    more: Math.max(0, items.length - MAX_CELL_ITEMS),
  };
}

/**
 * The view as it will look once `itemId` has moved to `date`: shown at once on a drop, then
 * replaced by the server's answer. Days left and urgency follow the new date.
 */
export function moveItemInView(
  view: CalendarView,
  itemId: string,
  date: string,
  today: string,
): CalendarView {
  const moving = view.days.flatMap((day) => day.items).find((item) => item.id === itemId);
  const due = parseIsoDate(date);
  const now = parseIsoDate(today);
  if (!moving || !due || !now) return view;
  const daysLeft = daysBetween(now, due);
  const moved: DeadlineItem = {
    ...moving,
    date,
    daysLeft,
    urgency: moving.done ? 'done' : urgencyOf(daysLeft),
  };
  return {
    ...view,
    days: view.days.map((day) => {
      const items = day.items.filter((item) => item.id !== itemId);
      if (day.date === date) items.push(moved);
      return items.length === day.items.length && day.date !== date ? day : { ...day, items };
    }),
  };
}
