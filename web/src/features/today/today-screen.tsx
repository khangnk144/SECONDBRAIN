import { useTranslation } from 'react-i18next';
import { formatLongDate } from '../../lib/format-long-date';
import { greetingPeriod } from '../../lib/greeting';
import { useNow } from '../../lib/use-now';
import { useUiPrefsStore } from '../../lib/ui-prefs-store';
import './today-screen.css';

/**
 * Today screen. For now it shows the date, the time-of-day greeting and a calm
 * summary line; the 14-day strip, tasks, capture and projects join once the
 * vault and index exist.
 */
export function TodayScreen() {
  const { t, i18n } = useTranslation();
  const now = useNow();
  const name = useUiPrefsStore((state) => state.prefs.name);
  const period = greetingPeriod(now);

  return (
    <section className="today" aria-labelledby="today-greeting">
      <p className="today__date">{formatLongDate(now, i18n.language, t('today.dateFormat'))}</p>
      <h1 id="today-greeting" className="text-display today__greeting">
        {t(`today.greeting.${period}`, { name })}
      </h1>
      <p className="today__summary">{t('today.summaryNothingUrgent')}</p>
      <p className="today__hint">{t('today.emptyHint')}</p>
    </section>
  );
}
