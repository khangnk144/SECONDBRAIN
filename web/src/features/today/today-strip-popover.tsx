import { X } from '@phosphor-icons/react';
import {
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from 'react';
import { useTranslation } from 'react-i18next';
import type { DeadlineItem } from '../../lib/api/deadlines-types';
import { DeadlineItemRow } from '../deadline-items/deadline-item-row';
import { useFocusRescue } from './use-focus-rescue';

export interface TodayStripPopoverProps {
  id: string;
  title: string;
  items: DeadlineItem[];
  /** Horizontal position inside the strip (px), already kept inside it. */
  left: number;
  /** `returnFocus`: Esc and the close button put focus back on the cell. */
  onClose: (returnFocus: boolean) => void;
  onItemDone: (id: string, done: boolean) => void;
  refresh: () => unknown;
}

const FOCUSABLE = 'input:not([disabled]), button:not([disabled]), [href], [tabindex="0"]';

/**
 * Every item of one day (or every overdue item), each with its tick and "Mở ghi chú". Dialog
 * semantics: focus moves inside on open and stays inside (Tab wraps), Esc or the close button
 * close it and return focus to the cell; a click outside closes it without moving focus.
 */
export function TodayStripPopover({
  id,
  title,
  items,
  left,
  onClose,
  onItemDone,
  refresh,
}: TodayStripPopoverProps) {
  const { t } = useTranslation();
  const headingId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  useFocusRescue(listRef, () => closeRef.current);
  const [fits, setFits] = useState(false);

  // A popover short enough not to scroll does not clip either, so a row's tooltip can reach past
  // its edge instead of being cut off (long lists scroll and keep their tooltips inside).
  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    // Without clipping, `scrollHeight` still counts what would overflow the max height.
    const measure = () => setFits(dialog.scrollHeight <= dialog.clientHeight);
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [items.length]);

  useLayoutEffect(() => {
    const first = listRef.current?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? closeRef.current)?.focus();
  }, []);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onClose(true);
      return;
    }
    if (event.key !== 'Tab' || !dialogRef.current) return;
    const focusables = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE));
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  const style = { '--today-popover-left': `${left}px` } as CSSProperties;

  return (
    <div
      id={id}
      ref={dialogRef}
      className={fits ? 'today-strip__popover is-fitting' : 'today-strip__popover'}
      role="dialog"
      aria-modal="true"
      aria-labelledby={headingId}
      style={style}
      onKeyDown={onKeyDown}
    >
      <div className="today-strip__popover-head">
        <h3 id={headingId} className="today-strip__popover-title">
          {title}
        </h3>
        <button
          ref={closeRef}
          type="button"
          className="icon-button"
          aria-label={t('today.strip.popover.close')}
          onClick={() => onClose(true)}
        >
          <X size={18} aria-hidden="true" focusable="false" />
        </button>
      </div>
      {items.length > 0 ? (
        <ul ref={listRef} className="deadline-list today-strip__popover-list">
          {items.map((item) => (
            <DeadlineItemRow
              key={item.id}
              item={item}
              showNoteTitle
              onDone={(done) => onItemDone(item.id, done)}
              refresh={refresh}
            />
          ))}
        </ul>
      ) : (
        <p className="today-strip__popover-empty">{t('today.strip.popover.empty')}</p>
      )}
    </div>
  );
}
