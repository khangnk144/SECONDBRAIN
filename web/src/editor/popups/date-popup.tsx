import type { Editor } from '@tiptap/core';
import { CaretLeft, CaretRight } from '@phosphor-icons/react';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { EditorContext } from '../editor-context';
import type { TriggerMatch } from '../extensions/editor-triggers';
import { addMonths, todayDate, type CalendarDate } from '../local-dates';
import { CalendarGrid, dayCellId } from './calendar-grid';
import {
  dateForQuery,
  dueToken,
  moveByKey,
  quickChoices,
  type QuickChoice,
} from './calendar-model';
import { useActiveDescendant, usePopupKeys, usePopupPlacement } from './popup-hooks';
import { replaceTrigger } from './trigger-replace';

interface DatePopupProps {
  editor: Editor;
  context: EditorContext;
  trigger: TriggerMatch;
}

/**
 * Date popup on `📅` or `@` (F3): quick choices and a small calendar. Arrows move by day/week,
 * Page Up/Down by month, Enter picks, Esc closes. Inserts `📅 YYYY-MM-DD` (local calendar date).
 */
export function DatePopup(props: DatePopupProps) {
  const { t } = useTranslation();
  const today = todayDate();
  const label = (choice: QuickChoice) => t(`editor.date.${choice.id}`);
  const start = dateForQuery(props.trigger.query, today, label);
  const [moved, setMoved] = useState<{ query: string; date: CalendarDate } | null>(null);
  const active = moved && moved.query === props.trigger.query ? moved.date : start;
  if (!active) return <HiddenPopup context={props.context} />;
  return (
    <DateCalendar
      {...props}
      today={today}
      active={active}
      label={label}
      onMove={(date) => setMoved({ query: props.trigger.query, date })}
    />
  );
}

/** Nothing matches (`@someone`): show nothing and leave every key to the editor. */
function HiddenPopup({ context }: { context: EditorContext }) {
  usePopupKeys(context, () => false);
  return null;
}

interface DateCalendarProps extends DatePopupProps {
  today: CalendarDate;
  active: CalendarDate;
  label: (choice: QuickChoice) => string;
  onMove: (date: CalendarDate) => void;
}

function DateCalendar({
  editor,
  context,
  trigger,
  today,
  active,
  label,
  onMove,
}: DateCalendarProps) {
  const { t } = useTranslation();
  const id = useId();
  const gridId = `${id}-grid`;
  const hintId = `${id}-hint`;
  const { ref, style } = usePopupPlacement(editor, trigger.from, `${active.year}-${active.month}`);
  useActiveDescendant(editor, gridId, dayCellId(gridId, active));

  const pick = (date: CalendarDate) => {
    // No space after it: a space at the end of a line would be saved as `&#x20;`.
    replaceTrigger(editor, trigger, dueToken(date));
  };
  usePopupKeys(context, (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      pick(active);
      return true;
    }
    if (event.ctrlKey || event.metaKey || event.altKey) return false;
    const next = moveByKey(active, event.key);
    if (!next) return false;
    onMove(next);
    return true;
  });

  return (
    <div
      ref={ref}
      className="editor-popup date-popup"
      style={style}
      role="group"
      aria-label={t('editor.date.label')}
      onMouseDown={(event) => event.preventDefault()}
    >
      <div className="date-popup__quick">
        {quickChoices(today).map((choice) => (
          <button
            key={choice.id}
            type="button"
            tabIndex={-1}
            className="date-popup__choice"
            onClick={() => pick(choice.date)}
          >
            {label(choice)}
          </button>
        ))}
      </div>
      <div className="date-popup__nav">
        <button
          type="button"
          tabIndex={-1}
          className="date-popup__step"
          aria-label={t('editor.date.previousMonth')}
          title={t('editor.date.previousMonth')}
          onClick={() => onMove(addMonths(active, -1))}
        >
          <CaretLeft size={18} aria-hidden="true" focusable="false" />
        </button>
        <button
          type="button"
          tabIndex={-1}
          className="date-popup__step"
          aria-label={t('editor.date.nextMonth')}
          title={t('editor.date.nextMonth')}
          onClick={() => onMove(addMonths(active, 1))}
        >
          <CaretRight size={18} aria-hidden="true" focusable="false" />
        </button>
      </div>
      <CalendarGrid id={gridId} active={active} today={today} describedBy={hintId} onPick={pick} />
      <p id={hintId} className="date-popup__hint">
        {t('editor.date.hint')}
      </p>
    </div>
  );
}
