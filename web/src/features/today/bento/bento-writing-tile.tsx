import { useId, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import type { TodayActivity } from '../../../lib/api/deadlines-types';
import { longDateText, weekdayKey } from '../today-strip-model';
import { useBentoIntro } from './bento-intro';

/** Bar heights (px): a stub for an empty day, the tallest day reaches the top. */
const MIN_BAR = 6;
const MAX_BAR = 56;

export interface BentoWritingTileProps {
  /** Undefined while loading or from an older server; null when the server could not read it. */
  activity: TodayActivity | null | undefined;
  loading: boolean;
}

/**
 * "7 ngày ghi chép" (3 columns): notes created or edited on each of the last 7 days, as counted by
 * the server; today's bar in the accent; one `role="img"` whose name reads all seven numbers.
 * The bars grow on the first paint (F35.8). A week without any writing says so in a sentence.
 */
export function BentoWritingTile({ activity, loading }: BentoWritingTileProps) {
  const { t, i18n } = useTranslation();
  const headingId = useId();
  const days = activity?.days;
  const intro = useBentoIntro('bars', !loading);
  const max = Math.max(1, ...(days ?? []).map((day) => day.count));
  const last = (days?.length ?? 0) - 1;
  const spoken = (days ?? []).map((day, index) =>
    t('today.bento.writing.day', {
      day:
        index === last
          ? t('today.bento.writing.todayDay')
          : longDateText(day.date, i18n.language, 'dddd', false),
      count: day.count,
    }),
  );

  return (
    <section className="tile today-tile today-tile--writing" aria-labelledby={headingId}>
      <h2 id={headingId} className="today-tile__title">
        {t('today.bento.writing.title')}
      </h2>
      {loading ? null : !days ? (
        <p className="today-tile__empty">{t('today.bento.unavailable')}</p>
      ) : days.every((day) => day.count === 0) ? (
        <p className="today-tile__empty">{t('today.bento.writing.empty')}</p>
      ) : (
        <div
          className={intro ? 'today-bars is-intro' : 'today-bars'}
          role="img"
          aria-label={t('today.bento.writing.chart', {
            days: spoken.join(t('today.brain.separator')),
          })}
        >
          {days.map((day, index) => (
            <span key={day.date} className="today-bars__day" aria-hidden="true">
              <span
                className={index === last ? 'today-bars__bar is-today' : 'today-bars__bar'}
                style={
                  {
                    '--bar-h': `${MIN_BAR + ((MAX_BAR - MIN_BAR) * day.count) / max}px`,
                  } as CSSProperties
                }
              />
              <span className="today-bars__label">
                {t(`today.strip.weekday.${weekdayKey(day.date)}`)}
              </span>
            </span>
          ))}
        </div>
      )}
    </section>
  );
}
