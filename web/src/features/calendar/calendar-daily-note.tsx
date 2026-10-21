import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { isApiError } from '../../lib/api-client';
import { getDaily } from '../../lib/api/capture-daily-api';
import type { DailyNoteResponse } from '../../lib/api/capture-daily-types';
import { openDailyNote } from '../../lib/daily-flow';
import { useLiveQuery } from '../../lib/use-live-query';
import { noteLinkHandlers } from '../backlinks/open-note-at-line';

/** `GET /daily` answers 404 for a day without a note (and never creates one). */
async function findDaily(date: string): Promise<DailyNoteResponse | null> {
  try {
    return await getDaily(date);
  } catch (error) {
    if (isApiError(error, 'NOT_FOUND')) return null;
    throw error;
  }
}

/**
 * The opened day's Daily note: "Mở ghi chú ngày" when it exists, else "Viết", which creates it
 * from the Daily template (`POST /daily`) and opens it. Stays current when the note appears or
 * goes away elsewhere.
 */
export function CalendarDailyNote({ date }: { date: string }) {
  const { t } = useTranslation();
  const headingId = useId();
  const key = `daily:${date}`;
  const daily = useLiveQuery(key, () => findDaily(date));
  // Until this day's answer arrives, the previous day's would be wrong. After a failed check
  // "Viết" still works: it looks again before creating anything.
  const known = daily.dataKey === key || daily.error !== undefined;
  const exists = daily.dataKey === key && daily.data != null;
  const open = noteLinkHandlers((newTab) => void openDailyNote(date, { newTab }));

  return (
    <section className="calendar-day-panel__daily" aria-labelledby={headingId}>
      <h3 id={headingId} className="calendar-day-panel__subheading">
        {t('calendar.daily.title')}
      </h3>
      {!known ? null : exists ? (
        <button type="button" className="button button--secondary" {...open}>
          {t('calendar.daily.open')}
        </button>
      ) : (
        <div className="calendar-day-panel__daily-missing">
          <p className="calendar-day-panel__muted">{t('calendar.daily.missing')}</p>
          <button type="button" className="button button--secondary" {...open}>
            {t('calendar.daily.write')}
          </button>
        </div>
      )}
    </section>
  );
}
