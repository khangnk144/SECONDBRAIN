import { memo, type DragEvent } from 'react';
import type { DeadlineItem } from '../../lib/api/deadlines-types';
import { visibleItems } from './calendar-month-model';

/** Type of the drag payload; the item itself travels in the grid's state. */
export const CALENDAR_DRAG_TYPE = 'application/x-second-brain-deadline';

export interface CalendarDayCellProps {
  date: string;
  /** Day of the month shown in the corner. */
  dayNumber: number;
  items: readonly DeadlineItem[];
  /** Accessible name: the long date, "hôm nay", every item title. */
  label: string;
  inMonth: boolean;
  isToday: boolean;
  isSelected: boolean;
  /** Holds the grid's single tab stop. */
  isActive: boolean;
  /** An item is being dragged and may be dropped here (another day). */
  isDropTarget: boolean;
  /** The item being dragged, if it comes from this cell. */
  draggingId: string | null;
  onOpen: (date: string) => void;
  onItemDragStart: (item: DeadlineItem, event: DragEvent) => void;
  onItemDragEnd: () => void;
  onDragOverDay: (date: string, event: DragEvent) => void;
  onDragLeaveDay: (date: string, event: DragEvent) => void;
  onDropOnDay: (date: string, event: DragEvent) => void;
}

function dotClass(item: DeadlineItem): string {
  return item.done ? 'deadline-dot' : `deadline-dot deadline-dot--${item.urgency}`;
}

/**
 * One day of the month grid (`gridcell`, focusable through the grid's roving tab stop): the day
 * number, up to three items (dot + one-line title, done ones struck through) then "+n". Open
 * items can be dragged to another day; the keyboard path is the day pane's "Dời ngày…".
 */
export const CalendarDayCell = memo(function CalendarDayCell(props: CalendarDayCellProps) {
  const { date, items, isDropTarget, draggingId } = props;
  const { shown, more } = visibleItems(items);
  const classes = ['calendar-cell'];
  if (!props.inMonth) classes.push('is-outside');
  if (props.isToday) classes.push('is-today');
  if (props.isSelected) classes.push('is-selected');
  if (isDropTarget) classes.push('is-drop-target');
  if (items.length > 0) classes.push('has-items');

  return (
    <td
      role="gridcell"
      className={classes.join(' ')}
      data-date={date}
      tabIndex={props.isActive ? 0 : -1}
      aria-label={props.label}
      aria-selected={props.isSelected}
      aria-current={props.isToday ? 'date' : undefined}
      onClick={() => props.onOpen(date)}
      // Cancelling both enter and over makes the day a drop target in every browser.
      onDragEnter={(event) => props.onDragOverDay(date, event)}
      onDragOver={(event) => props.onDragOverDay(date, event)}
      onDragLeave={(event) => props.onDragLeaveDay(date, event)}
      onDrop={(event) => props.onDropOnDay(date, event)}
    >
      {/* The name above already says all of this; the visual copy stays out of the reading. */}
      <div className="calendar-cell__body" aria-hidden="true">
        <span className="calendar-cell__number">{props.dayNumber}</span>
        {shown.length > 0 ? (
          <ul className="calendar-cell__items">
            {shown.map((item) => {
              const itemClasses = ['calendar-item'];
              if (item.done) itemClasses.push('is-done');
              if (item.id === draggingId) itemClasses.push('is-dragging');
              return (
                <li
                  key={item.id}
                  className={itemClasses.join(' ')}
                  data-item-id={item.id}
                  draggable={!item.done}
                  onDragStart={
                    item.done ? undefined : (event) => props.onItemDragStart(item, event)
                  }
                  onDragEnd={item.done ? undefined : props.onItemDragEnd}
                >
                  <span className={dotClass(item)} />
                  <span className="calendar-item__title">{item.title}</span>
                </li>
              );
            })}
          </ul>
        ) : null}
        {more > 0 ? <span className="calendar-cell__more">+{more}</span> : null}
        {items.length > 0 ? <span className="calendar-cell__count">{items.length}</span> : null}
      </div>
    </td>
  );
});
