import { useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { parseIsoDate } from '../../editor/local-dates';
import { navigateTo } from '../../lib/app-navigation';
import { isoAddDays, useLocalDay } from '../../lib/local-day';
import { useLiveQuery } from '../../lib/use-live-query';
import { getWeekReview } from './review-api';
import { useReviewRange } from './review-range';
import { reviewRoute } from './review-route';
import { WeeklyReviewContent } from './weekly-review-content';
import './weekly-review.css';
import './review-screen.css';

const TITLE_ID = 'review-title';

/** `?end=` when it is a real date not after today; otherwise the week ending today. */
function weekEnd(requested: string | null, today: string): string {
  return requested !== null && parseIsoDate(requested) !== null && requested <= today
    ? requested
    : today;
}

/**
 * "Tổng kết tuần" (`#/review[?end=YYYY-MM-DD]`, SPEC F26.2): the same review any day, with the
 * whole lists the server sends and buttons to the previous and next weeks (seven days each; the
 * week never ends after today). The palette command "Tổng kết tuần" opens it.
 */
export function ReviewScreen() {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const today = useLocalDay();
  const end = weekEnd(params.get('end'), today);
  const { data, dataKey, status, refresh } = useLiveQuery(`review-week:${end}`, () =>
    getWeekReview(end),
  );
  const range = useReviewRange(isoAddDays(end, -6), end);
  const atToday = end === today;
  const go = (next: string) =>
    navigateTo(reviewRoute(next >= today ? undefined : next), { replace: true });

  return (
    <section className="review-screen" aria-labelledby={TITLE_ID}>
      <h1 id={TITLE_ID} className="text-display">
        {t('review.title')}
      </h1>
      <div className="review-screen__weeks" role="group" aria-label={t('review.screen.weeks')}>
        <button
          type="button"
          className="button button--secondary"
          onClick={() => go(isoAddDays(end, -7))}
        >
          {t('review.screen.previous')}
        </button>
        <p className="review-screen__range" aria-live="polite">
          {range}
        </p>
        <button
          type="button"
          className="button button--secondary"
          aria-disabled={atToday || undefined}
          onClick={() => {
            if (!atToday) go(isoAddDays(end, 7));
          }}
        >
          {t('review.screen.next')}
        </button>
        {atToday ? null : (
          <button type="button" className="button button--secondary" onClick={() => go(today)}>
            {t('review.screen.thisWeek')}
          </button>
        )}
      </div>
      {data ? (
        <div aria-busy={dataKey !== `review-week:${end}`}>
          <WeeklyReviewContent
            review={data}
            limit={Number.POSITIVE_INFINITY}
            level="h2"
            idPrefix="review-screen"
            overflow="count"
          />
        </div>
      ) : status === 'error' ? (
        <div className="weekly-review__error">
          <p role="alert">{t('review.loadError')}</p>
          <button type="button" className="button button--secondary" onClick={() => void refresh()}>
            {t('review.retry')}
          </button>
        </div>
      ) : (
        <p className="weekly-review__hint" role="status">
          {t('review.loading')}
        </p>
      )}
    </section>
  );
}
