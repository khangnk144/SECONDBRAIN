import { useTranslation } from 'react-i18next';

const ENTRIES = ['urgent', 'soon', 'ok', 'today'] as const;

/** What the dot colours mean (as in the Today mock), so colour is never the only key. */
export function TodayStripLegend() {
  const { t } = useTranslation();
  return (
    <ul className="today-strip__legend">
      {ENTRIES.map((entry) => (
        <li key={entry} className="today-strip__legend-item">
          <span
            className={`today-strip__legend-dot today-strip__legend-dot--${entry}`}
            aria-hidden="true"
          />
          {t(`today.strip.legend.${entry}`)}
        </li>
      ))}
    </ul>
  );
}
