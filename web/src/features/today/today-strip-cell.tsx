import { useId, type CSSProperties, type FocusEvent, type MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import {
  dayNumberText,
  labelLines,
  longDateText,
  OVERDUE_KEY,
  weekdayKey,
  type StripCell,
} from './today-strip-model';

export interface TodayStripCellProps {
  cell: StripCell;
  /** The roving tab stop of the strip. */
  tabStop: boolean;
  /** Its popover is open. */
  expanded: boolean;
  popoverId: string;
  onActivate: (key: string, button: HTMLButtonElement) => void;
  onHint: (key: string | null, button: HTMLButtonElement | null) => void;
}

/** Accessible name: the full date (or "Quá hạn") and how many items, never colour alone. */
function useCellLabel(cell: StripCell): string {
  const { t, i18n } = useTranslation();
  const count = cell.items.length;
  if (cell.key === OVERDUE_KEY) return t('today.strip.overdueCell', { count });
  const date = cell.date ?? '';
  const long = longDateText(date, i18n.language, t('today.dateFormat'), !cell.isToday);
  const named = cell.isToday ? t('today.strip.todayDate', { date: long }) : long;
  return count > 0
    ? t('today.strip.cell', { date: named, count })
    : t('today.strip.cellEmpty', { date: named });
}

/**
 * One cell of the strip: a real button (Enter/Space/click open the day's popover) with the dot,
 * weekday + day number (or "Quá hạn (n)"), up to two labels sharing three lines (a lone label may
 * wrap over all three, as in the mock; full titles in the tooltip and the popover) and "+n". Every
 * cell has the same fixed height, so long titles or busy days never push the sections below.
 */
export function TodayStripCell({
  cell,
  tabStop,
  expanded,
  popoverId,
  onActivate,
  onHint,
}: TodayStripCellProps) {
  const { t, i18n } = useTranslation();
  const descriptionId = useId();
  const label = useCellLabel(cell);
  const lines = labelLines(cell);
  const overdue = cell.key === OVERDUE_KEY;
  const classes = ['today-strip__cell'];
  if (overdue) classes.push('today-strip__cell--overdue');
  if (cell.isToday) classes.push('is-today');
  if (cell.urgency) classes.push(`has-items today-strip__cell--${cell.urgency}`);

  const hint = (event: MouseEvent<HTMLButtonElement> | FocusEvent<HTMLButtonElement>) =>
    onHint(cell.key, event.currentTarget);

  return (
    <button
      type="button"
      className={classes.join(' ')}
      data-key={cell.key}
      tabIndex={tabStop ? 0 : -1}
      aria-label={label}
      aria-describedby={cell.items.length > 0 ? descriptionId : undefined}
      aria-haspopup="dialog"
      aria-expanded={expanded}
      aria-controls={expanded ? popoverId : undefined}
      aria-current={cell.isToday ? 'date' : undefined}
      onClick={(event) => onActivate(cell.key, event.currentTarget)}
      onMouseEnter={hint}
      onFocus={hint}
      onMouseLeave={() => onHint(null, null)}
      onBlur={() => onHint(null, null)}
    >
      <span className="today-strip__dot" aria-hidden="true" />
      {overdue ? (
        <span className="today-strip__heading" aria-hidden="true">
          {t('today.strip.overdue', { count: cell.items.length })}
        </span>
      ) : (
        <>
          <span className="today-strip__weekday" aria-hidden="true">
            {t(`today.strip.weekday.${weekdayKey(cell.date ?? '')}`)}
          </span>
          <span className="today-strip__day" aria-hidden="true">
            {dayNumberText(cell.date ?? '', i18n.language, t('today.strip.monthStart'))}
          </span>
        </>
      )}
      <span className="today-strip__labels" aria-hidden="true">
        {cell.labels.map((item, index) => (
          <span
            key={item.id}
            className="today-strip__label"
            style={{ '--today-label-lines': lines[index] ?? 1 } as CSSProperties}
          >
            {item.title}
          </span>
        ))}
        {cell.more > 0 ? (
          <span className="today-strip__more">{t('today.strip.more', { count: cell.more })}</span>
        ) : null}
      </span>
      {cell.items.length > 0 ? (
        <span id={descriptionId} className="visually-hidden">
          {cell.items.map((item) => item.title).join(', ')}
        </span>
      ) : null}
    </button>
  );
}
