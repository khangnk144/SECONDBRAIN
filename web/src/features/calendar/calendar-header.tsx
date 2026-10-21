import { CaretLeft, CaretRight } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { monthTitle } from './calendar-labels';

export interface CalendarHeaderProps {
  month: string;
  titleId: string;
  includeArchive: boolean;
  onPrevious: () => void;
  onToday: () => void;
  onNext: () => void;
  onIncludeArchive: (value: boolean) => void;
}

/** Month and year, the month buttons and the "Bao gồm Archive" toggle (a real checkbox). */
export function CalendarHeader(props: CalendarHeaderProps) {
  const { t, i18n } = useTranslation();
  return (
    <header className="calendar-header">
      {/* The screen's name is read first, so the heading says where the user is. */}
      <h1 id={props.titleId} className="calendar-header__title">
        <span className="visually-hidden">{t('nav.calendar')},</span>{' '}
        {monthTitle(props.month, i18n.language, t)}
      </h1>
      <div className="calendar-header__controls">
        <div className="calendar-header__nav" role="group" aria-label={t('calendar.navLabel')}>
          <button type="button" className="button button--secondary" onClick={props.onPrevious}>
            <CaretLeft size={18} aria-hidden="true" focusable="false" />
            <span>{t('calendar.previousMonth')}</span>
          </button>
          <button type="button" className="button button--secondary" onClick={props.onToday}>
            {t('calendar.today')}
          </button>
          <button type="button" className="button button--secondary" onClick={props.onNext}>
            <span>{t('calendar.nextMonth')}</span>
            <CaretRight size={18} aria-hidden="true" focusable="false" />
          </button>
        </div>
        <label className="calendar-archive-toggle">
          <input
            type="checkbox"
            className="calendar-archive-toggle__input"
            checked={props.includeArchive}
            onChange={(event) => props.onIncludeArchive(event.target.checked)}
          />
          <span>{t('calendar.includeArchive')}</span>
        </label>
      </div>
    </header>
  );
}
