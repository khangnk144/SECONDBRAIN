import type { CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import type { StripCell } from './today-strip-model';

/** Long lists stay readable: the rest is counted, the popover lists everything. */
const TOOLTIP_TITLES = 5;

/**
 * Full titles of a cell's items on hover/focus (labels on the strip are cut to one line). Hidden
 * from assistive technology: the cell already carries the titles as its description.
 */
export function TodayStripTooltip({ cell, left }: { cell: StripCell; left: number }) {
  const { t } = useTranslation();
  if (cell.items.length === 0) return null;
  const rest = cell.items.length - TOOLTIP_TITLES;
  return (
    <div
      className="today-strip__tooltip"
      aria-hidden="true"
      style={{ '--today-tooltip-left': `${left}px` } as CSSProperties}
    >
      {cell.items.slice(0, TOOLTIP_TITLES).map((item) => (
        <span key={item.id} className="today-strip__tooltip-line">
          {item.title}
        </span>
      ))}
      {rest > 0 ? (
        <span className="today-strip__tooltip-more">{t('today.strip.more', { count: rest })}</span>
      ) : null}
    </div>
  );
}
