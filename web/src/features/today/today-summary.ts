/**
 * The one calm sentence under the greeting (SPEC F10 item 1, design.md screen 1): overdue work
 * first, then the week's deadlines and what is left today; when nothing is pending, an invitation
 * to write. Counts come from the server's deadline-items service (done items never count).
 */
import type { TFunction } from 'i18next';
import type { TodayView } from '../../lib/api/deadlines-types';

export function summarySentence(summary: TodayView['summary'], t: TFunction): string {
  const parts: string[] = [];
  if (summary.overdue > 0) parts.push(t('today.summary.overdue', { count: summary.overdue }));
  if (summary.deadlinesThisWeek > 0) {
    parts.push(t('today.summary.week', { count: summary.deadlinesThisWeek }));
  }
  if (summary.openToday > 0) {
    parts.push(t('today.summary.openToday', { count: summary.openToday }));
  }
  return parts.length > 0 ? parts.join(' ') : t('today.summary.nothingUrgent');
}
