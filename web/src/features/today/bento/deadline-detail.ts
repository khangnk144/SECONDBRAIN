/**
 * The detail line of "Deadline gần nhất" (design.md §12.3): the date, then where the item lives –
 * the note's title for a task, the open tasks for a project. A date is never said twice (E2E D4):
 * a task in the Daily note of its own day shows the date alone (the note's title is that date);
 * one in another day's Daily says "Daily 20/10"; a note whose title already holds the date is
 * left out.
 */
import type { TFunction } from 'i18next';
import type { DeadlineItem } from '../../../lib/api/deadlines-types';
import { DAILY_FOLDER } from '../../../lib/daily-flow';
import { longDateText } from '../today-strip-model';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** The day of a Daily note (`Daily/YYYY-MM-DD.md`, or a note titled with a bare date), else null. */
export function dailyNoteDate(item: Pick<DeadlineItem, 'path' | 'noteTitle'>): string | null {
  const [folder, file, ...rest] = item.path.split('/');
  const name = file?.replace(/\.md$/i, '');
  if (folder === DAILY_FOLDER && rest.length === 0 && name && ISO_DATE.test(name)) return name;
  return ISO_DATE.test(item.noteTitle.trim()) ? item.noteTitle.trim() : null;
}

export interface DeadlineDetailInput {
  item: Pick<DeadlineItem, 'kind' | 'date' | 'path' | 'noteTitle'>;
  /** A project's open tasks; null when unknown. */
  openTasks: number | null;
}

export function deadlineDetail(
  { item, openTasks }: DeadlineDetailInput,
  language: string,
  t: TFunction,
): string {
  const date = longDateText(item.date, language, t('today.bento.deadline.dateFormat'), true);
  return [date, detailSource(item, openTasks, language, t)]
    .filter((part): part is string => Boolean(part))
    .join(t('today.brain.separator'));
}

function detailSource(
  item: DeadlineDetailInput['item'],
  openTasks: number | null,
  language: string,
  t: TFunction,
): string | null {
  const short = (iso: string) => longDateText(iso, language, t('today.strip.monthStart'), false);
  if (item.kind !== 'task') {
    return openTasks !== null && openTasks > 0
      ? t('today.bento.deadline.openTasks', { count: openTasks })
      : null;
  }
  const daily = dailyNoteDate(item);
  if (daily !== null) {
    if (daily === item.date) return null;
    return t('today.bento.deadline.dailyNote', { date: short(daily) });
  }
  const title = item.noteTitle.trim();
  // "Họp nhóm 2026-10-23" or "Họp 23/10" next to "Thứ sáu 23/10" would say the day twice.
  if (!title || mentions(title, item.date) || mentions(title, short(item.date))) return null;
  return title;
}

/** `text` holds `date` as a whole token ("Họp 23/10" holds "23/10"; "Oct 23" does not hold "Oct 2"). */
function mentions(text: string, date: string): boolean {
  const escaped = date.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}($|[^\\p{L}\\p{N}])`, 'u').test(text);
}
