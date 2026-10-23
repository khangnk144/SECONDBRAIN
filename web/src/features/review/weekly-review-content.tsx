import type { MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useAiStatusStore } from '../../lib/ai-status-store';
import { navigateTo, TASKS_ROUTE } from '../../lib/app-navigation';
import { useTabsStore } from '../../lib/tabs-store';
import { noteLinkHandlers, openNoteAtLine, wantsNewTab } from '../backlinks/open-note-at-line';
import type { WeekReview } from './review-api';
import { REVIEW_ROUTE } from './review-route';
import { inboxTidyUsesAi, tidyInbox } from './tidy-inbox';

interface ContentProps {
  review: WeekReview;
  /** Rows shown per list (the card shows 8, the screen everything the server sent). */
  limit: number;
  /** Heading level of the four groups (h3 inside the card, h2 on the screen). */
  level: 'h2' | 'h3';
  idPrefix: string;
  /** Rows beyond `limit`: the card links to `#/review`, the screen says how many are left out. */
  overflow: 'link' | 'count';
}

/** A real link to a route that navigates inside the app (Ctrl+click keeps the browser's way). */
function RouteLink({ route, children }: { route: string; children: string }) {
  const onClick = (event: MouseEvent<HTMLAnchorElement>) => {
    if (wantsNewTab(event) || event.shiftKey || event.altKey) return;
    event.preventDefault();
    navigateTo(route);
  };
  return (
    <a className="weekly-review__link" href={`#${route}`} onClick={onClick}>
      {children}
    </a>
  );
}

/**
 * The four parts of "Tổng kết tuần" (SPEC F26.1): Inbox with "Dọn Inbox", notes created or edited,
 * tasks done, next week's deadlines. Every number comes from `GET /api/review/week`.
 */
export function WeeklyReviewContent(props: ContentProps) {
  const { review, limit, level: Heading, idPrefix, overflow } = props;
  const { t } = useTranslation();
  // Re-rendered when the AI status arrives or changes: the hint names what "Dọn Inbox" opens.
  const aiStatus = useAiStatusStore((state) => state.status);
  const notes = review.notes.items.slice(0, limit);
  const tasks = review.tasksDone.items.slice(0, limit);
  const tidyHint = `${idPrefix}-tidy-hint`;
  const openNote = (path: string) => (newTab: boolean) =>
    useTabsStore.getState().openNote(path, { newTab });
  const more = (left: number, key: 'notes' | 'tasks') => {
    if (left <= 0) return null;
    if (overflow === 'link')
      return <RouteLink route={REVIEW_ROUTE}>{t('review.seeAll')}</RouteLink>;
    return <p className="weekly-review__hint">{t(`review.${key}.more`, { count: left })}</p>;
  };

  return (
    <div className="weekly-review__groups">
      <section className="weekly-review__group" aria-labelledby={`${idPrefix}-inbox`}>
        <Heading id={`${idPrefix}-inbox`} className="weekly-review__group-title">
          {t('review.inbox.heading')}
        </Heading>
        <p className="weekly-review__sentence">
          {review.inbox.count === 0
            ? t('review.inbox.empty')
            : t('review.inbox.count', { count: review.inbox.count })}
        </p>
        {review.inbox.count > 0 ? (
          <>
            <button
              type="button"
              className="button button--secondary weekly-review__action"
              aria-describedby={tidyHint}
              onClick={tidyInbox}
            >
              {t('review.inbox.tidy')}
            </button>
            <p id={tidyHint} className="weekly-review__hint">
              {t(
                inboxTidyUsesAi(aiStatus)
                  ? 'review.inbox.tidyWithAi'
                  : 'review.inbox.tidyWithoutAi',
              )}
            </p>
          </>
        ) : null}
      </section>

      <section className="weekly-review__group" aria-labelledby={`${idPrefix}-notes`}>
        <Heading id={`${idPrefix}-notes`} className="weekly-review__group-title">
          {t('review.notes.heading')}
        </Heading>
        <p className="weekly-review__sentence">
          {review.notes.count === 0
            ? t('review.notes.none')
            : t('review.notes.count', { count: review.notes.count })}
        </p>
        {notes.length > 0 ? (
          <ul className="weekly-review__list">
            {notes.map((note) => (
              <li key={note.path} className="weekly-review__item">
                <button
                  type="button"
                  className="weekly-review__note"
                  {...noteLinkHandlers(openNote(note.path))}
                >
                  {note.title}
                </button>
                <span className="weekly-review__meta">{t(`review.notes.${note.change}`)}</span>
              </li>
            ))}
          </ul>
        ) : null}
        {more(review.notes.count - notes.length, 'notes')}
      </section>

      <section className="weekly-review__group" aria-labelledby={`${idPrefix}-tasks`}>
        <Heading id={`${idPrefix}-tasks`} className="weekly-review__group-title">
          {t('review.tasks.heading')}
        </Heading>
        <p className="weekly-review__sentence">
          {review.tasksDone.count === 0
            ? t('review.tasks.none')
            : t('review.tasks.count', { count: review.tasksDone.count })}
        </p>
        {tasks.length > 0 ? (
          <ul className="weekly-review__list">
            {tasks.map((task) => (
              <li key={`${task.path}#${task.line}`} className="weekly-review__item">
                <button
                  type="button"
                  className="weekly-review__note"
                  {...noteLinkHandlers((newTab) =>
                    openNoteAtLine(task.path, task.line, { newTab }),
                  )}
                >
                  {task.text}
                </button>
                <span className="weekly-review__meta">
                  {t('review.tasks.inNote', { title: task.noteTitle })}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
        {more(review.tasksDone.count - tasks.length, 'tasks')}
      </section>

      <section className="weekly-review__group" aria-labelledby={`${idPrefix}-upcoming`}>
        <Heading id={`${idPrefix}-upcoming`} className="weekly-review__group-title">
          {t('review.upcoming.heading')}
        </Heading>
        <p className="weekly-review__sentence">
          {review.upcoming.count === 0
            ? t('review.upcoming.none')
            : t('review.upcoming.count', { count: review.upcoming.count })}
        </p>
        <RouteLink route={TASKS_ROUTE}>{t('review.upcoming.open')}</RouteLink>
      </section>
    </div>
  );
}
