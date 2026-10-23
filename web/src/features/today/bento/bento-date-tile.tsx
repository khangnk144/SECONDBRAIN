import dayjs from 'dayjs';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { formatLongDate } from '../../../lib/format-long-date';

/**
 * "Ngày" (2 columns, `--tint` background, `--on-tint` text): the weekday, today's day number as
 * the screen's big date (64 px, 800) and month + year. Read as one full date by screen readers.
 */
export function BentoDateTile({ now }: { now: Date }) {
  const { t, i18n } = useTranslation();
  const headingId = useId();
  const language = i18n.language;
  return (
    <section className="tile tile--tint today-tile today-tile--date" aria-labelledby={headingId}>
      <h2 id={headingId} className="visually-hidden">
        {t('today.bento.date.title')}
      </h2>
      <p className="visually-hidden">{formatLongDate(now, language, t('today.bento.date.full'))}</p>
      <span className="today-date__weekday" aria-hidden="true">
        {formatLongDate(now, language, t('today.bento.date.weekday'))}
      </span>
      <span className="today-date__day" aria-hidden="true">
        {now.getDate()}
      </span>
      <span className="today-date__month" aria-hidden="true">
        {dayjs(now).locale(language).format(t('today.bento.date.monthYear'))}
      </span>
    </section>
  );
}
