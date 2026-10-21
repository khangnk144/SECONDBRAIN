import { useMemo, useRef, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { isoAddDays, useLocalDay } from '../../lib/local-day';
import { TodayStripLegend } from './today-strip-legend';
import { dayNumberText, weekdayKey } from './today-strip-model';
import { useStripVisibleDays } from './use-strip-visible-days';

/** Days of the strip (today … today+59), as the server sends them. */
const STRIP_DAYS = 60;

/**
 * The strip's place while Today loads: the same caption, cells (weekday and day number, no dots
 * or labels yet) and legend with the same classes, so it has exactly the strip's height and
 * nothing below moves when the data arrives (F10.2). Static: no shimmer; hidden from assistive
 * technology (the summary line says it is loading).
 */
export function TodayStripSkeleton() {
  const { t, i18n } = useTranslation();
  const rootRef = useRef<HTMLDivElement>(null);
  const visibleDays = useStripVisibleDays(rootRef);
  const today = useLocalDay();
  const days = useMemo(
    () => Array.from({ length: STRIP_DAYS }, (_, index) => isoAddDays(today, index)),
    [today],
  );
  const style = { '--today-strip-days': visibleDays } as CSSProperties;

  return (
    <div ref={rootRef} className="today-strip-placeholder" style={style} aria-hidden="true">
      <p className="today-strip__caption">{t('today.strip.caption')}</p>
      <div className="today-strip__frame">
        <div className="today-strip__row">
          <div className="today-strip__scroller">
            <div className="today-strip__track">
              {days.map((date, index) => (
                <span
                  key={date}
                  className={index === 0 ? 'today-strip__cell is-today' : 'today-strip__cell'}
                >
                  <span className="today-strip__dot" />
                  <span className="today-strip__weekday">
                    {t(`today.strip.weekday.${weekdayKey(date)}`)}
                  </span>
                  <span className="today-strip__day">
                    {dayNumberText(date, i18n.language, t('today.strip.monthStart'))}
                  </span>
                  <span className="today-strip__labels" />
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>
      <TodayStripLegend />
    </div>
  );
}
