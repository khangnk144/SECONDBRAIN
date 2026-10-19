import type { Icon } from '@phosphor-icons/react';
import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import './popup-menu.css';

export interface PopupMenuItem {
  id: string;
  label: string;
  icon?: Icon;
  disabled?: boolean;
  /** Why it is disabled (tooltip and screen-reader description). */
  disabledReason?: string;
  /** Hint shown faded on the right, e.g. `F2`. */
  shortcut?: string;
  onSelect: () => void;
}

export interface PopupMenuProps {
  label: string;
  items: PopupMenuItem[];
  /** Viewport coordinates of the top-left corner (clamped to stay on screen). */
  position: { x: number; y: number };
  /** Called before `onSelect`, and on Esc, Tab or a click outside; restore focus here. */
  onClose: () => void;
}

/**
 * WAI-ARIA menu: focus moves to the first item, ↑/↓ wrap, Home/End, Enter/Space activate, Esc and
 * Tab close. Disabled items stay focusable (so their reason can be read) but do nothing.
 */
export function PopupMenu({ label, items, position, onClose }: PopupMenuProps) {
  const ref = useRef<HTMLUListElement>(null);
  const reasonId = useId();
  const [active, setActive] = useState(() =>
    Math.max(
      0,
      items.findIndex((i) => !i.disabled),
    ),
  );
  const [place, setPlace] = useState(position);

  useLayoutEffect(() => {
    const menu = ref.current;
    if (!menu) return;
    const rect = menu.getBoundingClientRect();
    const margin = 8;
    setPlace({
      x: Math.max(margin, Math.min(position.x, window.innerWidth - rect.width - margin)),
      y: Math.max(margin, Math.min(position.y, window.innerHeight - rect.height - margin)),
    });
  }, [position]);

  useEffect(() => {
    ref.current?.querySelectorAll<HTMLElement>('[role="menuitem"]')[active]?.focus();
  }, [active]);

  useEffect(() => {
    const onPointerDown = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) onClose();
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [onClose]);

  function select(item: PopupMenuItem) {
    if (item.disabled) return;
    onClose();
    item.onSelect();
  }

  function onKeyDown(event: KeyboardEvent) {
    const count = items.length;
    const moves: Record<string, number> = {
      ArrowDown: (active + 1) % count,
      ArrowUp: (active - 1 + count) % count,
      Home: 0,
      End: count - 1,
    };
    if (event.key in moves) {
      event.preventDefault();
      setActive(moves[event.key] ?? 0);
    } else if (event.key === 'Escape' || event.key === 'Tab') {
      event.preventDefault();
      event.stopPropagation();
      onClose();
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      const item = items[active];
      if (item) select(item);
    }
  }

  return (
    <ul
      ref={ref}
      className="popup-menu"
      role="menu"
      aria-label={label}
      style={{ left: place.x, top: place.y }}
      onKeyDown={onKeyDown}
      onContextMenu={(event) => event.preventDefault()}
    >
      {items.map((item, index) => {
        const ItemIcon = item.icon;
        return (
          <li key={item.id} role="none">
            <button
              type="button"
              role="menuitem"
              className="popup-menu__item"
              tabIndex={index === active ? 0 : -1}
              aria-disabled={item.disabled || undefined}
              aria-describedby={
                item.disabled && item.disabledReason ? `${reasonId}-${index}` : undefined
              }
              title={item.disabled ? item.disabledReason : undefined}
              onMouseMove={() => setActive(index)}
              onClick={() => select(item)}
            >
              {ItemIcon ? <ItemIcon size={18} aria-hidden="true" focusable="false" /> : null}
              <span className="popup-menu__label">{item.label}</span>
              {item.shortcut ? <kbd aria-hidden="true">{item.shortcut}</kbd> : null}
            </button>
          </li>
        );
      })}
      {items.some((item) => item.disabled && item.disabledReason) ? (
        <li role="none" hidden>
          {items.map((item, index) =>
            item.disabled && item.disabledReason ? (
              <span key={item.id} id={`${reasonId}-${index}`}>
                {item.disabledReason}
              </span>
            ) : null,
          )}
        </li>
      ) : null}
    </ul>
  );
}
