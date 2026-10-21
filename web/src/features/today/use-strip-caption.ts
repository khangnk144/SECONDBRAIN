/**
 * The strip's caption: "14 ngày tới" while the strip shows its start; once scrolled, the visible
 * range with its month names ("5 – 18 tháng 12", "28 tháng 11 – 11 tháng 12"), so the cells (which
 * only show weekday and day number) never lose their place in the year.
 */
import dayjs from 'dayjs';
import 'dayjs/locale/vi';
import 'dayjs/locale/en';
import { useState, type UIEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { parseIsoDate } from '../../editor/local-dates';

function format(iso: string, language: string, pattern: string): string {
  const date = parseIsoDate(iso);
  if (!date) return iso;
  return dayjs(new Date(date.year, date.month - 1, date.day))
    .locale(language)
    .format(pattern);
}

/** "5 – 18 tháng 12" / "December 5 – 18", or both months when the range crosses one. */
export function visibleRangeText(from: string, to: string, language: string, t: TFunction): string {
  const sameMonth = from.slice(0, 7) === to.slice(0, 7);
  return t('today.strip.range', {
    from: format(
      from,
      language,
      t(sameMonth ? 'today.strip.rangeFromSameMonth' : 'today.strip.rangeDay'),
    ),
    to: format(
      to,
      language,
      t(sameMonth ? 'today.strip.rangeToSameMonth' : 'today.strip.rangeDay'),
    ),
  });
}

/** Index of the first day cell the scroller shows (cells all have the same width). */
export function firstVisibleIndex(scrollLeft: number, scrollWidth: number, cells: number): number {
  if (cells <= 0 || scrollWidth <= 0) return 0;
  return Math.max(0, Math.min(cells - 1, Math.round(scrollLeft / (scrollWidth / cells))));
}

export function useStripCaption(
  dayKeys: readonly string[],
  visibleDays: number,
): { caption: string; onScroll: (event: UIEvent<HTMLElement>) => void } {
  const { t, i18n } = useTranslation();
  const [first, setFirst] = useState(0);
  const onScroll = (event: UIEvent<HTMLElement>) => {
    const { scrollLeft, scrollWidth } = event.currentTarget;
    setFirst(firstVisibleIndex(scrollLeft, scrollWidth, dayKeys.length));
  };
  const from = dayKeys[first];
  const to = dayKeys[Math.min(dayKeys.length - 1, first + visibleDays - 1)];
  const caption =
    first === 0 || from === undefined || to === undefined
      ? t('today.strip.caption')
      : visibleRangeText(from, to, i18n.language, t);
  return { caption, onScroll };
}
