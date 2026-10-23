import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TaskEntry } from '../../../lib/api/deadlines-types';
import { noteLinkHandlers } from '../../backlinks/open-note-at-line';
import { openItemNote, tickTask } from '../../deadline-items/deadline-actions';
import { taskSubLine } from './task-sub-line';
import '../../deadline-items/deadline-items.css';

export interface BentoTaskRowProps {
  task: TaskEntry;
  /** Called once the server confirmed the tick or untick. */
  onDone: (done: boolean) => void;
  refresh: () => unknown;
}

/**
 * One Bento "Hôm nay" row (`--tile-2`, radius 16, ≥ 52 px): the real checkbox (named by the
 * title; square in Bento), the title as the "open note" control and the sub-line. The tick is the
 * shared one (deadline-actions.ts: revision check, conflict toast, reload): the box flips at once
 * and flips back when the write is refused.
 */
export function BentoTaskRow({ task, onDone, refresh }: BentoTaskRowProps) {
  const { t } = useTranslation();
  const titleId = useId();
  const subId = useId();
  const [checked, setChecked] = useState(task.done);
  const busy = useRef(false);

  // A reloaded list is the truth again.
  useEffect(() => setChecked(task.done), [task.done, task.revision]);

  async function toggle(next: boolean) {
    if (busy.current) return;
    busy.current = true;
    setChecked(next);
    const { path, line, lineText, revision, title } = task;
    const outcome = await tickTask({ path, line, lineText, revision, title }, next, { refresh });
    busy.current = false;
    if (outcome === 'done') onDone(next);
    else setChecked(!next);
  }

  const sub = taskSubLine({ ...task, done: checked }, t);
  return (
    <li className={checked ? 'today-task is-done' : 'today-task'}>
      <span className="deadline-check">
        <input
          type="checkbox"
          className="deadline-check__input"
          checked={checked}
          aria-labelledby={titleId}
          onChange={(event) => void toggle(event.target.checked)}
        />
        <span className="deadline-check__box" aria-hidden="true" />
      </span>
      <div className="today-task__body">
        <button
          type="button"
          className="today-task__open"
          aria-label={t('deadline-items.openItemNamed', { title: task.title })}
          aria-describedby={subId}
          {...noteLinkHandlers((newTab) => openItemNote(task, { newTab }))}
        >
          <span id={titleId} className="today-task__title">
            {task.title}
          </span>
        </button>
        <span
          id={subId}
          className={sub.urgent ? 'today-task__sub today-task__sub--urgent' : 'today-task__sub'}
        >
          {sub.text}
        </span>
      </div>
    </li>
  );
}
