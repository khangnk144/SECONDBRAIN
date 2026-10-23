import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import type { TodayView } from '../../../lib/api/deadlines-types';
import { noteLinkHandlers } from '../../backlinks/open-note-at-line';
import { openItemNote } from '../../deadline-items/deadline-actions';
import { deadlineDetail } from './deadline-detail';
import { nearestDeadline } from './nearest-deadline';

/**
 * "Deadline gần nhất" (4 columns): the urgency pill ("gấp" on the accent, the others as pastel
 * chips), the days left as the screen's countdown number ("Hôm nay" when due today), the title
 * (opens the note) and one detail line: the date and the note it lives in, or a project's open
 * tasks, never the same date twice (`deadline-detail.ts`). Nothing within 14 days: one sentence
 * and no number.
 */
export function BentoDeadlineTile({ view }: { view: TodayView | undefined }) {
  const { t, i18n } = useTranslation();
  const headingId = useId();
  const nearest = view ? nearestDeadline(view) : null;

  return (
    <section className="tile today-tile today-tile--deadline" aria-labelledby={headingId}>
      <div className="today-deadline__head">
        <h2 id={headingId} className="today-deadline__title">
          {t('today.bento.deadline.title')}
        </h2>
        {nearest ? (
          <span className={`today-pill today-pill--${nearest.urgency}`}>
            {t(`today.bento.deadline.urgency.${nearest.urgency}`)}
          </span>
        ) : null}
      </div>
      {view === undefined ? null : nearest === null ? (
        <p className="today-tile__empty">{t('today.bento.deadline.none')}</p>
      ) : (
        <>
          <p className="today-deadline__count">
            {nearest.item.daysLeft === 0 ? (
              <span className="today-deadline__number today-deadline__number--word">
                {t('today.bento.deadline.today')}
              </span>
            ) : (
              <>
                <span className="today-deadline__number">{nearest.item.daysLeft}</span>
                <span className="today-deadline__unit">
                  {t('today.bento.deadline.daysLeft', { count: nearest.item.daysLeft })}
                </span>
              </>
            )}
          </p>
          <button
            type="button"
            className="today-deadline__item"
            aria-label={t('deadline-items.openItemNamed', { title: nearest.item.title })}
            {...noteLinkHandlers((newTab) => openItemNote(nearest.item, { newTab }))}
          >
            {nearest.item.title}
          </button>
          <p className="today-deadline__detail">{deadlineDetail(nearest, i18n.language, t)}</p>
        </>
      )}
    </section>
  );
}
