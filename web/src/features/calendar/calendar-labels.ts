/**
 * Texts of the calendar built from dates and items: the month title ("Tháng 10, 2026" /
 * "October 2026"), long day names, and each day cell's accessible name, which carries the item
 * titles (narrow cells show only dots), the first three of a busy day plus how many more.
 */
import type { TFunction } from 'i18next';
import { parseIsoDate } from '../../editor/local-dates';
import type { DeadlineItem } from '../../lib/api/deadlines-types';
import { formatLongDate } from '../../lib/format-long-date';

export const WEEKDAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;

function language(lang: string): 'vi' | 'en' {
  return lang === 'en' ? 'en' : 'vi';
}

/** "Tháng 10, 2026" / "October 2026" for `YYYY-MM`. */
export function monthTitle(month: string, lang: string, t: TFunction): string {
  const [year = '', number = ''] = month.split('-');
  const first = new Date(Number(year), Number(number) - 1, 1);
  return formatLongDate(first, language(lang), t('calendar.monthTitleFormat'));
}

/** "Thứ ba, 20 tháng 10, 2026" / "Tuesday, October 20, 2026". */
export function longDayLabel(iso: string, lang: string, t: TFunction): string {
  const date = parseIsoDate(iso);
  if (!date) return iso;
  const local = new Date(date.year, date.month - 1, date.day);
  return formatLongDate(local, language(lang), t('calendar.longDateFormat'));
}

/** "A, B và C" / "A, B, and C". */
function joinTitles(titles: string[], lang: string): string {
  return new Intl.ListFormat(language(lang), { type: 'conjunction' }).format(titles);
}

/** Titles read out per cell; a busy day names these and counts the rest. */
export const CELL_LABEL_TITLES = 3;

/**
 * A day cell's name: the date, "hôm nay" when it is, and its items (done ones marked): every
 * title up to three, else the first three and "và 8 việc khác", so moving through the grid by
 * arrow key stays short to listen to. The day pane lists everything.
 */
export function dayCellLabel(
  iso: string,
  items: readonly DeadlineItem[],
  isToday: boolean,
  lang: string,
  t: TFunction,
): string {
  const parts = [longDayLabel(iso, lang, t)];
  if (isToday) parts.push(t('calendar.cell.today'));
  const titles = items.map((item) =>
    item.done ? t('calendar.cell.doneItem', { title: item.title }) : item.title,
  );
  const count = items.length;
  if (count === 0) parts.push(t('calendar.cell.empty'));
  else if (count <= CELL_LABEL_TITLES) {
    parts.push(t('calendar.cell.items', { count, list: joinTitles(titles, lang) }));
  } else {
    const list = titles.slice(0, CELL_LABEL_TITLES).join(', ');
    parts.push(t('calendar.cell.itemsCapped', { count, list, rest: count - CELL_LABEL_TITLES }));
  }
  return parts.join(', ');
}
