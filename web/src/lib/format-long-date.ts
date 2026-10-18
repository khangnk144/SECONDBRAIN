import dayjs from 'dayjs';
import 'dayjs/locale/vi';
import 'dayjs/locale/en';

/**
 * Formats a calendar date with a locale-specific pattern (the pattern itself
 * lives in the i18n files) and capitalizes the first letter, since dayjs'
 * Vietnamese weekday names are lowercase ("chủ nhật" → "Chủ nhật").
 */
export function formatLongDate(date: Date, language: string, pattern: string): string {
  const text = dayjs(date).locale(language).format(pattern);
  return text.charAt(0).toLocaleUpperCase(language) + text.slice(1);
}
