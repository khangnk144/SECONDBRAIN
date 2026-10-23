import { useTranslation } from 'react-i18next';

export interface TodayStripHeadProps {
  /** Id of the heading: the Bento tile is labelled by it. */
  headingId: string;
  /** The visible range once the strip is scrolled, else null. */
  range: string | null;
  /** Open overdue items (the overdue cell's count). */
  overdue: number;
}

/**
 * The Bento strip tile's head: the heading "14 ngày tới" and, on the right, how many items are
 * overdue – or, once the strip is scrolled, the dates in view (the cells only show weekday and
 * day number, so the month is never lost).
 */
export function TodayStripHead({ headingId, range, overdue }: TodayStripHeadProps) {
  const { t } = useTranslation();
  const aside = range ?? (overdue > 0 ? t('today.bento.strip.overdue', { count: overdue }) : null);
  return (
    <div className="today-strip__head">
      <h2 id={headingId} className="today-tile__title">
        {t('today.strip.caption')}
      </h2>
      {aside ? <p className="today-strip__aside">{aside}</p> : null}
    </div>
  );
}
