import { useEffect, useRef, type ReactNode, type RefObject } from 'react';
import { suspendShortcuts } from '../../lib/shortcuts/shortcut-registry';
import { holdToastTimers } from '../../lib/toast-store';
import { useFocusTrap } from './use-focus-trap';
import './dialogs.css';

export interface ModalFrameProps {
  labelledBy: string;
  describedBy?: string;
  /** `alertdialog` for confirmations of destructive actions. */
  role?: 'dialog' | 'alertdialog';
  onCancel: () => void;
  initialFocus?: RefObject<HTMLElement | null>;
  /** A tall dialog read from the top: opening does not scroll it to the focused button. */
  startAtTop?: boolean;
  className?: string;
  children: ReactNode;
}

/**
 * Accessible modal: backdrop, `aria-modal`, focus trap, `Esc` and backdrop click cancel, focus
 * returns on close. Global shortcuts are suspended and toast countdowns frozen while it is open
 * (the backdrop covers the toasts, so an undo must not expire out of reach).
 */
export function ModalFrame({
  labelledBy,
  describedBy,
  role = 'dialog',
  onCancel,
  initialFocus,
  startAtTop,
  className,
  children,
}: ModalFrameProps) {
  const ref = useRef<HTMLDivElement>(null);
  useFocusTrap(ref, { onEscape: onCancel, initialFocus, startAtTop });
  useEffect(() => suspendShortcuts(), []);
  useEffect(() => holdToastTimers(), []);

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <div
        ref={ref}
        className={className ? `modal ${className}` : 'modal'}
        role={role}
        aria-modal="true"
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
        tabIndex={-1}
      >
        {children}
      </div>
    </div>
  );
}
