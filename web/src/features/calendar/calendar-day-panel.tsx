import { useId, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { DeadlineItem } from '../../lib/api/deadlines-types';
import { pickDateDialog } from '../../lib/dialogs/dialog-requests';
import { DeadlineItemRow } from '../deadline-items/deadline-item-row';
import { CalendarDailyNote } from './calendar-daily-note';
import { CalendarItemMenu } from './calendar-item-menu';
import { longDayLabel } from './calendar-labels';
import { rescheduleCalendarItem } from './calendar-reschedule';
import { useCalendarDayItems } from './use-calendar-day-items';
import { useCalendarRoute } from './use-calendar-route';
import { useRevealDayPane } from './use-reveal-day-pane';
import '../deadline-items/deadline-items.css';
import './calendar-day-panel.css';

/**
 * Right pane of the calendar: the opened day (from the URL) with its items – tick, "Mở ghi chú",
 * and a menu with "Dời ngày…" (date picker, the keyboard way to reschedule) – and its Daily note.
 */
export function CalendarDayPanel() {
  const { t, i18n } = useTranslation();
  const headingId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const { month, day, today } = useCalendarRoute();
  const { items, failed, refresh, mutate } = useCalendarDayItems(day, month);
  useRevealDayPane(day, headingRef);

  if (day === null) {
    return (
      <section className="calendar-day-panel" aria-labelledby={headingId}>
        <h2 id={headingId} className="calendar-day-panel__title">
          {t('placeholder.calendarDay.title')}
        </h2>
        <p className="calendar-day-panel__muted">{t('placeholder.calendarDay.body')}</p>
      </section>
    );
  }

  async function reschedule(item: DeadlineItem) {
    const date = await pickDateDialog({
      title: t('calendar.reschedule.title', { title: item.title }),
      initial: item.date,
      confirmLabel: t('calendar.reschedule.confirm'),
    });
    if (date === null || date === item.date) return;
    const outcome = await rescheduleCalendarItem(item, date, { mutate, refresh });
    // The row leaves this day; keep focus in the pane rather than let it fall to the page.
    if (outcome === 'done') headingRef.current?.focus();
  }

  return (
    <section className="calendar-day-panel" aria-labelledby={headingId}>
      <h2 id={headingId} ref={headingRef} tabIndex={-1} className="calendar-day-panel__title">
        {longDayLabel(day, i18n.language, t)}
      </h2>
      {day === today ? (
        <p className="calendar-day-panel__muted">{t('calendar.panel.today')}</p>
      ) : null}
      {items === null ? (
        <p className="calendar-day-panel__muted" role="status">
          {t(failed ? 'calendar.panel.loadError' : 'calendar.panel.loading')}
        </p>
      ) : items.length === 0 ? (
        <div className="calendar-day-panel__empty">
          <p>{t('calendar.panel.empty')}</p>
          <p>{t('calendar.panel.emptyHint')}</p>
        </div>
      ) : (
        <ul
          className="deadline-list calendar-day-panel__items"
          aria-label={t('calendar.panel.items')}
        >
          {items.map((item) => (
            <DeadlineItemRow
              key={item.id}
              item={item}
              showNoteTitle={item.kind === 'task'}
              refresh={refresh}
              onDone={() => void refresh()}
              actions={
                <CalendarItemMenu item={item} onReschedule={(target) => void reschedule(target)} />
              }
            />
          ))}
        </ul>
      )}
      <CalendarDailyNote date={day} />
    </section>
  );
}
