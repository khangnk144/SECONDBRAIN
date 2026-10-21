import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getTasks } from '../../lib/api/deadlines-api';
import type { TaskGroups } from '../../lib/api/deadlines-types';
import { useLocalDay } from '../../lib/local-day';
import { useLiveQuery } from '../../lib/use-live-query';
import { DeadlineItemRow } from '../deadline-items/deadline-item-row';
import { useFocusRescue } from '../today/use-focus-rescue';
import {
  keepTask,
  markTaskDone,
  NO_KEPT_TASKS,
  visibleGroups,
  withKeptTasks,
  type KeptTaskRows,
} from './task-groups-model';
import { useIncludeArchive } from './use-include-archive';
import './tasks-screen.css';

const TITLE_ID = 'tasks-title';

/**
 * "Việc cần làm" (route `/tasks`, SPEC F9): open tasks of user notes grouped Quá hạn / Hôm nay /
 * 7 ngày tới / Sau / Không có hạn, each group with its count, empty groups hidden. "Bao gồm
 * Archive" adds the tasks of `4 Archive`. Tab goes through the rows, Space ticks; a task ticked
 * here stays listed (checked, dimmed) until the user leaves the view, so a mis-tick can be undone.
 */
export function TasksScreen() {
  const { t } = useTranslation();
  const [includeArchive, setIncludeArchive] = useIncludeArchive();
  const titleRef = useRef<HTMLHeadingElement>(null);
  const groupsRef = useRef<HTMLDivElement>(null);
  const { data, status, refresh, mutate } = useLiveQuery<TaskGroups>(
    includeArchive ? 'tasks:with-archive' : 'tasks',
    () => getTasks({ includeArchive }),
  );
  useFocusRescue(groupsRef, () => titleRef.current);
  const today = useLocalDay();
  const [kept, setKept] = useState<KeptTaskRows>(NO_KEPT_TASKS);
  const shown = useMemo(
    () => (data ? withKeptTasks(data, kept, today) : undefined),
    [data, kept, today],
  );
  const latest = useRef({ shown, kept, today });
  useEffect(() => {
    latest.current = { shown, kept, today };
  });

  const onDone = useCallback(
    (id: string, done: boolean) => {
      const { shown: rows, kept: before, today: day } = latest.current;
      if (rows) {
        const after = keepTask(before, rows, id, done, day);
        latest.current = { ...latest.current, kept: after };
        setKept(after);
      }
      // With the rows as they were on screen, so an unticked kept row stays until the refetch.
      mutate((groups) => markTaskDone(withKeptTasks(groups, before, day), id, done));
    },
    [mutate],
  );
  // A refused tick reloads the list: from then on it shows what the server has.
  const refreshAfterConflict = useCallback(() => {
    latest.current = { ...latest.current, kept: NO_KEPT_TASKS };
    setKept(NO_KEPT_TASKS);
    return refresh();
  }, [refresh]);
  const groups = shown ? visibleGroups(shown) : [];

  return (
    <section className="tasks-screen" aria-labelledby={TITLE_ID}>
      <div className="tasks-screen__head">
        <h1 id={TITLE_ID} ref={titleRef} className="text-display" tabIndex={-1}>
          {t('tasks.title')}
        </h1>
        <label className="tasks-screen__toggle">
          <input
            type="checkbox"
            checked={includeArchive}
            onChange={(event) => setIncludeArchive(event.target.checked)}
          />
          {t('tasks.includeArchive')}
        </label>
      </div>
      {data === undefined && status === 'loading' ? (
        <p className="tasks-screen__note">{t('tasks.loading')}</p>
      ) : null}
      {data === undefined && status === 'error' ? (
        <div className="tasks-screen__note">
          <p role="alert">{t('tasks.loadError')}</p>
          <button type="button" className="button button--secondary" onClick={() => void refresh()}>
            {t('tasks.retry')}
          </button>
        </div>
      ) : null}
      {data !== undefined && groups.length === 0 ? (
        <p className="tasks-screen__note">{t('tasks.empty')}</p>
      ) : null}
      <div ref={groupsRef} className="tasks-screen__groups">
        {groups.map((group) => (
          <section
            key={group.id}
            className="tasks-group"
            aria-labelledby={`tasks-group-${group.id}`}
          >
            <h2 id={`tasks-group-${group.id}`} className="tasks-group__title">
              {t(`tasks.groups.${group.id}`)}{' '}
              <span className="tasks-group__count">
                {t('tasks.count', { count: group.tasks.filter((task) => !task.done).length })}
              </span>
            </h2>
            <ul className="deadline-list">
              {group.tasks.map((task) => (
                <DeadlineItemRow
                  key={task.id}
                  item={task}
                  showNoteTitle
                  onDone={(done) => onDone(task.id, done)}
                  refresh={refreshAfterConflict}
                />
              ))}
            </ul>
          </section>
        ))}
      </div>
    </section>
  );
}
