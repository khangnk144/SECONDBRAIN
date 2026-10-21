import { useId, useRef, type MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { TaskEntry } from '../../lib/api/deadlines-types';
import { navigateTo, TASKS_ROUTE } from '../../lib/app-navigation';
import { wantsNewTab } from '../backlinks/open-note-at-line';
import { DeadlineItemRow } from '../deadline-items/deadline-item-row';
import { useFocusRescue } from './use-focus-rescue';

/** Overdue rows Today lists before pointing to the Tasks view for the rest (a calm dashboard). */
export const MAX_OVERDUE_ROWS = 5;

export interface TodayTasksSectionProps {
  /** Undefined while Today is loading. */
  tasks: TaskEntry[] | undefined;
  onItemDone: (id: string, done: boolean) => void;
  refresh: () => unknown;
}

const isOverdue = (task: TaskEntry) => task.daysLeft !== null && task.daysLeft < 0;

/**
 * "Hôm nay": open tasks due today or overdue, then the undated tasks of today's Daily note (the
 * server builds the list). At most five overdue rows show, then "Xem tất cả n việc quá hạn" leads
 * to the Tasks view. A row ticked on Today stays (checked, dimmed) while Today is open, so it can
 * be unticked right there; rows that leave for other reasons hand focus on.
 */
export function TodayTasksSection({ tasks, onItemDone, refresh }: TodayTasksSectionProps) {
  const { t } = useTranslation();
  const headingId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  useFocusRescue(listRef, () => headingRef.current);

  const overdue = tasks?.filter(isOverdue) ?? [];
  const shownOverdue = overdue.slice(0, MAX_OVERDUE_ROWS);
  const rest = tasks?.filter((task) => !isOverdue(task)) ?? [];
  const openOverdue = overdue.filter((task) => !task.done).length;

  const row = (task: TaskEntry) => (
    <DeadlineItemRow
      key={task.id}
      item={task}
      showNoteTitle
      onDone={(done) => onItemDone(task.id, done)}
      refresh={refresh}
    />
  );

  function openTasks(event: MouseEvent<HTMLAnchorElement>) {
    if (wantsNewTab(event) || event.shiftKey || event.altKey) return; // the browser's own way
    event.preventDefault();
    navigateTo(TASKS_ROUTE);
  }

  return (
    <section className="today__section" aria-labelledby={headingId}>
      <h2 id={headingId} ref={headingRef} className="today__section-title" tabIndex={-1}>
        {t('today.tasks.title')}
      </h2>
      {tasks === undefined ? null : tasks.length === 0 ? (
        <p className="today__empty">{t('today.tasks.empty')}</p>
      ) : (
        <div ref={listRef}>
          {shownOverdue.length > 0 ? (
            <ul className="deadline-list">{shownOverdue.map(row)}</ul>
          ) : null}
          {overdue.length > shownOverdue.length ? (
            <p className="today__more">
              <a className="today__more-link" href={`#${TASKS_ROUTE}`} onClick={openTasks}>
                {t('today.tasks.allOverdue', { count: openOverdue })}
              </a>
            </p>
          ) : null}
          {rest.length > 0 ? <ul className="deadline-list">{rest.map(row)}</ul> : null}
        </div>
      )}
    </section>
  );
}
