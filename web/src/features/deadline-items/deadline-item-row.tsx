import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { DeadlineItem, TaskEntry } from '../../lib/api/deadlines-types';
import { noteLinkHandlers } from '../backlinks/open-note-at-line';
import { openItemNote, setNoteDone, tickTask, type TickTaskTarget } from './deadline-actions';
import { tooltipOpensAbove } from './tooltip-side';
import { dueLabel, isNoteItem, openUrgency } from './urgency-label';
import './deadline-items.css';

export interface DeadlineItemRowProps {
  item: DeadlineItem | TaskEntry;
  /** Show which note the item lives in (lists that mix notes). */
  showNoteTitle?: boolean;
  /** Extra controls at the end of the row (e.g. the calendar's "Dời ngày…" menu). */
  actions?: ReactNode;
  /** Called once the server confirmed a tick/untick (or note done/doing). */
  onDone?: (done: boolean) => void;
  /** Reloads the list after a conflict (the WebSocket event reloads live queries anyway). */
  refresh?: () => unknown;
}

function tickTarget(item: DeadlineItem | TaskEntry): TickTaskTarget | null {
  if (item.line === null || item.lineText === null) return null;
  const { path, line, lineText, revision, title } = item;
  return { path, line, lineText, revision, title };
}

/** The title is clamped (2 lines): cut when its text needs more room than it got. */
function isCut(title: HTMLElement): boolean {
  return title.scrollHeight > title.clientHeight + 1 || title.scrollWidth > title.clientWidth + 1;
}

/**
 * One deadline item or task as a list row (`<li>`): a real round checkbox named by the title,
 * the title itself as the "open note" control (up to 2 lines; Ctrl/middle click: new tab; full
 * text in a tooltip when cut), the urgency dot with its relative text, optionally the note title,
 * and extra actions. A container query moves the due text and the actions under the title when
 * the row is narrow, so the title keeps the room. Ticking is optimistic: the box flips at once
 * and flips back when the write is refused.
 */
export function DeadlineItemRow({
  item,
  showNoteTitle = false,
  actions,
  onDone,
  refresh,
}: DeadlineItemRowProps) {
  const { t } = useTranslation();
  const titleId = useId();
  const noteId = useId();
  const titleRef = useRef<HTMLSpanElement>(null);
  const [checked, setChecked] = useState(item.done);
  const [tooltip, setTooltip] = useState(false);
  const [tooltipAbove, setTooltipAbove] = useState(false);
  const rowRef = useRef<HTMLLIElement>(null);
  const tooltipRef = useRef<HTMLSpanElement>(null);
  const busy = useRef(false);

  // A reloaded list is the truth again.
  useEffect(() => setChecked(item.done), [item.done, item.revision]);

  async function toggle(next: boolean) {
    if (busy.current) return;
    busy.current = true;
    setChecked(next);
    const task = isNoteItem(item) ? null : tickTarget(item);
    const outcome = task
      ? await tickTask(task, next, { refresh })
      : await setNoteDone({ path: item.path, revision: item.revision, title: item.title }, next, {
          refresh,
        });
    busy.current = false;
    if (outcome === 'done') onDone?.(next);
    else setChecked(!next);
  }

  // Measured before paint: a tooltip that would be cut off below opens upward when it fits there.
  useLayoutEffect(() => {
    const row = rowRef.current;
    const tip = tooltipRef.current;
    if (tooltip && row && tip) setTooltipAbove(tooltipOpensAbove(row, tip));
  }, [tooltip]);

  // A tick hides the due text, so the title may fit now: its tooltip has nothing more to say.
  useLayoutEffect(() => {
    const title = titleRef.current;
    if (title && !isCut(title)) setTooltip(false);
  }, [checked]);

  function showTooltipIfCut() {
    const title = titleRef.current;
    if (title && isCut(title)) setTooltip(true);
  }

  const urgency = checked ? null : openUrgency(item);
  const classes = ['deadline-row'];
  if (checked) classes.push('is-done');
  if (tooltip) classes.push('has-tooltip');

  return (
    <li
      ref={rowRef}
      className={classes.join(' ')}
      onMouseEnter={showTooltipIfCut}
      onMouseLeave={() => setTooltip(false)}
      onFocus={showTooltipIfCut}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setTooltip(false);
      }}
      onKeyDown={(event) => {
        // WCAG 1.4.13: the tooltip can be dismissed without moving focus.
        if (event.key === 'Escape' && tooltip) setTooltip(false);
      }}
    >
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
      <div className="deadline-row__body">
        <button
          type="button"
          className="deadline-row__open"
          aria-label={t('deadline-items.openItemNamed', { title: item.title })}
          aria-describedby={showNoteTitle ? noteId : undefined}
          {...noteLinkHandlers((newTab) => openItemNote(item, { newTab }))}
        >
          <span ref={titleRef} id={titleId} className="deadline-row__title">
            {item.title}
          </span>
        </button>
        {showNoteTitle ? (
          <span id={noteId} className="deadline-row__note">
            {item.noteTitle}
          </span>
        ) : null}
        {urgency !== null && item.daysLeft !== null ? (
          <span className={`deadline-row__due deadline-row__due--${urgency}`}>
            <span className={`deadline-dot deadline-dot--${urgency}`} aria-hidden="true" />
            {dueLabel(item.daysLeft, t)}
          </span>
        ) : null}
        {actions ? <span className="deadline-row__actions">{actions}</span> : null}
      </div>
      {/* At row level, outside the dimmed text, so a done row's tooltip is never see-through. */}
      {tooltip ? (
        <span
          ref={tooltipRef}
          className={
            tooltipAbove
              ? 'deadline-row__tooltip deadline-row__tooltip--above'
              : 'deadline-row__tooltip'
          }
          aria-hidden="true"
        >
          {item.title}
        </span>
      ) : null}
    </li>
  );
}
