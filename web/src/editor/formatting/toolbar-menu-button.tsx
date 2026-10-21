import { useRef, useState, type HTMLAttributes, type ReactNode } from 'react';
import { PopupMenu, type PopupMenuItem } from '../../features/dialogs/popup-menu';

interface ToolbarMenuButtonProps {
  /** Toolbar item id (roving focus). */
  itemId: string;
  tabIndex: 0 | -1;
  label: string;
  menuLabel: string;
  className: string;
  disabled: boolean;
  /** Hover and focus handlers of the toolbar's tooltip. */
  tooltipProps?: HTMLAttributes<HTMLButtonElement>;
  items: PopupMenuItem[];
  children: ReactNode;
}

/**
 * A toolbar button that opens a menu (text style, "Thêm"). Pressing it never takes the editor's
 * selection; the menu takes focus while open and gives it back to this button when it closes
 * without a choice (a chosen command puts the caret back in the editor itself).
 */
export function ToolbarMenuButton(props: ToolbarMenuButtonProps) {
  const { itemId, tabIndex, label, menuLabel, className, disabled, tooltipProps, items, children } =
    props;
  const button = useRef<HTMLButtonElement>(null);
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null);

  const open = () => {
    const rect = button.current?.getBoundingClientRect();
    if (disabled || !rect) return;
    setPosition({ x: rect.left, y: rect.bottom + 4 });
  };

  return (
    <>
      <button
        ref={button}
        type="button"
        className={className}
        data-toolbar-item={itemId}
        tabIndex={tabIndex}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={position !== null}
        aria-disabled={disabled || undefined}
        {...tooltipProps}
        onMouseDown={(event) => event.preventDefault()}
        onClick={open}
        onKeyDown={(event) => {
          if (event.key !== 'ArrowDown') return;
          event.preventDefault();
          open();
        }}
      >
        {children}
      </button>
      {position ? (
        <PopupMenu
          label={menuLabel}
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
