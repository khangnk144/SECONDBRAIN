import { Check } from '@phosphor-icons/react';
import { useId, useRef, type MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { TaskEntry } from '../../../lib/api/deadlines-types';
import { navigateTo, TASKS_ROUTE } from '../../../lib/app-navigation';
import { wantsNewTab } from '../../backlinks/open-note-at-line';
import { MAX_OVERDUE_ROWS } from '../today-tasks-section';
import { useFocusRescue } from '../use-focus-rescue';
import { BentoTaskRow } from './bento-task-row';

export interface BentoTasksTileProps {
  /** Undefined while Today is loading. */
  tasks: TaskEntry[] | undefined;
  /** Tasks ticked yesterday (from the server); null/undefined when unknown. */
  doneYesterday: number | null | undefined;
  onItemDone: (id: string, done: boolean) => void;
  refresh: () => unknown;
}

const isOverdue = (task: TaskEntry) => task.daysLeft !== null && task.daysLeft < 0;

/**
 * Rows the tile shows (review B11): a busy day must not stretch the tiles beside it into empty
 * boxes. Overdue rows come first but leave room for at least two of today's; the rest is behind
 * "Xem tất cả n việc" (the Tasks screen).
 */
export const BENTO_TASK_ROWS = 5;
const MIN_TODAY_ROWS = 2;

export function bentoTaskRows(overdue: number, rest: number): { overdue: number; rest: number } {
  const overdueRows = Math.min(
    overdue,
    MAX_OVERDUE_ROWS,
    BENTO_TASK_ROWS - Math.min(rest, MIN_TODAY_ROWS),
  );
  return { overdue: overdueRows, rest: Math.min(rest, BENTO_TASK_ROWS - overdueRows) };
}

/**
 * "Hôm nay" (5 columns, two rows): the same list as calm Today (overdue first, then
 * "Xem tất cả n việc quá hạn"; rows ticked here stay checked) but at most five rows, then
 * "Xem tất cả n việc"; "n/m xong", and at the bottom the encouragement "Hôm qua bạn xong n việc."
 * only when the server counted n > 0 yesterday.
 */
export function BentoTasksTile({ tasks, doneYesterday, onItemDone, refresh }: BentoTasksTileProps) {
  const { t } = useTranslation();
  const headingId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  useFocusRescue(listRef, () => headingRef.current);

  const overdue = tasks?.filter(isOverdue) ?? [];
  const rest = tasks?.filter((task) => !isOverdue(task)) ?? [];
  const rows = bentoTaskRows(overdue.length, rest.length);
  const shownOverdue = overdue.slice(0, rows.overdue);
  const shownRest = rest.slice(0, rows.rest);
  const openOverdue = overdue.filter((task) => !task.done).length;
  const done = tasks?.filter((task) => task.done).length ?? 0;

  const row = (task: TaskEntry) => (
    <BentoTaskRow
      key={task.id}
      task={task}
      onDone={(isDone) => onItemDone(task.id, isDone)}
      refresh={refresh}
    />
  );

  function openTasks(event: MouseEvent<HTMLAnchorElement>) {
    if (wantsNewTab(event) || event.shiftKey || event.altKey) return; // the browser's own way
    event.preventDefault();
    navigateTo(TASKS_ROUTE);
  }

  return (
    <section className="tile today-tile today-tile--tasks" aria-labelledby={headingId}>
      <div className="today-tile__head">
        <h2 id={headingId} ref={headingRef} className="today-tile__title" tabIndex={-1}>
          {t('today.bento.tasks.title')}
        </h2>
        {tasks && tasks.length > 0 ? (
          <span className="today-tile__meta">
            {t('today.bento.tasks.progress', { done, count: tasks.length })}
          </span>
        ) : null}
      </div>
      {tasks === undefined ? null : tasks.length === 0 ? (
        <p className="today-tile__empty">{t('today.bento.tasks.empty')}</p>
      ) : (
        <div ref={listRef} className="today-tasks">
          {shownOverdue.length > 0 ? (
            <ul className="today-tasks__list">{shownOverdue.map(row)}</ul>
          ) : null}
          {overdue.length > shownOverdue.length ? (
            <p className="today-tasks__more">
              <a className="today-tile__link" href={`#${TASKS_ROUTE}`} onClick={openTasks}>
                {t('today.tasks.allOverdue', { count: openOverdue })}
              </a>
            </p>
          ) : null}
          {shownRest.length > 0 ? (
            <ul className="today-tasks__list">{shownRest.map(row)}</ul>
          ) : null}
          {rest.length > shownRest.length ? (
            <p className="today-tasks__more">
              <a className="today-tile__link" href={`#${TASKS_ROUTE}`} onClick={openTasks}>
                {t('today.bento.tasks.all', { count: tasks.length })}
              </a>
            </p>
          ) : null}
        </div>
      )}
      {doneYesterday && doneYesterday > 0 ? (
        <p className="today-tasks__cheer">
          <Check size={18} weight="bold" aria-hidden="true" focusable="false" />
          {t('today.bento.tasks.yesterday', { count: doneYesterday })}
        </p>
      ) : null}
    </section>
  );
}
