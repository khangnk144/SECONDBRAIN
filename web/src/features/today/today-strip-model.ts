/**
 * What the 14-day strip shows (SPEC F10 item 2, design.md screen 1): one cell per day (today …
 * today+59, 14 visible), an "Quá hạn (n)" cell on the left when something is overdue, each cell's
 * dot colored by its most urgent open item, at most two labels (urgent → soon → ok, then title)
 * and "+n" for the rest. Done items never show on the strip.
 */
import dayjs from 'dayjs';
import 'dayjs/locale/vi';
import 'dayjs/locale/en';
import { parseIsoDate, urgencyOf, weekdayIndex } from '../../editor/local-dates';
import type { DeadlineItem, TodayView, Urgency } from '../../lib/api/deadlines-types';

export const OVERDUE_KEY = 'overdue';
export const WIDE_VISIBLE_DAYS = 14;
export const NARROW_VISIBLE_DAYS = 7;
export const MAX_LABELS = 2;
/** Lines reserved under the day number for labels and "+n" (every cell has the same height). */
export const LABEL_LINES = 3;

export type OpenUrgency = Exclude<Urgency, 'done'>;

export interface StripCell {
  /** The ISO date, or `OVERDUE_KEY`. */
  key: string;
  /** Null for the overdue cell. */
  date: string | null;
  isToday: boolean;
  /** Open items, in display order. */
  items: DeadlineItem[];
  /** Most urgent open item's urgency; null when the day is free. */
  urgency: OpenUrgency | null;
  labels: DeadlineItem[];
  /** Items beyond the labels ("+n"). */
  more: number;
}

export interface StripModel {
  overdue: StripCell | null;
  days: StripCell[];
}

const RANK: Record<OpenUrgency, number> = { urgent: 0, soon: 1, ok: 2 };
const collator = new Intl.Collator('vi', { sensitivity: 'base', numeric: true });
const WEEKDAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;

/** Urgency by days left (SPEC §4.7), so an item flagged done locally still sorts like the rest. */
function urgencyFor(item: DeadlineItem): OpenUrgency {
  return urgencyOf(item.daysLeft);
}

/** Strip order inside a day: urgent → soon → ok, then title, then id (stable). */
export function compareStripItems(a: DeadlineItem, b: DeadlineItem): number {
  return (
    RANK[urgencyFor(a)] - RANK[urgencyFor(b)] ||
    collator.compare(a.title, b.title) ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  );
}

/** Overdue order: oldest first, then like a day. */
export function compareOverdueItems(a: DeadlineItem, b: DeadlineItem): number {
  return a.date < b.date ? -1 : a.date > b.date ? 1 : compareStripItems(a, b);
}

function buildCell(
  key: string,
  date: string | null,
  isToday: boolean,
  all: DeadlineItem[],
  compare: (a: DeadlineItem, b: DeadlineItem) => number,
): StripCell {
  const items = all.filter((item) => !item.done).sort(compare);
  let urgency: OpenUrgency | null = null;
  for (const item of items) {
    const next = urgencyFor(item);
    if (urgency === null || RANK[next] < RANK[urgency]) urgency = next;
  }
  const labels = items.slice(0, MAX_LABELS);
  return { key, date, isToday, items, urgency, labels, more: items.length - labels.length };
}

/**
 * `keepOverdue` keeps the overdue cell while its popover is open, even when the last overdue
 * item was just ticked, so the popover keeps its anchor until it closes.
 */
export function buildStrip(view: TodayView, keepOverdue = false): StripModel {
  const overdue = buildCell(OVERDUE_KEY, null, false, view.strip.overdue, compareOverdueItems);
  return {
    overdue:
      overdue.items.length > 0 || (keepOverdue && view.strip.overdue.length > 0) ? overdue : null,
    days: view.strip.days.map((day) =>
      buildCell(day.date, day.date, day.date === view.date, day.items, compareStripItems),
    ),
  };
}

/**
 * How many lines each label may wrap to: the lines left after "+n" go to the first label, the
 * others get one each (one item: three lines; two items: two and one; two plus "+n": one each).
 */
export function labelLines(cell: Pick<StripCell, 'labels' | 'more'>): number[] {
  const free = LABEL_LINES - (cell.more > 0 ? 1 : 0);
  return cell.labels.map((_, index) =>
    index === 0 ? Math.max(1, free - (cell.labels.length - 1)) : 1,
  );
}

/** Everything the popover of `key` lists: open items and the ones ticked a moment ago. */
export function popoverItems(view: TodayView, key: string): DeadlineItem[] {
  if (key === OVERDUE_KEY) return [...view.strip.overdue].sort(compareOverdueItems);
  const day = view.strip.days.find((entry) => entry.date === key);
  return day ? [...day.items].sort(compareStripItems) : [];
}

/** Roving focus: the key reached from `current` with an arrow, Home or End; null for other keys. */
export function nextStripKey(keys: string[], current: string, key: string): string | null {
  if (keys.length === 0) return null;
  const index = Math.max(0, keys.indexOf(current));
  switch (key) {
    case 'ArrowLeft':
      return keys[Math.max(0, index - 1)] ?? null;
    case 'ArrowRight':
      return keys[Math.min(keys.length - 1, index + 1)] ?? null;
    case 'Home':
      return keys[0] ?? null;
    case 'End':
      return keys[keys.length - 1] ?? null;
    default:
      return null;
  }
}

/** i18n key suffix of the short weekday (`today.strip.weekday.<key>`). */
export function weekdayKey(iso: string): (typeof WEEKDAY_KEYS)[number] {
  const date = parseIsoDate(iso);
  return WEEKDAY_KEYS[date ? weekdayIndex(date) : 0] ?? 'mon';
}

/** `iso` as a local Date at midnight (dayjs formats it in the UI language). */
function localDate(iso: string): Date {
  const date = parseIsoDate(iso);
  return date ? new Date(date.year, date.month - 1, date.day) : new Date(Number.NaN);
}

/** The day number under the weekday; the first of a month also names the month ("1/11"). */
export function dayNumberText(iso: string, language: string, monthStartPattern: string): string {
  const date = parseIsoDate(iso);
  if (!date) return iso;
  if (date.day !== 1) return String(date.day);
  return dayjs(localDate(iso)).locale(language).format(monthStartPattern);
}

/** A long date ("thứ ba, 20 tháng 10"); `capitalize` for the start of a sentence. */
export function longDateText(
  iso: string,
  language: string,
  pattern: string,
  capitalize: boolean,
): string {
  const text = dayjs(localDate(iso)).locale(language).format(pattern);
  return capitalize ? text.charAt(0).toLocaleUpperCase(language) + text.slice(1) : text;
}
