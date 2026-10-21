import { CalendarBlank, DotsThreeVertical } from '@phosphor-icons/react';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { DeadlineItem } from '../../lib/api/deadlines-types';
import { PopupMenu, type PopupMenuItem } from '../dialogs/popup-menu';

export interface CalendarItemMenuProps {
  item: DeadlineItem;
  /** "Dời ngày…": the date picker, then the move. */
  onReschedule: (item: DeadlineItem) => void;
}

/**
 * The item's menu button in the day pane. "Dời ngày…" is the keyboard way to move an item
 * (drag and drop needs a pointer): Enter or ↓ opens the menu, Enter picks, the date picker
 * follows. Focus comes back to this button when the menu or the picker closes.
 */
export function CalendarItemMenu({ item, onReschedule }: CalendarItemMenuProps) {
  const { t } = useTranslation();
  const button = useRef<HTMLButtonElement>(null);
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null);

  const open = () => {
    const rect = button.current?.getBoundingClientRect();
    if (rect) setPosition({ x: rect.left, y: rect.bottom + 4 });
  };

  const items: PopupMenuItem[] = [
    {
      id: 'reschedule',
      label: t('calendar.itemMenu.reschedule'),
      icon: CalendarBlank,
      onSelect: () => onReschedule(item),
    },
  ];

  return (
    <>
      <button
        ref={button}
        type="button"
        className="icon-button calendar-item-menu"
        aria-label={t('calendar.itemMenu.button', { title: item.title })}
        aria-haspopup="menu"
        aria-expanded={position !== null}
        onClick={open}
        onKeyDown={(event) => {
          if (event.key !== 'ArrowDown') return;
          event.preventDefault();
          open();
        }}
      >
        <DotsThreeVertical size={18} aria-hidden="true" focusable="false" />
      </button>
      {position ? (
        <PopupMenu
          label={t('calendar.itemMenu.label', { title: item.title })}
          items={items}
          position={position}
          onClose={() => {
            setPosition(null);
            button.current?.focus();
          }}
        />
      ) : null}
    </>
  );
}
