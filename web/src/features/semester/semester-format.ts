/** "14:05, 22/10/2026" / "Oct 22, 2026, 2:05 PM": when the page was last written. */
import { i18n } from '../../i18n';
import { formatLongDate } from '../../lib/format-long-date';

export function formatGeneratedAt(iso: string, language: string): string {
  const instant = new Date(iso);
  if (Number.isNaN(instant.getTime())) return '';
  return formatLongDate(instant, language, i18n.t('semester.timeFormat', { lng: language }));
}
