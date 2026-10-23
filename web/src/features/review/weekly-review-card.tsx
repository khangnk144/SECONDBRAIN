import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocalDay } from '../../lib/local-day';
import { showToast } from '../../lib/toast-store';
import { useLiveQuery } from '../../lib/use-live-query';
import { useVaultStore } from '../../lib/vault-store';
import { getWeekReview } from './review-api';
import { useReviewRange } from './review-range';
import { dismissReview, isReviewDismissed, isSunday } from './review-week';
import { WeeklyReviewContent } from './weekly-review-content';
import './weekly-review.css';

/** Rows per list on the card; the rest is on `#/review` ("Xem tất cả"). */
export const CARD_ROWS = 8;

type Variant = 'tile' | 'section';

/**
 * "Tổng kết tuần" on Today (SPEC F26.1, F26.2): only on Sundays (local, re-evaluated when the day
 * changes), unless "Để sau" hid it for this week in this vault. Today places it as a full-width
 * tile (bento) or a quiet section (calm). Renders nothing on other days, while dismissed and
 * while the first answer is on its way.
 */
export function WeeklyReviewCard({ variant }: { variant: Variant }) {
  const today = useLocalDay();
  const vaultId = useVaultStore((state) => state.vaultId);
  // Bumped by "Để sau" so the stored dismissal is read again.
  const [, setDismissals] = useState(0);
  if (vaultId === null || !isSunday(today) || isReviewDismissed(today)) return null;
  return (
    <CardBody
      key={`${vaultId}:${today}`}
      variant={variant}
      today={today}
      onDismissed={() => setDismissals((n) => n + 1)}
    />
  );
}

function CardBody(props: { variant: Variant; today: string; onDismissed: () => void }) {
  const { variant, today, onDismissed } = props;
  const { t } = useTranslation();
  const id = useId();
  const { data, status, refresh } = useLiveQuery(`review-week:${today}`, () =>
    getWeekReview(today),
  );
  const range = useReviewRange(data?.start, data?.end);
  if (!data && status !== 'error') return null;

  const later = () => {
    dismissReview(today);
    showToast({ message: t('review.laterDone') });
    // The card goes away with the focused button: keep the keyboard in the page.
    document.getElementById('main-content')?.focus();
    onDismissed();
  };

  return (
    <section
      // `tile`: the shared Bento tile look (styles/bento/bento-tiles.css).
      className={`weekly-review weekly-review--${variant}${variant === 'tile' ? ' tile' : ''}`}
      aria-labelledby={`${id}-title`}
    >
      <header className="weekly-review__head">
        <h2 id={`${id}-title`} className="weekly-review__title">
          {t('review.title')}
        </h2>
        {range ? <p className="weekly-review__range">{range}</p> : null}
      </header>
      {data ? (
        <WeeklyReviewContent
          review={data}
          limit={CARD_ROWS}
          level="h3"
          idPrefix={id}
          overflow="link"
        />
      ) : (
        <div className="weekly-review__error">
          <p role="alert">{t('review.loadError')}</p>
          <button type="button" className="button button--secondary" onClick={() => void refresh()}>
            {t('review.retry')}
          </button>
        </div>
      )}
      <footer className="weekly-review__foot">
        <button type="button" className="button button--secondary" onClick={later}>
          {t('review.later')}
        </button>
      </footer>
    </section>
  );
}
