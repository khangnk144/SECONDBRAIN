/** "2/3 – 8/3" (vi) / "Mar 2 – Mar 8" (en): the week of a review, patterns in the `review` area. */
import { useTranslation } from 'react-i18next';
import { parseIsoDate } from '../../editor/local-dates';
import { formatLongDate } from '../../lib/format-long-date';

function asDate(iso: string): Date | null {
  const parts = parseIsoDate(iso);
  return parts ? new Date(parts.year, parts.month - 1, parts.day) : null;
}

export function useReviewRange(start: string | undefined, end: string | undefined): string | null {
  const { t, i18n } = useTranslation();
  const from = start ? asDate(start) : null;
  const to = end ? asDate(end) : null;
  if (!from || !to) return null;
  const pattern = t('review.rangeDay');
  return t('review.range', {
    from: formatLongDate(from, i18n.language, pattern),
    to: formatLongDate(to, i18n.language, pattern),
  });
}
