/** The title of a strip popover: "Quá hạn (n)", "Hôm nay, thứ ba, 20 tháng 10" or the long date. */
import type { TFunction } from 'i18next';
import { longDateText, OVERDUE_KEY } from './today-strip-model';

export function stripPopoverTitle(
  key: string,
  today: string,
  overdueCount: number,
  language: string,
  t: TFunction,
): string {
  if (key === OVERDUE_KEY) return t('today.strip.overdue', { count: overdueCount });
  const pattern = t('today.dateFormat');
  if (key === today) {
    return t('today.strip.todayDate', { date: longDateText(key, language, pattern, false) });
  }
  return longDateText(key, language, pattern, true);
}
