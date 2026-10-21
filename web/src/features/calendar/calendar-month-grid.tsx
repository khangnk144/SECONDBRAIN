import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent,
} from 'react';
import { useTranslation } from 'react-i18next';
import type { DeadlineItem } from '../../lib/api/deadlines-types';
import { CALENDAR_DRAG_TYPE, CalendarDayCell } from './calendar-day-cell';
import { dayCellLabel, WEEKDAY_KEYS } from './calendar-labels';
import { monthGridDates, moveDayByKey } from './calendar-month-model';

export interface CalendarMonthGridProps {
  month: string;
  /** Id of the month title (the grid's name). */
  labelledBy: string;
  items: Map<string, DeadlineItem[]>;
  today: string;
  selectedDay: string | null;
  /** Day holding the single tab stop (always drawn in this month's grid). */
  activeDay: string;
  busy: boolean;
  /** A key moved the focused day (it may lie in another month). */
  onMove: (day: string) => void;
  /** Enter/Space or a click: open the day in the right pane. */
  onOpenDay: (day: string) => void;
  /** An item was dropped on another day. */
  onDropItem: (item: DeadlineItem, day: string) => void;
}

const NO_ITEMS: DeadlineItem[] = [];

/**
 * The month as a WAI-ARIA grid with one tab stop (roving tabindex): arrows move by day/week,
 * Home/End to the week's start/end, PageUp/PageDown by month, Enter/Space opens the day. Focus
 * follows the moved day, also into the next month once it is drawn. Open items can be dragged
 * onto another day (HTML drag and drop); the day under the pointer shows it accepts the drop.
 */
export function CalendarMonthGrid(props: CalendarMonthGridProps) {
  const { month, items, today, selectedDay, activeDay, onMove, onOpenDay, onDropItem } = props;
  const { t, i18n } = useTranslation();
  const gridRef = useRef<HTMLTableElement>(null);
  /** Day to focus once its cell is on screen (the month may load a render later). */
  const pendingFocus = useRef<string | null>(null);
  const dragging = useRef<DeadlineItem | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [overDay, setOverDay] = useState<string | null>(null);
  const weeks = useMemo(() => monthGridDates(month), [month]);
  // Names are rebuilt only when the data, the day or the language change, not on every drag move.
  const labels = useMemo(
    () =>
      new Map(
        weeks
          .flat()
          .map((date) => [
            date,
            dayCellLabel(date, items.get(date) ?? NO_ITEMS, date === today, i18n.language, t),
          ]),
      ),
    [weeks, items, today, i18n.language, t],
  );

  useLayoutEffect(() => {
    const day = pendingFocus.current;
    if (day === null) return;
    const cell = gridRef.current?.querySelector<HTMLElement>(`[data-date="${day}"]`);
    if (!cell) return;
    pendingFocus.current = null;
    cell.focus();
  });

  const endDrag = useCallback(() => {
    dragging.current = null;
    setDraggingId(null);
    setOverDay(null);
  }, []);

  // A drag that ends anywhere (Esc, a drop outside the grid) clears the drop state. `drop` is
  // heard while bubbling, so a day's own drop handler still sees the dragged item first.
  useEffect(() => {
    if (draggingId === null) return;
    document.addEventListener('dragend', endDrag, true);
    document.addEventListener('drop', endDrag);
    return () => {
      document.removeEventListener('dragend', endDrag, true);
      document.removeEventListener('drop', endDrag);
    };
  }, [draggingId, endDrag]);

  const onItemDragStart = useCallback((item: DeadlineItem, event: DragEvent) => {
    const transfer = event.dataTransfer as DataTransfer | undefined;
    transfer?.setData(CALENDAR_DRAG_TYPE, item.id);
    transfer?.setData('text/plain', item.title);
    if (transfer) transfer.effectAllowed = 'move';
    dragging.current = item;
    setDraggingId(item.id);
  }, []);

  const onDragOverDay = useCallback((day: string, event: DragEvent) => {
    const item = dragging.current;
    // Only our own items, and only onto another day: the same day refuses the drop.
    if (!item || item.date === day) return;
    event.preventDefault();
    const transfer = event.dataTransfer as DataTransfer | undefined;
    if (transfer) transfer.dropEffect = 'move';
    setOverDay(day);
  }, []);

  const onDragLeaveDay = useCallback((day: string, event: DragEvent) => {
    const into = event.relatedTarget as Node | null;
    if (into && event.currentTarget.contains(into)) return;
    setOverDay((current) => (current === day ? null : current));
  }, []);

  const onDropOnDay = useCallback(
    (day: string, event: DragEvent) => {
      const item = dragging.current;
      endDrag();
      if (!item || item.date === day) return;
      event.preventDefault();
      onDropItem(item, day);
    },
    [endDrag, onDropItem],
  );

  function onKeyDown(event: KeyboardEvent<HTMLTableElement>) {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onOpenDay(activeDay);
      return;
    }
    const next = moveDayByKey(activeDay, event.key);
    if (next === null) return;
    event.preventDefault();
    pendingFocus.current = next;
    onMove(next);
  }

  const classes = ['calendar-grid'];
  if (draggingId !== null) classes.push('is-dragging');

  return (
    <table
      ref={gridRef}
      role="grid"
      className={classes.join(' ')}
      aria-labelledby={props.labelledBy}
      aria-busy={props.busy || undefined}
      onKeyDown={onKeyDown}
    >
      <thead>
        <tr>
          {WEEKDAY_KEYS.map((key) => (
            <th key={key} scope="col" className="calendar-grid__weekday">
              <span aria-hidden="true">{t(`calendar.weekdays.${key}.short`)}</span>
              <span className="visually-hidden">{t(`calendar.weekdays.${key}.long`)}</span>
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {weeks.map((week) => (
          <tr key={week[0]}>
            {week.map((date) => {
              const dayItems = items.get(date) ?? NO_ITEMS;
              const isToday = date === today;
              return (
                <CalendarDayCell
                  key={date}
                  date={date}
                  dayNumber={Number(date.slice(8))}
                  items={dayItems}
                  label={labels.get(date) ?? date}
                  inMonth={date.startsWith(month)}
                  isToday={isToday}
                  isSelected={date === selectedDay}
                  isActive={date === activeDay}
                  isDropTarget={date === overDay}
                  draggingId={draggingId}
                  onOpen={onOpenDay}
                  onItemDragStart={onItemDragStart}
                  onItemDragEnd={endDrag}
                  onDragOverDay={onDragOverDay}
                  onDragLeaveDay={onDragLeaveDay}
                  onDropOnDay={onDropOnDay}
                />
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
